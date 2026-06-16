// ============================================================
// Aura AI — Edge Function: generate-kit
// Llama a Claude Vision para generar el Kit de Lanzamiento completo
// ============================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.27.0";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---- Límites de costo (techo duro: ~$0.15 por kit) ----------
const LIMITS = {
  MAX_IMAGES: 3,
  MAX_TOKENS_OUTPUT: 8000,
  MAX_DESCRIPTION_CHARS: 1000,
  MAX_PROMPT_CHARS: 4000,
  BUDGET_ALERT_USD: 0.12,
  COST_PER_INPUT_TOKEN: 0.000003,   // $3 / 1M tokens (Sonnet 4.6)
  COST_PER_OUTPUT_TOKEN: 0.000015,  // $15 / 1M tokens
} as const;

// ---- Créditos por plan ---------------------------------------
const PLAN_CREDITS: Record<string, { kits: number; videos: number }> = {
  free:    { kits: 2,   videos: 0  },
  creator: { kits: 20,  videos: 5  },
  agency:  { kits: -1,  videos: 20 }, // -1 = ilimitado
};

// ---- Tipos de oferta soportados ------------------------------
type OfferType = "producto_fisico" | "infoproducto" | "producto_digital" | "servicio" | "saas";

// Contexto adaptado por tipo para el análisis visual y el copy
const OFFER_TYPE_CONTEXT: Record<OfferType, {
  label: string;
  visual_hint: string;
  copy_hint: string;
  broll_hint: string;
  cta_hint: string;
}> = {
  producto_fisico: {
    label: "Producto Físico",
    visual_hint: "Analiza empaque, colores, tipografía, materiales percibidos, diseño de la caja o etiqueta, sensación táctil visual y presentación en las imágenes.",
    copy_hint: "Enfócate en el resultado tangible, la experiencia sensorial y la transformación visible que produce el producto.",
    broll_hint: "Tomas del producto en uso, unboxing, detalles del empaque, manos sosteniendo el producto, antes/después.",
    cta_hint: "Compra ahora · Pide el tuyo · Envío gratis hoy",
  },
  infoproducto: {
    label: "Infoproducto (Curso / Ebook / Template / Taller)",
    visual_hint: "Si hay imágenes, analiza el mockup del ebook/curso, paleta de colores, tipografía usada, percepción de valor y credibilidad profesional. Si no hay imágenes, deriva la identidad visual del nombre y la descripción.",
    copy_hint: "Enfócate en la transformación de conocimiento: el ANTES (ignorancia/frustración) vs el DESPUÉS (habilidad/resultado). Usa el lenguaje de la promesa de aprendizaje. Reduce la percepción de dificultad. El precio se justifica comparándolo con alternativas (cursos tradicionales, contratar a alguien).",
    broll_hint: "Pantalla del curso con texto animado, mockup del ebook flotando, capturas de resultados de alumnos, timer contando resultados, manos en teclado trabajando.",
    cta_hint: "Accede ahora · Empieza hoy · Quiero aprender esto · Descarga gratis",
  },
  producto_digital: {
    label: "Producto Digital (Software / App / Plugin / Plantilla / Pack)",
    visual_hint: "Si hay imágenes, analiza capturas de pantalla de la interfaz, UX percibida, paleta de colores del producto, sensación de modernidad y facilidad de uso. Si son plantillas/packs, analiza el diseño visual y la completitud percibida.",
    copy_hint: "Enfócate en el ahorro de tiempo y la automatización. El cliente no compra el producto, compra horas recuperadas y problemas eliminados. Cuantifica el ahorro: '3 horas de trabajo → 3 minutos'. Reduce la fricción técnica en el copy.",
    broll_hint: "Screen recording del producto funcionando, dashboard con métricas positivas, comparación antes/después en pantalla, temporizador acelerando, notificaciones de éxito.",
    cta_hint: "Pruébalo gratis · Descárgalo ahora · Activa tu licencia · Empieza en 60 segundos",
  },
  servicio: {
    label: "Servicio (Consultoría / Coaching / Agencia / Freelance)",
    visual_hint: "Si hay imágenes, analiza el branding personal o de la agencia, la percepción de expertise, confianza y profesionalismo. Busca señales de autoridad. Si no hay imágenes, construye la identidad visual del experto desde la descripción.",
    copy_hint: "Para servicios, la credibilidad es el activo más importante. El copy debe posicionar al proveedor como el experto indiscutible del nicho. Usa resultados específicos de clientes anteriores (aunque sean hipotéticos ilustrativos). Reduce el riesgo percibido con garantías. El CTA debe ser de baja fricción: una llamada, una consulta gratuita, un diagnóstico.",
    broll_hint: "Pantalla de videollamada con cliente, dashboard con resultados de cliente, testimonios en pantalla, gráficas de crecimiento, proceso de trabajo paso a paso.",
    cta_hint: "Agenda tu consulta · Quiero trabajar contigo · Solicita tu diagnóstico gratis · Reserva tu lugar",
  },
  saas: {
    label: "SaaS (Software as a Service / Herramienta Online / Plataforma)",
    visual_hint: "Si hay capturas o mockups, analiza la limpieza de la UI, la curva de aprendizaje percibida, las métricas que muestra el dashboard, y la sensación de potencia vs simplicidad. El diseño de un SaaS comunica la sofisticación del producto.",
    copy_hint: "Para SaaS, el copy debe atacar el dolor del proceso manual actual ('¿Cuántas horas pierdes haciendo X a mano?'). Posiciona el SaaS como la infraestructura del negocio, no como una herramienta opcional. Usa el argumento ROI: el precio mensual vs el costo de NO usarlo. El free trial o freemium es el CTA de mayor conversión.",
    broll_hint: "Demo del dashboard en acción, notificaciones de automatización disparándose, comparación manual vs automatizado, métricas creciendo en tiempo real, integraciones conectándose.",
    cta_hint: "Prueba gratis 14 días · Empieza sin tarjeta · Ver demo · Activa tu cuenta",
  },
};

// ---- Prompt Maestro de Élite — Universal por tipo de oferta --
function buildMasterPrompt(params: {
  nombre: string;
  descripcion: string;
  nicho: string;
  audiencia: string;
  tono: string;
  objetivo: string;
  plataforma: string;
  offer_type: OfferType;
}): string {
  const desc = params.descripcion.slice(0, LIMITS.MAX_DESCRIPTION_CHARS);
  const ctx  = OFFER_TYPE_CONTEXT[params.offer_type] ?? OFFER_TYPE_CONTEXT.producto_fisico;

  const today = new Date().toLocaleDateString("es-LA", { year: "numeric", month: "long", day: "numeric" });

  return `Responde ÚNICAMENTE con JSON puro válido, sin texto antes ni después, sin bloques de código markdown.

Eres el estratega de marketing digital más élite del mundo hispanohablante. Tu expertise abarca copywriting directo (Gary Halbert, Eugene Schwartz), embudos de ventas (Russell Brunson), posicionamiento (April Dunford), psicología del consumidor y el comportamiento actual de los algoritmos de las principales plataformas digitales.

Fecha actual: ${today}

TIPO DE OFERTA: ${ctx.label}
INSTRUCCIÓN DE ANÁLISIS VISUAL: ${ctx.visual_hint}
ENFOQUE DE COPY: ${ctx.copy_hint}
CTAs DE REFERENCIA PARA ESTE TIPO: ${ctx.cta_hint}

DATOS DE LA OFERTA:
Nombre: ${params.nombre}
Descripción: ${desc}
Nicho: ${params.nicho}
Audiencia objetivo: ${params.audiencia}
Tono de marca: ${params.tono}
Objetivo principal: ${params.objetivo}
Plataforma prioritaria: ${params.plataforma}

CRITERIOS DE CALIDAD OBLIGATORIOS:
1. NUNCA uses tendencias o datos hardcodeados. Razona las tendencias actuales desde tu conocimiento experto considerando: el nicho específico, el tipo de oferta, la plataforma prioritaria, la audiencia y el momento del mercado.
2. En el campo "trend_alerts" del JSON debes identificar y describir las tendencias de contenido, formato, copy y algoritmo que son MÁS RELEVANTES para esta oferta específica en esta plataforma específica — no tendencias genéricas del marketing digital.
3. Cada hook debe ser 100% específico para ESTA oferta — imposible de reutilizar en cualquier otro negocio.
4. El copy usa el lenguaje exacto de la audiencia objetivo (su jerga, sus miedos reales, sus deseos específicos).
5. Adapta el "B-Roll sin rostro" al tipo: ${ctx.broll_hint}
6. Subject lines de email que pasan filtros anti-spam de Gmail.
7. Hashtags en 3 capas: 10 alta competencia + 10 media + 10 micro-nicho, elegidos para esta audiencia y nicho.
8. Horarios de publicación: usa tu criterio experto para la plataforma "${params.plataforma}" y la audiencia "${params.audiencia}" — no apliques horarios genéricos.
9. Principio "One Big Idea": todo el kit debe girar alrededor de UNA promesa central.
10. Para infoproductos/SaaS/servicios: los bullets deben atacar la objeción de precio comparando con el costo alternativo.

Genera el siguiente JSON completo:

{
  "one_big_idea": "La promesa central única en 1 frase irresistible",
  "product_analysis": {
    "visual_identity": "Descripción precisa de colores, tipografía, sensación de marca y calidad percibida detectada en las imágenes",
    "unique_value_proposition": "Qué diferencia radical tiene este producto vs todo lo demás",
    "target_emotion": "La emoción primaria que activa la compra (libertad/seguridad/estatus/pertenencia/venganza/amor)",
    "brand_archetype": "Arquetipo detectado: El Sabio / El Héroe / El Rebelde / El Amante / El Cuidador / El Creador"
  },
  "funnel_copy": {
    "headline_principal": "Headline fórmula [Resultado específico] en [Tiempo] sin [Objeción principal]",
    "subheadline": "Subheadline con beneficio emocional profundo",
    "vsl_script_opening": "Primeros 45 segundos del VSL usando AIDA — específico para este producto",
    "sales_page_bullets": [
      "Descubre el [secreto]: cómo [beneficio concreto] incluso si [objeción común]",
      "La razón por la que [problema del cliente] y cómo [solución del producto]",
      "El método probado para [resultado deseado] sin [sacrificio que temen]",
      "Por qué [alternativa que usan hoy] no funciona — y qué hacer en cambio",
      "Cómo [resultado aspiracional] en solo [tiempo realista] desde [punto de partida]"
    ],
    "cta_primary": "CTA con verbo acción + urgencia + beneficio inmediato",
    "cta_secondary": "CTA suave para indecisos (garantía o prueba gratuita)",
    "thank_you_message": "Mensaje post-compra que elimina remordimiento y presenta upsell natural"
  },
  "viral_hooks": {
    "curiosity": [
      "Hook específico del producto — primeros 3 segundos en pantalla",
      "Hook 2 — fórmula 'Nadie te ha contado esto sobre [tema del producto]...'",
      "Hook 3 — fórmula 'Lo que descubrí después de [situación relatable]...'"
    ],
    "fear_of_missing_out": [
      "Hook FOMO 1 — activa miedo a quedarse atrás específico del nicho",
      "Hook FOMO 2 — 'Mientras tú [acción pasiva], ellos ya están [resultado]'",
      "Hook FOMO 3 — urgencia de tendencia o ventana de oportunidad"
    ],
    "social_proof": [
      "Hook prueba social 1 — formato resultado o transformación",
      "Hook prueba social 2 — dato o estadística del nicho",
      "Hook prueba social 3 — formato 'De [situación inicial] a [resultado]'"
    ],
    "youtube_shorts_titles": [
      "Título SEO para YouTube Shorts — keyword principal + número + beneficio",
      "Título 2 — formato pregunta que el usuario ya se hace"
    ],
    "pov_format": [
      "POV: [situación en la que el espectador se reconoce al 100%]",
      "POV: [momento de transformación gracias al producto]"
    ]
  },
  "email_sequence": [
    {
      "day": 0,
      "type": "Bienvenida + Quick Win",
      "subject": "7 palabras que cambiaron mi [resultado del nicho] (te las comparto)",
      "preview_text": "Esto funciona incluso si eres principiante completo",
      "body_hook": "Párrafo de apertura con historia de identificación — específica al producto y audiencia",
      "cta": "CTA concreto y de bajo compromiso"
    },
    {
      "day": 1,
      "type": "Educar + Problema",
      "subject": "El error #1 que comete el 90% en [nicho] (y cómo evitarlo)",
      "preview_text": "Yo también lo cometí hasta que encontré esto",
      "body_hook": "Revela el problema profundo que el producto resuelve, usando el lenguaje exacto de la audiencia",
      "cta": "CTA educativo que lleva al producto"
    },
    {
      "day": 3,
      "type": "Prueba Social + Historia",
      "subject": "Cómo [persona como el lector] logró [resultado específico] en [tiempo]",
      "preview_text": "Sin experiencia previa. Sin inversión enorme.",
      "body_hook": "Historia de transformación real o hipotética que sea 100% relatable para la audiencia",
      "cta": "CTA con prueba social o garantía"
    },
    {
      "day": 5,
      "type": "Oferta Principal",
      "subject": "Todo lo que incluye [nombre del producto] (y por qué vale 10x el precio)",
      "preview_text": "Abre antes de que cambie el precio",
      "body_hook": "Presenta la oferta completa con todos los beneficios y derriba la objeción de precio con ROI",
      "cta": "CTA de compra directa con urgencia real"
    },
    {
      "day": 7,
      "type": "Urgencia + Cierre",
      "subject": "Última oportunidad (cierra en 24h)",
      "preview_text": "No quiero que te quedes fuera",
      "body_hook": "Recapitula el problema, la solución, la transformación posible y la consecuencia de no actuar",
      "cta": "CTA final con escasez o fecha límite"
    }
  ],
  "social_content_pack": {
    "instagram_captions": [
      {
        "type": "Educativo",
        "hook_line": "Primera línea que detiene el scroll — antes del botón 'más' de Instagram",
        "body": "3-5 líneas de valor real con saltos de línea para legibilidad móvil",
        "cta": "Pregunta de engagement o acción concreta",
        "emoji_style": "moderado"
      },
      {
        "type": "Viral Hook",
        "hook_line": "Hook de curiosidad irresistible",
        "body": "Revelación del gancho con valor inesperado",
        "cta": "Guarda este post + compártelo",
        "emoji_style": "abundante"
      },
      {
        "type": "Prueba Social",
        "hook_line": "Hook de transformación o resultado",
        "body": "Historia corta de antes/después relacionada al producto",
        "cta": "Comenta tu situación actual",
        "emoji_style": "moderado"
      },
      {
        "type": "Oferta / CTA",
        "hook_line": "Hook de FOMO o beneficio directo",
        "body": "Presenta el producto de forma natural, sin sonar a venta directa",
        "cta": "Link en bio / DM para info",
        "emoji_style": "minimalista"
      },
      {
        "type": "Entretenimiento",
        "hook_line": "Hook divertido o sorpresivo del nicho",
        "body": "Contenido que entretiene y educa a la vez — máximo shareable",
        "cta": "Etiqueta a alguien que necesita ver esto",
        "emoji_style": "abundante"
      }
    ],
    "twitter_threads": [
      {
        "tweet_1": "Tweet de apertura — el más importante. Hook fuerte que promete valor específico (1/7)",
        "tweets_2_6": [
          "Tweet 2 — Desarrolla el punto 1 con dato o insight concreto (2/7)",
          "Tweet 3 — Punto 2 con ejemplo práctico del nicho (3/7)",
          "Tweet 4 — Punto 3 — el más contraintuitivo del thread (4/7)",
          "Tweet 5 — Punto 4 con aplicación inmediata (5/7)",
          "Tweet 6 — El punto que más va a sorprender (6/7)"
        ],
        "tweet_cierre": "Tweet de cierre — resume el valor, CTA suave, pide RT si fue útil (7/7)"
      }
    ],
    "pinterest_descriptions": [
      "Descripción 1 — keywords naturales para búsqueda en Pinterest + beneficio del producto + CTA",
      "Descripción 2 — enfoque en el problema que resuelve + keywords de nicho",
      "Descripción 3 — enfoque aspiracional + hashtags relevantes de Pinterest"
    ],
    "reel_scripts": [
      {
        "duracion_segundos": 15,
        "hook_visual": "Qué se ve en pantalla segundos 0-2 sin mostrar rostro (ej: manos, producto, texto animado)",
        "hook_audio": "Texto en pantalla o voz en off exacto de los primeros 2 segundos",
        "development": "Desarrollo compacto segundos 3-12 — una idea, un beneficio, un dato",
        "cta_final": "CTA últimos 3 segundos — acción específica",
        "broll_suggestions": "3 tomas de b-roll concretas sin mostrar cara"
      },
      {
        "duracion_segundos": 30,
        "hook_visual": "Toma de apertura de 30s sin rostro",
        "hook_audio": "Hook de audio/texto en pantalla",
        "development": "Desarrollo de 20 segundos con mini-historia o proceso",
        "cta_final": "CTA con beneficio inmediato",
        "broll_suggestions": "5 tomas de b-roll concretas"
      },
      {
        "duracion_segundos": 60,
        "hook_visual": "Apertura de Reel 60s sin rostro — la más impactante visualmente",
        "hook_audio": "Hook que promete transformación en 60 segundos",
        "development": "Tutorial o historia completa en 50 segundos — paso a paso",
        "cta_final": "CTA fuerte con urgencia",
        "broll_suggestions": "7 tomas de b-roll para narrar sin cara"
      }
    ]
  },
  "seo_strategy": {
    "one_big_keyword": "La keyword principal más buscada del nicho",
    "primary_keywords": ["keyword 1", "keyword 2", "keyword 3", "keyword 4", "keyword 5"],
    "long_tail_keywords": [
      "frase long tail de intención de compra 1",
      "frase long tail informacional 2",
      "frase long tail de comparación 3"
    ],
    "hashtags_high_competition": ["#tag1","#tag2","#tag3","#tag4","#tag5","#tag6","#tag7","#tag8","#tag9","#tag10"],
    "hashtags_medium": ["#tag1","#tag2","#tag3","#tag4","#tag5","#tag6","#tag7","#tag8","#tag9","#tag10"],
    "hashtags_micro_niche": ["#tag1","#tag2","#tag3","#tag4","#tag5","#tag6","#tag7","#tag8","#tag9","#tag10"]
  },
  "content_calendar": {
    "semana_1": [
      {"dia": "Lunes",    "tipo": "Educativo",      "tema": "tema concreto semana 1", "plataforma": "Instagram", "horario": "10:00am", "formato": "Carrusel 5 slides", "cta": "CTA específico"},
      {"dia": "Martes",   "tipo": "Viral Hook",     "tema": "tema concreto",          "plataforma": "TikTok",    "horario": "8:00pm",  "formato": "Reel 15s",          "cta": "CTA"},
      {"dia": "Miércoles","tipo": "Valor",           "tema": "tema concreto",          "plataforma": "Instagram", "horario": "7:00pm",  "formato": "Reel 30s",          "cta": "CTA"},
      {"dia": "Jueves",   "tipo": "Comunidad",      "tema": "tema concreto",          "plataforma": "X/Twitter", "horario": "12:00pm", "formato": "Thread 7 tweets",   "cta": "CTA"},
      {"dia": "Viernes",  "tipo": "Prueba Social",  "tema": "tema concreto",          "plataforma": "Instagram", "horario": "7:00pm",  "formato": "Post + Story",      "cta": "CTA"},
      {"dia": "Sábado",   "tipo": "Entretenimiento","tema": "tema concreto",          "plataforma": "TikTok",    "horario": "9:00pm",  "formato": "Reel 60s",          "cta": "CTA"},
      {"dia": "Domingo",  "tipo": "Inspiracional",  "tema": "tema concreto",          "plataforma": "Pinterest", "horario": "9:00pm",  "formato": "Pin + Descripción", "cta": "CTA"}
    ],
    "semana_2": [
      {"dia": "Lunes",    "tipo": "Problema/Solución","tema": "tema semana 2", "plataforma": "Instagram", "horario": "10:00am", "formato": "Carrusel",    "cta": "CTA"},
      {"dia": "Martes",   "tipo": "Tutorial",         "tema": "tema",         "plataforma": "TikTok",    "horario": "8:00pm",  "formato": "Reel 60s",    "cta": "CTA"},
      {"dia": "Miércoles","tipo": "UGC-style",        "tema": "tema",         "plataforma": "Instagram", "horario": "7:00pm",  "formato": "Reel 30s",    "cta": "CTA"},
      {"dia": "Jueves",   "tipo": "Dato o Estadística","tema": "tema",       "plataforma": "X/Twitter", "horario": "12:00pm", "formato": "Tweet simple","cta": "CTA"},
      {"dia": "Viernes",  "tipo": "FOMO",             "tema": "tema",         "plataforma": "Instagram", "horario": "7:00pm",  "formato": "Story + Post","cta": "CTA"},
      {"dia": "Sábado",   "tipo": "Detrás de escena", "tema": "tema",         "plataforma": "TikTok",    "horario": "9:00pm",  "formato": "Reel 15s",    "cta": "CTA"},
      {"dia": "Domingo",  "tipo": "Pinterest SEO",    "tema": "tema",         "plataforma": "Pinterest", "horario": "9:00pm",  "formato": "Pin",         "cta": "CTA"}
    ],
    "semana_3": [
      {"dia": "Lunes",    "tipo": "Conversión",    "tema": "tema semana 3 (enfoque en venta)", "plataforma": "Instagram", "horario": "10:00am", "formato": "Carrusel",     "cta": "CTA de compra"},
      {"dia": "Martes",   "tipo": "Testimonio",    "tema": "tema",                             "plataforma": "TikTok",    "horario": "8:00pm",  "formato": "Reel 30s",     "cta": "CTA"},
      {"dia": "Miércoles","tipo": "Oferta",        "tema": "tema",                             "plataforma": "Instagram", "horario": "7:00pm",  "formato": "Post + Story", "cta": "CTA venta"},
      {"dia": "Jueves",   "tipo": "Objeciones",    "tema": "Derriba las 3 objeciones principales", "plataforma": "X/Twitter", "horario": "12:00pm", "formato": "Thread", "cta": "CTA"},
      {"dia": "Viernes",  "tipo": "Valor Premium", "tema": "tema",                             "plataforma": "Instagram", "horario": "7:00pm",  "formato": "Reel 60s",     "cta": "CTA"},
      {"dia": "Sábado",   "tipo": "Caso de éxito", "tema": "tema",                             "plataforma": "TikTok",    "horario": "9:00pm",  "formato": "Reel 60s",     "cta": "CTA compra"},
      {"dia": "Domingo",  "tipo": "Inspiracional", "tema": "tema",                             "plataforma": "Pinterest", "horario": "9:00pm",  "formato": "Pin",           "cta": "CTA"}
    ],
    "semana_4": [
      {"dia": "Lunes",    "tipo": "Urgencia",      "tema": "tema semana 4 (cierre)", "plataforma": "Instagram", "horario": "10:00am", "formato": "Post",         "cta": "CTA urgencia"},
      {"dia": "Martes",   "tipo": "Recordatorio",  "tema": "tema",                   "plataforma": "TikTok",    "horario": "8:00pm",  "formato": "Reel 15s",     "cta": "CTA"},
      {"dia": "Miércoles","tipo": "Último llamado","tema": "tema",                   "plataforma": "Instagram", "horario": "7:00pm",  "formato": "Story",        "cta": "CTA final"},
      {"dia": "Jueves",   "tipo": "Community",     "tema": "tema",                   "plataforma": "X/Twitter", "horario": "12:00pm", "formato": "Tweet",        "cta": "CTA"},
      {"dia": "Viernes",  "tipo": "Cierre",        "tema": "tema",                   "plataforma": "Instagram", "horario": "7:00pm",  "formato": "Post + Story", "cta": "CTA cierre"},
      {"dia": "Sábado",   "tipo": "Celebración",   "tema": "Resultados del mes",     "plataforma": "TikTok",    "horario": "9:00pm",  "formato": "Reel 30s",     "cta": "CTA nuevo ciclo"},
      {"dia": "Domingo",  "tipo": "Planificación", "tema": "Preview del próximo mes","plataforma": "Pinterest", "horario": "9:00pm",  "formato": "Pin",          "cta": "CTA suscripción"}
    ]
  },
  "trend_alerts": [
    {
      "plataforma": "La plataforma específica a la que aplica esta tendencia (ej: Instagram Reels, TikTok, YouTube Shorts, LinkedIn, Pinterest, Email...)",
      "tendencia": "Describe la tendencia real que identificas para este nicho+plataforma+tipo de oferta. No nombres genéricos — describe el patrón de comportamiento concreto que está funcionando para audiencias similares a la de esta oferta.",
      "razonamiento": "Explica brevemente por qué esta tendencia es relevante para ESTA oferta específica y ESTA audiencia específica. Conecta la tendencia con los datos del negocio.",
      "como_aplicarla": "Instrucción táctica específica y ejecutable: qué hacer exactamente, con qué formato, con qué frecuencia, con qué ángulo de contenido.",
      "urgencia": "alta | media | baja — basada en qué tan ventana de oportunidad es este momento para esta tendencia"
    },
    {
      "plataforma": "...",
      "tendencia": "Segunda tendencia identificada para este caso específico",
      "razonamiento": "...",
      "como_aplicarla": "...",
      "urgencia": "media"
    },
    {
      "plataforma": "...",
      "tendencia": "Tercera tendencia — puede ser de copy, formato, algoritmo, comportamiento de audiencia o estética visual",
      "razonamiento": "...",
      "como_aplicarla": "...",
      "urgencia": "baja"
    }
  ]
}`;
}

// ---- Handler principal ---------------------------------------
Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  try {
    // 1. Autenticar usuario con JWT de Supabase Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Token inválido" }, 401);

    // 2. Verificar créditos del usuario
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("plan_type, credits_kits")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) return json({ error: "Perfil no encontrado" }, 404);

    const planLimits = PLAN_CREDITS[profile.plan_type];
    const hasKitCredits = planLimits.kits === -1 || profile.credits_kits > 0;
    if (!hasKitCredits) {
      return json({
        error: "Sin créditos disponibles",
        message: `Tu plan ${profile.plan_type} no tiene kits disponibles este mes. Actualiza tu plan para continuar.`,
        upgrade_required: true,
      }, 402);
    }

    // 3. Parsear y validar el body
    const body = await req.json();
    const {
      nombre, descripcion, nicho, target_audience,
      tono, product_goal, platform_focus = "instagram",
      offer_type = "producto_fisico",
      product_id, image_urls = [],
    } = body;

    // Validar offer_type
    const validOfferTypes: OfferType[] = ["producto_fisico", "infoproducto", "producto_digital", "servicio", "saas"];
    const safeOfferType: OfferType = validOfferTypes.includes(offer_type) ? offer_type : "producto_fisico";

    if (!nombre || !descripcion || !nicho || !target_audience || !tono || !product_goal) {
      return json({ error: "Faltan campos requeridos: nombre, descripcion, nicho, target_audience, tono, product_goal" }, 400);
    }

    // 4. Limitar imágenes
    const limitedImages: string[] = (image_urls as string[]).slice(0, LIMITS.MAX_IMAGES);
    if ((image_urls as string[]).length > LIMITS.MAX_IMAGES) {
      console.warn(`Usuario ${user.id} envió ${image_urls.length} imágenes — truncadas a ${LIMITS.MAX_IMAGES}`);
    }

    // 5. Si hay product_id, obtener datos del producto
    let productData: { name: string; description: string; media_urls: string[] } | null = null;
    if (product_id) {
      const { data: prod } = await supabase
        .from("products")
        .select("name, description, media_urls")
        .eq("id", product_id)
        .eq("user_id", user.id)
        .single();
      if (prod) {
        productData = prod;
        // Agregar URLs del producto (respetando el límite)
        const productImages = (prod.media_urls as string[]).slice(0, LIMITS.MAX_IMAGES);
        limitedImages.push(...productImages.slice(0, LIMITS.MAX_IMAGES - limitedImages.length));
      }
    }

    // 6. Construir el prompt maestro
    const promptText = buildMasterPrompt({
      nombre: productData?.name ?? nombre,
      descripcion: productData?.description ?? descripcion,
      nicho,
      audiencia: target_audience,
      tono,
      objetivo: product_goal,
      plataforma: platform_focus,
      offer_type: safeOfferType,
    });

    // 7. Construir bloques de contenido para Claude Vision
    const contentBlocks: Anthropic.MessageParam["content"] = [];

    // Agregar imágenes si las hay (formato URL directo)
    for (const imageUrl of limitedImages) {
      contentBlocks.push({
        type: "image",
        source: {
          type: "url",
          url: imageUrl,
        },
      } as Anthropic.ImageBlockParam);
    }

    // Agregar el prompt de texto
    contentBlocks.push({ type: "text", text: promptText.slice(0, LIMITS.MAX_PROMPT_CHARS + 3000) });

    // 8. Llamar a Claude Sonnet 4.6
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: LIMITS.MAX_TOKENS_OUTPUT,
      messages: [{ role: "user", content: contentBlocks }],
    });

    // 9. Calcular y registrar costo real
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd = (inputTokens * LIMITS.COST_PER_INPUT_TOKEN) + (outputTokens * LIMITS.COST_PER_OUTPUT_TOKEN);

    if (costUsd >= LIMITS.BUDGET_ALERT_USD) {
      console.warn(`[BUDGET ALERT] Kit generado con costo $${costUsd.toFixed(6)} — usuario: ${user.id}`);
    }
    console.log(`[KIT] usuario=${user.id} input=${inputTokens} output=${outputTokens} costo=$${costUsd.toFixed(6)}`);

    // 10. Parsear respuesta JSON de Claude
    const rawText = response.content[0].type === "text" ? response.content[0].text : "";
    let kitJson: Record<string, unknown>;
    try {
      // Limpiar posibles bloques de código que Claude pueda agregar a pesar del prompt
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      kitJson = JSON.parse(cleaned);
    } catch {
      console.error("[KIT] Claude no respondió con JSON válido:", rawText.slice(0, 500));
      return json({ error: "Error al parsear respuesta de IA. Intenta nuevamente." }, 500);
    }

    // 11. Guardar kit en la BD
    const { data: savedKit, error: kitError } = await supabase
      .from("kits")
      .insert({
        user_id: user.id,
        product_id: product_id ?? null,
        niche: nicho,
        offer_type: safeOfferType,
        target_audience,
        tone: tono,
        product_goal,
        platform_focus,
        generated_json: kitJson,
        tokens_used: inputTokens + outputTokens,
        cost_usd: costUsd,
      })
      .select("id")
      .single();

    if (kitError) {
      console.error("[KIT] Error guardando en BD:", kitError);
    }

    // 12. Descontar 1 crédito (solo si no es plan agency con créditos ilimitados)
    if (planLimits.kits !== -1) {
      await supabase
        .from("profiles")
        .update({ credits_kits: profile.credits_kits - 1 })
        .eq("id", user.id);
    }

    // 13. Retornar el kit generado
    return json({
      success: true,
      kit_id: savedKit?.id ?? null,
      kit: kitJson,
      meta: {
        tokens_used: inputTokens + outputTokens,
        cost_usd: parseFloat(costUsd.toFixed(6)),
        images_analyzed: limitedImages.length,
        credits_remaining: planLimits.kits === -1 ? "ilimitado" : profile.credits_kits - 1,
      },
    });

  } catch (err) {
    console.error("[KIT] Error inesperado:", err);
    return json({ error: "Error interno del servidor" }, 500);
  }
});

// Utilidad de respuesta JSON
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

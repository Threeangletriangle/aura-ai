// ============================================================
// Aura AI — Edge Function: generate-kit
// Llama a Claude Vision para generar el Kit de Lanzamiento completo
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

// ---- Límites de costo (techo duro: ~$0.15 por kit) ----------
const LIMITS = {
  MAX_IMAGES: 3,
  MAX_TOKENS_OUTPUT: 5000,
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

Genera un JSON con EXACTAMENTE estas claves. Contenido real y específico para esta oferta — nada genérico:

{
  "one_big_idea": "promesa central en 1 frase",
  "product_analysis": { "visual_identity": "...", "unique_value_proposition": "...", "target_emotion": "...", "brand_archetype": "..." },
  "funnel_copy": {
    "headline_principal": "...", "subheadline": "...", "vsl_script_opening": "primeros 45 seg VSL...",
    "sales_page_bullets": ["bullet 1","bullet 2","bullet 3","bullet 4","bullet 5"],
    "cta_primary": "...", "cta_secondary": "...", "thank_you_message": "..."
  },
  "viral_hooks": {
    "curiosity": ["hook1","hook2","hook3"],
    "fear_of_missing_out": ["hook1","hook2","hook3"],
    "social_proof": ["hook1","hook2","hook3"],
    "youtube_shorts_titles": ["titulo1","titulo2"],
    "pov_format": ["pov1","pov2"]
  },
  "email_sequence": [
    {"day":0,"type":"Bienvenida","subject":"...","preview_text":"...","body_hook":"...","cta":"..."},
    {"day":1,"type":"Educar","subject":"...","preview_text":"...","body_hook":"...","cta":"..."},
    {"day":3,"type":"Prueba Social","subject":"...","preview_text":"...","body_hook":"...","cta":"..."},
    {"day":5,"type":"Oferta","subject":"...","preview_text":"...","body_hook":"...","cta":"..."},
    {"day":7,"type":"Urgencia","subject":"...","preview_text":"...","body_hook":"...","cta":"..."}
  ],
  "social_content_pack": {
    "instagram_captions": [
      {"type":"Educativo","hook_line":"...","body":"...","cta":"..."},
      {"type":"Viral Hook","hook_line":"...","body":"...","cta":"..."},
      {"type":"Prueba Social","hook_line":"...","body":"...","cta":"..."}
    ],
    "twitter_threads": [{"tweet_1":"...","tweets_2_6":["t2","t3","t4","t5","t6"],"tweet_cierre":"..."}],
    "pinterest_descriptions": ["desc1","desc2"],
    "reel_scripts": [
      {"duracion_segundos":15,"hook_visual":"...","hook_audio":"...","development":"...","cta_final":"...","broll_suggestions":"..."},
      {"duracion_segundos":60,"hook_visual":"...","hook_audio":"...","development":"...","cta_final":"...","broll_suggestions":"..."}
    ]
  },
  "seo_strategy": {
    "one_big_keyword": "...",
    "primary_keywords": ["kw1","kw2","kw3","kw4","kw5"],
    "long_tail_keywords": ["lt1","lt2","lt3"],
    "hashtags_high_competition": ["#h1","#h2","#h3","#h4","#h5","#h6","#h7","#h8","#h9","#h10"],
    "hashtags_medium": ["#m1","#m2","#m3","#m4","#m5","#m6","#m7","#m8","#m9","#m10"],
    "hashtags_micro_niche": ["#n1","#n2","#n3","#n4","#n5","#n6","#n7","#n8","#n9","#n10"]
  },
  "content_calendar": {
    "semana_1": [
      {"dia":"Lunes","tipo":"Educativo","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."},
      {"dia":"Miércoles","tipo":"Viral","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."},
      {"dia":"Viernes","tipo":"Prueba Social","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."}
    ],
    "semana_2": [{"dia":"Lunes","tipo":"...","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."},{"dia":"Miércoles","tipo":"...","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."},{"dia":"Viernes","tipo":"...","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."}],
    "semana_3": [{"dia":"Lunes","tipo":"Conversión","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."},{"dia":"Miércoles","tipo":"...","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."},{"dia":"Viernes","tipo":"...","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."}],
    "semana_4": [{"dia":"Lunes","tipo":"Urgencia","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."},{"dia":"Miércoles","tipo":"...","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."},{"dia":"Viernes","tipo":"Cierre","tema":"...","plataforma":"...","horario":"...","formato":"...","cta":"..."}]
  },
  "trend_alerts": [
    {"plataforma":"...","tendencia":"...","razonamiento":"...","como_aplicarla":"...","urgencia":"alta"},
    {"plataforma":"...","tendencia":"...","razonamiento":"...","como_aplicarla":"...","urgencia":"media"},
    {"plataforma":"...","tendencia":"...","razonamiento":"...","como_aplicarla":"...","urgencia":"baja"}
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
    type ContentBlock = { type: "text"; text: string } | { type: "image"; source: { type: "url"; url: string } };
    const contentBlocks: ContentBlock[] = [];

    // Agregar imágenes si las hay (formato URL directo)
    for (const imageUrl of limitedImages) {
      contentBlocks.push({
        type: "image",
        source: { type: "url", url: imageUrl },
      });
    }

    // Agregar el prompt de texto
    contentBlocks.push({ type: "text", text: promptText.slice(0, LIMITS.MAX_PROMPT_CHARS + 3000) });

    // 8. Llamar a Claude Sonnet 4.6 via fetch directo (sin SDK)
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      console.error("[KIT] ANTHROPIC_API_KEY no configurada");
      return json({ error: "Configuración incompleta en el servidor" }, 500);
    }

    // Construir el body — si no hay imágenes mandamos solo texto
    const messagesBody = contentBlocks.length > 0
      ? [{ role: "user", content: contentBlocks }]
      : [{ role: "user", content: [{ type: "text", text: promptText.slice(0, LIMITS.MAX_PROMPT_CHARS + 3000) }] }];

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: LIMITS.MAX_TOKENS_OUTPUT,
        messages: messagesBody,
      }),
    });

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text();
      console.error(`[KIT] Anthropic API error ${claudeRes.status}:`, errBody);
      return json({ error: `Error al llamar a Claude: ${claudeRes.status}`, detail: errBody }, 502);
    }

    const claudeData = await claudeRes.json();

    // 9. Calcular y registrar costo real
    const inputTokens: number = claudeData.usage?.input_tokens ?? 0;
    const outputTokens: number = claudeData.usage?.output_tokens ?? 0;
    const costUsd = (inputTokens * LIMITS.COST_PER_INPUT_TOKEN) + (outputTokens * LIMITS.COST_PER_OUTPUT_TOKEN);

    if (costUsd >= LIMITS.BUDGET_ALERT_USD) {
      console.warn(`[BUDGET ALERT] Kit generado con costo $${costUsd.toFixed(6)} — usuario: ${user.id}`);
    }
    console.log(`[KIT] usuario=${user.id} input=${inputTokens} output=${outputTokens} costo=$${costUsd.toFixed(6)}`);

    // 10. Parsear respuesta JSON de Claude
    const rawText: string = claudeData.content?.[0]?.text ?? "";
    let kitJson: Record<string, unknown>;
    try {
      // Estrategia 1: limpiar bloques markdown y parsear
      let cleaned = rawText
        .replace(/^[\s\S]*?```(?:json)?\s*/i, "")  // quitar todo antes del primer ```
        .replace(/```[\s\S]*$/i, "")                 // quitar todo desde el último ```
        .trim();

      // Estrategia 2: si no hay backticks, buscar el primer { hasta el último }
      if (!cleaned || cleaned === rawText.trim()) {
        const first = rawText.indexOf("{");
        const last  = rawText.lastIndexOf("}");
        if (first !== -1 && last !== -1) {
          cleaned = rawText.slice(first, last + 1);
        }
      }

      kitJson = JSON.parse(cleaned);
    } catch {
      console.error("[KIT] Claude no respondió con JSON válido:", rawText.slice(0, 300));
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

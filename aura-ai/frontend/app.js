// ============================================================
// Aura AI — app.js
// Lógica completa del frontend: Auth, Kit, Video, Historial
// ============================================================

// ---- Configuración Supabase --
const SUPABASE_URL  = "https://fvmudkttojgheqmndwrw.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2bXVka3R0b2pnaGVxbW5kd3J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjkxMTUsImV4cCI6MjA5NzIwNTExNX0.CwWDQpObKOJUDarr0OtU2KJmw63YGktBB1cUf2g_zy0";

// URLs de las Edge Functions
const FN_GENERATE_KIT    = `${SUPABASE_URL}/functions/v1/generate-kit`;
const FN_GENERATE_VIDEO  = `${SUPABASE_URL}/functions/v1/generate-video`;
const FN_HEYGEN_OPTIONS  = `${SUPABASE_URL}/functions/v1/heygen-options`;

// ---- Estado global -------------------------------------------
let db = null;
let selectedOfferType = "producto_fisico";

// ---- Hints por tipo de oferta --------------------------------
const OFFER_HINTS = {
  producto_fisico:  "📦 Sube fotos del empaque, etiqueta o producto en uso. Claude analizará colores, diseño y materiales.",
  infoproducto:     "🎓 Sube el mockup del ebook, portada del curso o captura de la landing. Si no tienes imágenes, describe el contenido detalladamente.",
  producto_digital: "💾 Sube capturas del software, plantilla o pack. Claude analizará la UX, interfaz y propuesta de valor visual.",
  servicio:         "🤝 Sube tu foto de perfil profesional, logo o portafolio. Claude construirá tu autoridad y posicionamiento de experto.",
  saas:             "⚙️ Sube capturas del dashboard, landing page o flujo de uso. Claude analizará la UX y posicionará el ROI del producto.",
};

const OFFER_LABELS = {
  producto_fisico:  { name: "Nombre del producto", desc: "¿Qué hace? Ingredientes, materiales, resultado visible..." },
  infoproducto:     { name: "Nombre del infoproducto", desc: "¿Qué aprende el estudiante? ¿Qué transformación logra? ¿En cuánto tiempo?" },
  producto_digital: { name: "Nombre del producto digital", desc: "¿Qué hace? ¿Qué problema resuelve? ¿Cuánto tiempo ahorra?" },
  servicio:         { name: "Nombre del servicio o agencia", desc: "¿Qué resultado concreto entregas? ¿En cuánto tiempo? ¿A quién?" },
  saas:             { name: "Nombre del SaaS o app", desc: "¿Qué automatiza o resuelve? ¿Qué proceso manual elimina? ¿Cuánto tiempo ahorra?" },
};
let currentUser = null;
let currentKit = null;
let uploadedImageUrls = [];   // URLs en Supabase Storage
let uploadedImagePreviews = []; // { file, dataUrl } para preview local
let authMode = "login";       // "login" | "signup"
let realtimeChannel = null;

// ---- Mensajes de carga progresivos ---------------------------
const LOADING_MESSAGES = [
  "✨ Aura AI está analizando visualmente tu producto...",
  "🎨 Extrayendo identidad visual y propuesta de valor...",
  "📝 Construyendo tu copy de embudo de ventas...",
  "🚀 Generando hooks virales y pack de contenido...",
  "📅 Armando tu calendario de 30 días...",
  "🏁 Finalizando tu Kit de Lanzamiento completo...",
];

// ---- Inicialización ------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  setupAuthListener();
  setupCharCounters();
});

function setupAuthListener() {
  db.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user ?? null;
    updateAuthUI();
    if (currentUser) {
      await loadCredits();
      setupRealtimeVideos();
      loadHeygenOptions();
    } else {
      if (realtimeChannel) {
        db.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
    }
  });
}

// ---- Selector de tipo de oferta ------------------------------
function selectOfferType(btn) {
  selectedOfferType = btn.dataset.type;
  document.querySelectorAll(".offer-type-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  // Hint dinámico
  const hint = document.getElementById("offer-type-hint");
  hint.textContent = OFFER_HINTS[selectedOfferType] ?? "";
  hint.classList.remove("hidden");

  // Adaptar labels del formulario
  const labels = OFFER_LABELS[selectedOfferType] ?? OFFER_LABELS.producto_fisico;
  const nameLabel = document.getElementById("name-label");
  const descArea  = document.getElementById("product-description");
  if (nameLabel) nameLabel.textContent = labels.name + " *";
  if (descArea)  descArea.placeholder  = labels.desc;
}

function setupCharCounters() {
  const desc = document.getElementById("product-description");
  const descCount = document.getElementById("desc-count");
  if (desc) desc.addEventListener("input", () => { descCount.textContent = desc.value.length; });

  const script = document.getElementById("video-script");
  const scriptCount = document.getElementById("script-count");
  if (script) script.addEventListener("input", () => { scriptCount.textContent = script.value.length; });
}

// ============================================================
// AUTH
// ============================================================
function updateAuthUI() {
  const authButtons = document.getElementById("auth-buttons");
  const userMenu    = document.getElementById("user-menu");
  const credDisplay = document.getElementById("credits-display");
  const emailEl     = document.getElementById("user-email");

  if (currentUser) {
    authButtons.classList.add("hidden");
    userMenu.classList.remove("hidden");
    credDisplay.classList.remove("hidden");
    emailEl.textContent = currentUser.email;
  } else {
    authButtons.classList.remove("hidden");
    userMenu.classList.add("hidden");
    credDisplay.classList.add("hidden");
  }
}

async function loadCredits() {
  if (!currentUser) return;
  const { data } = await db
    .from("profiles")
    .select("credits_kits, credits_videos, plan_type")
    .eq("id", currentUser.id)
    .single();

  if (data) {
    document.getElementById("credits-kits-count").textContent =
      data.plan_type === "agency" ? "∞" : data.credits_kits;
    document.getElementById("credits-videos-count").textContent = data.credits_videos;
  }
}

function showAuthModal(mode = "login") {
  authMode = mode;
  document.getElementById("auth-modal").classList.remove("hidden");
  document.getElementById("auth-modal-title").textContent =
    mode === "login" ? "Iniciar sesión" : "Crear cuenta gratis";
  document.getElementById("auth-modal-sub").textContent =
    mode === "login" ? "Accede a tu cuenta de Aura AI" : "2 kits gratis. Sin tarjeta de crédito.";
  document.getElementById("auth-btn-label").textContent =
    mode === "login" ? "Iniciar sesión" : "Crear cuenta";
  document.getElementById("auth-toggle").innerHTML =
    mode === "login"
      ? '¿No tienes cuenta? <button onclick="toggleAuthMode()" class="text-aura-gold underline ml-1">Regístrate gratis</button>'
      : '¿Ya tienes cuenta? <button onclick="toggleAuthMode()" class="text-aura-gold underline ml-1">Inicia sesión</button>';
  document.getElementById("auth-error").classList.add("hidden");
  document.getElementById("auth-email").focus();
}

function hideAuthModal() {
  document.getElementById("auth-modal").classList.add("hidden");
  document.getElementById("auth-email").value = "";
  document.getElementById("auth-password").value = "";
}

function toggleAuthMode() {
  showAuthModal(authMode === "login" ? "signup" : "login");
}

async function submitAuth() {
  const email    = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const errorEl  = document.getElementById("auth-error");
  const btn      = document.getElementById("auth-submit-btn");

  if (!email || !password) {
    showAuthError("Completa email y contraseña"); return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner w-4 h-4 border-2 border-black/30 border-t-black rounded-full mx-auto"></div>';

  const { error } =
    authMode === "login"
      ? await db.auth.signInWithPassword({ email, password })
      : await db.auth.signUp({ email, password });

  btn.disabled = false;
  document.getElementById("auth-btn-label");
  btn.innerHTML = `<span id="auth-btn-label">${authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}</span>`;

  if (error) {
    showAuthError(translateAuthError(error.message));
  } else {
    hideAuthModal();
    if (authMode === "signup") {
      showToast("✉️ Revisa tu email para confirmar tu cuenta", "info");
    }
  }
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function translateAuthError(msg) {
  if (msg.includes("Invalid login")) return "Email o contraseña incorrectos";
  if (msg.includes("already registered")) return "Este email ya está registrado";
  if (msg.includes("Password should")) return "La contraseña debe tener al menos 6 caracteres";
  return msg;
}

async function handleLogout() {
  await db.auth.signOut();
  currentKit = null;
  document.getElementById("kit-result").classList.add("hidden");
  document.getElementById("kit-placeholder").classList.remove("hidden");
}

// ============================================================
// DRAG & DROP E IMÁGENES
// ============================================================
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById("drop-zone").classList.add("drag-over");
}

function handleDragLeave() {
  document.getElementById("drop-zone").classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById("drop-zone").classList.remove("drag-over");
  processFiles(Array.from(e.dataTransfer.files));
}

function handleFileSelect(e) {
  processFiles(Array.from(e.target.files));
  e.target.value = ""; // reset para permitir re-seleccionar el mismo archivo
}

function processFiles(files) {
  const MAX = 3;
  const remaining = MAX - uploadedImagePreviews.length;
  if (remaining <= 0) {
    showToast("Máximo 3 imágenes por kit", "warning"); return;
  }

  const imageFiles = files
    .filter(f => f.type.startsWith("image/"))
    .filter(f => f.size <= 5 * 1024 * 1024) // 5MB máx
    .slice(0, remaining);

  if (files.length > remaining) {
    showToast(`Solo se agregaron ${imageFiles.length} imágenes (máx 3 en total)`, "warning");
  }

  imageFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedImagePreviews.push({ file, dataUrl: e.target.result });
      renderImagePreviews();
    };
    reader.readAsDataURL(file);
  });
}

function renderImagePreviews() {
  const container = document.getElementById("image-previews");
  container.innerHTML = uploadedImagePreviews.map((img, i) => `
    <div class="img-preview relative">
      <img src="${img.dataUrl}" class="w-20 h-20 object-cover rounded-lg border border-aura-border" />
      <button onclick="removeImage(${i})" title="Eliminar">×</button>
    </div>
  `).join("");
}

function removeImage(index) {
  uploadedImagePreviews.splice(index, 1);
  uploadedImageUrls.splice(index, 1);
  renderImagePreviews();
}

async function uploadImagesToStorage() {
  if (!currentUser || uploadedImagePreviews.length === 0) return [];
  const urls = [];

  for (const { file } of uploadedImagePreviews) {
    const ext  = file.name.split(".").pop();
    const path = `${currentUser.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await db.storage
      .from("product-images")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (!error) {
      const { data: { publicUrl } } = db.storage
        .from("product-images")
        .getPublicUrl(path);

      // Usar signed URL si el bucket es privado
      const { data: signed } = await db.storage
        .from("product-images")
        .createSignedUrl(path, 3600); // 1 hora

      urls.push(signed?.signedUrl ?? publicUrl);
    } else {
      console.warn("Error subiendo imagen:", error);
    }
  }

  return urls;
}

// ============================================================
// GENERAR KIT
// ============================================================
async function generateKit() {
  if (!currentUser) { showAuthModal("login"); return; }

  // Validar campos requeridos
  const nombre    = document.getElementById("product-name").value.trim();
  const desc      = document.getElementById("product-description").value.trim();
  const nicho     = document.getElementById("kit-niche").value.trim();
  const audiencia = document.getElementById("kit-audience").value.trim();
  const tono      = document.getElementById("kit-tone").value;
  const plataforma= document.getElementById("kit-platform").value;
  const objetivo  = document.getElementById("kit-goal").value;

  if (!nombre || !desc || !nicho || !audiencia) {
    showToast("Completa todos los campos requeridos (*)", "error"); return;
  }

  // UI: mostrar loading
  const btn = document.getElementById("btn-generate-kit");
  btn.disabled = true;
  document.getElementById("kit-loading").classList.remove("hidden");
  document.getElementById("kit-error").classList.add("hidden");
  document.getElementById("kit-result").classList.add("hidden");
  document.getElementById("kit-placeholder").classList.add("hidden");

  // Mensajes de carga progresivos
  let msgIndex = 0;
  const msgEl = document.getElementById("loading-message");
  msgEl.textContent = LOADING_MESSAGES[0];
  const msgInterval = setInterval(() => {
    msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
    msgEl.textContent = LOADING_MESSAGES[msgIndex];
  }, 3500);

  try {
    // 1. Subir imágenes a Storage
    const imageUrls = await uploadImagesToStorage();

    // 2. Obtener JWT del usuario
    const { data: { session } } = await db.auth.getSession();
    const jwt = session?.access_token;

    // 3. Llamar a la Edge Function
    const response = await fetch(FN_GENERATE_KIT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        nombre, descripcion: desc, nicho,
        target_audience: audiencia, tono,
        product_goal: objetivo, platform_focus: plataforma,
        offer_type: selectedOfferType,
        image_urls: imageUrls,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message ?? data.error ?? "Error desconocido");
    }

    // 4. Renderizar el kit
    currentKit = data.kit;
    renderKit(data.kit, data.meta);
    await loadCredits();
    showToast("✅ Kit generado exitosamente", "success");

  } catch (err) {
    document.getElementById("kit-error").classList.remove("hidden");
    document.getElementById("kit-error-msg").textContent = err.message;
    document.getElementById("kit-placeholder").classList.remove("hidden");
    console.error("[KIT]", err);
  } finally {
    clearInterval(msgInterval);
    btn.disabled = false;
    document.getElementById("kit-loading").classList.add("hidden");
  }
}

// ---- Renderizar el kit en la UI ------------------------------
function renderKit(kit, meta) {
  // One Big Idea
  document.getElementById("kit-one-big-idea").textContent = kit.one_big_idea ?? "—";

  // Meta
  if (meta) {
    document.getElementById("meta-tokens").textContent = meta.tokens_used?.toLocaleString() ?? "—";
    document.getElementById("meta-cost").textContent   = `$${meta.cost_usd ?? "—"}`;
    document.getElementById("meta-images").textContent = meta.images_analyzed ?? 0;
    document.getElementById("kit-meta").classList.remove("hidden");
  }

  // Secciones dinámicas
  const sectionsEl = document.getElementById("kit-sections");
  sectionsEl.innerHTML = "";

  const sections = [
    {
      id: "product_analysis",
      icon: "🔍",
      title: "Análisis del Producto",
      render: (d) => `
        <div class="space-y-2 text-sm">
          <div><span class="text-aura-gold text-xs font-bold">Identidad Visual:</span><p class="text-aura-text mt-0.5">${d.visual_identity}</p></div>
          <div><span class="text-aura-gold text-xs font-bold">Propuesta de Valor Única:</span><p class="text-aura-text mt-0.5">${d.unique_value_proposition}</p></div>
          <div><span class="text-aura-gold text-xs font-bold">Emoción de Compra:</span><p class="text-aura-text mt-0.5">${d.target_emotion}</p></div>
          <div><span class="text-aura-gold text-xs font-bold">Arquetipo de Marca:</span><p class="text-aura-text mt-0.5">${d.brand_archetype}</p></div>
        </div>`,
    },
    {
      id: "funnel_copy",
      icon: "💰",
      title: "Copy de Embudo de Ventas",
      render: (d) => `
        <div class="space-y-2 text-sm">
          <div><span class="text-aura-gold text-xs font-bold">Headline Principal:</span><p class="text-aura-text font-semibold mt-0.5">${d.headline_principal}</p></div>
          <div><span class="text-aura-gold text-xs font-bold">Subheadline:</span><p class="text-aura-text mt-0.5">${d.subheadline}</p></div>
          <div><span class="text-aura-gold text-xs font-bold">Apertura VSL (45s):</span><p class="text-aura-text mt-0.5">${d.vsl_script_opening}</p></div>
          <div><span class="text-aura-gold text-xs font-bold">Bullets de Venta:</span><ul class="mt-1 space-y-1">${(d.sales_page_bullets??[]).map(b=>`<li class="flex gap-2"><span class="text-aura-gold flex-shrink-0">•</span><span>${b}</span></li>`).join("")}</ul></div>
          <div><span class="text-aura-gold text-xs font-bold">CTA Principal:</span><p class="text-aura-gold font-bold mt-0.5">${d.cta_primary}</p></div>
        </div>`,
    },
    {
      id: "viral_hooks",
      icon: "🔥",
      title: "Hooks Virales",
      render: (d) => `
        <div class="space-y-3 text-sm">
          ${renderHookGroup("Curiosidad", d.curiosity)}
          ${renderHookGroup("FOMO", d.fear_of_missing_out)}
          ${renderHookGroup("Prueba Social", d.social_proof)}
          ${renderHookGroup("Formato POV", d.pov_format)}
          ${renderHookGroup("Títulos YouTube Shorts", d.youtube_shorts_titles)}
        </div>`,
    },
    {
      id: "email_sequence",
      icon: "✉️",
      title: "Secuencia de 5 Emails",
      render: (d) => `
        <div class="space-y-3">
          ${(d??[]).map(e=>`
            <div class="border border-aura-border rounded-lg p-3">
              <div class="flex gap-2 items-center mb-1">
                <span class="text-xs bg-aura-gold/20 text-aura-gold px-2 py-0.5 rounded font-bold">Día ${e.day}</span>
                <span class="text-xs text-aura-muted">${e.type}</span>
              </div>
              <div class="text-xs text-aura-muted">Subject:</div>
              <div class="text-sm font-semibold text-aura-text">${e.subject}</div>
              <div class="text-xs text-aura-muted mt-1">Preview:</div>
              <div class="text-xs text-aura-muted italic">${e.preview_text}</div>
              <div class="text-xs text-aura-muted mt-1">Gancho:</div>
              <div class="text-xs text-aura-text">${e.body_hook}</div>
              <div class="text-xs text-aura-gold mt-1 font-bold">→ ${e.cta}</div>
            </div>`).join("")}
        </div>`,
    },
    {
      id: "social_content_pack",
      icon: "📱",
      title: "Pack de Contenido Multi-Plataforma",
      render: (d) => `
        <div class="space-y-4 text-sm">
          <div>
            <div class="text-xs font-bold text-aura-gold mb-2">Instagram Captions (${d.instagram_captions?.length??0})</div>
            <div class="space-y-2">${(d.instagram_captions??[]).map((c,i)=>`
              <div class="border border-aura-border rounded-lg p-3">
                <div class="text-xs text-aura-muted mb-1">${c.type}</div>
                <div class="font-semibold">${c.hook_line}</div>
                <div class="text-aura-muted text-xs mt-1">${c.body}</div>
                <div class="text-aura-gold text-xs mt-1">→ ${c.cta}</div>
              </div>`).join("")}</div>
          </div>
          <div>
            <div class="text-xs font-bold text-aura-gold mb-2">Guiones de Reels (3)</div>
            <div class="space-y-2">${(d.reel_scripts??[]).map(r=>`
              <div class="border border-aura-border rounded-lg p-3">
                <div class="text-xs text-aura-gold font-bold mb-1">Reel ${r.duracion_segundos}s</div>
                <div class="text-xs"><span class="text-aura-muted">Hook visual:</span> ${r.hook_visual}</div>
                <div class="text-xs"><span class="text-aura-muted">Hook audio:</span> ${r.hook_audio}</div>
                <div class="text-xs"><span class="text-aura-muted">Desarrollo:</span> ${r.development}</div>
                <div class="text-xs text-aura-gold">→ ${r.cta_final}</div>
                <div class="text-xs text-aura-muted mt-1">🎥 B-Roll: ${r.broll_suggestions}</div>
              </div>`).join("")}</div>
          </div>
        </div>`,
    },
    {
      id: "seo_strategy",
      icon: "🔎",
      title: "Estrategia SEO + Hashtags",
      render: (d) => `
        <div class="space-y-3 text-sm">
          <div><span class="text-aura-gold text-xs font-bold">Keyword Principal:</span><p class="text-aura-text font-bold text-base mt-0.5">${d.one_big_keyword}</p></div>
          <div><span class="text-aura-gold text-xs font-bold">Keywords Primarias:</span><div class="flex flex-wrap gap-1 mt-1">${(d.primary_keywords??[]).map(k=>`<span class="text-xs bg-aura-card border border-aura-border px-2 py-0.5 rounded">${k}</span>`).join("")}</div></div>
          <div><span class="text-aura-gold text-xs font-bold">Long-tail:</span><div class="flex flex-wrap gap-1 mt-1">${(d.long_tail_keywords??[]).map(k=>`<span class="text-xs bg-aura-card border border-aura-border px-2 py-0.5 rounded">${k}</span>`).join("")}</div></div>
          <div><span class="text-aura-gold text-xs font-bold">Hashtags Alta Competencia:</span><div class="flex flex-wrap gap-1 mt-1">${(d.hashtags_high_competition??[]).map(h=>`<span class="text-xs text-aura-gold">${h}</span>`).join(" ")}</div></div>
          <div><span class="text-aura-gold text-xs font-bold">Hashtags Medio:</span><div class="flex flex-wrap gap-1 mt-1 text-xs text-aura-muted">${(d.hashtags_medium??[]).join(" ")}</div></div>
          <div><span class="text-aura-gold text-xs font-bold">Micro-nicho:</span><div class="flex flex-wrap gap-1 mt-1 text-xs text-aura-muted">${(d.hashtags_micro_niche??[]).join(" ")}</div></div>
        </div>`,
    },
    {
      id: "content_calendar",
      icon: "📅",
      title: "Calendario de Contenido 30 Días",
      render: (d) => {
        const semanas = ["semana_1","semana_2","semana_3","semana_4"];
        return semanas.map((s,i) => `
          <div class="mb-4">
            <div class="text-xs font-bold text-aura-gold mb-2">Semana ${i+1}</div>
            <div class="space-y-1">
              ${(d[s]??[]).map(day=>`
                <div class="flex gap-2 text-xs items-start border-b border-aura-border/50 pb-1">
                  <span class="text-aura-muted w-16 flex-shrink-0">${day.dia}</span>
                  <span class="text-aura-text font-medium flex-shrink-0">${day.plataforma}</span>
                  <span class="text-aura-muted">${day.tema}</span>
                  <span class="text-aura-gold ml-auto flex-shrink-0">${day.horario}</span>
                </div>`).join("")}
            </div>
          </div>`).join("");
      },
    },
    {
      id: "trend_alerts",
      icon: "📡",
      title: "Tendencias Identificadas por la IA",
      render: (d) => `
        <div class="space-y-3">
          ${(d??[]).map(t => {
            const urgColor = t.urgencia==='alta'
              ? 'border-aura-gold bg-aura-gold/5'
              : t.urgencia==='media'
              ? 'border-blue-800 bg-blue-900/10'
              : 'border-aura-border';
            const badgeColor = t.urgencia==='alta'
              ? 'bg-aura-gold/20 text-aura-gold'
              : t.urgencia==='media'
              ? 'bg-blue-900/30 text-blue-400'
              : 'bg-gray-800 text-gray-400';
            return `
            <div class="border rounded-xl p-4 ${urgColor}">
              <div class="flex flex-wrap gap-2 items-center mb-2">
                ${t.plataforma ? `<span class="text-xs bg-aura-card border border-aura-border px-2 py-0.5 rounded-full text-aura-muted">📍 ${t.plataforma}</span>` : ''}
                <span class="text-xs px-2 py-0.5 rounded-full font-bold ml-auto ${badgeColor}">${(t.urgencia??'').toUpperCase()}</span>
              </div>
              <div class="text-sm font-bold text-aura-text mb-1">${t.tendencia}</div>
              ${t.razonamiento ? `<div class="text-xs text-aura-muted mb-2 italic border-l-2 border-aura-gold/30 pl-2">${t.razonamiento}</div>` : ''}
              <div class="text-xs font-medium text-aura-gold">→ ${t.como_aplicarla}</div>
            </div>`;
          }).join("")}
        </div>`,
    },
  ];

  sections.forEach(({ id, icon, title, render }) => {
    const data = kit[id];
    if (!data) return;
    const el = document.createElement("div");
    el.className = "bg-aura-card border border-aura-border rounded-xl overflow-hidden";
    el.innerHTML = `
      <button onclick="toggleSection('${id}')"
        class="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors">
        <span class="text-sm font-bold text-aura-text">${icon} ${title}</span>
        <div class="flex gap-2 items-center">
          <button onclick="event.stopPropagation();copySection('${id}')"
            class="text-xs text-aura-muted hover:text-aura-gold border border-aura-border px-2 py-0.5 rounded transition-colors">
            Copiar
          </button>
          <span id="chevron-${id}" class="text-aura-muted text-xs transition-transform">▼</span>
        </div>
      </button>
      <div id="section-${id}" class="kit-section-content px-4 pb-4 open">
        ${render(data)}
      </div>`;
    sectionsEl.appendChild(el);
  });

  document.getElementById("kit-result").classList.remove("hidden");
  document.getElementById("kit-placeholder").classList.add("hidden");
  document.getElementById("kit-result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderHookGroup(label, hooks) {
  if (!hooks?.length) return "";
  return `
    <div>
      <div class="text-xs font-bold text-aura-gold mb-1">${label}:</div>
      <ul class="space-y-1">
        ${hooks.map(h => `<li class="flex gap-2 text-xs"><span class="text-aura-gold flex-shrink-0">→</span><span>${h}</span></li>`).join("")}
      </ul>
    </div>`;
}

function toggleSection(id) {
  const content = document.getElementById(`section-${id}`);
  const chevron = document.getElementById(`chevron-${id}`);
  content.classList.toggle("open");
  chevron.style.transform = content.classList.contains("open") ? "rotate(0)" : "rotate(-90deg)";
}

async function copySection(id) {
  if (!currentKit) return;
  const data = currentKit[id];
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    showToast("✅ Copiado al portapapeles", "success");
  } catch {
    showToast("No se pudo copiar", "error");
  }
}

function downloadKit() {
  if (!currentKit) return;
  const blob = new Blob([JSON.stringify(currentKit, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `aura-kit-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF() {
  if (!currentKit) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const ORANGE = [249, 115, 22];
  const WHITE  = [255, 255, 255];
  const GRAY   = [160, 160, 160];
  const DARK   = [20, 20, 20];
  const PW     = 210; // page width mm
  const ML     = 15; // margin left
  const MR     = 15; // margin right
  const CW     = PW - ML - MR; // content width
  let y        = 0;

  const checkPage = (needed = 10) => {
    if (y + needed > 270) { doc.addPage(); y = 15; }
  };

  const addText = (text, x, yPos, opts = {}) => {
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(...(opts.color ?? DARK));
    if (opts.bold) doc.setFont("helvetica", "bold");
    else doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(String(text ?? ""), opts.maxW ?? CW);
    doc.text(lines, x, yPos);
    return lines.length * ((opts.size ?? 10) * 0.45);
  };

  // ---- Portada ----
  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, PW, 60, "F");
  doc.setFontSize(28); doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text("Aura AI", ML, 25);
  doc.setFontSize(13); doc.setFont("helvetica", "normal");
  doc.text("Kit de Lanzamiento Digital", ML, 35);
  doc.setFontSize(10);
  doc.text(currentKit.one_big_idea ?? "", ML, 45, { maxWidth: CW });
  doc.setTextColor(...GRAY);
  doc.text(`Generado el ${new Date().toLocaleDateString("es-LA")}`, ML, 55);
  y = 72;

  const SECTIONS = [
    { key: "product_analysis",   label: "🔍 Análisis del Producto" },
    { key: "funnel_copy",        label: "💰 Copy de Embudo de Ventas" },
    { key: "viral_hooks",        label: "🔥 Hooks Virales" },
    { key: "email_sequence",     label: "✉️ Secuencia de Emails" },
    { key: "social_content_pack",label: "📱 Pack Multi-Plataforma" },
    { key: "seo_strategy",       label: "🔎 SEO + Hashtags" },
    { key: "trend_alerts",       label: "📡 Alertas de Tendencias" },
  ];

  SECTIONS.forEach(({ key, label }) => {
    const data = currentKit[key];
    if (!data) return;
    checkPage(20);

    // Título de sección
    doc.setFillColor(...ORANGE);
    doc.rect(ML, y, CW, 8, "F");
    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHITE);
    doc.text(label, ML + 3, y + 5.5);
    y += 12;

    // Contenido según la sección
    const json = JSON.stringify(data, null, 2);
    const flatLines = json.replace(/[{}\[\]"]/g, "").split("\n")
      .map(l => l.trim()).filter(l => l && l !== ",");

    flatLines.slice(0, 60).forEach(line => {
      checkPage(6);
      const h = addText(line, ML, y, { size: 9, color: DARK, maxW: CW });
      y += Math.max(h, 5);
    });
    y += 4;
  });

  // Pie de página en cada página
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    doc.text(`Aura AI · Kit generado con IA · Página ${i} de ${totalPages}`, ML, 288);
    doc.setDrawColor(...ORANGE);
    doc.setLineWidth(0.5);
    doc.line(ML, 283, PW - MR, 283);
  }

  doc.save(`aura-kit-${Date.now()}.pdf`);
  showToast("📄 PDF descargado exitosamente", "success");
}

// ============================================================
// GENERAR VIDEO
// ============================================================
async function loadHeygenOptions() {
  const avatarSel = document.getElementById("avatar-id");
  const voiceSel  = document.getElementById("voice-id");
  if (!avatarSel || !voiceSel) return;

  try {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(FN_HEYGEN_OPTIONS, {
      headers: { "Authorization": `Bearer ${session?.access_token}` },
    });
    if (!res.ok) throw new Error("Error al cargar opciones de HeyGen");
    const { avatars, voices } = await res.json();

    // Poblar avatares
    avatarSel.innerHTML = "";
    if (!avatars?.length) {
      avatarSel.innerHTML = '<option value="">Sin avatares en tu cuenta de HeyGen</option>';
    } else {
      avatars.forEach(a => {
        const opt = document.createElement("option");
        opt.value = a.id;
        opt.textContent = a.name;
        avatarSel.appendChild(opt);
      });
    }

    // Poblar voces
    voiceSel.innerHTML = "";
    if (!voices?.length) {
      voiceSel.innerHTML = '<option value="">Sin voces disponibles</option>';
    } else {
      voices.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = `${v.name}${v.gender ? " · " + v.gender : ""}${v.language ? " · " + v.language : ""}`;
        voiceSel.appendChild(opt);
      });
    }
  } catch (err) {
    avatarSel.innerHTML = '<option value="">Error cargando avatares</option>';
    voiceSel.innerHTML  = '<option value="">Error cargando voces</option>';
    console.warn("[HeyGen options]", err.message);
  }
}

async function generateVideo() {
  if (!currentUser) { showAuthModal("login"); return; }

  const avatarId   = document.getElementById("avatar-id").value.trim();
  const scriptText = document.getElementById("video-script").value.trim();
  const voiceId    = document.getElementById("voice-id").value.trim();

  if (!avatarId || !scriptText) {
    showToast("Completa el ID del avatar y el guion", "error"); return;
  }

  const btn = document.getElementById("btn-generate-video");
  btn.disabled = true;
  btn.textContent = "Enviando a HeyGen...";

  try {
    const { data: { session } } = await db.auth.getSession();
    const jwt = session?.access_token;

    const response = await fetch(FN_GENERATE_VIDEO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        avatar_id: avatarId,
        script_text: scriptText,
        voice_id: voiceId || undefined,
        orientation: document.querySelector('input[name="video-orientation"]:checked')?.value ?? "horizontal",
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message ?? data.error);

    // Mostrar estado de procesamiento
    document.getElementById("video-status").classList.remove("hidden");
    document.getElementById("video-processing").classList.remove("hidden");
    document.getElementById("video-completed").classList.add("hidden");
    document.getElementById("video-failed").classList.add("hidden");

    showToast("🎬 Video enviado a HeyGen. Notificaremos cuando esté listo.", "info");
    await loadCredits();

    // El Realtime listener actualizará la UI automáticamente
    currentVideoDbId = data.video_id;

  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🎬 Generar Video con Avatar";
  }
}

let currentVideoDbId = null;

// ---- Supabase Realtime para actualizaciones de video ---------
function setupRealtimeVideos() {
  if (!currentUser) return;
  if (realtimeChannel) db.removeChannel(realtimeChannel);

  realtimeChannel = db
    .channel(`videos-${currentUser.id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "videos",
        filter: `user_id=eq.${currentUser.id}`,
      },
      (payload) => {
        const video = payload.new;
        if (video.id !== currentVideoDbId) return;

        if (video.status === "completed" && video.video_url) {
          document.getElementById("video-processing").classList.add("hidden");
          document.getElementById("video-completed").classList.remove("hidden");
          const player = document.getElementById("video-player");
          player.src = video.video_url;
          document.getElementById("video-download-link").href = video.video_url;
          showToast("🎉 ¡Tu video está listo!", "success");
        } else if (video.status === "failed") {
          document.getElementById("video-processing").classList.add("hidden");
          document.getElementById("video-failed").classList.remove("hidden");
        }
      }
    )
    .subscribe();
}

// ============================================================
// HISTORIAL DE KITS
// ============================================================
async function loadKitHistory() {
  if (!currentUser) return;

  document.getElementById("history-loading").classList.remove("hidden");
  document.getElementById("history-empty").classList.add("hidden");
  document.getElementById("history-list").classList.add("hidden");

  const { data: kits, error } = await db
    .from("kits")
    .select("id, niche, tone, created_at, generated_json")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(20);

  document.getElementById("history-loading").classList.add("hidden");

  if (error || !kits?.length) {
    document.getElementById("history-empty").classList.remove("hidden"); return;
  }

  const listEl = document.getElementById("history-list");
  listEl.innerHTML = kits.map(kit => `
    <div class="bg-aura-card border border-aura-border rounded-xl p-4 cursor-pointer hover:border-aura-gold/50 transition-colors"
      onclick="loadKitFromHistory(${kit.id})">
      <div class="flex justify-between items-start">
        <div>
          <div class="text-sm font-bold text-aura-text">${kit.generated_json?.one_big_idea ?? kit.niche}</div>
          <div class="text-xs text-aura-muted mt-1">${kit.niche} · ${kit.tone}</div>
        </div>
        <div class="text-xs text-aura-muted">${new Date(kit.created_at).toLocaleDateString("es-LA")}</div>
      </div>
    </div>`).join("");

  listEl.classList.remove("hidden");
}

async function loadKitFromHistory(kitId) {
  const { data } = await db
    .from("kits")
    .select("generated_json")
    .eq("id", kitId)
    .single();

  if (data?.generated_json) {
    currentKit = data.generated_json;
    switchTab("kit", document.querySelector('[data-tab="kit"]'));
    renderKit(data.generated_json, null);
  }
}

// ============================================================
// TABS
// ============================================================
function switchTab(tab, btn) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.remove("hidden");
  if (btn) btn.classList.add("active");

  if (tab === "history") loadKitHistory();
}

// ============================================================
// UTILIDADES
// ============================================================
function showToast(msg, type = "info") {
  const colors = {
    success: "bg-green-900/80 border-green-700 text-green-300",
    error:   "bg-red-900/80 border-red-700 text-red-300",
    warning: "bg-yellow-900/80 border-yellow-700 text-yellow-300",
    info:    "bg-aura-card border-aura-border text-aura-text",
  };

  const toast = document.createElement("div");
  toast.className = `fixed bottom-4 right-4 z-50 border px-4 py-3 rounded-xl text-sm font-medium shadow-xl ${colors[type]} transition-all`;
  toast.style.animation = "fadeInUp 0.3s ease-out";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 3500);
}

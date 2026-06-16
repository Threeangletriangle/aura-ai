// ============================================================
// Aura AI — Edge Function: generate-video
// Crea un video con avatar via HeyGen API
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const PLAN_VIDEO_CREDITS: Record<string, number> = {
  free: 0,
  creator: 5,
  agency: 20,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    // 1. Autenticar
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Token inválido" }, 401);

    // 2. Verificar créditos de video
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan_type, credits_videos")
      .eq("id", user.id)
      .single();

    if (!profile) return json({ error: "Perfil no encontrado" }, 404);

    const planVideoCredits = PLAN_VIDEO_CREDITS[profile.plan_type] ?? 0;
    if (profile.plan_type === "free") {
      return json({
        error: "Plan gratuito no incluye videos",
        message: "Actualiza al plan Creator ($29/mes) para generar videos con avatar.",
        upgrade_required: true,
      }, 402);
    }

    if (profile.credits_videos <= 0) {
      return json({
        error: "Sin créditos de video",
        message: `Has usado todos tus videos este mes (${planVideoCredits} incluidos en tu plan). Se renuevan el próximo ciclo.`,
        upgrade_required: profile.plan_type === "creator",
      }, 402);
    }

    // 3. Parsear body
    const body = await req.json();
    const {
      script_text, avatar_id, voice_id,
      background_color = "#0a0a0a",
      orientation = "horizontal",   // "horizontal" | "vertical"
    } = body;

    if (!script_text) {
      return json({ error: "Falta el guion del video (script_text)" }, 400);
    }

    if (script_text.length > 2000) {
      return json({ error: "El guion no puede superar 2000 caracteres" }, 400);
    }

    // Resolver avatar_id: si no viene del cliente, tomar el primero disponible en HeyGen
    let resolvedAvatarId = avatar_id;
    if (!resolvedAvatarId) {
      try {
        const avatarsRes = await fetch("https://api.heygen.com/v2/avatars", {
          headers: { "X-Api-Key": Deno.env.get("HEYGEN_API_KEY")! },
        });
        const avatarsData = await avatarsRes.json();
        const avatars: { avatar_id: string; avatar_name: string }[] =
          avatarsData?.data?.avatars ?? avatarsData?.avatars ?? [];
        if (avatars.length > 0) {
          resolvedAvatarId = avatars[0].avatar_id;
          console.log(`[VIDEO] Avatar auto-seleccionado: ${avatars[0].avatar_name} (${resolvedAvatarId})`);
        }
      } catch (e) {
        console.warn("[VIDEO] No se pudo obtener lista de avatares de HeyGen:", e);
      }
    }

    if (!resolvedAvatarId) {
      return json({ error: "No se encontró avatar disponible. Ve a HeyGen → Avatars y pega el Avatar ID." }, 400);
    }

    // 4. Insertar registro en BD con status=processing
    const { data: videoRecord, error: insertError } = await supabase
      .from("videos")
      .insert({
        user_id: user.id,
        avatar_id,
        script_text,
        status: "processing",
      })
      .select("id")
      .single();

    if (insertError || !videoRecord) {
      console.error("[VIDEO] Error insertando en BD:", insertError);
      return json({ error: "Error al crear registro de video" }, 500);
    }

    // 5. Resolver voice_id: si no viene del cliente, buscar voz en español en HeyGen
    let resolvedVoiceId = voice_id;
    if (!resolvedVoiceId) {
      try {
        const voicesRes = await fetch("https://api.heygen.com/v2/voices", {
          headers: { "X-Api-Key": Deno.env.get("HEYGEN_API_KEY")! },
        });
        const voicesData = await voicesRes.json();
        const voices: { voice_id: string; language: string; name: string }[] =
          voicesData?.data?.voices ?? voicesData?.voices ?? [];
        // Prioridad: español latinoam → español genérico → cualquier español
        const esVoice =
          voices.find(v => v.language?.toLowerCase().startsWith("es") && v.name?.toLowerCase().includes("latin")) ||
          voices.find(v => v.language?.toLowerCase() === "es") ||
          voices.find(v => v.language?.toLowerCase().startsWith("es"));
        if (esVoice) {
          resolvedVoiceId = esVoice.voice_id;
          console.log(`[VIDEO] Voz auto-seleccionada: ${esVoice.name} (${esVoice.voice_id})`);
        }
      } catch (e) {
        console.warn("[VIDEO] No se pudo obtener lista de voces de HeyGen:", e);
      }
    }

    if (!resolvedVoiceId) {
      return json({ error: "No se encontró voz disponible. Ve a HeyGen → Voices y pega el Voice ID." }, 400);
    }

    // 6. Llamar a HeyGen API v2
    const heygenPayload = {
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id: resolvedAvatarId,
            avatar_style: "normal",
          },
          voice: {
            type: "text",
            input_text: script_text,
            voice_id: resolvedVoiceId,
            speed: 1.0,
          },
          background: {
            type: "color",
            value: background_color,
          },
        },
      ],
      dimension: orientation === "vertical"
        ? { width: 1080, height: 1920 }  // 9:16 Reels/TikTok
        : { width: 1280, height: 720 },  // 16:9 YouTube/Facebook
      aspect_ratio: orientation === "vertical" ? "9:16" : "16:9",
      // callback_url: se configura en HeyGen dashboard apuntando al webhook
    };

    const heygenRes = await fetch("https://api.heygen.com/v2/video/generate", {
      method: "POST",
      headers: {
        "X-Api-Key": Deno.env.get("HEYGEN_API_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(heygenPayload),
    });

    const heygenData = await heygenRes.json();

    if (!heygenRes.ok || !heygenData.data?.video_id) {
      console.error("[VIDEO] HeyGen error:", heygenData);
      // Marcar video como fallido en BD
      await supabase
        .from("videos")
        .update({ status: "failed" })
        .eq("id", videoRecord.id);

      return json({
        error: "Error al comunicarse con HeyGen",
        detail: heygenData.message ?? "Respuesta inválida de HeyGen",
      }, 502);
    }

    const heygenVideoId: string = heygenData.data.video_id;

    // 6. Guardar heygen_video_id en el registro
    await supabase
      .from("videos")
      .update({ heygen_video_id: heygenVideoId })
      .eq("id", videoRecord.id);

    // 7. Descontar 1 crédito de video
    await supabase
      .from("profiles")
      .update({ credits_videos: profile.credits_videos - 1 })
      .eq("id", user.id);

    console.log(`[VIDEO] usuario=${user.id} video_db=${videoRecord.id} heygen_id=${heygenVideoId}`);

    return json({
      success: true,
      video_id: videoRecord.id,
      heygen_video_id: heygenVideoId,
      status: "processing",
      credits_videos_remaining: profile.credits_videos - 1,
      message: "Video en proceso. Recibirás una notificación cuando esté listo (2-5 minutos).",
    });

  } catch (err) {
    console.error("[VIDEO] Error inesperado:", err);
    return json({ error: "Error interno del servidor" }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

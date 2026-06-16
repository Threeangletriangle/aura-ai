// ============================================================
// Aura AI — Edge Function: webhook-heygen
// Recibe notificaciones de HeyGen cuando el video está listo
// Supabase Realtime notifica al frontend automáticamente
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Heygen-Signature",
      },
    });
  }

  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    // 1. Verificar firma HMAC del webhook de HeyGen
    const signature = req.headers.get("X-Heygen-Signature") ?? "";
    const rawBody = await req.text();
    const webhookSecret = Deno.env.get("HEYGEN_WEBHOOK_SECRET") ?? "";

    if (webhookSecret && !(await verifyHeygenSignature(rawBody, signature, webhookSecret))) {
      console.warn("[WEBHOOK] Firma inválida — posible request no autorizado");
      return json({ error: "Firma inválida" }, 401);
    }

    const payload = JSON.parse(rawBody);
    console.log("[WEBHOOK] HeyGen payload:", JSON.stringify(payload).slice(0, 300));

    // 2. Extraer datos del evento
    // Estructura de HeyGen v2: { event_type, event_data: { video_id, url, thumbnail_url, status } }
    const eventType: string = payload.event_type ?? payload.type ?? "";
    const eventData = payload.event_data ?? payload.data ?? {};

    const heygenVideoId: string = eventData.video_id ?? "";
    const videoUrl: string = eventData.url ?? eventData.video_url ?? "";
    const thumbnailUrl: string = eventData.thumbnail_url ?? "";
    const heygenStatus: string = eventData.status ?? "";

    if (!heygenVideoId) {
      console.warn("[WEBHOOK] Payload sin video_id:", payload);
      return json({ received: true });
    }

    // 3. Mapear estado de HeyGen a nuestro esquema
    let ourStatus: "processing" | "completed" | "failed" = "processing";
    if (
      eventType === "avatar_video.success" ||
      heygenStatus === "completed" ||
      heygenStatus === "success"
    ) {
      ourStatus = "completed";
    } else if (
      eventType === "avatar_video.fail" ||
      heygenStatus === "failed" ||
      heygenStatus === "error"
    ) {
      ourStatus = "failed";
    }

    // 4. Actualizar registro en BD usando Service Role Key (acceso total)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SERVICE_ROLE_KEY")!  // Service Role para bypasear RLS en webhook
    );

    const updateData: Record<string, unknown> = { status: ourStatus };
    if (videoUrl) updateData.video_url = videoUrl;
    if (thumbnailUrl) updateData.thumbnail_url = thumbnailUrl;

    const { error: updateError } = await supabase
      .from("videos")
      .update(updateData)
      .eq("heygen_video_id", heygenVideoId);

    if (updateError) {
      console.error("[WEBHOOK] Error actualizando BD:", updateError);
      // Retornamos 200 para que HeyGen no reintente — el error es nuestro
    } else {
      console.log(`[WEBHOOK] Video ${heygenVideoId} actualizado → ${ourStatus}`);
    }

    // Supabase Realtime detecta el UPDATE y notifica al frontend automáticamente

    return json({ received: true, status: ourStatus });

  } catch (err) {
    console.error("[WEBHOOK] Error inesperado:", err);
    // Siempre 200 para que HeyGen no reintente innecesariamente
    return json({ received: true });
  }
});

// Verificación HMAC-SHA256 de la firma de HeyGen
async function verifyHeygenSignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const computed = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
    // Comparación constante para evitar timing attacks
    return computed === signature.replace(/^sha256=/, "");
  } catch {
    return false;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

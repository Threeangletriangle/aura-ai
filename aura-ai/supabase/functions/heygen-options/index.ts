// ============================================================
// Aura AI — Edge Function: heygen-options
// Proxy seguro para listar avatares y voces de HeyGen
// ============================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);

  const apiKey = Deno.env.get("HEYGEN_API_KEY")!;
  const headers = { "X-Api-Key": apiKey, "Content-Type": "application/json" };

  try {
    const [avatarsRes, voicesRes, customVoicesRes] = await Promise.all([
      fetch("https://api.heygen.com/v2/avatars", { headers }),
      fetch("https://api.heygen.com/v2/voices", { headers }),
      fetch("https://api.heygen.com/v2/voice/list", { headers }),
    ]);

    const [avatarsData, voicesData, customVoicesData] = await Promise.all([
      avatarsRes.json(),
      voicesRes.json(),
      customVoicesRes.ok ? customVoicesRes.json() : Promise.resolve({}),
    ]);

    // Avatares públicos/stock
    const rawAvatars: { avatar_id: string; avatar_name: string; preview_image_url?: string }[] =
      avatarsData?.data?.avatars ?? avatarsData?.avatars ?? [];

    // Avatares personalizados (los que el usuario crea en HeyGen Studio)
    const rawCustom: { avatar_id: string; avatar_name: string; preview_image_url?: string }[] =
      avatarsData?.data?.custom_avatars ?? avatarsData?.custom_avatars ?? [];

    const allRaw = [
      ...rawCustom.map(a => ({ ...a, _type: "Mis avatares" })),
      ...rawAvatars.map(a => ({ ...a, _type: "Stock" })),
    ];

    const avatars = allRaw.map(a => ({
      id: a.avatar_id,
      name: `${a._type === "Mis avatares" ? "⭐ " : ""}${a.avatar_name ?? a.avatar_id}`,
      preview_image: a.preview_image_url ?? null,
    }));

    // Voces stock de HeyGen
    const rawVoices: { voice_id: string; name: string; language: string; gender?: string }[] =
      voicesData?.data?.voices ?? voicesData?.voices ?? [];

    // Voces clonadas/personalizadas del usuario
    const rawCustomVoices: { voice_id: string; name: string; language?: string; gender?: string }[] =
      customVoicesData?.data?.voices ?? customVoicesData?.voices ?? [];

    // Combinar: personalizadas primero con ⭐
    const combined = [
      ...rawCustomVoices.map(v => ({ ...v, _custom: true })),
      ...rawVoices.map(v => ({ ...v, _custom: false })),
    ];

    // Filtrar español (o mostrar todas si no hay)
    const esVoices = combined.filter(v =>
      v.language?.toLowerCase().startsWith("es") || v.name?.toLowerCase().includes("spanish")
    );
    const allVoices = (esVoices.length > 0 ? esVoices : combined).map(v => ({
      id: v.voice_id,
      name: `${v._custom ? "⭐ " : ""}${v.name ?? v.voice_id}`,
      language: v.language ?? "",
      gender: v.gender ?? "",
    }));

    console.log(`[HEYGEN-OPTIONS] ${avatars.length} avatares, ${allVoices.length} voces en español`);

    return json({ avatars, voices: allVoices });

  } catch (err) {
    console.error("[HEYGEN-OPTIONS] Error:", err);
    return json({ error: "Error al conectar con HeyGen" }, 502);
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

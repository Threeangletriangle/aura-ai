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
    const [avatarsRes, voicesRes] = await Promise.all([
      fetch("https://api.heygen.com/v2/avatars", { headers }),
      fetch("https://api.heygen.com/v2/voices", { headers }),
    ]);

    const [avatarsData, voicesData] = await Promise.all([
      avatarsRes.json(),
      voicesRes.json(),
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

    // Normalizar voces — priorizar español
    const rawVoices: { voice_id: string; name: string; language: string; gender?: string }[] =
      voicesData?.data?.voices ?? voicesData?.voices ?? [];

    const voices = rawVoices
      .filter(v => v.language?.toLowerCase().startsWith("es") || v.name?.toLowerCase().includes("spanish"))
      .map(v => ({
        id: v.voice_id,
        name: v.name ?? v.voice_id,
        language: v.language ?? "es",
        gender: v.gender ?? "",
      }));

    // Si no hay voces en español, devolver todas
    const allVoices = voices.length > 0 ? voices : rawVoices.map(v => ({
      id: v.voice_id,
      name: v.name ?? v.voice_id,
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

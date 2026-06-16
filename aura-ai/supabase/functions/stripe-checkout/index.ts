// ============================================================
// Aura AI — Edge Function: stripe-checkout
// Crea una Stripe Checkout Session para suscripciones
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

// IDs de los Price de Stripe (crear en dashboard.stripe.com → Products)
const STRIPE_PRICE_IDS: Record<string, string> = {
  creator: Deno.env.get("STRIPE_PRICE_CREATOR") ?? "", // $29/mes
  agency:  Deno.env.get("STRIPE_PRICE_AGENCY")  ?? "", // $79/mes
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
    // 1. Autenticar usuario
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Token inválido" }, 401);

    // 2. Obtener el plan solicitado
    const { plan, success_url, cancel_url } = await req.json();
    if (!plan || !STRIPE_PRICE_IDS[plan]) {
      return json({ error: "Plan inválido. Usa: creator | agency" }, 400);
    }

    // 3. Obtener o crear customer de Stripe
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .single();

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2024-04-10",
    });

    let customerId: string = profile?.stripe_customer_id ?? "";

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? profile?.email ?? "",
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      // Guardar el customer ID en profiles
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // 4. Crear Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: STRIPE_PRICE_IDS[plan], quantity: 1 }],
      success_url: success_url ?? `${req.headers.get("origin") ?? ""}/success?plan=${plan}`,
      cancel_url:  cancel_url  ?? `${req.headers.get("origin") ?? ""}/`,
      metadata: {
        supabase_user_id: user.id,
        plan_type: plan,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan_type: plan,
        },
      },
      // Idioma español
      locale: "es",
      allow_promotion_codes: true,
    });

    console.log(`[STRIPE] Checkout session creada: ${session.id} — usuario: ${user.id} — plan: ${plan}`);

    return json({ url: session.url, session_id: session.id });

  } catch (err) {
    console.error("[STRIPE] Error:", err);
    return json({ error: "Error al crear sesión de pago" }, 500);
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

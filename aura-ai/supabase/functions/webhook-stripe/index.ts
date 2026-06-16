// ============================================================
// Aura AI — Edge Function: webhook-stripe
// Procesa eventos de Stripe y actualiza plan + créditos
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

// Créditos por plan (reseteados en cada ciclo de facturación)
const PLAN_CREDITS: Record<string, { kits: number; videos: number }> = {
  free:    { kits: 2,   videos: 0  },
  creator: { kits: 20,  videos: 5  },
  agency:  { kits: -1,  videos: 20 }, // -1 = ilimitado en lógica de la app
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-04-10" });
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

  // 1. Verificar firma del webhook de Stripe
  const signature = req.headers.get("stripe-signature") ?? "";
  const rawBody   = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[STRIPE WEBHOOK] Firma inválida:", err);
    return new Response("Firma inválida", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  console.log(`[STRIPE WEBHOOK] Evento: ${event.type}`);

  try {
    switch (event.type) {

      // ---- Pago exitoso: activar plan -------------------------
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId  = session.metadata?.supabase_user_id;
        const plan    = session.metadata?.plan_type;

        if (!userId || !plan) {
          console.warn("[STRIPE] checkout.session sin metadata de usuario/plan");
          break;
        }

        const credits = PLAN_CREDITS[plan] ?? PLAN_CREDITS.free;

        await supabase.from("profiles").update({
          plan_type:      plan,
          credits_kits:   credits.kits,
          credits_videos: credits.videos,
        }).eq("id", userId);

        console.log(`[STRIPE] Plan activado: ${plan} → usuario ${userId}`);
        break;
      }

      // ---- Renovación mensual: resetear créditos ---------------
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        // Buscar usuario por stripe_customer_id
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, plan_type")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!profile) {
          console.warn("[STRIPE] invoice.paid sin perfil para customer:", customerId);
          break;
        }

        const credits = PLAN_CREDITS[profile.plan_type] ?? PLAN_CREDITS.free;

        await supabase.from("profiles").update({
          credits_kits:   credits.kits,
          credits_videos: credits.videos,
        }).eq("id", profile.id);

        console.log(`[STRIPE] Créditos renovados para ${profile.id} (plan: ${profile.plan_type})`);
        break;
      }

      // ---- Cancelación o pago fallido: degradar a free ---------
      case "customer.subscription.deleted":
      case "invoice.payment_failed": {
        const obj = event.data.object as Stripe.Subscription | Stripe.Invoice;
        const customerId = (obj as Stripe.Subscription).customer as string
          ?? (obj as Stripe.Invoice).customer as string;

        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (!profile) break;

        await supabase.from("profiles").update({
          plan_type:      "free",
          credits_kits:   2,
          credits_videos: 0,
        }).eq("id", profile.id);

        console.log(`[STRIPE] Plan degradado a free → usuario ${profile.id} (${event.type})`);
        break;
      }

      default:
        console.log(`[STRIPE] Evento ignorado: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[STRIPE WEBHOOK] Error procesando evento:", err);
    // Retornar 200 para que Stripe no reintente — el error es interno
    return new Response(JSON.stringify({ received: true, error: "Error interno" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});

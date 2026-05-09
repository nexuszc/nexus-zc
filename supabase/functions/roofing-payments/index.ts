import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "sk_test_placeholder", {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const body = await req.json();
  const { action } = body;

  if (action === "create_payment_intent") {
    const { job_id, amount_cents, payment_type } = body;

    if (!Deno.env.get("STRIPE_SECRET_KEY")) {
      return Response.json({ error: "STRIPE_SECRET_KEY not configured" }, { status: 503 });
    }

    const { data: job } = await supabase
      .from("roofing_jobs")
      .select("*, clients(name)")
      .eq("id", job_id)
      .single();

    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

    const intent = await stripe.paymentIntents.create({
      amount: amount_cents,
      currency: "usd",
      metadata: {
        job_id,
        payment_type: payment_type || "payment",
        homeowner: job.homeowner_name,
        address: job.property_address,
      },
      description: `${payment_type || "payment"} — ${job.homeowner_name} — ${job.property_address}`,
    });

    await supabase.from("roofing_jobs").update({
      stripe_payment_intent_id: intent.id,
    }).eq("id", job_id);

    return Response.json({ client_secret: intent.client_secret, payment_intent_id: intent.id });
  }

  if (action === "confirm_payment") {
    const { payment_intent_id, amount_paid } = body;

    const { data: job } = await supabase
      .from("roofing_jobs")
      .select("*")
      .eq("stripe_payment_intent_id", payment_intent_id)
      .single();

    if (!job) return Response.json({ error: "Job not found" });

    const newTotal = (job.amount_paid || 0) + amount_paid;
    const isFullyPaid = newTotal >= job.contract_amount;

    await supabase.from("roofing_jobs").update({
      amount_paid: newTotal,
      deposit_paid: job.payment_type === "deposit" ? true : job.deposit_paid,
      final_payment_paid: isFullyPaid,
      status: isFullyPaid ? "paid" : job.status,
    }).eq("id", job.id);

    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        event: "payment_received",
        job_id: job.id,
        data: { amount: amount_paid },
      }),
    });

    return Response.json({ ok: true, new_total: newTotal, fully_paid: isFullyPaid });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
});

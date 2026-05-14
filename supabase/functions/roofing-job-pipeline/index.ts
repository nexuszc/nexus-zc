import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function callFn(name: string, body: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => {});
}

async function calculateJobProfitability(jobId: string) {
  const { data: job } = await supabase.from("roofing_jobs").select("contract_amount").eq("id", jobId).single();
  const { data: materials } = await supabase.from("material_orders").select("total_amount").eq("job_id", jobId).eq("status", "delivered");
  const { data: subs } = await supabase.from("sub_assignments").select("payment_amount").eq("job_id", jobId);

  const materialCost = (materials || []).reduce((s, m) => s + (m.total_amount || 0), 0);
  const subCost = (subs || []).reduce((s, r) => s + (r.payment_amount || 0), 0);
  const totalCost = materialCost + subCost;
  const contractAmt = Math.round((job?.contract_amount || 0) * 100);
  const grossProfit = contractAmt - totalCost;
  const grossMargin = contractAmt > 0 ? grossProfit / contractAmt : 0;

  await supabase.from("job_financials").update({
    material_cost: materialCost,
    sub_cost: subCost,
    total_cost: totalCost,
    gross_profit: grossProfit,
    gross_margin: grossMargin,
    updated_at: new Date().toISOString()
  }).eq("job_id", jobId);
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-job-pipeline ready" });

  const { job_id, new_status, metadata = {} } = body;
  if (!job_id || !new_status) return Response.json({ error: "job_id and new_status required" }, { status: 400 });

  const { data: job } = await supabase.from("roofing_jobs").select("*").eq("id", job_id).single();
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

  const previousStatus = job.status;

  await supabase.from("roofing_jobs").update({
    status: new_status,
    updated_at: new Date().toISOString(),
    ...metadata
  }).eq("id", job_id);

  switch (new_status) {

    case "contracted": {
      // Create / upsert job financials
      await supabase.from("job_financials").upsert({
        job_id,
        contract_amount: Math.round(((metadata as any).contract_amount || job.contract_amount || 0) * 100),
        amount_outstanding: Math.round(((metadata as any).contract_amount || job.contract_amount || 0) * 100)
      }, { onConflict: "job_id" });

      // Send portal magic link if homeowner has email
      if (job.homeowner_email) {
        await callFn("portal-magic-link", {
          job_id,
          homeowner_email: job.homeowner_email,
          homeowner_name: job.homeowner_name,
          homeowner_phone: job.homeowner_phone,
          contractor_name: (metadata as any).contractor_name || "Your Contractor"
        });
      }

      // Pre-install supplement for insurance jobs
      if (job.job_type === "insurance" && (job.insurance_carrier || job.insurance_claim)) {
        callFn("roofing-supplement-generator", { job_id, package_type: "pre_install" });
      }

      // Create permit record
      await supabase.from("roofing_permits").insert({
        job_id,
        municipality: job.city || "Denver",
        state: job.state || "CO",
        status: "not_started"
      });

      await tg(
        `✅ *Contract Signed*\n` +
        `*${job.property_address}*\n` +
        `Amount: $${(((metadata as any).contract_amount || job.contract_amount || 0)).toLocaleString()}\n` +
        `Portal sent to homeowner.\n` +
        `Pre-install supplement generating.\n` +
        `Permit process starting.`
      );
      break;
    }

    case "materials_ordered": {
      await callFn("portal-activity-generator", {
        job_id,
        activity_type: "materials_ordered",
        metadata: {
          material: (metadata as any).material_type || job.material_type,
          delivery_date: (metadata as any).delivery_date
        }
      });
      break;
    }

    case "in_progress": {
      await supabase.from("roofing_jobs")
        .update({ actual_start_date: new Date().toISOString().split("T")[0] })
        .eq("id", job_id);
      await callFn("portal-activity-generator", { job_id, activity_type: "installation_started", metadata: {} });
      break;
    }

    case "complete": {
      await supabase.from("roofing_jobs")
        .update({ actual_end: new Date().toISOString().split("T")[0], completion_date: new Date().toISOString().split("T")[0] })
        .eq("id", job_id);

      // Post-install supplement
      if (job.job_type === "insurance") {
        callFn("roofing-supplement-generator", { job_id, package_type: "post_install" });
      }

      // Depreciation release
      callFn("roofing-depreciation-tracker", { action: "scan" });

      // Review request 24h later
      await supabase.from("reminders").insert({
        chat_id: TELEGRAM_CHAT_ID,
        message: `Send review request: ${job.property_address} ${job.homeowner_phone || ""}`,
        fire_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

      await callFn("portal-activity-generator", { job_id, activity_type: "installation_complete", metadata: {} });
      await calculateJobProfitability(job_id);

      await tg(
        `🏠 *Job Complete*\n` +
        `*${job.property_address}*\n` +
        `Post-install supplement generating.\n` +
        `Review request scheduled for tomorrow.\n` +
        `Depreciation release processing.`
      );
      break;
    }

    case "paid": {
      const payAmt = (metadata as any).amount || 0;

      // Read current total before updating
      const { data: fin } = await supabase.from("job_financials")
        .select("total_collected, deposit_received, insurance_check_received")
        .eq("job_id", job_id)
        .maybeSingle();

      const newTotal = (fin?.total_collected || 0)
        + (fin?.deposit_received || 0)
        + (fin?.insurance_check_received || 0)
        + payAmt;

      await supabase.from("job_financials").update({
        final_payment_received: payAmt,
        final_payment_received_at: new Date().toISOString(),
        total_collected: newTotal,
        amount_outstanding: 0
      }).eq("job_id", job_id);

      // Add to roof monitoring
      await supabase.from("roof_monitoring").insert({
        job_id,
        homeowner_email: job.homeowner_email || "",
        property_address: job.property_address,
        installation_date: job.actual_end || job.completion_date || new Date().toISOString().split("T")[0],
        material_type: job.material_type,
        warranty_years: 25,
        warranty_expires: new Date(new Date().setFullYear(new Date().getFullYear() + 25)).toISOString().split("T")[0],
        health_score: 100,
        monitoring_active: true
      }).catch(() => {});

      await tg(
        `💰 *Job Paid — Complete*\n` +
        `*${job.property_address}*\n` +
        `Amount: $${(payAmt / 100).toLocaleString()}\n` +
        `Roof monitoring activated.\n` +
        `Annual check-in scheduled.`
      );
      break;
    }
  }

  return Response.json({ ok: true, previous_status: previousStatus, new_status });
});

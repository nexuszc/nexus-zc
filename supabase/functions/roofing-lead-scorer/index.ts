// roofing-lead-scorer v1 — scores leads 0-100 and updates job cards
// Can be called: POST { job_id } for single job, or POST {} to score all unscored leads
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function computeScore(job: any): { score: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;

  // Storm source: +25
  if (job.source === 'storm_alert' || job.storm_event_id) {
    breakdown.storm_source = 25;
    score += 25;
  }

  // Insurance job: +20
  if (job.insurance_claim || job.insurance_carrier) {
    breakdown.insurance_job = 20;
    score += 20;
  }

  // Referral source: +15
  if (job.source === 'referral' || job.referred_by) {
    breakdown.referral_source = 15;
    score += 15;
  }

  // Portal viewed: +10
  if (job.portal_last_viewed_at) {
    breakdown.portal_viewed = 10;
    score += 10;
  }

  // Has email AND phone: +10
  if (job.homeowner_email && job.homeowner_phone) {
    breakdown.full_contact = 10;
    score += 10;
  }

  // Document signed (estimate/contract): +15
  if (['contract_signed','materials_ordered','scheduled','in_progress','inspection','invoiced','complete','paid'].includes(job.status)) {
    breakdown.document_signed = 15;
    score += 15;
  }

  // Recent contact (within 3 days): +5
  if (job.last_contacted_at) {
    const daysSince = (Date.now() - new Date(job.last_contacted_at).getTime()) / 86400000;
    if (daysSince < 3) {
      breakdown.recent_contact = 5;
      score += 5;
    }
  }

  return { score: Math.min(score, 100), breakdown };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-lead-scorer v1 ready" });

  const { job_id } = body;
  let scored = 0;

  if (job_id) {
    // Score single job
    const { data: job } = await supabase
      .from("roofing_jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (!job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

    const { score, breakdown } = computeScore(job);

    await supabase.from("lead_scores").upsert({
      job_id: job.id,
      contractor_id: job.contractor_id,
      score,
      storm_source: !!breakdown.storm_source,
      insurance_job: !!breakdown.insurance_job,
      referral_source: !!breakdown.referral_source,
      portal_viewed: !!breakdown.portal_viewed,
      document_signed: !!breakdown.document_signed,
      score_breakdown: breakdown,
      last_scored_at: new Date().toISOString(),
    }, { onConflict: "job_id" });

    await supabase.from("roofing_jobs").update({ lead_score: score }).eq("id", job.id);
    scored = 1;

    return new Response(JSON.stringify({ ok: true, job_id, score, breakdown }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Batch score all active leads
  const { data: jobs } = await supabase
    .from("roofing_jobs")
    .select("*")
    .in("status", ["lead", "estimate_sent", "contract_signed", "materials_ordered", "scheduled"]);

  for (const job of jobs || []) {
    const { score, breakdown } = computeScore(job);

    await supabase.from("lead_scores").upsert({
      job_id: job.id,
      contractor_id: job.contractor_id,
      score,
      storm_source: !!breakdown.storm_source,
      insurance_job: !!breakdown.insurance_job,
      referral_source: !!breakdown.referral_source,
      portal_viewed: !!breakdown.portal_viewed,
      document_signed: !!breakdown.document_signed,
      score_breakdown: breakdown,
      last_scored_at: new Date().toISOString(),
    }, { onConflict: "job_id" });

    await supabase.from("roofing_jobs").update({ lead_score: score }).eq("id", job.id);
    scored++;
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "roofing-lead-scorer",
    status: "ok",
    response_ms: 0,
    metadata: { jobs_scored: scored },
    recorded_at: new Date().toISOString(),
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true, jobs_scored: scored }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});

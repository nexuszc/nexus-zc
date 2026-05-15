// roofing-referral-engine
// Triggered by: supplement_approved, review_detected, tier_upgrade, 90_day_anniversary
// Generates personalized referral outreach and tracks in contractor_referrals

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
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

async function claude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function buildContractorSummary(contractorId: string): Promise<string> {
  const [acctRes, jobsRes, supRes] = await Promise.all([
    supabase.from("contractor_accounts").select("company_name, owner_name, plan, created_at, referral_code").eq("id", contractorId).single(),
    supabase.from("roofing_jobs").select("id, status, contract_amount").eq("contractor_id", contractorId).in("status", ["complete", "paid"]).limit(50),
    supabase.from("supplement_packages").select("supplement_approved_amount, status").eq("contractor_id", contractorId).eq("status", "approved").limit(50)
  ]);

  const acct = acctRes.data;
  const jobs = jobsRes.data || [];
  const sups = supRes.data || [];

  const totalSupRevenue = sups.reduce((s: number, p: any) => s + ((p.supplement_approved_amount || 0) / 100), 0);
  const completedJobs = jobs.length;

  return `Company: ${acct?.company_name || "Unknown"}
Owner: ${acct?.owner_name || ""}
Plan: ${acct?.plan || "starter"}
Completed jobs: ${completedJobs}
Total supplement revenue recovered: $${totalSupRevenue.toLocaleString()}
Member since: ${acct?.created_at ? new Date(acct.created_at).toLocaleDateString() : "recently"}
Referral code: ${acct?.referral_code || ""}`;
}

async function sendReferralOutreach(contractor: any, message: string, trigger: string) {
  // Queue via Aria if phone available
  if (contractor.owner_phone) {
    const gateRes = await fetch(`${SUPABASE_URL}/functions/v1/aria-call-gate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contact_phone: contractor.owner_phone, call_type: "referral_ask" })
    });
    const gate = await gateRes.json().catch(() => ({ allowed: false }));

    const fireAt = gate.allowed
      ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
      : gate.next_allowed_at || new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();

    await supabase.from("aria_call_queue").insert({
      call_type: "referral_ask",
      contact_phone: contractor.owner_phone,
      contact_name: contractor.owner_name,
      contact_type: "contractor",
      metadata: { trigger, referral_message: message, referral_code: contractor.referral_code },
      fire_at: fireAt,
      status: "queued"
    }).catch(() => {});
  }

  // SMS fallback
  if (contractor.owner_phone) {
    const smsBody = message.length > 160 ? message.slice(0, 157) + "…" : message;
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sms", phone: contractor.owner_phone, message: smsBody })
    }).catch(() => {});
  }
}

async function handleSupplementApproved(payload: any) {
  const { package_id, contractor_id } = payload;

  const { data: pkg } = await supabase
    .from("supplement_packages")
    .select("supplement_approved_amount, carrier_name, job_id")
    .eq("id", package_id)
    .single();

  if (!pkg) return;

  const { data: contractor } = await supabase
    .from("contractor_accounts")
    .select("id, company_name, owner_name, owner_phone, referral_code")
    .eq("id", contractor_id)
    .single();

  if (!contractor) return;

  const approvedAmount = ((pkg.supplement_approved_amount || 0) / 100).toLocaleString();
  const summary = await buildContractorSummary(contractor_id);

  const message = await claude(
    `Write a brief, genuine SMS message (max 140 chars) from Roofing OS to a roofing contractor celebrating their supplement approval.

Context:
${summary}
Just approved: $${approvedAmount} from ${pkg.carrier_name}

The message should:
1. Congratulate them specifically on the amount
2. Ask if they know another contractor still struggling with supplements
3. Mention they get a free month for each referral (code: ${contractor.referral_code})

Sound like a human text, not marketing. No emojis overload.`
  );

  await sendReferralOutreach(contractor, message, "supplement_approved");

  await supabase.from("contractor_referrals").insert({
    referring_contractor_id: contractor_id,
    referral_code: contractor.referral_code,
    status: "outreach_sent",
    referred_email: null
  }).catch(() => {});

  await tg(
    `🤝 *Referral Outreach Sent*\n` +
    `Trigger: Supplement approved ($${approvedAmount})\n` +
    `Contractor: ${contractor.company_name}\n` +
    `Outreach: SMS + Aria call queued`
  );
}

async function handleReviewDetected(payload: any) {
  const { contractor_id, review_text, rating, platform } = payload;

  const { data: contractor } = await supabase
    .from("contractor_accounts")
    .select("id, company_name, owner_name, owner_phone, referral_code")
    .eq("id", contractor_id)
    .single();

  if (!contractor) return;

  const summary = await buildContractorSummary(contractor_id);

  const message = await claude(
    `Write a brief SMS (max 140 chars) to a roofing contractor who just got a 5-star review on ${platform || "Google"}.

Context: ${summary}
Review snippet: "${(review_text || "").slice(0, 100)}"

Congratulate them genuinely, then ask if they know another contractor who'd benefit from what they're using.
Mention referral code: ${contractor.referral_code}. One free month per referral.`
  );

  await sendReferralOutreach(contractor, message, "review_detected");
  await tg(`⭐ *Referral Sent — 5-Star Review*\nContractor: ${contractor.company_name} (${platform})`);
}

async function handleTierUpgrade(payload: any) {
  const { contractor_id, old_plan, new_plan } = payload;

  const { data: contractor } = await supabase
    .from("contractor_accounts")
    .select("id, company_name, owner_name, owner_phone, referral_code")
    .eq("id", contractor_id)
    .single();

  if (!contractor) return;

  const message = await claude(
    `Write an SMS (max 140 chars) to a roofing contractor who just upgraded from ${old_plan} to ${new_plan} plan on Roofing OS.

Acknowledge the upgrade, say you appreciate them, and ask if they know any other contractors who are still on basic tools who'd benefit.
Referral code: ${contractor.referral_code}. They get a free month for each referral.
Sound genuine, not salesy.`
  );

  await sendReferralOutreach(contractor, message, "tier_upgrade");
  await tg(`⬆️ *Referral Sent — Tier Upgrade*\nContractor: ${contractor.company_name}\n${old_plan} → ${new_plan}`);
}

async function handle90DayAnniversary(payload: any) {
  const { contractor_id } = payload;

  const { data: contractor } = await supabase
    .from("contractor_accounts")
    .select("id, company_name, owner_name, owner_phone, referral_code, created_at")
    .eq("id", contractor_id)
    .single();

  if (!contractor) return;

  const summary = await buildContractorSummary(contractor_id);

  const message = await claude(
    `Write a congratulatory SMS (max 140 chars) to a roofing contractor who's been using Roofing OS for 90 days.

Their results:
${summary}

Be personal and specific about their 90 days. Ask if they know another contractor who should be where they are now.
Referral code: ${contractor.referral_code}. One free month per referral they send.`
  );

  await sendReferralOutreach(contractor, message, "90_day_anniversary");
  await tg(`🎂 *90-Day Referral Outreach*\nContractor: ${contractor.company_name}\n${summary.split("\n").slice(2, 5).join(" | ")}`);
}

async function scan90DayAnniversaries() {
  // Find contractors who hit exactly 90 days today (±2 hour window)
  const now = new Date();
  const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const windowEnd = now;

  const target90Start = new Date(windowStart.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const target90End = new Date(windowEnd.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: contractors } = await supabase
    .from("contractor_accounts")
    .select("id, company_name, created_at")
    .gte("created_at", target90Start)
    .lte("created_at", target90End);

  for (const contractor of contractors || []) {
    await handle90DayAnniversary({ contractor_id: contractor.id });
  }

  return (contractors || []).length;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-referral-engine ready" });

  const { trigger, ...payload } = body;
  const startMs = Date.now();

  try {
    let result: any = {};

    if (trigger === "supplement_approved") {
      await handleSupplementApproved(payload);
      result = { trigger, handled: true };
    } else if (trigger === "review_detected") {
      await handleReviewDetected(payload);
      result = { trigger, handled: true };
    } else if (trigger === "tier_upgrade") {
      await handleTierUpgrade(payload);
      result = { trigger, handled: true };
    } else if (trigger === "90_day_anniversary") {
      await handle90DayAnniversary(payload);
      result = { trigger, handled: true };
    } else if (trigger === "scan_anniversaries") {
      const count = await scan90DayAnniversaries();
      result = { trigger, anniversaries_found: count };
    } else {
      return Response.json({ error: "Unknown trigger. Valid: supplement_approved, review_detected, tier_upgrade, 90_day_anniversary, scan_anniversaries" }, { status: 400 });
    }

    const duration = Date.now() - startMs;

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-referral-engine",
      status: "ok",
      response_ms: duration,
      checked_at: new Date().toISOString()
    }).catch(() => {});

    return Response.json({ ok: true, ...result, duration_ms: duration });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-referral-engine",
      status: "error",
      error_message: msg,
      checked_at: new Date().toISOString()
    }).catch(() => {});
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

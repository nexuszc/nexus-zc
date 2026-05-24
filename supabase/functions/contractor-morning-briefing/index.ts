// contractor-morning-briefing v1 — 7am MT (13:00 UTC) daily
// Sends personalized morning SMS to paid contractor owner phones
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID  = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN   = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendSMS(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) return { skipped: true };
  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: body }),
    }
  );
  return res.json();
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "contractor-morning-briefing v1 ready" });

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Get paid plan contractors with phone numbers
  const { data: contractors } = await supabase
    .from("contractor_accounts")
    .select("id, company_name, owner_name, owner_phone, plan")
    .in("plan", ["starter", "pro", "custom"])
    .eq("status", "active")
    .not("owner_phone", "is", null);

  if (!contractors?.length) return Response.json({ ok: true, sent: 0 });

  let sent = 0;

  for (const c of contractors) {
    if (!c.owner_phone) continue;

    // Get today's jobs
    const { data: scheduledJobs } = await supabase
      .from("job_schedule")
      .select("*, roofing_jobs(homeowner_name, property_address, status)")
      .eq("roofing_jobs.contractor_id", c.id)
      .eq("scheduled_date", todayStr);

    // Get active jobs count
    const { count: activeCount } = await supabase
      .from("roofing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("contractor_id", c.id)
      .in("status", ["in_progress", "scheduled", "materials_ordered"]);

    // Get hot leads
    const { count: hotLeads } = await supabase
      .from("lead_scores")
      .select("id", { count: "exact", head: true })
      .eq("contractor_id", c.id)
      .gte("score", 70);

    // Get weather warnings
    const { count: weatherWarnings } = await supabase
      .from("roofing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("contractor_id", c.id)
      .eq("weather_warning", true)
      .not("status", "in", '("complete","paid","lead")');

    // Get payments due today
    const { data: paymentsDue } = await supabase
      .from("job_payments")
      .select("amount_cents, label")
      .eq("contractor_id", c.id)
      .eq("status", "pending")
      .lte("due_date", todayStr);

    const totalDueCents = (paymentsDue || []).reduce((s, p) => s + p.amount_cents, 0);

    const firstName = (c.owner_name || "").split(" ")[0] || "there";
    const jobsToday = scheduledJobs?.length || 0;

    let lines = [`Good morning ${firstName} ☀️`];
    if (jobsToday > 0) {
      lines.push(`📅 ${jobsToday} job${jobsToday > 1 ? 's' : ''} scheduled today`);
    }
    if ((activeCount || 0) > 0) {
      lines.push(`🔨 ${activeCount} active job${activeCount! > 1 ? 's' : ''} in progress`);
    }
    if ((hotLeads || 0) > 0) {
      lines.push(`🔥 ${hotLeads} hot lead${hotLeads! > 1 ? 's' : ''} — follow up today`);
    }
    if ((weatherWarnings || 0) > 0) {
      lines.push(`⛈️ ${weatherWarnings} job${weatherWarnings! > 1 ? 's' : ''} have weather warnings`);
    }
    if (totalDueCents > 0) {
      lines.push(`💰 $${(totalDueCents / 100).toLocaleString()} in payments due`);
    }
    lines.push(`\nManage at app.nexuszc.com/roofing/jobs`);

    const result = await sendSMS(c.owner_phone, lines.join("\n"));
    if (!result?.skipped) sent++;

    // Log briefing
    await supabase.from("contractor_briefings").upsert({
      contractor_id: c.id,
      briefing_date: todayStr,
      jobs_scheduled: jobsToday,
      jobs_active: activeCount || 0,
      payments_due_cents: totalDueCents,
      weather_warnings: weatherWarnings || 0,
      hot_leads: hotLeads || 0,
      briefing_text: lines.join("\n"),
      sms_sent: !result?.skipped,
      sms_sent_at: new Date().toISOString(),
    }, { onConflict: "contractor_id,briefing_date" });
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "contractor-morning-briefing",
    status: "ok",
    response_ms: 0,
    metadata: { contractors_checked: contractors.length, sms_sent: sent },
    recorded_at: now.toISOString(),
  }).catch(() => {});

  return Response.json({ ok: true, contractors_checked: contractors.length, sms_sent: sent });
});

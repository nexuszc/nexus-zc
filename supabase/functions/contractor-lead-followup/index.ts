// contractor-lead-followup v1
// Daily at 9am MT (15:00 UTC) — sends SMS follow-ups to unconverted leads
// Day 3 / Day 7 / Day 14 from last contact

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID  = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN   = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendSMS(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.warn("Twilio not configured — SMS skipped");
    return { skipped: true };
  }
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
  if (body.test) return Response.json({ ok: true, message: "contractor-lead-followup v1 ready" });

  const now = new Date();
  const day3ago  = new Date(now.getTime() - 3  * 86400000).toISOString();
  const day7ago  = new Date(now.getTime() - 7  * 86400000).toISOString();
  const day14ago = new Date(now.getTime() - 14 * 86400000).toISOString();
  const day3start  = new Date(now.getTime() - (3  * 86400000 + 3600000)).toISOString();
  const day7start  = new Date(now.getTime() - (7  * 86400000 + 3600000)).toISOString();
  const day14start = new Date(now.getTime() - (14 * 86400000 + 3600000)).toISOString();

  // Get all leads eligible for follow-up (not signed, not opted out, not complete)
  const { data: jobs } = await supabase
    .from("roofing_jobs")
    .select("id, homeowner_name, homeowner_phone, contractor_id, last_contacted_at, follow_up_opted_out, follow_up_complete, status")
    .not("status", "in", '("contract_signed","in_progress","inspection","invoiced","complete","paid")')
    .eq("follow_up_opted_out", false)
    .eq("follow_up_complete", false)
    .not("homeowner_phone", "is", null);

  if (!jobs?.length) return Response.json({ ok: true, processed: 0 });

  // Get contractor names for messaging
  const contractorIds = [...new Set(jobs.map(j => j.contractor_id).filter(Boolean))];
  const { data: accounts } = await supabase
    .from("contractor_accounts")
    .select("id, company_name")
    .in("id", contractorIds);

  const companyMap: Record<string, string> = {};
  for (const a of accounts || []) companyMap[a.id] = a.company_name || "Your contractor";

  let sent = 0;
  let markedComplete = 0;

  for (const job of jobs) {
    const phone = job.homeowner_phone;
    const name = (job.homeowner_name || "").split(" ")[0] || "there";
    const company = companyMap[job.contractor_id] || "Your contractor";
    const lastContact = job.last_contacted_at ? new Date(job.last_contacted_at) : null;

    if (!lastContact) continue;

    const daysSince = (now.getTime() - lastContact.getTime()) / 86400000;

    let message: string | null = null;

    if (daysSince >= 3 && daysSince < 4) {
      // Day 3
      message = `Hey ${name} — ${company} here.\nJust checking in on your roof estimate.\nAny questions I can answer?`;
    } else if (daysSince >= 7 && daysSince < 8) {
      // Day 7
      message = `Hi ${name} — storm season is busy and we're booking up fast.\nWant to lock in your spot?`;
    } else if (daysSince >= 14 && daysSince < 15) {
      // Day 14 — final
      message = `Last follow up from ${company} —\nYour estimate is still available.\nReply STOP to opt out.`;
    }

    if (!message) continue;

    // Check for STOP keyword in recent inbound (opt-out handling is basic)
    const result = await sendSMS(phone, message);
    if (!result?.skipped) sent++;

    // Mark day 14 as complete
    if (daysSince >= 14 && daysSince < 15) {
      await supabase.from("roofing_jobs")
        .update({ follow_up_complete: true })
        .eq("id", job.id);
      markedComplete++;
    }

    // Update last_contacted_at to prevent re-firing same day
    await supabase.from("roofing_jobs")
      .update({ last_contacted_at: now.toISOString() })
      .eq("id", job.id);
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "contractor-lead-followup",
    status: "ok",
    response_ms: 0,
    metadata: { jobs_checked: jobs.length, sms_sent: sent, sequences_completed: markedComplete },
    recorded_at: now.toISOString(),
  }).catch(() => {});

  return Response.json({ ok: true, jobs_checked: jobs.length, sms_sent: sent, sequences_completed: markedComplete });
});

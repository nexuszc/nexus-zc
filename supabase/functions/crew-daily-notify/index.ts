// crew-daily-notify v1 — 6am MT (12:00 UTC) daily
// SMS each crew member assigned to a job scheduled for today
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
  if (body.test) return Response.json({ ok: true, message: "crew-daily-notify v1 ready" });

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Get job schedules for today
  const { data: schedules } = await supabase
    .from("job_schedule")
    .select("*, roofing_jobs(homeowner_name, property_address, contractor_id, status)")
    .eq("scheduled_date", todayStr);

  if (!schedules?.length) return Response.json({ ok: true, sent: 0 });

  let sent = 0;

  for (const sched of schedules) {
    const job = sched.roofing_jobs;
    if (!job) continue;

    // Get crew assignments for this job
    const { data: crew } = await supabase
      .from("crew_assignments")
      .select("*")
      .eq("job_id", sched.job_id)
      .eq("notify_sms", true)
      .not("phone", "is", null);

    for (const member of crew || []) {
      const firstName = (member.name || "").split(" ")[0] || "Crew";
      const msg = [
        `Good morning ${firstName}! 🔨`,
        `Today's job: ${job.homeowner_name}`,
        `Address: ${job.property_address}`,
        sched.arrival_window_start ? `Report time: ${sched.arrival_window_start}` : null,
        sched.work_description ? `Work: ${sched.work_description}` : null,
        `\nLog your arrival + upload photos: https://app.nexuszc.com/roofing/crew/${member.id}`,
      ].filter(Boolean).join("\n");

      const result = await sendSMS(member.phone, msg);
      if (!result?.skipped) {
        sent++;
        await supabase.from("crew_assignments").update({ notified_at: now.toISOString() }).eq("id", member.id);
      }
    }

    // Also notify crew lead if set on schedule and has phone but no crew_assignments row
    if (sched.crew_lead && !crew?.length) {
      // Try to find by name in contractor_employees
      const { data: emp } = await supabase
        .from("contractor_employees")
        .select("phone, name")
        .eq("contractor_id", job.contractor_id)
        .ilike("name", `%${sched.crew_lead}%`)
        .maybeSingle();

      if (emp?.phone) {
        const msg = `Good morning! 🔨 Today's job: ${job.homeowner_name} at ${job.property_address}${sched.arrival_window_start ? `\nReport: ${sched.arrival_window_start}` : ''}\nManage: https://app.nexuszc.com/roofing/jobs`;
        const result = await sendSMS(emp.phone, msg);
        if (!result?.skipped) sent++;
      }
    }
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "crew-daily-notify",
    status: "ok",
    response_ms: 0,
    metadata: { schedules_today: schedules.length, sms_sent: sent },
    recorded_at: now.toISOString(),
  }).catch(() => {});

  return Response.json({ ok: true, schedules_today: schedules.length, sms_sent: sent });
});

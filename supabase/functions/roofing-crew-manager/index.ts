import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const FROM_NUMBER = Deno.env.get("RETELL_PHONE_NUMBER") || Deno.env.get("TWILIO_PHONE_NUMBER") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function sendSMS(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !FROM_NUMBER) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ From: FROM_NUMBER, To: to, Body: body })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-crew-manager ready" });

  const { action } = body;

  switch (action) {

    case "schedule": {
      const { job_id, crew_member_ids, scheduled_date, start_time } = body;
      if (!job_id || !crew_member_ids?.length || !scheduled_date) {
        return Response.json({ error: "job_id, crew_member_ids, scheduled_date required" }, { status: 400 });
      }

      const schedules = (crew_member_ids as string[]).map(id => ({
        job_id,
        crew_member_id: id,
        scheduled_date,
        start_time: start_time || "07:00",
        status: "scheduled"
      }));

      await supabase.from("crew_schedules").insert(schedules);

      const { data: crewMembers } = await supabase
        .from("roofing_crew")
        .select("name, phone")
        .in("id", crew_member_ids);

      const { data: job } = await supabase
        .from("roofing_jobs")
        .select("property_address, material_type")
        .eq("id", job_id)
        .single();

      for (const member of crewMembers || []) {
        if (!member.phone) continue;
        await sendSMS(
          member.phone,
          `Job scheduled!\nDate: ${scheduled_date}\nStart: ${start_time || "7:00 AM"}\nAddress: ${job?.property_address}\nMaterial: ${job?.material_type || "TBD"}\nReply CONFIRM to confirm.`
        );
      }

      // Portal activity
      await fetch(`${SUPABASE_URL}/functions/v1/portal-activity-generator`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id,
          activity_type: "crew_assigned",
          metadata: {
            foreman_name: crewMembers?.[0]?.name || "Your crew",
            date: scheduled_date
          }
        })
      }).catch(() => {});

      return Response.json({ ok: true, scheduled: schedules.length });
    }

    case "checkin": {
      const { crew_member_id, job_id, gps_lat, gps_lng } = body;
      const today = new Date().toISOString().split("T")[0];

      await supabase.from("crew_schedules")
        .update({
          checked_in_at: new Date().toISOString(),
          gps_checkin_lat: gps_lat,
          gps_checkin_lng: gps_lng,
          status: "checked_in"
        })
        .eq("crew_member_id", crew_member_id)
        .eq("job_id", job_id)
        .eq("scheduled_date", today);

      // Transition job to in_progress on first checkin
      const { data: job } = await supabase
        .from("roofing_jobs")
        .select("status")
        .eq("id", job_id)
        .single();

      if (job?.status === "scheduled") {
        await fetch(`${SUPABASE_URL}/functions/v1/roofing-job-pipeline`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ job_id, new_status: "in_progress" })
        }).catch(() => {});
      }

      return Response.json({ ok: true });
    }

    case "checkout": {
      const { crew_member_id, job_id } = body;

      const { data: schedule } = await supabase
        .from("crew_schedules")
        .select("checked_in_at")
        .eq("crew_member_id", crew_member_id)
        .eq("job_id", job_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const hoursWorked = schedule?.checked_in_at
        ? (Date.now() - new Date(schedule.checked_in_at).getTime()) / (1000 * 60 * 60)
        : 0;

      await supabase.from("crew_schedules")
        .update({
          checked_out_at: new Date().toISOString(),
          hours_worked: Math.round(hoursWorked * 10) / 10,
          status: "complete"
        })
        .eq("crew_member_id", crew_member_id)
        .eq("job_id", job_id)
        .eq("status", "checked_in");

      return Response.json({ ok: true, hours_worked: Math.round(hoursWorked * 10) / 10 });
    }

    case "weather_check": {
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const today = new Date().toISOString().split("T")[0];

      const { data: upcoming } = await supabase
        .from("crew_schedules")
        .select("scheduled_date, job_id, roofing_jobs(property_address)")
        .gte("scheduled_date", today)
        .lte("scheduled_date", nextWeek)
        .eq("status", "scheduled");

      // Deduplicate by job_id
      const seen = new Set<string>();
      for (const schedule of upcoming || []) {
        if (seen.has(schedule.job_id)) continue;
        seen.add(schedule.job_id);

        const job = schedule.roofing_jobs as Record<string, unknown>;
        const daysUntil = Math.round(
          (new Date(schedule.scheduled_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntil <= 2) {
          await tg(
            `🌤️ *Job in ${daysUntil} day${daysUntil === 1 ? "" : "s"}*\n` +
            `${job?.property_address}\n` +
            `Date: ${schedule.scheduled_date}\n` +
            `Check weather before confirming crew.`
          );
        }
      }

      return Response.json({ ok: true, upcoming_jobs: seen.size });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
});

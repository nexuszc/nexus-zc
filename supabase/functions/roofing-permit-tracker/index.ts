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

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-permit-tracker ready" });

  const { action } = body;

  switch (action) {

    case "submit": {
      const { permit_id, method } = body;
      if (!permit_id) return Response.json({ error: "permit_id required" }, { status: 400 });

      await supabase.from("roofing_permits").update({
        status: "submitted",
        application_submitted_at: new Date().toISOString(),
        application_method: method || "va_submitted"
      }).eq("id", permit_id);

      const { data: permit } = await supabase
        .from("roofing_permits")
        .select("*, roofing_jobs(property_address)")
        .eq("id", permit_id)
        .single();

      if (permit?.job_id) {
        await fetch(`${SUPABASE_URL}/functions/v1/portal-activity-generator`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: permit.job_id,
            activity_type: "permit_submitted",
            metadata: {
              municipality: permit.municipality,
              days: permit.expected_approval_days || 5
            }
          })
        }).catch(() => {});
      }

      return Response.json({ ok: true });
    }

    case "approved": {
      const { permit_id, permit_number } = body;
      if (!permit_id) return Response.json({ error: "permit_id required" }, { status: 400 });

      await supabase.from("roofing_permits").update({
        status: "approved",
        approved_at: new Date().toISOString(),
        permit_number: permit_number || null
      }).eq("id", permit_id);

      const { data: permit } = await supabase
        .from("roofing_permits")
        .select("job_id, municipality")
        .eq("id", permit_id)
        .single();

      if (permit?.job_id) {
        await fetch(`${SUPABASE_URL}/functions/v1/portal-activity-generator`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id: permit.job_id,
            activity_type: "permit_approved",
            metadata: {}
          })
        }).catch(() => {});

        await supabase.from("roofing_jobs").update({ status: "permit_approved" }).eq("id", permit.job_id);
      }

      await tg(`✅ *Permit Approved*\nPermit #: ${permit_number || "On file"}\nJob is cleared for installation.`);
      return Response.json({ ok: true });
    }

    case "scan_pending": {
      const { data: pending } = await supabase
        .from("roofing_permits")
        .select("*, roofing_jobs(property_address)")
        .in("status", ["submitted", "application_ready"])
        .not("application_submitted_at", "is", null);

      let overdue = 0;
      for (const permit of pending || []) {
        const daysPending = Math.round(
          (Date.now() - new Date(permit.application_submitted_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        const expectedDays = permit.expected_approval_days || 5;

        if (daysPending > expectedDays) {
          overdue++;
          const job = permit.roofing_jobs as Record<string, unknown>;
          await tg(
            `⏰ *Permit Overdue*\n` +
            `${job?.property_address || "Unknown address"}\n` +
            `Municipality: ${permit.municipality}\n` +
            `Submitted ${daysPending} days ago.\n` +
            `Expected: ${expectedDays} days.\n` +
            `Call permit office to follow up.`
          );
        }
      }

      return Response.json({ ok: true, checked: (pending || []).length, overdue });
    }

    case "get": {
      const { job_id } = body;
      if (!job_id) return Response.json({ error: "job_id required" }, { status: 400 });
      const { data: permits } = await supabase.from("roofing_permits").select("*").eq("job_id", job_id);
      return Response.json({ ok: true, permits: permits || [] });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
});

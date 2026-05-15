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
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-aria-storm-trigger ready" });

  const { zip_codes, hail_size, storm_date, contractor_id, city, state, storm_event_id } = body;

  // Fire roofing-storm-marketing in parallel (prospect outreach + content bundles)
  fetch(`${SUPABASE_URL}/functions/v1/roofing-storm-marketing`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zip_codes, hail_size, city, state, storm_event_id, storm_date })
  }).catch(() => {});

  if (!zip_codes?.length || !hail_size) {
    return Response.json({ error: "zip_codes and hail_size required" }, { status: 400 });
  }

  // Get all previous customers from completed jobs
  const { data: completedJobs } = await supabase
    .from("roofing_jobs")
    .select("id, homeowner_name, homeowner_phone, property_address, status")
    .in("status", ["complete", "paid"])
    .not("homeowner_phone", "is", null);

  // Filter by zip code in property_address
  const matchingJobs = (completedJobs || []).filter(job =>
    zip_codes.some((zip: string) => (job.property_address || "").includes(zip))
  );

  let callsQueued = 0;
  const results: { homeowner: string; phone: string; queued: boolean }[] = [];

  for (const job of matchingJobs) {
    // Check DNC / unsubscribe list
    const { data: unsub } = await supabase
      .from("nexus_unsubscribes")
      .select("id")
      .eq("phone", job.homeowner_phone)
      .eq("channel", "voice")
      .maybeSingle();

    if (unsub) continue;

    // Get portal token for SMS
    const { data: session } = await supabase
      .from("homeowner_sessions")
      .select("magic_link_token")
      .eq("job_id", job.id)
      .maybeSingle();

    const portalLink = session?.magic_link_token
      ? `https://roofingos.dev/portal/${session.magic_link_token}`
      : "";

    // CALL GATE — check timing before firing
    const gateRes = await fetch(`${SUPABASE_URL}/functions/v1/aria-call-gate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contact_phone: job.homeowner_phone, call_type: "storm_alert" })
    });
    const gate = await gateRes.json().catch(() => ({ allowed: true }));

    if (!gate.allowed && !gate.permanent) {
      await supabase.from("aria_call_queue").insert({
        call_type: "storm_alert",
        contact_phone: job.homeowner_phone,
        contact_name: job.homeowner_name,
        contact_type: "previous_customer",
        job_id: job.id,
        metadata: {
          property_address: job.property_address,
          hail_size: String(hail_size),
          storm_date: storm_date || new Date().toISOString(),
          portal_link: portalLink
        },
        fire_at: gate.next_allowed_at,
        recipient_timezone: gate.recipient_timezone || "America/Denver",
        queue_reason: gate.reason,
        status: "queued"
      });
      results.push({ homeowner: job.homeowner_name || "Unknown", phone: job.homeowner_phone, queued: false });
      continue;
    }

    if (gate.permanent) {
      results.push({ homeowner: job.homeowner_name || "Unknown", phone: job.homeowner_phone, queued: false });
      continue;
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        call_type: "storm_alert",
        contact_phone: job.homeowner_phone,
        contact_name: job.homeowner_name,
        contact_type: "previous_customer",
        job_id: job.id,
        metadata: {
          property_address: job.property_address,
          hail_size: String(hail_size),
          storm_date: storm_date || new Date().toISOString(),
          contractor_name: "your roofing company",
          portal_link: portalLink
        }
      })
    });

    const queued = res.ok;
    if (queued) callsQueued++;
    results.push({ homeowner: job.homeowner_name || "Unknown", phone: job.homeowner_phone, queued });

    // Small delay between calls to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  await tg(
    `⛈️ *Storm Alert Calls Queued*\n` +
    `Zip codes: ${zip_codes.join(", ")}\n` +
    `Hail size: ${hail_size}"\n` +
    `Previous customers found: ${matchingJobs.length}\n` +
    `Calls queued: ${callsQueued}\n` +
    `_Calls completing over next ~2 hours_`
  );

  return Response.json({ ok: true, calls_queued: callsQueued, total_found: matchingJobs.length, results });
});

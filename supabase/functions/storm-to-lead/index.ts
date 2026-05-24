// storm-to-lead v1 — triggered by VPS hail-trigger when a hail event is detected
// Creates roofing_jobs leads for contractors in the affected market_city
// Sets source='storm_alert', lead_score=75, triggers Aria outreach queue
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_CHAT_ID   = Deno.env.get("TELEGRAM_CHAT_ID") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "storm-to-lead v1 ready" });

  const {
    hail_event_id,
    city,
    state,
    zip_codes,        // array of affected ZIPs
    severity,         // 'moderate' | 'significant' | 'severe'
    hail_size_inches,
    affected_addresses, // optional array of {homeowner_name, property_address, phone, email}
  } = body;

  if (!city) return Response.json({ error: "city required" }, { status: 400, headers: CORS_HEADERS });

  // Find contractors serving this market
  const { data: contractors } = await supabase
    .from("contractor_accounts")
    .select("id, company_name, market_city, market_state")
    .eq("status", "active")
    .or(`market_city.ilike.%${city}%,market_state.eq.${state || 'CO'}`);

  if (!contractors?.length) {
    return Response.json({ ok: true, leads_created: 0, message: "No contractors in this market" });
  }

  let leadsCreated = 0;

  for (const c of contractors) {
    // Create leads from affected addresses if provided, otherwise create a generic storm lead
    const leadsToCreate = affected_addresses?.length > 0
      ? affected_addresses
      : [{ homeowner_name: `Storm Lead — ${city}`, property_address: `${city}, ${state || 'CO'}`, phone: null, email: null }];

    for (const addr of leadsToCreate) {
      const { data: job } = await supabase.from("roofing_jobs").insert({
        contractor_id: c.id,
        homeowner_name: addr.homeowner_name || `Storm Lead — ${city}`,
        homeowner_phone: addr.phone || null,
        homeowner_email: addr.email || null,
        property_address: addr.property_address || `${city}, ${state || 'CO'}`,
        city: city,
        state: state || 'CO',
        status: 'lead',
        source: 'storm_alert',
        lead_score: 75,
        storm_event_id: hail_event_id || null,
        insurance_claim: true,
        notes: `Hail event: ${hail_size_inches || '?'}" hail — ${severity || 'moderate'} severity`,
        last_contacted_at: null,
        follow_up_opted_out: false,
        follow_up_complete: false,
        portal_token: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select().single();

      if (job) {
        leadsCreated++;

        // Create lead score record
        await supabase.from("lead_scores").insert({
          job_id: job.id,
          contractor_id: c.id,
          score: 75,
          storm_source: true,
          insurance_job: true,
          score_breakdown: {
            storm_source: 25,
            insurance_job: 20,
            base: 30,
          },
          last_scored_at: new Date().toISOString(),
        }).catch(() => {});

        // Queue Aria call if phone provided
        if (addr.phone) {
          await supabase.from("aria_call_queue").insert({
            contact_phone: addr.phone,
            contact_name: addr.homeowner_name || null,
            contact_type: "storm_lead",
            metadata: { job_id: job.id, contractor_id: c.id, hail_event_id },
            status: "queued",
            fire_at: new Date(Date.now() + 3600000).toISOString(), // 1hr delay
            attempt_count: 0,
          }).catch(() => {});
        }
      }
    }
  }

  if (leadsCreated > 0) {
    await sendTelegram(
      `🌩️ <b>Storm → Lead Chain Fired</b>\n` +
      `City: ${city}, ${state || 'CO'}\n` +
      `Hail: ${hail_size_inches || '?'}" — ${severity || 'moderate'}\n` +
      `Contractors notified: ${contractors.length}\n` +
      `Leads created: ${leadsCreated}`
    );
  }

  return new Response(JSON.stringify({ ok: true, leads_created: leadsCreated, contractors_notified: contractors.length }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});

// aria-queue-daily v1
// Runs daily at 14:00 UTC (8am MT). Selects 100 callable prospects,
// distributes across 6 states, inserts to aria_call_queue with TCPA-compliant fire_at.
// State detection via phone area code (address column is null in roofing_prospects).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

// State config: area codes, UTC offset (summer DST), daily target
const STATE_CONFIG: Record<string, { codes: string[]; utcOffset: number; target: number }> = {
  CO: { codes: ["303","720","719","970"],                                                              utcOffset: 6, target: 20 },
  TX: { codes: ["214","469","972","817","682","832","713","281","346","512","210","940","806"],        utcOffset: 5, target: 25 },
  FL: { codes: ["305","786","954","561","407","321","689","904","386","352","727","813","941","239"],  utcOffset: 4, target: 20 },
  GA: { codes: ["404","678","770","470","912","706","762"],                                            utcOffset: 4, target: 15 },
  OH: { codes: ["614","740","937","513","330","216","440","234"],                                      utcOffset: 4, target: 10 },
  IL: { codes: ["312","872","773","847","630","708","224","331","618","217","309"],                    utcOffset: 5, target: 10 },
};

function getStateFromPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  const areaCode = digits.startsWith("1") ? digits.slice(1, 4) : digits.slice(0, 3);
  for (const [state, cfg] of Object.entries(STATE_CONFIG)) {
    if (cfg.codes.includes(areaCode)) return state;
  }
  return null;
}

// Distribute N calls across 9am-4:30pm local, return fire_at UTC string for item i
function buildFireAt(utcOffset: number, index: number, total: number): string {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // 9:00am local = UTC midnight + utcOffset hours + 9 hours
  const windowStartMinutes = (utcOffset + 9) * 60;
  // 4:30pm local
  const windowEndMinutes   = (utcOffset + 16.5) * 60;
  const windowSize         = windowEndMinutes - windowStartMinutes; // 450 min
  const interval           = total > 1 ? windowSize / (total - 1) : 0;
  const minutesFromMidnight = windowStartMinutes + index * interval;
  const fireAt = new Date(today.getTime() + minutesFromMidnight * 60000);
  // If already past, push to tomorrow
  if (fireAt <= new Date()) {
    fireAt.setDate(fireAt.getDate() + 1);
  }
  return fireAt.toISOString();
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "aria-queue-daily v1 ready" });

  // Check pause flag
  const { data: pausePref } = await supabase
    .from("nexus_preferences")
    .select("value")
    .eq("key", "aria_outbound_paused")
    .maybeSingle();
  if (pausePref?.value === "true") {
    return Response.json({ ok: true, paused: true, message: "Outbound paused via nexus_preferences" });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  // Get phones already queued today (avoid duplicates)
  const { data: alreadyQueued } = await supabase
    .from("aria_call_queue")
    .select("contact_phone")
    .gte("created_at", today.toISOString());
  const alreadyQueuedPhones = new Set((alreadyQueued || []).map(r => r.contact_phone));

  // Pull callable prospects (not customer/unsubscribed/bounced)
  const { data: prospects } = await supabase
    .from("roofing_prospects")
    .select("id, owner_name, phone, company_name, status")
    .not("status", "in", '("customer","unsubscribed","bounced")')
    .not("phone", "is", null)
    .limit(500);

  if (!prospects?.length) {
    return Response.json({ ok: true, queued: 0, message: "No callable prospects found" });
  }

  // Classify by state
  const byState: Record<string, typeof prospects> = { CO: [], TX: [], FL: [], GA: [], OH: [], IL: [] };
  for (const p of prospects) {
    if (alreadyQueuedPhones.has(p.phone)) continue;
    const state = getStateFromPhone(p.phone);
    if (state && byState[state]) byState[state].push(p);
  }

  const inserts: Record<string, unknown>[] = [];

  for (const [state, cfg] of Object.entries(STATE_CONFIG)) {
    const pool = byState[state] || [];
    const count = Math.min(cfg.target, pool.length);
    const selected = pool.slice(0, count);
    selected.forEach((p, i) => {
      inserts.push({
        contact_phone:      p.phone,
        contact_name:       p.owner_name || p.company_name || "there",
        contact_type:       "roofing_prospect",
        call_type:          "cold_free_portal",
        status:             "queued",
        fire_at:            buildFireAt(cfg.utcOffset, i, count),
        metadata:           { prospect_id: p.id, state, company_name: p.company_name },
      });
    });
  }

  if (!inserts.length) {
    return Response.json({ ok: true, queued: 0, message: "No new prospects to queue (all states at capacity or no prospects)" });
  }

  const { error } = await supabase.from("aria_call_queue").insert(inserts);
  if (error) {
    console.error("Insert failed:", error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const byStateCounts = Object.fromEntries(
    Object.keys(STATE_CONFIG).map(s => [s, inserts.filter(i => (i.metadata as any).state === s).length])
  );

  console.log(`aria-queue-daily: queued ${inserts.length} calls`, byStateCounts);
  return Response.json({ ok: true, queued: inserts.length, by_state: byStateCounts });
});

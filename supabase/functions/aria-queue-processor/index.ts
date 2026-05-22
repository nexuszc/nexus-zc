// aria-queue-processor v3
// Reads aria_call_queue WHERE status IN ('queued','pending') AND fire_at <= NOW()
// For each: checks aria-call-gate → if allowed, fires roofing-aria-engine → updates status.
// v3: phone normalization to E.164, bypass_gate passed to engine, engine response checked.
// Runs every 2h during business hours via pg_cron (14:00–21:00 UTC = 8am–3pm MT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

const MAX_PER_RUN  = 25;
const MAX_ATTEMPTS = 3;
const TOLL_FREE    = ["800","888","877","866","855","844","833","822"];

function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  const clean = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (clean.length !== 10) return null;
  if (TOLL_FREE.includes(clean.slice(0, 3))) return null;
  return `+1${clean}`;
}

Deno.serve(async (req) => {
  try {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "aria-queue-processor v3 ready" });

  const startMs = Date.now();
  const now = new Date().toISOString();

  const { data: readyToFire, error: qErr } = await supabase
    .from("aria_call_queue")
    .select("*")
    .in("status", ["queued", "pending"])
    .lte("fire_at", now)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("fire_at", { ascending: true })
    .limit(body.limit || MAX_PER_RUN);

  if (qErr) {
    return Response.json({ ok: false, error: qErr.message }, { status: 500 });
  }

  if (!readyToFire?.length) {
    return Response.json({ ok: true, fired: 0, blocked: 0, message: "no calls due" });
  }

  let fired = 0, blocked = 0, errors = 0, skipped = 0;

  for (const call of readyToFire) {
    try {
      // Normalize phone to E.164 — skip invalid or toll-free numbers
      const phone = normalizePhone(call.contact_phone);
      if (!phone) {
        await supabase.from("aria_call_queue")
          .update({ status: "failed", last_attempt_at: new Date().toISOString() })
          .eq("id", call.id);
        skipped++;
        continue;
      }

      // Check compliance gate
      const gateRes = await fetch(`${SUPABASE_URL}/functions/v1/aria-call-gate`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contact_phone: phone, call_type: call.call_type }),
      }).catch(() => null);
      if (!gateRes) { blocked++; continue; }
      const gate = await gateRes.json().catch(() => ({ allowed: true }));

      if (!gate.allowed) {
        await supabase.from("aria_call_queue")
          .update({
            fire_at: gate.next_allowed_at || new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
            last_attempt_at: new Date().toISOString(),
          })
          .eq("id", call.id);
        blocked++;
        continue;
      }

      // Fire the call — pass bypass_gate so engine skips the duplicate gate check
      const engRes = await fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          call_type:     call.call_type,
          contact_phone: phone,
          contact_name:  call.contact_name,
          contact_type:  call.contact_type,
          job_id:        call.job_id,
          language:      call.language || "en",
          metadata:      call.metadata || {},
          bypass_gate:   true,
        }),
      }).catch(() => null);

      const engData = engRes ? await engRes.json().catch(() => ({})) : {};
      const callSucceeded = engRes?.ok && engData.ok !== false && !engData.error;

      const newAttempts = (call.attempt_count || 0) + 1;

      if (callSucceeded) {
        await supabase.from("aria_call_queue")
          .update({
            status:          "fired",
            fired_at:        new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            attempt_count:   newAttempts,
            retell_call_id:  engData.retell_call_id || null,
          })
          .eq("id", call.id);
        fired++;
      } else {
        // Engine failed — reschedule or fail permanently
        const reschedule = newAttempts < MAX_ATTEMPTS;
        await supabase.from("aria_call_queue")
          .update({
            status:          reschedule ? "queued" : "failed",
            fire_at:         reschedule ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null,
            last_attempt_at: new Date().toISOString(),
            attempt_count:   newAttempts,
          })
          .eq("id", call.id);
        errors++;
      }

      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors++;
      console.error(`Queue processor error for ${call.id}:`, err);
    }
  }

  try {
    await supabase.from("system_heartbeats").insert({
      function_name: "aria-queue-processor",
      status: errors > 0 ? "error" : "ok",
      response_ms: Date.now() - startMs,
      error_message: errors > 0 ? `${errors} call errors, ${skipped} skipped (bad phone)` : null,
      metadata: { fired, blocked, errors, skipped, total: readyToFire.length },
      recorded_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  return Response.json({
    ok: true,
    fired,
    blocked,
    errors,
    skipped,
    total: readyToFire.length,
    duration_ms: Date.now() - startMs,
  });

  } catch (fatal) {
    console.error("aria-queue-processor fatal:", fatal);
    return Response.json({ ok: false, error: String(fatal) }, { status: 500 });
  }
});

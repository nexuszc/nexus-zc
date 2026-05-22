// aria-queue-processor v1
// Reads aria_call_queue WHERE status IN ('queued','pending') AND fire_at <= NOW()
// For each: checks aria-call-gate → if allowed, fires roofing-aria-engine → updates status.
// Runs every 2h during business hours via pg_cron (14:00–21:00 UTC = 8am–3pm MT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

const MAX_PER_RUN  = 25;
const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "aria-queue-processor v1 ready" });

  const startMs = Date.now();
  const now = new Date().toISOString();

  const { data: readyToFire, error: qErr } = await supabase
    .from("aria_call_queue")
    .select("*")
    .in("status", ["queued", "pending"])
    .lte("fire_at", now)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("fire_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (qErr) {
    return Response.json({ ok: false, error: qErr.message }, { status: 500 });
  }

  if (!readyToFire?.length) {
    return Response.json({ ok: true, fired: 0, blocked: 0, message: "no calls due" });
  }

  let fired = 0;
  let blocked = 0;
  let errors = 0;

  for (const call of readyToFire) {
    try {
      // Check compliance gate
      const gateRes = await fetch(`${SUPABASE_URL}/functions/v1/aria-call-gate`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contact_phone: call.contact_phone, call_type: call.call_type }),
      });
      const gate = await gateRes.json().catch(() => ({ allowed: true }));

      if (!gate.allowed) {
        // Reschedule to next valid window — do NOT burn attempt_count
        await supabase.from("aria_call_queue")
          .update({
            fire_at: gate.next_allowed_at || new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
            last_attempt_at: new Date().toISOString(),
          })
          .eq("id", call.id);
        blocked++;
        continue;
      }

      // Fire the call
      await fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          call_type:    call.call_type,
          contact_phone: call.contact_phone,
          contact_name:  call.contact_name,
          contact_type:  call.contact_type,
          job_id:        call.job_id,
          language:      call.language || "en",
          metadata:      call.metadata || {},
        }),
      }).catch(() => null);

      const newAttempts = (call.attempt_count || 0) + 1;
      await supabase.from("aria_call_queue")
        .update({
          status:          newAttempts >= MAX_ATTEMPTS ? "failed" : "fired",
          fired_at:        new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
          attempt_count:   newAttempts,
        })
        .eq("id", call.id);

      fired++;

      // Brief pause between calls to avoid hammering Retell
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      errors++;
      console.error(`Queue processor error for ${call.id}:`, err);
    }
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "aria-queue-processor",
    status: errors > 0 ? "error" : "ok",
    response_ms: Date.now() - startMs,
    error_message: errors > 0 ? `${errors} call errors` : null,
    metadata: { fired, blocked, errors, total: readyToFire.length },
    recorded_at: new Date().toISOString(),
  }).catch(() => {});

  return Response.json({
    ok: true,
    fired,
    blocked,
    errors,
    total: readyToFire.length,
    duration_ms: Date.now() - startMs,
  });
});

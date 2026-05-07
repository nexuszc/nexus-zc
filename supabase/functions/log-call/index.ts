import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Displayed in the VA UI when they select an outcome — keeps messaging
// consistent without locking VAs into a rigid script.
const SCRIPT_HINTS: Record<string, string> = {
  voicemail:
    "Hi [First Name], this is [Your Name] calling about your property at [Address]. I have some information that could really help your situation — please give me a call back when you get a chance. Thanks.",
  no_answer:
    "No answer. Do not leave a voicemail on first contact. Mark and try again tomorrow.",
  connected_not_interested:
    "I completely understand, and I won't keep you. Just so you know, we help homeowners in situations like yours access their equity without selling. If anything changes, feel free to reach back out. Have a great day.",
  connected_not_ready:
    "That's totally okay. When would be a better time to reach you? Even just a few minutes — I want to make sure you have all the information you need before making any decisions.",
  callback_requested:
    "Perfect. I'll make sure to call you right at that time. Is this the best number? I'll make a note so your call comes through right on schedule.",
  qualified:
    "This sounds like a great fit. Let me get your details to our specialist — they'll reach out shortly to walk you through exactly what's available for your property.",
  do_not_call:
    "Absolutely, I'll take care of that right away and make sure you're removed from our list. I'm sorry for any inconvenience, and I appreciate your time. Have a great day.",
};

// Days until next contact attempt by outcome. null = don't auto-schedule.
const NEXT_TOUCH_DAYS: Record<string, number | null> = {
  voicemail: 2,
  no_answer: 1,
  connected_not_interested: 7,
  connected_not_ready: 3,
  callback_requested: null,  // next_touch_due_at = callback_scheduled_at
  qualified: null,
  do_not_call: null,
};

const VALID_OUTCOMES = new Set([
  "voicemail",
  "no_answer",
  "connected_not_interested",
  "connected_not_ready",
  "callback_requested",
  "qualified",
  "do_not_call",
]);

// TCPA: no calls before 8 AM or after 9 PM in the lead's local time.
// Unknown timezone → allow (don't silently block).
function isTcpaAllowed(timezone: string): boolean {
  try {
    const hour = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false })
        .format(new Date()),
      10
    );
    return hour >= 8 && hour < 21;
  } catch {
    return true;
  }
}

function daysSince(ts: string | null): number | null {
  if (!ts) return null;
  return Math.floor((Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24));
}

// Canonical lead shape returned to the queue UI.
function shapeQueueLead(lead: Record<string, unknown>) {
  return {
    id: lead.id,
    first_name: lead.first_name ?? null,
    last_name: lead.last_name ?? null,
    phone: lead.phone,
    address: lead.address ?? null,
    city: lead.city ?? null,
    state: lead.state ?? null,
    loan_amount: lead.loan_amount ?? null,
    property_value: lead.property_value ?? null,
    current_outcome: lead.current_outcome ?? null,
    touch_count: lead.touch_count as number,
    last_touched_at: lead.last_touched_at ?? null,
    days_since_touch: daysSince(lead.last_touched_at as string | null),
    next_touch_due_at: lead.next_touch_due_at ?? null,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { mode } = body;

    // ── LOGIN ─────────────────────────────────────────────────────────────────
    if (mode === "login") {
      const { va_code, client_id } = body;
      if (!va_code || !client_id) return bad("va_code and client_id required");

      const { data: va, error: vaErr } = await supabase
        .from("vas")
        .select("id, name")
        .eq("client_id", client_id)
        .eq("va_code", va_code)
        .eq("status", "active")
        .maybeSingle();

      if (vaErr) return bad(`VA lookup error: ${vaErr.message}`);
      if (!va) return bad("Invalid code. Check with Sam.");

      const { data: client } = await supabase
        .from("clients")
        .select("name")
        .eq("id", client_id)
        .maybeSingle();

      return ok({
        va_id: va.id,
        va_name: va.name,
        client_id,
        client_name: client?.name ?? null,
      });
    }

    // ── QUEUE ─────────────────────────────────────────────────────────────────
    if (mode === "queue") {
      const { va_id, client_id } = body;
      if (!va_id || !client_id) return bad("va_id and client_id required");

      const { data: va } = await supabase
        .from("vas")
        .select("id")
        .eq("id", va_id)
        .eq("client_id", client_id)
        .eq("status", "active")
        .maybeSingle();
      if (!va) return bad("VA not found");

      const { data: client } = await supabase
        .from("clients")
        .select("timezone")
        .eq("id", client_id)
        .maybeSingle();
      const clientTimezone = (client?.timezone as string) ?? "America/Denver";

      const now = new Date();
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

      // Tier 1: scheduled callbacks due within 2 hours.
      const { data: callbackRows } = await supabase
        .from("scheduled_callbacks")
        .select(`
          id, scheduled_at,
          leads(id, first_name, last_name, phone, address, city, state,
                timezone, current_outcome, touch_count, last_touched_at,
                next_touch_due_at, loan_amount, property_value, status)
        `)
        .eq("client_id", client_id)
        .lte("scheduled_at", twoHoursLater)
        .is("completed_at", null)
        .order("scheduled_at", { ascending: true });

      const tier1LeadIds = new Set<string>();
      const tier1 = [];

      for (const cb of callbackRows ?? []) {
        const lead = cb.leads as Record<string, unknown> | null;
        if (!lead || lead.status !== "active") continue;
        const tz = (lead.timezone as string | null) ?? clientTimezone;
        if (!isTcpaAllowed(tz)) continue;
        tier1LeadIds.add(lead.id as string);
        tier1.push({
          ...shapeQueueLead(lead),
          tier: 1,
          callback_id: cb.id,
          callback_scheduled_at: cb.scheduled_at,
        });
      }

      // Tier 2: sequence-due leads (previously contacted, touch overdue).
      const { data: seqDueRows } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, address, city, state, timezone, current_outcome, touch_count, last_touched_at, next_touch_due_at, loan_amount, property_value")
        .eq("client_id", client_id)
        .eq("status", "active")
        .lte("next_touch_due_at", now.toISOString())
        .gt("touch_count", 0)
        .order("next_touch_due_at", { ascending: true })
        .limit(30);

      const tier2LeadIds = new Set<string>();
      const tier2 = [];

      for (const lead of seqDueRows ?? []) {
        if (tier1LeadIds.has(lead.id)) continue;
        const tz = lead.timezone ?? clientTimezone;
        if (!isTcpaAllowed(tz)) continue;
        tier2LeadIds.add(lead.id);
        tier2.push({ ...shapeQueueLead(lead), tier: 2 });
      }

      // Tier 3: uncontacted leads.
      const { data: newRows } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, address, city, state, timezone, current_outcome, touch_count, last_touched_at, next_touch_due_at, loan_amount, property_value")
        .eq("client_id", client_id)
        .eq("status", "active")
        .eq("touch_count", 0)
        .order("imported_at", { ascending: true })
        .limit(30);

      const tier3 = [];
      for (const lead of newRows ?? []) {
        if (tier1LeadIds.has(lead.id) || tier2LeadIds.has(lead.id)) continue;
        const tz = lead.timezone ?? clientTimezone;
        if (!isTcpaAllowed(tz)) continue;
        tier3.push({ ...shapeQueueLead(lead), tier: 3 });
      }

      return ok({
        tier1,
        tier2,
        tier3,
        total: tier1.length + tier2.length + tier3.length,
        script_hints: SCRIPT_HINTS,
      });
    }

    // ── LOG ───────────────────────────────────────────────────────────────────
    if (mode === "log") {
      const { va_id, lead_id, client_id, outcome, callback_scheduled_at, notes, duration_seconds } = body;

      if (!va_id || !lead_id || !client_id || !outcome) {
        return bad("va_id, lead_id, client_id, outcome required");
      }
      if (!VALID_OUTCOMES.has(outcome)) return bad(`Invalid outcome: ${outcome}`);
      if (outcome === "callback_requested" && !callback_scheduled_at) {
        return bad("callback_scheduled_at required when outcome is callback_requested");
      }

      // Verify VA and lead belong to this client.
      const [{ data: va }, { data: lead }] = await Promise.all([
        supabase.from("vas").select("id").eq("id", va_id).eq("client_id", client_id).maybeSingle(),
        supabase.from("leads").select("id, touch_count").eq("id", lead_id).eq("client_id", client_id).maybeSingle(),
      ]);
      if (!va) return bad("VA not found for this client");
      if (!lead) return bad("Lead not found for this client");

      // Insert call log.
      const { data: callLog, error: logErr } = await supabase
        .from("call_logs")
        .insert({
          lead_id,
          va_id,
          client_id,
          outcome,
          notes: notes ?? null,
          callback_scheduled_at: outcome === "callback_requested" ? callback_scheduled_at : null,
          duration_seconds: duration_seconds ?? null,
        })
        .select("id")
        .single();

      if (logErr) return bad(`Failed to log call: ${logErr.message}`);

      // Compute next_touch_due_at.
      let nextTouchDueAt: string | null = null;
      if (outcome === "callback_requested" && callback_scheduled_at) {
        nextTouchDueAt = callback_scheduled_at;
      } else {
        const days = NEXT_TOUCH_DAYS[outcome];
        if (days !== null && days !== undefined) {
          const d = new Date();
          d.setDate(d.getDate() + days);
          nextTouchDueAt = d.toISOString();
        }
      }

      // New lead status.
      let newStatus: string | undefined;
      if (outcome === "do_not_call") newStatus = "do_not_call";
      else if (outcome === "qualified") newStatus = "qualified";

      // Update lead.
      const leadUpdate: Record<string, unknown> = {
        current_outcome: outcome,
        touch_count: (lead.touch_count as number) + 1,
        last_touched_at: new Date().toISOString(),
        next_touch_due_at: nextTouchDueAt,
      };
      if (newStatus) leadUpdate.status = newStatus;
      // First touch: assign this VA so Tier 3 queue generation can find the lead.
      if ((lead.touch_count as number) === 0) leadUpdate.assigned_va_id = va_id;

      const { error: updateErr } = await supabase.from("leads").update(leadUpdate).eq("id", lead_id);
      if (updateErr) console.error("Lead update error:", updateErr.message);

      if (outcome === "callback_requested" && callback_scheduled_at) {
        // Close any existing open callbacks for this lead, then schedule the new one.
        await supabase
          .from("scheduled_callbacks")
          .update({ completed_at: new Date().toISOString(), outcome_call_log_id: callLog.id })
          .eq("lead_id", lead_id)
          .is("completed_at", null);

        await supabase.from("scheduled_callbacks").insert({
          lead_id,
          va_id,
          client_id,
          scheduled_at: callback_scheduled_at,
        });
      } else {
        // Resolve any open callbacks for this lead.
        await supabase
          .from("scheduled_callbacks")
          .update({ completed_at: new Date().toISOString(), outcome_call_log_id: callLog.id })
          .eq("lead_id", lead_id)
          .is("completed_at", null);
      }

      // ── Auto-enrollment ───────────────────────────────────────────────────
      if (outcome !== "qualified" && outcome !== "do_not_call") {
        try {
          const { data: template } = await supabase
            .from("sequence_templates")
            .select("id")
            .eq("client_id", client_id)
            .eq("outcome_type", outcome)
            .eq("is_active", true)
            .maybeSingle();

          if (template) {
            await supabase
              .from("lead_enrollments")
              .update({ completed_at: new Date().toISOString(), exited_reason: "outcome_changed" })
              .eq("lead_id", lead_id)
              .is("completed_at", null);

            const { data: step1 } = await supabase
              .from("sequence_steps")
              .select("days_after_previous")
              .eq("template_id", template.id)
              .eq("step_number", 1)
              .maybeSingle();

            if (step1) {
              const nextDue = new Date();
              nextDue.setDate(nextDue.getDate() + (step1.days_after_previous as number));
              const { error: enrollErr } = await supabase.from("lead_enrollments").insert({
                lead_id,
                template_id: template.id,
                current_step_number: 1,
                next_step_due_at: nextDue.toISOString(),
                enrolled_at: new Date().toISOString(),
              });
              if (enrollErr) console.error("Enrollment insert error:", enrollErr.message);
            } else {
              console.warn(`sequence_template ${template.id} has no step 1 — skipping enrollment`);
            }
          }
        } catch (enrollErr) {
          console.error("Auto-enrollment error:", (enrollErr as Error).message);
        }
      }

      return ok({ success: true, call_log_id: callLog.id });
    }

    return bad("mode must be 'login', 'queue', or 'log'");

  } catch (err) {
    console.error("log-call error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bad(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

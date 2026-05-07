import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Per-tier cap. 100 per tier × 4 tiers = 400 max per VA queue.
const TIER_LIMIT = 100;

// Script hints shown to the VA in the UI before/during each call.
// Tier 1/2 always use "callback_requested". Tiers 3/4 use lead's current outcome.
const SCRIPT_HINTS: Record<string, string> = {
  first_contact:
    "First contact — no previous calls. Introduce yourself and explain why you're calling. Be warm, not pushy. Lead with their situation, not the product.",
  voicemail:
    "Hi [First Name], this is [Your Name] calling about your property at [Address]. I have some information that could really help your situation — please give me a call back when you get a chance.",
  no_answer:
    "Previous attempt: no answer. Try again — do not leave a voicemail on repeat no-answer calls.",
  connected_not_interested:
    "Said not interested last time. Acknowledge it: 'I know you weren't ready before — just wanted to check in. Has anything changed with the property?'",
  connected_not_ready:
    "Warm lead — wasn't ready last time. Acknowledge the gap: 'Last time we spoke it wasn't the right time. Wanted to check back — is now any better?'",
  callback_requested:
    "They asked for this callback. Be on time, reference the previous call: 'Hi [First Name], this is [Your Name] — you asked me to call you today.'",
  qualified:
    "Qualified lead — follow up on next steps. Confirm they're still interested and check on their timeline.",
  do_not_call:
    "DO NOT CALL — this lead is marked DNC. If this appears in your queue, flag it to Sam immediately.",
};

const TIER_LABELS: Record<number, string> = {
  1: "Missed Callback",
  2: "Callback Due",
  3: "Follow-Up",
  4: "New Lead",
};

// TCPA: no calls before 8 AM or after 9 PM in lead's local time.
// Tier 1 (missed callbacks) bypasses this — surface overdue callbacks regardless.
// Unknown timezone → allow (don't silently block).
function isTcpaAllowed(leadTimezone: string | null, clientTimezone: string): boolean {
  const tz = leadTimezone ?? clientTimezone;
  try {
    const hour = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false })
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

// Pick the script hint that best prepares the VA for this call.
function scriptHintFor(tier: number, currentOutcome: string | null): string {
  if (tier <= 2) return SCRIPT_HINTS["callback_requested"];
  return SCRIPT_HINTS[currentOutcome ?? "first_contact"] ?? SCRIPT_HINTS["first_contact"];
}

// Canonical lead shape returned in the queue.
function shapeLead(
  lead: Record<string, unknown>,
  tier: number,
  callbackScheduledAt: string | null = null,
): Record<string, unknown> {
  const outcome = lead.current_outcome as string | null ?? null;
  return {
    id: lead.id,
    first_name: lead.first_name ?? null,
    last_name: lead.last_name ?? null,
    phone: lead.phone,
    priority_tier: tier,
    tier_label: TIER_LABELS[tier],
    current_outcome: outcome,
    last_touched_at: lead.last_touched_at ?? null,
    days_since_touch: daysSince(lead.last_touched_at as string | null),
    touch_count: lead.touch_count as number,
    script_hint: scriptHintFor(tier, outcome),
    callback_scheduled_at: callbackScheduledAt,
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
    const { client_id, va_id } = body;
    if (!client_id) return bad("client_id required");

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("timezone")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr) return bad(`Client lookup error: ${clientErr.message}`);
    if (!client) return bad(`client_id '${client_id}' not found`);

    const clientTimezone = (client.timezone as string) ?? "America/Denver";
    const now = new Date();
    const nowIso = now.toISOString();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    // ── Four parallel queries ─────────────────────────────────────────────────

    const [vasRes, callbacksRes, tier3Res, tier4Res] = await Promise.all([

      // Active VAs — filter to single VA if va_id provided.
      va_id
        ? supabase.from("vas").select("id, name").eq("client_id", client_id).eq("status", "active").eq("id", va_id)
        : supabase.from("vas").select("id, name").eq("client_id", client_id).eq("status", "active"),

      // All pending callbacks with lead info. Tier 1 vs 2 split happens in Deno.
      supabase
        .from("scheduled_callbacks")
        .select("id, scheduled_at, va_id, leads(id, first_name, last_name, phone, timezone, current_outcome, touch_count, last_touched_at, next_touch_due_at)")
        .eq("client_id", client_id)
        .is("completed_at", null)
        .order("scheduled_at", { ascending: true })
        .limit(500),

      // Tier 3: assigned leads with touch_count > 0 whose next touch is overdue.
      // Leads with next_touch_due_at = null (qualified/dnc) are excluded by lte filter.
      supabase
        .from("leads")
        .select("id, first_name, last_name, phone, timezone, assigned_va_id, current_outcome, touch_count, last_touched_at, next_touch_due_at")
        .eq("client_id", client_id)
        .eq("status", "active")
        .gt("touch_count", 0)
        .lte("next_touch_due_at", nowIso)
        .not("assigned_va_id", "is", null)
        .order("next_touch_due_at", { ascending: true })
        .limit(400),

      // Tier 4: all uncontacted active leads — both assigned and unassigned.
      // Fetching enough for all VAs: 600 = 100 per VA × 6 VA max.
      // Unassigned leads are distributed across VAs deterministically in Deno.
      supabase
        .from("leads")
        .select("id, first_name, last_name, phone, timezone, assigned_va_id, current_outcome, touch_count, last_touched_at, next_touch_due_at, imported_at")
        .eq("client_id", client_id)
        .eq("status", "active")
        .eq("touch_count", 0)
        .order("imported_at", { ascending: true })
        .limit(600),
    ]);

    const vas = vasRes.data ?? [];
    const allCallbacks = (callbacksRes.data ?? []) as Record<string, unknown>[];
    const tier3All = (tier3Res.data ?? []) as Record<string, unknown>[];
    const tier4All = (tier4Res.data ?? []) as Record<string, unknown>[];

    // Precompute unassigned Tier 4 for distribution across VAs.
    const tier4Unassigned = tier4All.filter(l => !l.assigned_va_id);
    const numVas = vas.length;
    const chunkSize = numVas > 0 ? Math.ceil(tier4Unassigned.length / numVas) : 0;

    // ── Build queue per VA ────────────────────────────────────────────────────

    const queues = vas.map((va, vaIndex) => {
      const vaId = va.id as string;

      // ── Tier 1: missed callbacks (overdue — bypass TCPA) ───────────────────
      const tier1 = allCallbacks
        .filter(cb => {
          if (!cb.leads) return false;
          const cbVa = cb.va_id as string | null;
          return (cbVa === vaId || cbVa === null) && (cb.scheduled_at as string) < nowIso;
        })
        .map(cb => shapeLead(cb.leads as Record<string, unknown>, 1, cb.scheduled_at as string))
        .slice(0, TIER_LIMIT);

      // Track lead IDs claimed by Tier 1 to prevent them appearing in lower tiers.
      const claimedIds = new Set(tier1.map(l => l.id as string));

      // ── Tier 2: callbacks due within 2 hours (TCPA enforced) ──────────────
      const tier2 = allCallbacks
        .filter(cb => {
          if (!cb.leads) return false;
          const cbVa = cb.va_id as string | null;
          const sched = cb.scheduled_at as string;
          if (cbVa !== vaId && cbVa !== null) return false;
          if (sched < nowIso || sched > twoHoursLater) return false;
          const lead = cb.leads as Record<string, unknown>;
          if (claimedIds.has(lead.id as string)) return false;
          return isTcpaAllowed(lead.timezone as string | null, clientTimezone);
        })
        .map(cb => shapeLead(cb.leads as Record<string, unknown>, 2, cb.scheduled_at as string))
        .slice(0, TIER_LIMIT);

      tier2.forEach(l => claimedIds.add(l.id as string));

      // ── Tier 3: assigned follow-ups (TCPA enforced) ────────────────────────
      const tier3 = tier3All
        .filter(l =>
          l.assigned_va_id === vaId &&
          !claimedIds.has(l.id as string) &&
          isTcpaAllowed(l.timezone as string | null, clientTimezone)
        )
        .slice(0, TIER_LIMIT)
        .map(l => shapeLead(l, 3));

      tier3.forEach(l => claimedIds.add(l.id as string));

      // ── Tier 4: uncontacted leads (TCPA enforced) ──────────────────────────
      // Assigned uncontacted leads belong entirely to this VA.
      // Unassigned leads are distributed by imported_at position.
      const assignedTier4 = tier4All.filter(l => l.assigned_va_id === vaId);
      const myUnassigned = chunkSize > 0
        ? tier4Unassigned.slice(vaIndex * chunkSize, (vaIndex + 1) * chunkSize)
        : [];

      const tier4 = [...assignedTier4, ...myUnassigned]
        .sort((a, b) =>
          new Date(a.imported_at as string).getTime() -
          new Date(b.imported_at as string).getTime()
        )
        .filter(l =>
          !claimedIds.has(l.id as string) &&
          isTcpaAllowed(l.timezone as string | null, clientTimezone)
        )
        .slice(0, TIER_LIMIT)
        .map(l => shapeLead(l, 4));

      return {
        va_id: vaId,
        va_name: va.name as string,
        leads: [...tier1, ...tier2, ...tier3, ...tier4],
      };
    });

    const totalLeadsQueued = queues.reduce((sum, q) => sum + q.leads.length, 0);

    return ok({
      generated_at: nowIso,
      total_leads_queued: totalLeadsQueued,
      queues,
    });

  } catch (err) {
    console.error("generate-queue error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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

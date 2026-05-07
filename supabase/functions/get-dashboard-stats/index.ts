import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CONNECT_OUTCOMES = new Set([
  "connected_not_interested",
  "connected_not_ready",
  "callback_requested",
  "qualified",
]);

// ── Timezone helpers ──────────────────────────────────────────────────────────

// Returns the UTC start/end of "today" in the given timezone.
// Uses noon UTC as the anchor to determine offset — safe against DST transitions
// which always happen at 2 AM, never at noon.
function dayBoundsUtc(timezone: string): { start: Date; end: Date } {
  const now = new Date();
  const localDate = now.toLocaleDateString("sv-SE", { timeZone: timezone }); // "YYYY-MM-DD"

  const noonUtc = new Date(`${localDate}T12:00:00Z`);
  const noonLocalHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hour12: false })
      .format(noonUtc),
    10
  );
  const offsetHours = noonLocalHour - 12; // positive = ahead of UTC, negative = behind

  // Midnight local = midnight UTC − offset (e.g. UTC-7: start = midnight UTC + 7h)
  const midnightUtc = new Date(`${localDate}T00:00:00Z`);
  const start = new Date(midnightUtc.getTime() - offsetHours * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
}

// Last N local dates in given timezone (YYYY-MM-DD), oldest first.
function getLast7Dates(timezone: string): string[] {
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    dates.push(d.toLocaleDateString("sv-SE", { timeZone: timezone }));
  }
  return dates;
}

// Convert a UTC timestamp string to a local date string (YYYY-MM-DD).
function toLocalDate(utcTs: string, timezone: string): string {
  return new Date(utcTs).toLocaleDateString("sv-SE", { timeZone: timezone });
}

// Short weekday label from a local date string.
function dayLabel(localDate: string): string {
  // Use noon UTC on that date to avoid day-boundary issues.
  return new Date(`${localDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short" });
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
    const { client_id } = await req.json();
    if (!client_id) return bad("client_id required");

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("timezone")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr) return bad(`Client lookup error: ${clientErr.message}`);
    if (!client) return bad(`client_id '${client_id}' not found`);

    const timezone = (client.timezone as string) ?? "America/Denver";
    const { start: todayStart, end: todayEnd } = dayBoundsUtc(timezone);
    const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    const now = new Date();

    // All 7 queries run in parallel.
    const [
      leadsRes,
      callLogsRes,
      vasRes,
      callbacksPendingRes,
      callbacksTodayRes,
      allCallsTotalRes,
      allConnectsRes,
    ] = await Promise.all([
      // All leads: status buckets, touch counts, import time, queue readiness.
      supabase.from("leads")
        .select("status, touch_count, imported_at, next_touch_due_at")
        .eq("client_id", client_id),

      // Call logs: last 7 days for daily stats, trend, and VA performance.
      supabase.from("call_logs")
        .select("outcome, logged_at, va_id")
        .eq("client_id", client_id)
        .gte("logged_at", sevenDaysAgo.toISOString())
        .order("logged_at", { ascending: true }),

      // Active VAs for this client.
      supabase.from("vas")
        .select("id, name")
        .eq("client_id", client_id)
        .eq("status", "active"),

      // All open callbacks (for pending count and next-callback timestamp).
      supabase.from("scheduled_callbacks")
        .select("id, scheduled_at")
        .eq("client_id", client_id)
        .is("completed_at", null)
        .order("scheduled_at", { ascending: true }),

      // Today's callbacks with lead and VA names for the timeline list.
      supabase.from("scheduled_callbacks")
        .select("scheduled_at, leads(first_name, last_name), vas(name)")
        .eq("client_id", client_id)
        .is("completed_at", null)
        .gte("scheduled_at", todayStart.toISOString())
        .lt("scheduled_at", todayEnd.toISOString())
        .order("scheduled_at", { ascending: true }),

      // All-time total calls (count only — no row data transferred).
      supabase.from("call_logs")
        .select("*", { count: "exact", head: true })
        .eq("client_id", client_id),

      // All-time connects (count only).
      supabase.from("call_logs")
        .select("*", { count: "exact", head: true })
        .eq("client_id", client_id)
        .in("outcome", ["connected_not_interested", "connected_not_ready", "callback_requested", "qualified"]),
    ]);

    const leads = leadsRes.data ?? [];
    const callLogs = callLogsRes.data ?? [];
    const vas = vasRes.data ?? [];
    const callbacksPending = callbacksPendingRes.data ?? [];
    const callbacksToday = callbacksTodayRes.data ?? [];
    const allCallsTotal = allCallsTotalRes.count ?? 0;
    const allConnectsTotal = allConnectsRes.count ?? 0;

    // ── Overview ──────────────────────────────────────────────────────────────

    const logsToday = callLogs.filter(log => {
      const t = new Date(log.logged_at as string).getTime();
      return t >= todayStart.getTime() && t < todayEnd.getTime();
    });

    const contactRate = allCallsTotal > 0
      ? Math.round((allConnectsTotal / allCallsTotal) * 100)
      : 0;

    // ── Lead breakdown ────────────────────────────────────────────────────────

    const hotLeads = leads.filter(l => l.status === "qualified").length;

    const leadBreakdown = {
      new:     leads.filter(l => l.touch_count === 0 && l.status === "active").length,
      working: leads.filter(l => (l.touch_count as number) > 0 && l.status === "active").length,
      hot:     hotLeads,
      dead:    leads.filter(l => l.status === "do_not_call").length,
    };

    // ── VA performance (today) ────────────────────────────────────────────────

    const vaMap = new Map(vas.map(v => [v.id as string, v.name as string]));
    const vaStats = new Map<string, { calls: number; connects: number; hot: number }>();

    for (const log of logsToday) {
      const vid = log.va_id as string;
      if (!vaStats.has(vid)) vaStats.set(vid, { calls: 0, connects: 0, hot: 0 });
      const s = vaStats.get(vid)!;
      s.calls++;
      if (CONNECT_OUTCOMES.has(log.outcome as string)) s.connects++;
      if (log.outcome === "qualified") s.hot++;
    }

    const vaPerformance = vas.map(va => ({
      va_name:       va.name,
      calls_today:   vaStats.get(va.id as string)?.calls    ?? 0,
      connects_today: vaStats.get(va.id as string)?.connects ?? 0,
      hot_leads:     vaStats.get(va.id as string)?.hot       ?? 0,
    }));

    // ── System health ─────────────────────────────────────────────────────────

    const importedAts = leads.map(l => l.imported_at as string).filter(Boolean);
    const lastImportAt = importedAts.length > 0
      ? importedAts.reduce((a, b) => (a > b ? a : b))
      : null;

    const queueSize = leads.filter(l =>
      l.status === "active" &&
      l.next_touch_due_at !== null &&
      new Date(l.next_touch_due_at as string) <= now
    ).length;

    const nextCallbackAt = callbacksPending
      .filter(cb => new Date(cb.scheduled_at as string) >= now)
      .map(cb => cb.scheduled_at as string)[0] ?? null;

    const callbacksTodayList = (callbacksToday as Record<string, unknown>[]).map(cb => {
      const lead = cb.leads as Record<string, string> | null;
      const va   = cb.vas  as Record<string, string> | null;
      return {
        scheduled_at: cb.scheduled_at as string,
        lead_name:    [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Unknown",
        va_name:      va?.name ?? "Unassigned",
      };
    });

    // ── Weekly trend ──────────────────────────────────────────────────────────

    const last7 = getLast7Dates(timezone);
    const trendMap = new Map(last7.map(d => [d, { calls: 0, connects: 0, qualifieds: 0 }]));

    for (const log of callLogs) {
      const localDate = toLocalDate(log.logged_at as string, timezone);
      const day = trendMap.get(localDate);
      if (!day) continue;
      day.calls++;
      if (CONNECT_OUTCOMES.has(log.outcome as string)) day.connects++;
      if (log.outcome === "qualified") day.qualifieds++;
    }

    const weeklyTrend = last7.map(d => ({
      date:       d,
      day_label:  dayLabel(d),
      ...trendMap.get(d)!,
    }));

    return ok({
      overview: {
        total_leads:       leads.length,
        calls_today:       logsToday.length,
        connects_today:    logsToday.filter(l => CONNECT_OUTCOMES.has(l.outcome as string)).length,
        contact_rate:      `${contactRate}%`,
        hot_leads:         hotLeads,
        callbacks_pending: callbacksPending.length,
      },
      lead_breakdown: leadBreakdown,
      va_performance: vaPerformance,
      system_health: {
        last_import_at:    lastImportAt,
        queue_size:        queueSize,
        next_callback_at:  nextCallbackAt,
        callbacks_today:   callbacksTodayList,
      },
      weekly_trend: weeklyTrend,
    });

  } catch (err) {
    console.error("get-dashboard-stats error:", err);
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Functions to probe on each heartbeat cycle
const PROBE_FUNCTIONS = [
  'chat', 'nexus-core', 'tier-enforcement', 'upgrade-engine',
  'job-intake', 'morning-digest', 'monthly-truth', 'stripe-webhook',
  'contractor-auth', 'contractor-dashboard-api', 'contractor-signup',
  'roofing-aria-engine', 'supplement-audit-engine', 'nexus-vertical-router'
];

async function probeFunction(name: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ test: true }),
      signal: AbortSignal.timeout(8000)
    });
    const ms = Date.now() - start;
    if (res.ok) {
      return { ok: true, ms };
    }
    return { ok: false, ms, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: String(e).slice(0, 100) };
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'system-heartbeat ready' });

  const action = body.action || 'run';

  // RUN — probe all functions and record results
  if (action === 'run') {
    const results: Array<{ function_name: string; status: string; response_ms: number; error_message?: string }> = [];

    // Probe functions (batch to avoid overwhelming)
    const probes = await Promise.allSettled(
      PROBE_FUNCTIONS.map(async (fn) => {
        const result = await probeFunction(fn);
        return { fn, result };
      })
    );

    for (const probe of probes) {
      if (probe.status === 'fulfilled') {
        const { fn, result } = probe.value;
        results.push({
          function_name: fn,
          status: result.ok ? 'ok' : 'error',
          response_ms: result.ms,
          error_message: result.error
        });
      }
    }

    // Write heartbeat records
    await supabase.from('system_heartbeats').insert(
      results.map(r => ({
        function_name: r.function_name,
        status: r.status,
        response_ms: r.response_ms,
        error_message: r.error_message || null,
        metadata: {}
      }))
    );

    // Write hourly snapshot
    const snapshotHour = new Date();
    snapshotHour.setMinutes(0, 0, 0);

    const okCount = results.filter(r => r.status === 'ok').length;
    const errCount = results.filter(r => r.status === 'error').length;
    const avgMs = results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.response_ms, 0) / results.length)
      : 0;
    const sortedMs = results.map(r => r.response_ms).sort((a, b) => a - b);
    const p95Ms = sortedMs.length > 0
      ? sortedMs[Math.floor(sortedMs.length * 0.95)]
      : 0;

    await supabase.from('system_health_snapshots').upsert({
      snapshot_hour: snapshotHour.toISOString(),
      total_calls: results.length,
      ok_calls: okCount,
      error_calls: errCount,
      avg_response_ms: avgMs,
      p95_response_ms: p95Ms,
      functions_checked: results.length,
      functions_degraded: errCount
    }, { onConflict: 'snapshot_hour' });

    return Response.json({
      ok: true,
      checked: results.length,
      ok_count: okCount,
      error_count: errCount,
      avg_ms: avgMs,
      errors: results.filter(r => r.status === 'error').map(r => ({ fn: r.function_name, error: r.error_message }))
    });
  }

  // STATUS — get recent health
  if (action === 'status') {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour

    const { data: recent } = await supabase
      .from('system_heartbeats')
      .select('function_name, status, response_ms, error_message, recorded_at')
      .gte('recorded_at', cutoff)
      .order('recorded_at', { ascending: false })
      .limit(200);

    const { data: snapshots } = await supabase
      .from('system_health_snapshots')
      .select('*')
      .order('snapshot_hour', { ascending: false })
      .limit(24);

    return Response.json({ ok: true, recent: recent || [], snapshots: snapshots || [] });
  }

  return Response.json({ ok: false, error: 'action required: run | status' }, { status: 400 });
});

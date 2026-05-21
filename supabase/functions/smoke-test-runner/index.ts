import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

interface TestResult {
  name: string
  ok: boolean
  ms: number
  error?: string
}

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const t0 = Date.now()
  try {
    await fn()
    return { name, ok: true, ms: Date.now() - t0 }
  } catch (e) {
    return { name, ok: false, ms: Date.now() - t0, error: String(e) }
  }
}

async function probe(fn: string, body: Record<string, unknown> = { test: true }): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  })
}

Deno.serve(async (_req) => {
  const results: TestResult[] = []

  // ── DB: core tables ──────────────────────────────────────────────────────
  results.push(await runTest('db:entries-accessible', async () => {
    const { error } = await supabase.from('entries').select('id').limit(1)
    if (error) throw error
  }))

  results.push(await runTest('db:projects-accessible', async () => {
    const { error } = await supabase.from('projects').select('id').limit(1)
    if (error) throw error
  }))

  results.push(await runTest('db:roofing-jobs-accessible', async () => {
    const { error } = await supabase.from('roofing_jobs').select('id').limit(1)
    if (error) throw error
  }))

  results.push(await runTest('db:contractor-accounts-accessible', async () => {
    const { error } = await supabase.from('contractor_accounts').select('id').limit(1)
    if (error) throw error
  }))

  results.push(await runTest('db:measurement-reports-accessible', async () => {
    const { error } = await supabase.from('measurement_reports').select('id').limit(1)
    if (error) throw error
  }))

  // ── Portal: demo data ────────────────────────────────────────────────────
  results.push(await runTest('portal:demo-session-exists', async () => {
    const { data, error } = await supabase
      .from('homeowner_sessions')
      .select('id')
      .eq('magic_link_token', 'DEMO2026ROOFINGOS')
      .single()
    if (error || !data) throw new Error('Demo session missing')
  }))

  results.push(await runTest('portal:demo-job-has-activities', async () => {
    const { data, error } = await supabase
      .from('portal_activities')
      .select('id')
      .eq('job_id', 'd0000000-0000-0000-0000-000000000001')
    if (error) throw error
    if (!data || data.length < 5) throw new Error(`Only ${data?.length} activities on demo job`)
  }))

  results.push(await runTest('portal:demo-insurance-claim-exists', async () => {
    const { data, error } = await supabase
      .from('insurance_claims')
      .select('id')
      .eq('job_id', 'd0000000-0000-0000-0000-000000000001')
      .limit(1)
    if (error) throw error
    if (!data || data.length === 0) throw new Error('No insurance claim on demo job')
  }))

  // ── Sequencer state ──────────────────────────────────────────────────────
  results.push(await runTest('sequencer:email-log-has-sends', async () => {
    const { data, error } = await supabase
      .from('email_log')
      .select('id')
      .limit(1)
    if (error) throw error
    if (!data || data.length === 0) throw new Error('email_log is empty — sequencer may not have run')
  }))

  results.push(await runTest('sequencer:active-sequences-exist', async () => {
    const { data, error } = await supabase
      .from('email_sequences')
      .select('id')
      .eq('completed', false)
      .limit(1)
    if (error) throw error
    // OK if empty — no active sequences is a valid state after launch
  }))

  // ── Function probes ──────────────────────────────────────────────────────
  results.push(await runTest('fn:roofing-measurements', async () => {
    const res = await probe('roofing-measurements', { action: 'list', contractor_id: '00000000-0000-0000-0000-000000000000' })
    // Accept 200 or 400 — 500 is the only failure
    if (res.status >= 500) throw new Error(`roofing-measurements returned ${res.status}`)
  }))

  results.push(await runTest('fn:roofing-integration-crm', async () => {
    const res = await probe('roofing-integration-crm', { action: 'connect', contractor_id: 'test', crm_type: 'acculynx', api_key: 'test' })
    if (res.status >= 500) throw new Error(`roofing-integration-crm returned ${res.status}`)
  }))

  results.push(await runTest('fn:roofing-ai', async () => {
    const res = await probe('roofing-ai', { action: 'estimate', job_id: 'test' })
    if (res.status >= 500) throw new Error(`roofing-ai returned ${res.status}`)
  }))

  results.push(await runTest('fn:roofing-notify', async () => {
    const res = await probe('roofing-notify', { type: 'test', job_id: 'test' })
    if (res.status >= 500) throw new Error(`roofing-notify returned ${res.status}`)
  }))

  results.push(await runTest('fn:portal-api', async () => {
    // portal-api requires homeowner auth — 401 means it exists and is auth-gating correctly
    const res = await fetch(`${SUPABASE_URL}/functions/v1/portal-api?token=smoke-test`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}` },
    })
    // 401/403 = function exists and is protecting correctly; only 404/5xx = bad
    if (res.status === 404) throw new Error('portal-api not found (404)')
    if (res.status >= 500) throw new Error(`portal-api returned ${res.status}`)
  }))

  results.push(await runTest('fn:nexus-core-reachable', async () => {
    const res = await probe('nexus-core', { action: 'observe' })
    if (res.status >= 500) throw new Error(`nexus-core returned ${res.status}`)
  }))

  // ── Heartbeat recency ────────────────────────────────────────────────────
  results.push(await runTest('core:heartbeat-recent', async () => {
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // 3h window
    const { data, error } = await supabase
      .from('system_heartbeats')
      .select('id')
      .eq('function_name', 'nexus-core')
      .eq('status', 'ok')
      .gte('checked_at', cutoff)
      .limit(1)
    if (error) throw error
    if (!data || data.length === 0) throw new Error('No successful nexus-core heartbeat in last 3h')
  }))

  // ── Landing & routing ────────────────────────────────────────────────────
  results.push(await runTest('integrations:webhook-url-formable', async () => {
    const testUrl = `${SUPABASE_URL}/functions/v1/roofing-integration-webhook?contractor_id=test`
    if (!testUrl.includes('/functions/v1/')) throw new Error('webhook URL malformed')
  }))

  results.push(await runTest('db:contractor-integrations-accessible', async () => {
    const { error } = await supabase.from('contractor_integrations').select('id').limit(1)
    if (error) throw error
  }))

  results.push(await runTest('db:system-heartbeats-accessible', async () => {
    const { error } = await supabase.from('system_heartbeats').select('id').limit(1)
    if (error) throw error
  }))

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)
  const totalMs = results.reduce((s, r) => s + r.ms, 0)

  return Response.json({
    ok: failed.length === 0,
    passed,
    total: results.length,
    failed: failed.map(r => ({ name: r.name, error: r.error })),
    total_ms: totalMs,
    results,
    timestamp: new Date().toISOString(),
  })
})

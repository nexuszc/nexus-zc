import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// Tier definitions
const TIERS: Record<string, { price_cents: number; recovery_pct: number | null; label: string; features: string[] }> = {
  package: {
    price_cents: 9900,
    recovery_pct: null,
    label: 'Supplement Package',
    features: ['AI photo analysis', 'Xactimate line items', 'Carrier strategy', 'Supplement packet PDF'],
  },
  aria_plus: {
    price_cents: 24900,
    recovery_pct: null,
    label: 'Supplement + Aria',
    features: ['Everything in Package', 'Aria calls adjuster', 'Denial rebuttal support', 'Depreciation release tracking'],
  },
  full_recovery: {
    price_cents: 0,
    recovery_pct: 10,
    label: 'Full Recovery (10%)',
    features: ['Everything in Supplement + Aria', 'Success-based pricing', 'We fight denials until approved', 'No upfront cost'],
  },
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const body = await req.json().catch(() => ({}))
  if (body.test) return Response.json({ ok: true, message: 'supplement-jobs ready', tiers: TIERS }, { headers: corsHeaders })

  const { action, job_id, contractor_id, tier, supplement_job_id } = body

  // START: create a supplement job for a given tier
  if (action === 'start') {
    if (!job_id || !contractor_id || !tier) {
      return Response.json({ error: 'job_id, contractor_id, and tier required' }, { status: 400, headers: corsHeaders })
    }

    const tierConfig = TIERS[tier]
    if (!tierConfig) {
      return Response.json({ error: `Invalid tier. Use: ${Object.keys(TIERS).join(', ')}` }, { status: 400, headers: corsHeaders })
    }

    // Check if supplement job already exists for this job+tier
    const { data: existing } = await supabase
      .from('supplement_jobs')
      .select('id, status')
      .eq('job_id', job_id)
      .eq('tier', tier)
      .not('status', 'in', '("denied","cancelled")')
      .maybeSingle()

    if (existing) {
      return Response.json({ ok: true, supplement_job_id: existing.id, status: existing.status, already_exists: true }, { headers: corsHeaders })
    }

    // Create supplement job
    const { data: suppJob, error } = await supabase
      .from('supplement_jobs')
      .insert({
        job_id,
        contractor_id,
        tier,
        price_cents: tierConfig.price_cents,
        recovery_pct: tierConfig.recovery_pct,
        status: 'pending',
      })
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders })

    // Log monetization event
    await supabase.from('monetization_events').insert({
      contractor_id,
      event_type: 'supplement_started',
      trigger_value: tier,
      upgrade_to: tier,
      metadata: { job_id, supplement_job_id: suppJob.id },
    }).catch(() => {})

    // Kick off the analyzer in the background
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-supplement-analyzer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ job_id, supplement_job_id: suppJob.id, tier }),
    }).catch(() => {})

    return Response.json({
      ok: true,
      supplement_job_id: suppJob.id,
      tier,
      price_cents: tierConfig.price_cents,
      price_display: tierConfig.recovery_pct ? `${tierConfig.recovery_pct}% of recovery` : `$${(tierConfig.price_cents / 100).toFixed(0)}`,
      label: tierConfig.label,
      status: 'pending',
    }, { headers: corsHeaders })
  }

  // STATUS: get supplement job status
  if (action === 'status') {
    if (!supplement_job_id && !job_id) {
      return Response.json({ error: 'supplement_job_id or job_id required' }, { status: 400, headers: corsHeaders })
    }

    let query = supabase.from('supplement_jobs').select('*')
    if (supplement_job_id) query = query.eq('id', supplement_job_id)
    else query = query.eq('job_id', job_id).order('created_at', { ascending: false })

    const { data } = supplement_job_id ? await query.single() : await query.limit(5)
    return Response.json({ ok: true, data }, { headers: corsHeaders })
  }

  // LIST: all supplement jobs for a contractor
  if (action === 'list') {
    if (!contractor_id) return Response.json({ error: 'contractor_id required' }, { status: 400, headers: corsHeaders })

    const { data } = await supabase
      .from('supplement_jobs')
      .select('*, roofing_jobs(property_address, homeowner_name)')
      .eq('contractor_id', contractor_id)
      .order('created_at', { ascending: false })
      .limit(50)

    const summary = {
      total: data?.length || 0,
      pending: data?.filter(j => j.status === 'pending').length || 0,
      in_progress: data?.filter(j => j.status === 'analyzing').length || 0,
      ready: data?.filter(j => j.status === 'ready').length || 0,
      approved: data?.filter(j => j.status === 'approved').length || 0,
      total_identified_cents: data?.reduce((s, j) => s + (j.total_identified_cents || 0), 0) || 0,
      total_approved_cents: data?.reduce((s, j) => s + (j.total_approved_cents || 0), 0) || 0,
    }

    return Response.json({ ok: true, jobs: data || [], summary }, { headers: corsHeaders })
  }

  // TIERS: return pricing info
  if (action === 'tiers') {
    return Response.json({ ok: true, tiers: TIERS }, { headers: corsHeaders })
  }

  return Response.json({ error: 'unknown action. Use: start | status | list | tiers' }, { status: 400, headers: corsHeaders })
})

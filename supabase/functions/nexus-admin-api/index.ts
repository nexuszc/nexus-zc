import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_KEY = Deno.env.get('NEXUS_ADMIN_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function authAdmin(req: Request): boolean {
  const key = req.headers.get('x-admin-key') || '';
  return key === ADMIN_KEY && ADMIN_KEY.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === 'GET') return Response.json({ ok: true, message: 'nexus-admin-api ready' });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'nexus-admin-api ready' });

  if (!authAdmin(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { action } = body;

  // ROOFING OS OVERVIEW — platform-wide stats
  if (action === 'roofing_overview') {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().split('T')[0];

    const [
      { count: totalContractors },
      { count: activeContractors },
      { count: trialContractors },
      { count: jobsToday },
      { count: jobsMonth },
      { data: tierBreakdown },
      { data: churnRisk }
    ] = await Promise.all([
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true }),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true })
        .eq('status', 'active').eq('subscription_status', 'active'),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true })
        .eq('status', 'active').eq('subscription_status', 'trialing'),
      supabase.from('roofing_jobs').select('id', { count: 'exact', head: true })
        .gte('created_at', today + 'T00:00:00'),
      supabase.from('roofing_jobs').select('id', { count: 'exact', head: true })
        .gte('created_at', currentMonth + '-01T00:00:00'),
      supabase.from('contractor_accounts')
        .select('plan')
        .eq('status', 'active'),
      supabase.from('contractor_accounts')
        .select('id, company_name, owner_name, owner_phone, churn_risk_score, plan')
        .eq('status', 'active')
        .gte('churn_risk_score', 70)
        .order('churn_risk_score', { ascending: false })
        .limit(10)
    ]);

    // Aggregate tier counts
    const tiers: Record<string, number> = {};
    for (const c of (tierBreakdown || [])) {
      const plan = (c as { plan: string }).plan || 'door';
      tiers[plan] = (tiers[plan] || 0) + 1;
    }

    return Response.json({
      ok: true,
      contractors: {
        total: totalContractors || 0,
        active: activeContractors || 0,
        trial: trialContractors || 0,
        by_tier: tiers
      },
      jobs: {
        today: jobsToday || 0,
        this_month: jobsMonth || 0
      },
      churn_risk: churnRisk || []
    });
  }

  // CONTRACTORS — paginated list with search
  if (action === 'contractors') {
    const { limit = 25, offset = 0, status, plan, search } = body;

    let query = supabase
      .from('contractor_accounts')
      .select('id, company_name, owner_name, owner_phone, owner_email, plan, status, subscription_status, churn_risk_score, total_jobs, created_at, trial_ends_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (plan) query = query.eq('plan', plan);
    if (search) query = query.or(`company_name.ilike.%${search}%,owner_name.ilike.%${search}%,owner_phone.ilike.%${search}%`);

    const { data: contractors, count } = await query;
    return Response.json({ ok: true, contractors: contractors || [], total: count || 0 });
  }

  // CONTRACTOR DETAIL
  if (action === 'contractor_detail') {
    const { contractor_id } = body;
    if (!contractor_id) return Response.json({ ok: false, error: 'contractor_id required' }, { status: 400 });

    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('*')
      .eq('id', contractor_id)
      .single();

    if (!contractor) return Response.json({ ok: false, error: 'not found' }, { status: 404 });

    const currentMonth = new Date().toISOString().slice(0, 7);

    const [
      { data: employees },
      { data: usage },
      { data: recentJobs },
      { data: upgradeEvents }
    ] = await Promise.all([
      supabase.from('contractor_employees').select('id, name, role, phone, is_owner, active').eq('contractor_id', contractor_id),
      supabase.from('contractor_monthly_usage').select('*').eq('contractor_id', contractor_id).eq('month_year', currentMonth).single(),
      supabase.from('roofing_jobs').select('id, property_address, status, created_at').eq('contractor_id', contractor_id).order('created_at', { ascending: false }).limit(5),
      supabase.from('contractor_upgrade_events').select('from_tier, to_tier, trigger_type, upgrade_initiated_at, upgrade_confirmed_at').eq('contractor_id', contractor_id).order('upgrade_initiated_at', { ascending: false }).limit(5)
    ]);

    return Response.json({ ok: true, contractor, employees, usage, recent_jobs: recentJobs, upgrade_events: upgradeEvents });
  }

  // SYSTEM HEALTH
  if (action === 'system_health') {
    const { data: snapshots } = await supabase
      .from('system_health_snapshots')
      .select('*')
      .order('snapshot_hour', { ascending: false })
      .limit(48);

    const { data: recentErrors } = await supabase
      .from('system_heartbeats')
      .select('function_name, error_message, recorded_at')
      .eq('status', 'error')
      .order('recorded_at', { ascending: false })
      .limit(20);

    return Response.json({ ok: true, snapshots: snapshots || [], recent_errors: recentErrors || [] });
  }

  // PROPOSALS — roofing improvement proposals
  if (action === 'proposals') {
    const { status } = body;
    let query = supabase
      .from('nexus_roofing_proposals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (status) query = query.eq('status', status);
    const { data: proposals } = await query;
    return Response.json({ ok: true, proposals: proposals || [] });
  }

  if (action === 'approve_proposal') {
    const { proposal_id } = body;
    if (!proposal_id) return Response.json({ ok: false, error: 'proposal_id required' }, { status: 400 });
    await supabase.from('nexus_roofing_proposals')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', proposal_id);
    return Response.json({ ok: true, approved: true });
  }

  if (action === 'reject_proposal') {
    const { proposal_id, reason } = body;
    if (!proposal_id) return Response.json({ ok: false, error: 'proposal_id required' }, { status: 400 });
    await supabase.from('nexus_roofing_proposals')
      .update({ status: 'rejected', rejected_at: new Date().toISOString(), rejection_reason: reason || null })
      .eq('id', proposal_id);
    return Response.json({ ok: true, rejected: true });
  }

  // STORM EVENTS (hail_events) in service areas
  if (action === 'storm_events') {
    const { limit = 20, zip } = body;
    let query = supabase
      .from('hail_events')
      .select('zip_code, hail_size_inches, event_date, city, state')
      .order('event_date', { ascending: false })
      .limit(limit);
    if (zip) query = query.eq('zip_code', zip);
    const { data: events } = await query;
    return Response.json({ ok: true, events: events || [] });
  }

  // UPGRADE — manually process contractor upgrade
  if (action === 'manual_upgrade') {
    const { contractor_id, to_tier } = body;
    if (!contractor_id || !to_tier) return Response.json({ ok: false, error: 'contractor_id and to_tier required' }, { status: 400 });

    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('plan')
      .eq('id', contractor_id)
      .single();

    if (!contractor) return Response.json({ ok: false, error: 'contractor not found' }, { status: 404 });

    const res = await fetch(`${SUPABASE_URL}/functions/v1/upgrade-engine`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'process_upgrade', contractor_id, from_tier: contractor.plan, to_tier })
    });
    const result = await res.json();
    return Response.json({ ok: true, result });
  }

  return Response.json({ ok: false, error: 'unknown action' }, { status: 400 });
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function resolveSession(token: string): Promise<{ contractor_id: string; employee_id: string | null } | null> {
  const { data: session } = await supabase
    .from('contractor_sessions')
    .select('contractor_id, employee_id, expires_at')
    .eq('token', token)
    .single();

  if (!session || new Date(session.expires_at) < new Date()) return null;
  return { contractor_id: session.contractor_id, employee_id: session.employee_id };
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'contractor-dashboard-api ready' });

  const { action, token } = body;
  if (!token) return Response.json({ ok: false, error: 'token required' }, { status: 401 });

  const session = await resolveSession(token);
  if (!session) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const contractorId = session.contractor_id;
  const currentMonth = new Date().toISOString().slice(0, 7);

  // OVERVIEW — main dashboard stats
  if (action === 'overview') {
    const today = new Date().toISOString().split('T')[0];

    const [
      { count: jobsToday },
      { count: jobsMonth },
      { data: usage },
      { data: contractor }
    ] = await Promise.all([
      supabase.from('roofing_jobs').select('id', { count: 'exact', head: true })
        .eq('contractor_id', contractorId).gte('created_at', today + 'T00:00:00'),
      supabase.from('roofing_jobs').select('id', { count: 'exact', head: true })
        .eq('contractor_id', contractorId).gte('created_at', currentMonth + '-01T00:00:00'),
      supabase.from('contractor_monthly_usage')
        .select('total_jobs_created, fully_handled_jobs_used, supplements_submitted')
        .eq('contractor_id', contractorId).eq('month_year', currentMonth).single(),
      supabase.from('contractor_accounts')
        .select('company_name, owner_name, plan, subscription_status, trial_ends_at, churn_risk_score, total_jobs, total_supplement_revenue_cents')
        .eq('id', contractorId).single()
    ]);

    // Get actual tier (separate query — plan is a slug, not a FK)
    const { data: actualTier } = await supabase
      .from('platform_tiers')
      .select('name, price_cents, included_jobs_per_month, fully_handled_jobs_included')
      .eq('slug', contractor?.plan || 'door')
      .single();

    // Open supplements: must go through job IDs (no contractor_id on supplement_packages)
    const { data: jobIdRows } = await supabase
      .from('roofing_jobs').select('id').eq('contractor_id', contractorId);
    const jobIds = (jobIdRows || []).map((j: { id: string }) => j.id);
    let openSupplements = 0;
    if (jobIds.length > 0) {
      const { count } = await supabase
        .from('supplement_packages')
        .select('id', { count: 'exact', head: true })
        .in('job_id', jobIds)
        .not('status', 'in', '("approved","closed","denied")');
      openSupplements = count || 0;
    }

    // Recent jobs (last 5)
    const { data: recentJobs } = await supabase
      .from('roofing_jobs')
      .select('id, property_address, status, handling_tier, fully_handled, created_at')
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
      .limit(5);

    // Pending upgrade jobs
    const { count: pendingUpgrade } = await supabase
      .from('roofing_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('contractor_id', contractorId)
      .eq('status', 'pending_upgrade');

    return Response.json({
      ok: true,
      contractor,
      tier: actualTier,
      stats: {
        jobs_today: jobsToday || 0,
        jobs_this_month: jobsMonth || 0,
        open_supplements: openSupplements || 0,
        fully_handled_used: usage?.fully_handled_jobs_used || 0,
        fully_handled_limit: actualTier?.fully_handled_jobs_included || 0,
        pending_upgrade: pendingUpgrade || 0
      },
      recent_jobs: recentJobs || []
    });
  }

  // JOBS — paginated job list
  if (action === 'jobs') {
    const { status, limit = 20, offset = 0 } = body;

    let query = supabase
      .from('roofing_jobs')
      .select('id, property_address, status, handling_tier, fully_handled, supplement_included, permit_included, created_at, updated_at')
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data: jobs, count } = await query;
    return Response.json({ ok: true, jobs: jobs || [], total: count || 0 });
  }

  // JOB DETAIL
  if (action === 'job_detail') {
    const { job_id } = body;
    if (!job_id) return Response.json({ ok: false, error: 'job_id required' }, { status: 400 });

    const { data: job } = await supabase
      .from('roofing_jobs')
      .select('*')
      .eq('id', job_id)
      .eq('contractor_id', contractorId)
      .single();

    if (!job) return Response.json({ ok: false, error: 'job not found' }, { status: 404 });

    // Supplements for this job
    const { data: supplements } = await supabase
      .from('supplement_packages')
      .select('id, status, total_amount, created_at')
      .eq('job_id', job_id)
      .catch(() => ({ data: null }));

    // Portal activity
    const { data: portalActivity } = await supabase
      .from('portal_activities')
      .select('title, description, created_at')
      .eq('job_id', job_id)
      .order('created_at', { ascending: false })
      .limit(10)
      .catch(() => ({ data: null }));

    return Response.json({ ok: true, job, supplements: supplements || [], portal_activity: portalActivity || [] });
  }

  // SUPPLEMENTS — all open supplement packages
  if (action === 'supplements') {
    const { data: jobIds } = await supabase
      .from('roofing_jobs')
      .select('id')
      .eq('contractor_id', contractorId);

    if (!jobIds || jobIds.length === 0) {
      return Response.json({ ok: true, supplements: [] });
    }

    const ids = jobIds.map((j: { id: string }) => j.id);
    const { data: supplements } = await supabase
      .from('supplement_packages')
      .select('id, job_id, status, total_amount, carrier_name, created_at, updated_at')
      .in('job_id', ids)
      .order('created_at', { ascending: false })
      .limit(50);

    return Response.json({ ok: true, supplements: supplements || [] });
  }

  // USAGE — monthly usage stats
  if (action === 'usage') {
    const { month } = body;
    const targetMonth = month || currentMonth;

    const { data: usage } = await supabase
      .from('contractor_monthly_usage')
      .select('*')
      .eq('contractor_id', contractorId)
      .eq('month_year', targetMonth)
      .single();

    const { data: roiReport } = await supabase
      .from('contractor_roi_reports')
      .select('jobs_handled, supplement_revenue_cents, roi_multiple, net_gain_cents')
      .eq('contractor_id', contractorId)
      .eq('month', targetMonth)
      .single();

    return Response.json({ ok: true, usage, roi_report: roiReport });
  }

  // EMPLOYEES — team management
  if (action === 'employees') {
    const { data: employees } = await supabase
      .from('contractor_employees')
      .select('id, name, phone, role, is_owner, active, created_at')
      .eq('contractor_id', contractorId)
      .order('is_owner', { ascending: false });

    return Response.json({ ok: true, employees: employees || [] });
  }

  // DASHBOARD CONFIG — get/set widget preferences
  if (action === 'get_config') {
    const { data: config } = await supabase
      .from('contractor_dashboard_config')
      .select('*')
      .eq('contractor_id', contractorId)
      .single();

    return Response.json({ ok: true, config });
  }

  if (action === 'set_config') {
    const { widgets, color_scheme, notification_prefs, onboarding_dismissed } = body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (widgets !== undefined) updates.widgets = widgets;
    if (color_scheme !== undefined) updates.color_scheme = color_scheme;
    if (notification_prefs !== undefined) updates.notification_prefs = notification_prefs;
    if (onboarding_dismissed !== undefined) updates.onboarding_dismissed = onboarding_dismissed;

    await supabase
      .from('contractor_dashboard_config')
      .upsert({ contractor_id: contractorId, ...updates }, { onConflict: 'contractor_id' });

    return Response.json({ ok: true, updated: true });
  }

  return Response.json({ ok: false, error: 'action required: overview | jobs | job_detail | supplements | usage | employees | get_config | set_config' }, { status: 400 });
});

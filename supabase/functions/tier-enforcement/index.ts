import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendSMS(to: string, body: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')!;
  const from = Deno.env.get('TWILIO_FROM_NUMBER') || Deno.env.get('TWILIO_PHONE_NUMBER') || '+18005550100';
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'tier-enforcement ready' });

  const { contractor_id, action } = body;
  if (!contractor_id || !action) {
    return Response.json({ ok: false, error: 'contractor_id and action required' }, { status: 400 });
  }

  const { data: contractor } = await supabase
    .from('contractor_accounts')
    .select('id, plan, owner_name, owner_phone, company_name')
    .eq('id', contractor_id)
    .single();

  if (!contractor) return Response.json({ ok: false, error: 'contractor not found' }, { status: 404 });

  const PLAN_LIMITS: Record<string, { jobs: number | null; team: number | null; supplements: boolean; permits: boolean; name: string }> = {
    free:    { jobs: 5,    team: 1,    supplements: false, permits: false, name: 'Free' },
    trial:   { jobs: 5,    team: 1,    supplements: false, permits: false, name: 'Free' },
    starter: { jobs: null, team: null, supplements: true,  permits: true,  name: 'Starter' },
    pro:     { jobs: null, team: null, supplements: true,  permits: true,  name: 'Pro' },
    custom:  { jobs: null, team: null, supplements: true,  permits: true,  name: 'Custom' },
    // Legacy slugs
    door:    { jobs: 5,    team: 1,    supplements: false, permits: false, name: 'Door' },
    taste:   { jobs: 10,   team: 3,    supplements: true,  permits: false, name: 'Taste' },
    revenue: { jobs: null, team: null, supplements: true,  permits: true,  name: 'Revenue' },
    command: { jobs: null, team: null, supplements: true,  permits: true,  name: 'Command' },
  };

  const plan = (contractor.plan || 'free').toLowerCase();
  const tier = PLAN_LIMITS[plan] || PLAN_LIMITS['free'];

  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  let { data: usage } = await supabase
    .from('contractor_monthly_usage')
    .select('*')
    .eq('contractor_id', contractor_id)
    .eq('month_year', currentMonth)
    .single();

  if (!usage) {
    const { data: newUsage } = await supabase
      .from('contractor_monthly_usage')
      .insert({ contractor_id, month_year: currentMonth })
      .select()
      .single();
    usage = newUsage;
  }

  if (action === 'check_job_create') {
    const jobsAllowed = tier.jobs;
    const jobsUsed = usage?.total_jobs_created || 0;
    if (jobsAllowed !== null && jobsUsed >= jobsAllowed) {
      if (contractor.owner_phone) {
        const firstName = (contractor.owner_name || '').split(' ')[0] || 'there';
        await sendSMS(
          contractor.owner_phone,
          `${firstName} — you've used all ${jobsAllowed} free jobs this month on Roofing OS. ` +
          `Reply UPGRADE to unlock unlimited jobs — Starter is $149/mo. ` +
          `roofingos.dev/upgrade`
        );
      }

      await supabase.from('contractor_upgrade_events').insert({
        contractor_id,
        from_tier: plan,
        to_tier: 'starter',
        trigger_type: 'job_limit_reached',
        upgrade_initiated_at: new Date().toISOString()
      }).catch(() => {});

      await supabase.from('contractor_monthly_usage')
        .update({ upgrade_triggered: true, upgrade_triggered_at: new Date().toISOString() })
        .eq('contractor_id', contractor_id)
        .eq('month_year', currentMonth);

      return Response.json({
        ok: true,
        allowed: false,
        reason: `Monthly job limit reached (${jobsAllowed} jobs on ${tier.name} plan). Upgrade at roofingos.dev/upgrade`,
        upgrade_triggered: true
      });
    }
    return Response.json({ ok: true, allowed: true, jobs_used: jobsUsed, jobs_allowed: jobsAllowed });
  }

  if (action === 'check_supplement') {
    if (!tier.supplements) {
      return Response.json({
        ok: true,
        allowed: false,
        reason: `Supplements not available on ${tier.name} plan. Upgrade to Starter ($149/mo) or higher.`
      });
    }
    return Response.json({ ok: true, allowed: true });
  }

  if (action === 'check_permit') {
    if (!tier.permits) {
      return Response.json({
        ok: true,
        allowed: false,
        reason: `Permit tracking not available on ${tier.name} plan. Upgrade to Starter ($149/mo) or higher.`
      });
    }
    return Response.json({ ok: true, allowed: true });
  }

  return Response.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
});

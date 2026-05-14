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

  const { data: tier } = await supabase
    .from('platform_tiers')
    .select('slug, name, price_cents, included_jobs_per_month, fully_handled_jobs_included, supplements_enabled, permits_enabled')
    .eq('slug', contractor.plan || 'door')
    .single();

  if (!tier) return Response.json({ ok: false, error: 'tier not found' }, { status: 404 });

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
    // Taste tier: cap is on fully-handled jobs (fully_handled_jobs_included)
    if (tier.slug === 'taste' && tier.fully_handled_jobs_included > 0) {
      const usedHandled = usage?.fully_handled_jobs_used || 0;
      if (usedHandled >= tier.fully_handled_jobs_included) {
        if (contractor.owner_phone) {
          const firstName = (contractor.owner_name || '').split(' ')[0] || 'there';
          await sendSMS(
            contractor.owner_phone,
            `${firstName} — you've used both fully-handled jobs this month on Roofing OS Taste. ` +
            `Reply UPGRADE to unlock unlimited AI-handled jobs for $2,499/mo. ` +
            `Every job we close pays for itself.`
          );
        }

        await supabase.from('contractor_upgrade_events').insert({
          contractor_id,
          from_tier: tier.slug,
          to_tier: 'revenue',
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
          reason: `Fully-handled job limit reached (${tier.fully_handled_jobs_included} on ${tier.name} plan)`,
          upgrade_triggered: true
        });
      }
      return Response.json({ ok: true, allowed: true, handled_used: usedHandled, handled_limit: tier.fully_handled_jobs_included });
    }

    // Other tiers: check included_jobs_per_month (null = unlimited)
    const jobsAllowed = tier.included_jobs_per_month;
    const jobsUsed = usage?.total_jobs_created || 0;
    if (jobsAllowed !== null && jobsUsed >= jobsAllowed) {
      return Response.json({
        ok: true,
        allowed: false,
        reason: `Monthly job limit reached (${jobsAllowed} on ${tier.name} plan)`,
        upgrade_triggered: false
      });
    }
    return Response.json({ ok: true, allowed: true, jobs_used: jobsUsed, jobs_allowed: jobsAllowed });
  }

  if (action === 'check_supplement') {
    if (!tier.supplements_enabled) {
      return Response.json({
        ok: true,
        allowed: false,
        reason: `Supplements not enabled on ${tier.name}. Upgrade to Taste ($799/mo) or higher.`
      });
    }
    return Response.json({ ok: true, allowed: true });
  }

  if (action === 'check_permit') {
    if (!tier.permits_enabled) {
      return Response.json({
        ok: true,
        allowed: false,
        reason: `Permit tracking not enabled on ${tier.name}. Upgrade to Taste ($799/mo) or higher.`
      });
    }
    return Response.json({ ok: true, allowed: true });
  }

  return Response.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
});

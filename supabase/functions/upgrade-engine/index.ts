import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendTelegram(msg: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4000), parse_mode: 'Markdown' })
  }).catch(() => {});
}

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
  if (body.test) return Response.json({ ok: true, message: 'upgrade-engine ready' });

  const { action, contractor_id, from_tier, to_tier, sms_reply, phone } = body;

  // Inbound SMS "UPGRADE" reply routed here
  if (sms_reply) {
    if (!phone) return Response.json({ ok: false, error: 'phone required for sms_reply' }, { status: 400 });

    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('id, plan, owner_name, owner_phone, company_name')
      .eq('owner_phone', phone)
      .single();

    if (!contractor) return Response.json({ ok: false, error: 'contractor not found' });

    await sendSMS(
      phone,
      `Perfect — upgrading your account now. ` +
      `We'll send a payment link in the next 60 seconds. ` +
      `Questions? Reply CALL and we'll phone you right now.`
    );

    await sendTelegram(
      `💰 *Upgrade Reply: ${contractor.owner_name || contractor.company_name}*\n` +
      `Phone: ${phone}\n` +
      `Current plan: ${contractor.plan}\n` +
      `Replied: UPGRADE\n\n` +
      `Action: Send Stripe upgrade link NOW`
    );

    await supabase.from('contractor_upgrade_events').insert({
      contractor_id: contractor.id,
      from_tier: contractor.plan,
      to_tier: 'revenue',
      trigger_type: 'sms_reply',
      upgrade_initiated_at: new Date().toISOString()
    }).catch(() => {});

    return Response.json({ ok: true, action: 'upgrade_initiated', contractor_id: contractor.id });
  }

  if (action === 'process_upgrade') {
    if (!contractor_id || !from_tier || !to_tier) {
      return Response.json({ ok: false, error: 'contractor_id, from_tier, to_tier required' }, { status: 400 });
    }

    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('*')
      .eq('id', contractor_id)
      .single();

    if (!contractor) return Response.json({ ok: false, error: 'contractor not found' }, { status: 404 });

    await supabase.from('contractor_accounts')
      .update({ plan: to_tier, updated_at: new Date().toISOString() })
      .eq('id', contractor_id);

    // Unlock pending jobs if upgrading from taste
    let pendingJobsUnlocked = 0;
    if (from_tier === 'taste' && to_tier === 'revenue') {
      const { data: pendingJobs } = await supabase
        .from('roofing_jobs')
        .select('id')
        .eq('contractor_id', contractor_id)
        .eq('status', 'pending_upgrade');

      if (pendingJobs && pendingJobs.length > 0) {
        pendingJobsUnlocked = pendingJobs.length;
        await supabase.from('roofing_jobs')
          .update({ status: 'new', handling_tier: to_tier })
          .eq('contractor_id', contractor_id)
          .eq('status', 'pending_upgrade');
      }
    }

    // Mark pending upgrade event confirmed
    await supabase.from('contractor_upgrade_events')
      .update({ upgrade_confirmed_at: new Date().toISOString() })
      .eq('contractor_id', contractor_id)
      .eq('from_tier', from_tier)
      .eq('to_tier', to_tier)
      .is('upgrade_confirmed_at', null);

    const { data: newTier } = await supabase
      .from('platform_tiers')
      .select('name')
      .eq('slug', to_tier)
      .single();

    await sendTelegram(
      `✅ *Upgrade Complete: ${contractor.company_name}*\n` +
      `${from_tier} → ${to_tier}\n` +
      `Pending jobs unlocked: ${pendingJobsUnlocked}`
    );

    if (contractor.owner_phone) {
      await sendSMS(
        contractor.owner_phone,
        `You're now on ${newTier?.name || to_tier}. ` +
        (pendingJobsUnlocked > 0 ? `${pendingJobsUnlocked} pending job(s) are now being processed. ` : '') +
        `Welcome to the full system.`
      );
    }

    return Response.json({ ok: true, upgraded: true, pending_jobs_unlocked: pendingJobsUnlocked });
  }

  if (action === 'check_pending') {
    if (!contractor_id) return Response.json({ ok: false, error: 'contractor_id required' }, { status: 400 });

    const { data: pendingJobs, count } = await supabase
      .from('roofing_jobs')
      .select('id, property_address, created_at', { count: 'exact' })
      .eq('contractor_id', contractor_id)
      .eq('status', 'pending_upgrade');

    return Response.json({ ok: true, pending_count: count || 0, jobs: pendingJobs || [] });
  }

  return Response.json({ ok: false, error: 'action required: process_upgrade | check_pending | sms_reply' }, { status: 400 });
});

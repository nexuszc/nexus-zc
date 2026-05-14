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

function fire(fn: string, payload: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'job-intake ready' });

  const { contractor_id, address, homeowner_name, homeowner_phone, homeowner_email, notes } = body;
  if (!contractor_id || !address) {
    return Response.json({ ok: false, error: 'contractor_id and address required' }, { status: 400 });
  }

  // Tier gate first
  const tierCheck = await fetch(`${SUPABASE_URL}/functions/v1/tier-enforcement`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractor_id, action: 'check_job_create' })
  }).then(r => r.json()).catch(() => ({ allowed: true }));

  if (!tierCheck.allowed) {
    return Response.json({
      ok: false,
      blocked: true,
      reason: tierCheck.reason,
      upgrade_triggered: tierCheck.upgrade_triggered || false
    });
  }

  const currentMonth = new Date().toISOString().slice(0, 7);

  const { data: job, error: jobError } = await supabase
    .from('roofing_jobs')
    .insert({
      contractor_id,
      property_address: address,
      homeowner_name: homeowner_name || null,
      homeowner_phone: homeowner_phone || null,
      homeowner_email: homeowner_email || null,
      notes: notes || null,
      status: 'new',
      created_month: currentMonth,
      fully_handled: false,
      handling_tier: null,
      supplement_included: false,
      permit_included: false
    })
    .select()
    .single();

  if (jobError || !job) {
    return Response.json({ ok: false, error: jobError?.message || 'job creation failed' }, { status: 500 });
  }

  // Increment monthly usage
  const { data: usage } = await supabase
    .from('contractor_monthly_usage')
    .select('total_jobs_created, fully_handled_jobs_used')
    .eq('contractor_id', contractor_id)
    .eq('month_year', currentMonth)
    .single();

  await supabase.from('contractor_monthly_usage')
    .upsert({
      contractor_id,
      month_year: currentMonth,
      total_jobs_created: (usage?.total_jobs_created || 0) + 1,
      // Increment fully_handled_jobs_used for taste tier (tier-enforcement already validated)
      fully_handled_jobs_used: tierCheck.handled_limit
        ? (usage?.fully_handled_jobs_used || 0) + 1
        : (usage?.fully_handled_jobs_used || 0)
    }, { onConflict: 'contractor_id,month_year' });

  // Homeowner automation chain
  if (homeowner_phone) {
    fire('portal-magic-link', { job_id: job.id, phone: homeowner_phone, name: homeowner_name });

    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('company_name')
      .eq('id', contractor_id)
      .single();

    fire('roofing-aria-engine', {
      call_type: 'homeowner_intake',
      contact_phone: homeowner_phone,
      contact_name: homeowner_name || 'Homeowner',
      contact_type: 'homeowner',
      metadata: { job_id: job.id, address, contractor_name: contractor?.company_name || 'your contractor' }
    });
  }

  // Supplement inclusion check
  const suppCheck = await fetch(`${SUPABASE_URL}/functions/v1/tier-enforcement`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractor_id, action: 'check_supplement' })
  }).then(r => r.json()).catch(() => ({ allowed: false }));

  if (suppCheck.allowed) {
    fire('roofing-supplement-generator', { job_id: job.id, contractor_id });
    await supabase.from('roofing_jobs').update({ supplement_included: true }).eq('id', job.id);
  }

  // Permit inclusion check
  const permitCheck = await fetch(`${SUPABASE_URL}/functions/v1/tier-enforcement`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractor_id, action: 'check_permit' })
  }).then(r => r.json()).catch(() => ({ allowed: false }));

  if (permitCheck.allowed) {
    fire('roofing-permit-tracker', { action: 'submit', job_id: job.id, contractor_id });
    await supabase.from('roofing_jobs').update({ permit_included: true }).eq('id', job.id);
  }

  const fullyHandled = suppCheck.allowed && permitCheck.allowed;
  if (fullyHandled) {
    await supabase.from('roofing_jobs')
      .update({ fully_handled: true, handling_tier: 'revenue' })
      .eq('id', job.id);
  }

  await sendTelegram(
    `📋 *New Job: ${address}*\n` +
    `Contractor: ${contractor_id}\n` +
    `Homeowner: ${homeowner_name || 'unknown'} ${homeowner_phone || ''}\n` +
    `Supplement: ${suppCheck.allowed ? '✅' : '❌'} | Permit: ${permitCheck.allowed ? '✅' : '❌'} | Fully handled: ${fullyHandled ? '✅' : '❌'}`
  );

  return Response.json({
    ok: true,
    job_id: job.id,
    supplement_included: suppCheck.allowed,
    permit_included: permitCheck.allowed,
    fully_handled: fullyHandled
  });
});

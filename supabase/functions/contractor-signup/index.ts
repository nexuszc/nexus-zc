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

function generateWelcomeEmail(contractor: Record<string, unknown>): string {
  const name = (contractor.owner_name as string || '').split(' ')[0];
  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
  .cta { background: #3b82f6; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 700; }
  .step { display: flex; gap: 16px; margin: 16px 0; align-items: flex-start; }
  .step-num { background: #3b82f6; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; line-height: 32px; text-align: center; }
</style>
</head>
<body>
  <h1>Welcome to Roofing OS, ${name}.</h1>
  <p>You just made the best decision for your roofing business. Here's how to get your first $4,000+ in recovered supplement revenue this week.</p>
  <h3>Your first 3 steps:</h3>
  <div class="step">
    <div class="step-num">1</div>
    <div><strong>Add your first job</strong><br>Enter any active insurance job. We'll generate a pre-install supplement package and send your homeowner their portal link — both automatically.</div>
  </div>
  <div class="step">
    <div class="step-num">2</div>
    <div><strong>Upload the adjuster estimate</strong><br>Take a photo of the adjuster's estimate. Our AI reads it, finds what they missed, and writes the supplement package in carrier-specific language.</div>
  </div>
  <div class="step">
    <div class="step-num">3</div>
    <div><strong>Send your homeowner their portal</strong><br>One click. They get a link showing their house, their job progress, their insurance status in plain English. They'll text their neighbor about it.</div>
  </div>
  <div style="text-align:center; margin: 32px 0;">
    <a href="https://roofingos.dev/contractor/${contractor.id as string}" class="cta">Open Your Dashboard →</a>
  </div>
  <p>Aria will call you in the next few hours to walk through everything.</p>
  <p>And if you know another contractor who's leaving supplement money behind — here's your referral link. They get 14 days free. You get a free month.<br>
  <strong>roofingos.dev/ref/${contractor.referral_code as string}</strong></p>
  <p>Talk soon,<br>Zach Curtis<br>Roofing OS</p>
</body>
</html>`;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'contractor-signup ready' });

  const {
    company_name,
    owner_name,
    owner_email,
    owner_phone,
    primary_zip,
    plan = 'starter',
    referral_code,
    payment_method_id,
    audit_lead_id
  } = body;

  if (!company_name || !owner_email) {
    return Response.json({ error: 'Company name and email required' }, { status: 400 });
  }

  // Check for referral
  let referredBy: string | null = null;
  if (referral_code) {
    const { data: referring } = await supabase
      .from('contractor_accounts')
      .select('id')
      .eq('referral_code', referral_code)
      .maybeSingle();
    if (referring) referredBy = referring.id;
  }

  // Generate referral code and subdomain
  const referralCode = company_name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10) +
    Math.random().toString(36).slice(2, 6);

  const subdomain = company_name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);

  const planPrices: Record<string, number> = {
    door: 4900,
    starter: 29900,
    growth: 49900,
    professional: 99900,
    enterprise: 299900
  };

  let stripeCustomerId = '';
  let stripeSubscriptionId = '';
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  if (payment_method_id) {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (stripeKey) {
      try {
        // Create Stripe customer
        const customerRes = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            email: owner_email,
            name: owner_name || '',
            'metadata[company_name]': company_name,
            'metadata[phone]': owner_phone || ''
          })
        });
        const customer = await customerRes.json();
        stripeCustomerId = customer.id || '';

        if (stripeCustomerId) {
          // Attach payment method
          await fetch(`https://api.stripe.com/v1/payment_methods/${payment_method_id}/attach`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ customer: stripeCustomerId })
          });

          // Create subscription
          const subRes = await fetch('https://api.stripe.com/v1/subscriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
              customer: stripeCustomerId,
              'items[0][price_data][currency]': 'usd',
              'items[0][price_data][product_data][name]': `Roofing OS ${plan}`,
              'items[0][price_data][unit_amount]': planPrices[plan].toString(),
              'items[0][price_data][recurring][interval]': 'month',
              trial_period_days: '14',
              default_payment_method: payment_method_id
            })
          });
          const sub = await subRes.json();
          stripeSubscriptionId = sub.id || '';
        }
      } catch { /* Stripe optional */ }
    }
  }

  // Create contractor account
  const { data: contractor } = await supabase
    .from('contractor_accounts')
    .insert({
      company_name,
      owner_name,
      owner_email,
      owner_phone,
      primary_zip,
      plan,
      plan_price_cents: planPrices[plan] || 29900,
      stripe_customer_id: stripeCustomerId || null,
      stripe_subscription_id: stripeSubscriptionId || null,
      subscription_status: payment_method_id ? 'trialing' : 'trialing',
      trial_ends_at: trialEndsAt,
      referral_code: referralCode,
      referred_by_contractor_id: referredBy,
      subdomain,
      onboarding_step: 'account_created'
    })
    .select()
    .single();

  if (!contractor) {
    return Response.json({ error: 'Failed to create account' }, { status: 500 });
  }

  // Link from audit lead
  if (audit_lead_id) {
    await supabase.from('supplement_audit_leads')
      .update({ converted_to_contractor: true, contractor_account_id: contractor.id })
      .eq('id', audit_lead_id);
  }

  // Track referral
  if (referredBy && referral_code) {
    await supabase.from('contractor_referrals').insert({
      referring_contractor_id: referredBy,
      referred_email: owner_email,
      referred_contractor_id: contractor.id,
      referral_code,
      status: 'signed_up'
    }).catch(() => {});
  }

  // Welcome call + email
  await Promise.allSettled([
    owner_phone ? fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call_type: 'contractor_welcome',
        contact_phone: owner_phone,
        contact_name: owner_name,
        contact_type: 'new_contractor',
        metadata: { company_name, plan, contractor_name: 'Roofing OS' }
      })
    }).catch(() => {}) : Promise.resolve(),

    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Zach at Roofing OS <zach@roofingos.dev>',
        to: owner_email,
        subject: `Welcome to Roofing OS, ${(owner_name || '').split(' ')[0]}`,
        html: generateWelcomeEmail(contractor)
      })
    }).catch(() => {})
  ]);

  // Schedule onboarding reminder
  await supabase.from('reminders').insert({
    chat_id: Deno.env.get('TELEGRAM_CHAT_ID'),
    message: `🎉 New contractor signed up: ${company_name} (${owner_email})\nCall to onboard: ${owner_phone || 'no phone'}\nPlan: ${plan}`,
    fire_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }).catch(() => {});

  await sendTelegram(
    `🎉 *New Contractor Signed Up*\n` +
    `*${company_name}*\n` +
    `Owner: ${owner_name}\n` +
    `Email: ${owner_email}\n` +
    `Phone: ${owner_phone || 'none'}\n` +
    `Plan: ${plan} ($${(planPrices[plan] || 29900) / 100}/mo)\n` +
    `Zip: ${primary_zip || 'not set'}\n` +
    `Referred by: ${referral_code || 'none'}\n` +
    `Trial ends: ${new Date(trialEndsAt).toLocaleDateString()}`
  );

  return Response.json({
    ok: true,
    contractor_id: contractor.id,
    subdomain,
    referral_code: referralCode,
    trial_ends_at: trialEndsAt,
    dashboard_url: `https://roofingos.dev/contractor/${contractor.id}`
  });
});

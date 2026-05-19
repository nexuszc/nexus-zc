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
  const companyName = contractor.company_name as string || '';
  const ownerPhone = contractor.owner_phone as string || '';
  const twilioNumber = Deno.env.get('TWILIO_FROM_NUMBER') || Deno.env.get('TWILIO_PHONE_NUMBER') || '+17202921930';
  return `<!DOCTYPE html>
<html>
<head>
<style>
  body{font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.8}
  h2{font-size:22px;margin-bottom:4px}
  h3{font-size:16px;margin-bottom:8px}
  hr{border:none;border-top:1px solid #e2e8f0;margin:24px 0}
  .cta{background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block}
  .sub{color:#64748b;font-size:14px}
</style>
</head>
<body>
<h2>Welcome to Roofing OS, ${companyName}.</h2>
<p class="sub" style="margin-top:0">Your account is active. Here's how to get started.</p>
<hr>
<h3>Step 1 — Log into your dashboard</h3>
<p>Go to your contractor dashboard and enter your phone number to get a login link:</p>
<p style="margin:16px 0"><a href="https://roofingos.dev/dashboard" class="cta">Open Your Dashboard →</a></p>
<p class="sub">Your phone: ${ownerPhone}<br>We'll text you a login link — no password needed.</p>
<hr>
<h3>Step 2 — Create your first job</h3>
<p>Call or text <strong>${twilioNumber}</strong> to start a job with your voice. Say the homeowner's name, address, and insurance carrier. We handle the rest.</p>
<hr>
<h3>Step 3 — Your homeowner gets the portal</h3>
<p>When you enter the homeowner's email, we send them a live project link instantly. They see every update. They stop calling.</p>
<hr>
<p>Questions? Reply to this email or text ${twilioNumber} anytime.</p>
<p style="margin-top:32px" class="sub">Zach Curtis<br>Roofing OS<br>roofingos.dev</p>
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
    enterprise: 299900,
    enterprise_inquiry: 0
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

  const twilioNumber = Deno.env.get('TWILIO_FROM_NUMBER') || Deno.env.get('TWILIO_PHONE_NUMBER') || '+17202921930';
  const firstName = (owner_name || '').split(' ')[0] || 'there';

  // Welcome call + email + SMS
  await Promise.allSettled([
    // Aria welcome call
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

    // Welcome email
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Zach Curtis <zach@nexuszc.com>',
        to: owner_email,
        subject: `Welcome to Roofing OS — here's how to get started`,
        html: generateWelcomeEmail(contractor)
      })
    }).catch(() => {}),

    // Welcome SMS (only if Twilio is configured)
    owner_phone && Deno.env.get('TWILIO_ACCOUNT_SID') ? (() => {
      const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
      const token = Deno.env.get('TWILIO_AUTH_TOKEN')!;
      return fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: owner_phone,
          From: twilioNumber,
          Body: `Hey ${firstName} — welcome to Roofing OS. Log in here: roofingos.dev/dashboard\nEnter this number when prompted. Any questions — reply here.`
        }).toString()
      }).catch(() => {});
    })() : Promise.resolve(),
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
    dashboard_url: `https://roofingos.dev/dashboard`
  });
});

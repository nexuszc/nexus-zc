import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'zach@roofingos.dev';
const FROM_NAME  = 'Zach from Roofing OS';

const ALLOWED_ORIGINS = new Set(['https://roofingos.dev', 'https://app.nexuszc.com']);

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://roofingos.dev';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

async function sendTelegram(msg: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4000), parse_mode: 'Markdown' })
  }).catch(() => {});
}

function generateWelcomeEmail(firstName: string, ownerName: string, email: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:40px 20px">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
          <tr>
            <td style="background:#0a0f1a;padding:32px 40px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">
                Roofing<span style="color:#4a9eff">OS</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:40px">
              <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6">Hey ${firstName},</p>
              <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6">Your Roofing OS account is live.</p>
              <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6">
                Login anytime at:<br>
                <a href="https://roofingos.dev/login" style="color:#4a9eff;text-decoration:none;font-weight:600">
                  roofingos.dev/login
                </a>
              </p>
              <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6">Questions? Text me: <a href="tel:7205006668" style="color:#4a9eff;text-decoration:none">(720) 500-6668</a></p>
              <p style="margin:0;font-size:16px;color:#374151;line-height:1.6">— Zach</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #f1f5f9;text-align:center">
              <p style="margin:0;font-size:13px;color:#9ca3af">
                Roofing OS · 1700 Lincoln St · Denver CO 80203
              </p>
              <p style="margin:8px 0 0;font-size:12px">
                <a href="https://roofingos.dev/unsubscribe?email=${encodeURIComponent(email)}"
                   style="color:#9ca3af;text-decoration:none">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req) });
  }

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'contractor-signup ready' }, { headers: corsHeaders(req) });

  const {
    company_name,
    owner_name,
    owner_email,
    owner_phone,
    primary_zip,
    plan = 'starter',
    referral_code,
    payment_method_id,
    audit_lead_id,
    ref_source,
    utm_campaign,
  } = body;

  const signupSource = ref_source || 'direct';

  if (!company_name || !owner_email) {
    return Response.json({ error: 'Company name and email required' }, { status: 400, headers: corsHeaders(req) });
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
    free: 0,
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
          await fetch(`https://api.stripe.com/v1/payment_methods/${payment_method_id}/attach`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stripeKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ customer: stripeCustomerId })
          });

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
      subscription_status: plan === 'free' ? 'active' : (payment_method_id ? 'trialing' : 'trialing'),
      trial_ends_at: trialEndsAt,
      referral_code: referralCode,
      referred_by_contractor_id: referredBy,
      subdomain,
      onboarding_step: 'account_created',
      signup_source: signupSource,
      signup_ref: utm_campaign || null,
    })
    .select()
    .single();

  if (!contractor) {
    return Response.json({ error: 'Failed to create account' }, { status: 500, headers: corsHeaders(req) });
  }

  // Fire-and-forget side effects
  void supabase.from('roofing_captures').insert({
    email: owner_email,
    name: owner_name || '',
    company: company_name,
    phone: owner_phone || '',
    ref_source: signupSource,
    utm_campaign: utm_campaign || null,
  });

  if (audit_lead_id) {
    void supabase.from('supplement_audit_leads')
      .update({ converted_to_contractor: true, contractor_account_id: contractor.id })
      .eq('id', audit_lead_id);
  }

  if (referredBy && referral_code) {
    void supabase.from('contractor_referrals').insert({
      referring_contractor_id: referredBy,
      referred_email: owner_email,
      referred_contractor_id: contractor.id,
      referral_code,
      status: 'signed_up'
    });
  }

  const twilioNumber = Deno.env.get('TWILIO_FROM_NUMBER') || Deno.env.get('TWILIO_PHONE_NUMBER') || '+17202921930';
  const firstName = (owner_name || '').split(' ')[0] || 'there';

  // Create auth user first so we can generate the magic link
  await supabase.auth.admin.createUser({
    email: owner_email,
    email_confirm: true,
  }).catch(() => {}); // ignore if already exists

  // Generate magic link pointing to our branded verify page
  let action_link: string | null = null;
  try {
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: owner_email,
      options: { redirectTo: 'https://roofingos.dev/auth/verify' },
    });
    action_link = linkData?.properties?.action_link || null;
  } catch { /* non-fatal */ }

  // Fire-and-forget welcome email (token already consumed by direct redirect)
  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      reply_to: 'zach@roofingos.dev',
      to: owner_email,
      subject: 'Welcome to Roofing OS!',
      html: generateWelcomeEmail(firstName, owner_name || '', owner_email),
    })
  }).catch(() => {});

  // Welcome call + SMS (parallel, non-blocking)
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
          Body: `Hey ${firstName} — welcome to Roofing OS. Check your email for a link to open your dashboard. Reply STOP to opt out.`
        }).toString()
      }).catch(() => {});
    })() : Promise.resolve(),
  ]);

  // Reminders + Telegram (fire and forget)
  void supabase.from('reminders').insert({
    chat_id: Deno.env.get('TELEGRAM_CHAT_ID'),
    message: `🎉 New contractor signed up: ${company_name} (${owner_email})\nCall to onboard: ${owner_phone || 'no phone'}\nPlan: ${plan}`,
    fire_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  });

  void sendTelegram(
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
    action_link,
  }, { headers: corsHeaders(req) });
});

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

async function verifyStripeSignature(payload: string, sig: string, secret: string): Promise<boolean> {
  const tPart = sig.split(',').find(p => p.startsWith('t='));
  const v1Part = sig.split(',').find(p => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  const timestamp = tPart.slice(2);
  const expectedSig = v1Part.slice(3);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const raw = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const computed = Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === expectedSig;
}

// Plan nickname → tier slug mapping
const TIER_MAP: Record<string, string> = {
  door: 'door', starter: 'door',
  taste: 'taste',
  revenue: 'revenue', pro: 'revenue',
  command: 'command', enterprise: 'command'
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('test') === 'true' || req.method === 'GET') {
    return Response.json({ ok: true, message: 'stripe-webhook ready' });
  }

  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature') || '';
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

  if (webhookSecret && sig) {
    const valid = await verifyStripeSignature(rawBody, sig, webhookSecret);
    if (!valid) return new Response('Invalid signature', { status: 400 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = event.type as string;
  const obj = (event.data as Record<string, unknown>)?.object as Record<string, unknown>;

  // Subscription created or updated
  if (eventType === 'customer.subscription.updated' || eventType === 'customer.subscription.created') {
    const customerId = obj?.customer as string;
    const status = obj?.status as string;
    const items = (obj?.items as Record<string, unknown>)?.data as Array<Record<string, unknown>>;
    const nickname = ((items?.[0]?.price as Record<string, unknown>)?.nickname as string || '').toLowerCase();
    const newPlan = TIER_MAP[nickname] || null;

    const updates: Record<string, unknown> = {
      subscription_status: status,
      stripe_subscription_id: obj?.id as string,
      updated_at: new Date().toISOString()
    };
    if (newPlan) updates.plan = newPlan;
    if (status === 'active') updates.status = 'active';
    if (status === 'canceled' || status === 'cancelled') updates.status = 'cancelled';

    await supabase.from('contractor_accounts')
      .update(updates)
      .eq('stripe_customer_id', customerId);

    await sendTelegram(`💳 Subscription ${status}: ${customerId}${newPlan ? ` → ${newPlan}` : ''}`);
  }

  // Successful payment — accumulate lifetime value
  if (eventType === 'invoice.paid') {
    const customerId = obj?.customer as string;
    const amountPaid = (obj?.amount_paid as number) || 0;

    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('id, total_subscription_paid_cents')
      .eq('stripe_customer_id', customerId)
      .single();

    if (contractor) {
      await supabase.from('contractor_accounts')
        .update({
          total_subscription_paid_cents: (contractor.total_subscription_paid_cents || 0) + amountPaid,
          subscription_status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', contractor.id);
    }
  }

  // Failed payment
  if (eventType === 'invoice.payment_failed') {
    const customerId = obj?.customer as string;
    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('owner_name, owner_phone, company_name')
      .eq('stripe_customer_id', customerId)
      .single();

    if (contractor) {
      await sendTelegram(
        `🚨 *Payment Failed: ${contractor.company_name}*\n` +
        `Customer: ${customerId}\n` +
        `Action: Call ${contractor.owner_name} at ${contractor.owner_phone || 'unknown'}`
      );

      if (contractor.owner_phone) {
        const firstName = (contractor.owner_name || '').split(' ')[0] || 'there';
        await sendSMS(
          contractor.owner_phone,
          `${firstName} — there was an issue with your Roofing OS payment. ` +
          `Reply PAY for a new link or call us to keep your account active.`
        );
      }
    }
  }

  // Trial ending soon (Stripe sends this 3 days before)
  if (eventType === 'customer.subscription.trial_will_end') {
    const customerId = obj?.customer as string;
    const trialEndTs = (obj?.trial_end as number) || 0;
    const daysLeft = Math.ceil((trialEndTs * 1000 - Date.now()) / (1000 * 60 * 60 * 24));

    const { data: contractor } = await supabase
      .from('contractor_accounts')
      .select('owner_name, owner_phone, company_name, plan')
      .eq('stripe_customer_id', customerId)
      .single();

    if (contractor?.owner_phone) {
      const firstName = (contractor.owner_name || '').split(' ')[0] || 'there';
      await sendSMS(
        contractor.owner_phone,
        `${firstName} — your Roofing OS trial ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}. ` +
        `No action needed if your card is on file. Questions? Reply HELP.`
      );
    }
  }

  // Subscription cancelled
  if (eventType === 'customer.subscription.deleted') {
    const customerId = obj?.customer as string;
    await supabase.from('contractor_accounts')
      .update({ status: 'cancelled', subscription_status: 'canceled', updated_at: new Date().toISOString() })
      .eq('stripe_customer_id', customerId);

    await sendTelegram(`❌ Subscription cancelled: ${customerId}`);
  }

  return Response.json({ ok: true, received: eventType });
});

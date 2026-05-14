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

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'contractor-churn-predictor ready' });

  const { data: contractors } = await supabase
    .from('contractor_accounts')
    .select('*')
    .eq('status', 'active');

  let highRiskCount = 0;

  for (const contractor of contractors || []) {
    let churnScore = 0;
    const reasons: string[] = [];

    // No login in 7+ days
    const daysSinceLogin = contractor.last_login_at
      ? (Date.now() - new Date(contractor.last_login_at).getTime()) / (1000 * 60 * 60 * 24)
      : 999;

    if (daysSinceLogin > 14) { churnScore += 30; reasons.push('No login in 14 days'); }
    else if (daysSinceLogin > 7) { churnScore += 15; reasons.push('No login in 7 days'); }

    // No jobs created
    if (!contractor.first_job_created_at) {
      churnScore += 25;
      reasons.push('No jobs created yet');
    }

    // Trial ending soon with no payment
    if (contractor.subscription_status === 'trialing' && contractor.trial_ends_at) {
      const daysUntilTrialEnd = (new Date(contractor.trial_ends_at).getTime() - Date.now()) /
        (1000 * 60 * 60 * 24);
      if (daysUntilTrialEnd < 3 && !contractor.stripe_subscription_id) {
        churnScore += 40;
        reasons.push(`Trial ends in ${Math.max(0, Math.round(daysUntilTrialEnd))} days — no payment method`);
      }
    }

    // No portal sent
    if (!contractor.first_portal_sent_at) {
      churnScore += 15;
      reasons.push('No homeowner portal sent yet');
    }

    // No supplement filed
    if (!contractor.first_supplement_at) {
      churnScore += 10;
      reasons.push('No supplement filed yet');
    }

    // Update churn score
    await supabase.from('contractor_accounts')
      .update({ churn_risk_score: churnScore, updated_at: new Date().toISOString() })
      .eq('id', contractor.id);

    // Alert if high risk
    if (churnScore >= 50) {
      highRiskCount++;
      await sendTelegram(
        `🚨 *Churn Risk: ${contractor.company_name}*\n` +
        `Score: ${churnScore}/100\n` +
        `Reasons:\n${reasons.map(r => `• ${r}`).join('\n')}\n\n` +
        `Action: VA should call ${contractor.owner_name} at ${contractor.owner_phone || 'unknown'}`
      );

      // Queue save attempt for very high risk with phone
      if (contractor.owner_phone && churnScore >= 70) {
        await fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            call_type: 'contractor_save',
            contact_phone: contractor.owner_phone,
            contact_name: contractor.owner_name,
            contact_type: 'at_risk_contractor',
            metadata: {
              company_name: contractor.company_name,
              reasons: reasons.join(', '),
              contractor_name: 'Roofing OS'
            }
          })
        }).catch(() => {});
      }
    }
  }

  return Response.json({
    ok: true,
    contractors_checked: (contractors || []).length,
    high_risk: highRiskCount
  });
});

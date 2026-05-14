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

async function sendEmail(to: string, subject: string, html: string) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: 'Roofing OS <reports@roofingos.dev>', to, subject, html })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'monthly-truth ready' });

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = lastMonth.toISOString().slice(0, 7);
  const lastMonthName = lastMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  // Support single contractor targeting
  const singleId = body.contractor_id || null;
  let query = supabase.from('contractor_accounts').select('*').eq('status', 'active');
  if (singleId) query = query.eq('id', singleId);
  const { data: contractors } = await query;

  let reported = 0;

  for (const contractor of contractors || []) {
    try {
      // Look up tier price separately (no FK relationship)
      const { data: tier } = await supabase
        .from('platform_tiers')
        .select('name, price_cents')
        .eq('slug', contractor.plan || 'door')
        .single();

      const { data: usage } = await supabase
        .from('contractor_monthly_usage')
        .select('total_jobs_created, supplements_submitted, supplements_approved, supplement_revenue_cents')
        .eq('contractor_id', contractor.id)
        .eq('month_year', lastMonthStr)
        .single();

      // Get supplement revenue through jobs (safe path since no direct contractor_id on supplement_packages)
      let suppRevenue = usage?.supplement_revenue_cents ? usage.supplement_revenue_cents / 100 : 0;

      if (!suppRevenue) {
        const { data: jobIds } = await supabase
          .from('roofing_jobs')
          .select('id')
          .eq('contractor_id', contractor.id)
          .eq('created_month', lastMonthStr);

        if (jobIds && jobIds.length > 0) {
          const ids = jobIds.map((j: { id: string }) => j.id);
          const { data: supplements } = await supabase
            .from('supplement_packages')
            .select('total_amount')
            .in('job_id', ids)
            .eq('status', 'approved')
            .catch(() => ({ data: null }));

          suppRevenue = ((supplements as Array<{ total_amount: number }> | null) || [])
            .reduce((sum, s) => sum + (s.total_amount || 0), 0);
        }
      }

      // Fall back to pre-computed ROI report if available
      const { data: existingReport } = await supabase
        .from('contractor_roi_reports')
        .select('supplement_revenue_cents')
        .eq('contractor_id', contractor.id)
        .eq('month', lastMonthStr)
        .single();

      if (existingReport?.supplement_revenue_cents && !suppRevenue) {
        suppRevenue = existingReport.supplement_revenue_cents / 100;
      }

      const tierPriceCents = tier?.price_cents || 29900;
      const subCost = tierPriceCents / 100;
      const jobsHandled = usage?.total_jobs_created || 0;
      const netGain = suppRevenue - subCost;
      const roiPct = subCost > 0 ? Math.round((netGain / subCost) * 100) : 0;

      // AI insight
      let insight = '';
      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 150,
            messages: [{
              role: 'user',
              content: `Roofing contractor monthly report. Jobs: ${jobsHandled}. Supplement revenue: $${suppRevenue.toLocaleString()}. Subscription: $${subCost}. ROI: ${roiPct}%. Write one direct sentence under 25 words: if ROI positive, make them feel it was worth it. If negative, create urgency to use more features. Be specific.`
            }]
          })
        });
        const aiData = await aiRes.json();
        insight = aiData.content?.[0]?.text?.trim() || '';
      } catch { /* fallback */ }

      if (!insight) {
        insight = suppRevenue > subCost
          ? `Your supplements returned ${Math.round(suppRevenue / subCost)}× your subscription cost this month.`
          : `${jobsHandled} jobs processed — activate supplements to flip this ROI positive next month.`;
      }

      // Upsert ROI report
      await supabase.from('contractor_roi_reports').upsert({
        contractor_id: contractor.id,
        month: lastMonthStr,
        jobs_handled: jobsHandled,
        supplement_revenue_cents: Math.round(suppRevenue * 100),
        roi_multiple: subCost > 0 ? suppRevenue / subCost : 0,
        net_gain_cents: Math.round(netGain * 100)
      }, { onConflict: 'contractor_id,month' }).catch(() => {});

      if (contractor.owner_phone) {
        await sendSMS(
          contractor.owner_phone,
          `📊 ${lastMonthName} | ${contractor.company_name}\n` +
          `Jobs: ${jobsHandled} | Supp revenue: $${Math.round(suppRevenue).toLocaleString()}\n` +
          `Subscription: $${subCost.toLocaleString()} | ROI: ${roiPct > 0 ? '+' : ''}${roiPct}%\n` +
          insight
        );
      }

      if (contractor.owner_email) {
        const roiColor = roiPct > 0 ? '#22c55e' : '#ef4444';
        await sendEmail(
          contractor.owner_email,
          `Your ${lastMonthName} ROI Report — ${contractor.company_name}`,
          `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <p style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">MONTHLY TRUTH</p>
  <h2 style="margin:0 0 24px 0;">${lastMonthName} Report</h2>
  <table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:10px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Jobs handled</td><td style="text-align:right;font-weight:600;border-bottom:1px solid #f1f5f9;">${jobsHandled}</td></tr>
    <tr><td style="padding:10px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Supplement revenue</td><td style="text-align:right;font-weight:600;border-bottom:1px solid #f1f5f9;">$${Math.round(suppRevenue).toLocaleString()}</td></tr>
    <tr><td style="padding:10px 0;color:#64748b;border-bottom:1px solid #f1f5f9;">Subscription cost</td><td style="text-align:right;font-weight:600;border-bottom:1px solid #f1f5f9;">$${subCost.toLocaleString()}</td></tr>
    <tr><td style="padding:10px 0;font-weight:700;">ROI</td><td style="text-align:right;font-weight:700;font-size:20px;color:${roiColor};">${roiPct > 0 ? '+' : ''}${roiPct}%</td></tr>
  </table>
  <div style="margin-top:20px;padding:16px;background:#f8fafc;border-radius:8px;border-left:3px solid #3b82f6;">
    <p style="margin:0;color:#1e293b;">${insight}</p>
  </div>
  <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
    <a href="https://roofingos.dev/contractor/${contractor.id}" style="color:#3b82f6;">View full dashboard</a> |
    <a href="https://roofingos.dev/unsubscribe?email=${encodeURIComponent(contractor.owner_email)}" style="color:#94a3b8;">Unsubscribe</a>
  </p>
</div>`
        );
      }

      reported++;
    } catch { /* skip, continue */ }
  }

  return Response.json({ ok: true, reports_sent: reported });
});

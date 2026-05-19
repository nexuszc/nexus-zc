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

function generateROIReportEmail(
  contractor: Record<string, unknown>,
  report: Record<string, unknown>,
  supplementRevenue: number,
  netGain: number,
  roiMultiple: number
): string {
  const name = (contractor.owner_name as string || '').split(' ')[0];
  const isPositive = netGain > 0;
  const subCost = contractor.plan_price_cents as number || 29900;

  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc; }
  .card { background: white; border-radius: 12px; padding: 32px; margin: 16px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .metric-value { font-size: 40px; font-weight: 800; color: ${isPositive ? '#16a34a' : '#ef4444'}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
  .stat { background: #f8fafc; border-radius: 8px; padding: 16px; }
  .stat-value { font-size: 24px; font-weight: 700; color: #0f172a; }
  .stat-label { color: #64748b; font-size: 12px; }
  .cta { background: #3b82f6; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 700; }
</style>
</head>
<body>
  <div class="card">
    <h2 style="margin:0 0 8px 0;">Your Monthly Report</h2>
    <p style="color:#64748b; margin:0;">${contractor.company_name as string} — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
    <div style="text-align:center; padding:24px 0; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; margin:24px 0;">
      <div style="color:#64748b;font-size:14px;font-weight:600;text-transform:uppercase;">Net gain from Roofing OS</div>
      <div class="metric-value">${isPositive ? '+' : ''}$${Math.abs(netGain / 100).toLocaleString()}</div>
      <div style="color:#64748b;font-size:13px;">$${(supplementRevenue / 100).toLocaleString()} recovered − $${(subCost / 100).toLocaleString()} subscription</div>
    </div>
    <div class="grid">
      <div class="stat">
        <div class="stat-value">${report.supplements_approved as number || 0}</div>
        <div class="stat-label">Supplements approved</div>
      </div>
      <div class="stat">
        <div class="stat-value">${Math.round((report.supplement_approval_rate as number || 0) * 100)}%</div>
        <div class="stat-label">Approval rate</div>
      </div>
      <div class="stat">
        <div class="stat-value">${report.homeowner_portals_sent as number || 0}</div>
        <div class="stat-label">Homeowner portals sent</div>
      </div>
      <div class="stat">
        <div class="stat-value">${Math.round((report.portal_open_rate as number || 0) * 100)}%</div>
        <div class="stat-label">Portal open rate</div>
      </div>
    </div>
    ${roiMultiple > 5 ? `
    <div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:8px;padding:16px;margin-top:16px;">
      <strong>🏆 ${Math.round(roiMultiple)}x ROI this month</strong><br>
      <span style="color:#64748b;">For every $1 you spend on Roofing OS you're getting $${roiMultiple.toFixed(1)} back.</span>
    </div>` : ''}
    <div style="text-align:center;margin-top:24px;">
      <a href="https://roofingos.dev/contractor/${contractor.id as string}" class="cta">View Full Dashboard</a>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px;">
      Your referral link: roofingos.dev/ref/${contractor.referral_code as string || ''}<br>
      Share with a contractor friend — they get 14 days free, you get a free month.
    </p>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'contractor-roi-engine ready' });

  const { contractor_id } = body;

  // Get active contractors (or specific one)
  let query = supabase
    .from('contractor_accounts')
    .select('*')
    .eq('status', 'active');

  if (contractor_id) query = query.eq('id', contractor_id);

  const { data: contractors } = await query;

  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);
  const periodStartStr = periodStart.toISOString().split('T')[0];
  const periodEndStr = new Date().toISOString().split('T')[0];

  let reportsGenerated = 0;

  for (const contractor of contractors || []) {
    // Get this month's jobs
    const { data: jobs } = await supabase
      .from('roofing_jobs')
      .select('id, status, contract_amount')
      .eq('contractor_id', contractor.id)
      .gte('created_at', periodStart.toISOString());

    const jobIds = (jobs || []).map(j => j.id);

    // Get supplement performance
    const { data: supplements } = jobIds.length > 0
      ? await supabase
          .from('supplement_packages')
          .select('status, supplement_approved_amount')
          .in('job_id', jobIds)
      : { data: [] };

    const supplementRevenue = (supplements || [])
      .filter(s => s.status === 'approved')
      .reduce((sum, s) => sum + (s.supplement_approved_amount || 0), 0);

    const supplementsApproved = (supplements || []).filter(s => s.status === 'approved').length;
    const supplementApprovalRate = (supplements || []).length > 0
      ? supplementsApproved / (supplements || []).length
      : 0;

    // Get portal engagement
    const { data: portals } = jobIds.length > 0
      ? await supabase
          .from('homeowner_sessions')
          .select('access_count')
          .in('job_id', jobIds)
      : { data: [] };

    const portalOpenRate = (portals || []).length > 0
      ? (portals || []).filter(p => (p.access_count || 0) > 0).length / (portals || []).length
      : 0;

    // Calculate ROI
    const subscriptionCost = contractor.plan_price_cents || 29900;
    const netGain = supplementRevenue - subscriptionCost;
    const roiMultiple = subscriptionCost > 0 ? supplementRevenue / subscriptionCost : 0;

    // Save report
    const { data: report } = await supabase
      .from('contractor_roi_reports')
      .insert({
        contractor_id: contractor.id,
        period_start: periodStartStr,
        period_end: periodEndStr,
        supplement_revenue_cents: supplementRevenue,
        jobs_completed: (jobs || []).filter(j => ['complete', 'paid'].includes(j.status)).length,
        supplements_filed: (supplements || []).length,
        supplements_approved: supplementsApproved,
        supplement_approval_rate: supplementApprovalRate,
        avg_supplement_per_job_cents: jobIds.length > 0
          ? Math.round(supplementRevenue / jobIds.length)
          : 0,
        subscription_cost_cents: subscriptionCost,
        net_gain_cents: netGain,
        roi_multiple: roiMultiple,
        homeowner_portals_sent: (portals || []).length,
        portal_open_rate: portalOpenRate,
        aria_calls_made: 0,
        aria_appointments_booked: 0
      })
      .select()
      .single();

    // Send ROI report email
    if (contractor.owner_email && report) {
      const emailHtml = generateROIReportEmail(contractor, report, supplementRevenue, netGain, roiMultiple);
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Roofing OS <reports@nexuszc.com>',
          to: contractor.owner_email,
          subject: roiMultiple > 5
            ? `Your Roofing OS ROI this month: ${Math.round(roiMultiple)}x`
            : `Your Roofing OS monthly report`,
          html: emailHtml
        })
      }).catch(() => {});

      await supabase.from('contractor_roi_reports')
        .update({ report_sent_at: new Date().toISOString() })
        .eq('id', report.id);

      reportsGenerated++;
    }

    // Alert on low ROI
    if (roiMultiple < 2 && contractor.onboarding_completed) {
      await sendTelegram(
        `⚠️ *Low ROI Alert*\n` +
        `Contractor: ${contractor.company_name}\n` +
        `ROI this month: ${roiMultiple.toFixed(1)}x\n` +
        `Supplement revenue: $${(supplementRevenue / 100).toLocaleString()}\n` +
        `Sub cost: $${(subscriptionCost / 100).toLocaleString()}\n` +
        `Action: VA should call and help them file more supplements.`
      );
    }
  }

  return Response.json({ ok: true, reports_generated: reportsGenerated });
});

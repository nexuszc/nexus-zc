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
  if (body.test) return Response.json({ ok: true, message: 'nexus-vertical-router ready' });

  const { cycle_number = 0 } = body;

  const { data: verticals } = await supabase
    .from('nexus_verticals')
    .select('*')
    .eq('status', 'active');

  const actions: string[] = [];

  for (const vertical of verticals || []) {
    const slug = vertical.slug;

    const call = async (fn: string, payload: object = {}) => {
      await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ vertical: slug, ...payload })
      }).catch(() => {});
    };

    // Storm detection
    if (
      vertical.storm_detection_enabled &&
      cycle_number % vertical.storm_detection_interval_cycles === 0
    ) {
      await call('roofing-prospector');
      actions.push(`${slug}: storm/prospect scan`);
    }

    // Prospect scan
    if (
      vertical.prospect_scan_enabled &&
      cycle_number % vertical.prospect_scan_interval_cycles === 0 &&
      cycle_number % vertical.storm_detection_interval_cycles !== 0
    ) {
      await call('roofing-prospector');
      actions.push(`${slug}: prospect scan`);
    }

    // QA
    if (cycle_number % vertical.qa_interval_cycles === 0) {
      await call('roofing-qa-bot');
      actions.push(`${slug}: QA run`);
    }

    // Self improve — weekly
    if (cycle_number % vertical.self_improve_interval_cycles === 0 && cycle_number > 0) {
      await call('roofing-self-improve');
      actions.push(`${slug}: self improve`);
    }

    // Weekly report — Monday 7am MT = 14:00 UTC
    const now = new Date();
    if (
      vertical.weekly_report_enabled &&
      now.getUTCDay() === 1 &&
      now.getUTCHours() === 14 &&
      cycle_number % 2 === 0
    ) {
      await call('roofing-weekly-report');
      actions.push(`${slug}: weekly report`);
    }

    // Depreciation scan — daily
    if (cycle_number % 48 === 0) {
      await call('roofing-depreciation-tracker', { action: 'scan' });
      actions.push(`${slug}: depreciation scan`);
    }

    // ROI reports — 1st of month at noon UTC
    if (now.getUTCDate() === 1 && now.getUTCHours() === 12 && cycle_number % 2 === 0) {
      await call('contractor-roi-engine');
      actions.push(`${slug}: ROI reports`);
    }

    // Competitive intel — weekly Friday
    if (now.getUTCDay() === 5 && now.getUTCHours() === 15 && cycle_number % 2 === 0) {
      await call('contractor-competitive-engine');
      actions.push(`${slug}: competitive intel`);
    }

    // Churn prediction — daily
    if (cycle_number % 48 === 24) {
      await call('contractor-churn-predictor');
      actions.push(`${slug}: churn scan`);
    }
  }

  return Response.json({ ok: true, cycle: cycle_number, actions });
});

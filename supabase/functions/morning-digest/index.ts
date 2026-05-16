// morning-digest v2
// 1. SMS digest to active contractor accounts (contractor stats, storms, supplements)
// 2. Lead Gen Machine owner intelligence via Telegram (whales, hot opens, pipeline)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: 'Markdown' })
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
  if (body.test) return Response.json({ ok: true, message: 'morning-digest ready' });

  // Support targeting a single contractor for on-demand digest
  const singleContractorId = body.contractor_id || null;

  let query = supabase
    .from('contractor_accounts')
    .select('id, company_name, owner_name, owner_phone, plan, primary_zip, service_zips')
    .eq('status', 'active')
    .not('owner_phone', 'is', null);

  if (singleContractorId) {
    query = query.eq('id', singleContractorId);
  }

  const { data: contractors } = await query;
  let sent = 0;

  for (const contractor of contractors || []) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const currentMonth = today.slice(0, 7);

      const { count: jobsToday } = await supabase
        .from('roofing_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('contractor_id', contractor.id)
        .gte('created_at', today + 'T00:00:00');

      const { data: usage } = await supabase
        .from('contractor_monthly_usage')
        .select('total_jobs_created, supplements_submitted')
        .eq('contractor_id', contractor.id)
        .eq('month_year', currentMonth)
        .single();

      // Open supplement packages
      const { count: openSupplements } = await supabase
        .from('supplement_packages')
        .select('id', { count: 'exact', head: true })
        .eq('contractor_id', contractor.id)
        .not('status', 'in', '("approved","closed","denied")');

      // Storm alerts in service area (last 48 hours)
      const serviceZips: string[] = contractor.service_zips || (contractor.primary_zip ? [contractor.primary_zip] : []);
      let stormLine = '✅ No new storms in your area';

      if (serviceZips.length > 0) {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: storms } = await supabase
          .from('hail_events')
          .select('zip_code, hail_size_inches, event_date')
          .in('zip_code', serviceZips)
          .gte('event_date', cutoff)
          .order('event_date', { ascending: false })
          .limit(1)
          .catch(() => ({ data: null }));

        const stormList = (storms as Array<{ zip_code: string; hail_size_inches: number }> | null) || [];
        if (stormList.length > 0) {
          stormLine = `⛈️ Storm: ${stormList[0].hail_size_inches}" hail in ${stormList[0].zip_code} — check call list`;
        }
      }

      const firstName = (contractor.owner_name || '').split(' ')[0] || 'there';
      const jobsThisMonth = usage?.total_jobs_created || 0;
      const suppOpen = openSupplements || 0;

      let actionLine = 'No action needed today.';
      if (stormLine.startsWith('⛈️')) {
        actionLine = 'Storm leads available — prioritize outreach now.';
      } else if (suppOpen > 3) {
        actionLine = `${suppOpen} open supplements need follow-up.`;
      } else if (jobsThisMonth === 0) {
        actionLine = 'No jobs this month yet. Reply HELP to fill pipeline.';
      }

      const message = [
        `☀️ Good morning ${firstName}.`,
        `📋 ${jobsToday || 0} new job${jobsToday !== 1 ? 's' : ''} today | ${jobsThisMonth} this month`,
        `📄 ${suppOpen} open supplement${suppOpen !== 1 ? 's' : ''}`,
        stormLine,
        `→ ${actionLine}`
      ].join('\n');

      await sendSMS(contractor.owner_phone, message);
      sent++;
    } catch { /* skip, continue */ }
  }

  // ── Owner intelligence: Lead Gen Machine Telegram digest ──────────────────
  if (!body.contractor_id) {
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [
        { data: prospects },
        { data: recentLogs },
        { data: whales },
        { data: hotOpens },
      ] = await Promise.all([
        supabase.from('roofing_prospects').select('id, in_sequence, outcome, whale_alerted'),
        supabase.from('roofing_outreach_log')
          .select('id, opened, delivered, bounced')
          .eq('direction', 'outbound')
          .gte('created_at', since24h),
        supabase.from('roofing_prospects')
          .select('owner_name, company_name, phone, whale_alerted_at')
          .eq('whale_alerted', true)
          .is('outcome', null)
          .order('whale_alerted_at', { ascending: false })
          .limit(5),
        supabase.from('roofing_outreach_log')
          .select('id, prospect_id, touch_number, open_count, last_opened_at')
          .gte('open_count', 2)
          .order('open_count', { ascending: false })
          .limit(5),
      ]);

      const all = prospects || [];
      const inSeq = all.filter(p => p.in_sequence).length;
      const booked = all.filter(p => p.outcome === 'booked').length;
      const whaleCount = (whales || []).length;
      const logs = recentLogs || [];
      const sent24 = logs.length;
      const opened24 = logs.filter(l => l.opened).length;
      const openRate = sent24 > 0 ? Math.round(opened24 / sent24 * 100) : 0;

      const lines: string[] = [
        `📊 *Lead Gen Machine — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}*`,
        ``,
        `🔄 ${inSeq} in sequence · 📅 ${booked} booked`,
        `📧 ${sent24} emails yesterday · ${openRate}% open rate`,
      ];

      if (whaleCount > 0) {
        lines.push(``, `🐋 *Call these whales today:*`);
        for (const w of (whales || [])) {
          lines.push(`• ${w.owner_name} (${w.company_name}) — ${w.phone || 'no phone'}`);
        }
      }

      if ((hotOpens || []).length > 0) {
        lines.push(``, `🔥 *Re-reading emails:*`);
        for (const h of (hotOpens || [])) {
          lines.push(`• Touch ${h.touch_number} opened ${h.open_count}x`);
        }
      }

      if (whaleCount === 0 && (hotOpens || []).length === 0) {
        lines.push(``, `✅ No whales or hot opens right now.`);
      }

      await tg(lines.join('\n'));
    } catch (e) {
      console.error('Owner digest error:', e);
    }
  }

  return Response.json({ ok: true, digests_sent: sent });
});

// morning-digest v4
// 1. SMS digest to active contractor accounts
// 2. Lean owner Telegram digest: whales, email, Aria, content, one action

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

function timeAgo(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'morning-digest ready' });

  const singleContractorId = body.contractor_id || null;

  // ── Contractor SMS loop (unchanged) ───────────────────────────────────────
  let query = supabase
    .from('contractor_accounts')
    .select('id, company_name, owner_name, owner_phone, plan, primary_zip, service_zips')
    .eq('status', 'active')
    .not('owner_phone', 'is', null);

  if (singleContractorId) query = query.eq('id', singleContractorId);

  const { data: contractors } = await query;
  let sent = 0;

  for (const contractor of contractors || []) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const currentMonth = today.slice(0, 7);

      const { count: jobsToday } = await supabase
        .from('roofing_jobs').select('id', { count: 'exact', head: true })
        .eq('contractor_id', contractor.id).gte('created_at', today + 'T00:00:00');

      const { data: usage } = await supabase
        .from('contractor_monthly_usage').select('total_jobs_created, supplements_submitted')
        .eq('contractor_id', contractor.id).eq('month_year', currentMonth).single();

      const { count: openSupplements } = await supabase
        .from('supplement_packages').select('id', { count: 'exact', head: true })
        .eq('contractor_id', contractor.id).not('status', 'in', '("approved","closed","denied")');

      const serviceZips: string[] = contractor.service_zips || (contractor.primary_zip ? [contractor.primary_zip] : []);
      let stormLine = '✅ No new storms in your area';

      if (serviceZips.length > 0) {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: storms } = await supabase.from('hail_events')
          .select('zip_code, hail_size_inches').in('zip_code', serviceZips)
          .gte('event_date', cutoff).order('event_date', { ascending: false }).limit(1)
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
      if (stormLine.startsWith('⛈️')) actionLine = 'Storm leads available — prioritize outreach now.';
      else if (suppOpen > 3) actionLine = `${suppOpen} open supplements need follow-up.`;
      else if (jobsThisMonth === 0) actionLine = 'No jobs this month yet. Reply HELP to fill pipeline.';

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

  // ── Owner Telegram digest ──────────────────────────────────────────────────
  if (!body.contractor_id) {
    try {
      const now = new Date();
      const since24h = new Date(Date.now() - 86400000).toISOString();
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const [
        { data: whales },
        { data: recentLogs },
        { data: touchesToday },
        { count: ariaQueued },
        { count: contentPending },
        { data: visitRow },
        { count: signupsYesterday },
      ] = await Promise.all([
        supabase.from('roofing_prospects')
          .select('owner_name, company_name, phone, last_activity_at')
          .eq('clicked', true).is('outcome', null)
          .order('last_activity_at', { ascending: false }).limit(3),
        supabase.from('roofing_outreach_log')
          .select('id, opened, delivered').eq('direction', 'outbound').gte('created_at', since24h),
        supabase.from('roofing_prospects')
          .select('id').eq('in_sequence', true).is('outcome', null)
          .not('last_touch_at', 'is', null).limit(100),
        supabase.from('aria_call_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
        supabase.from('roofing_content').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('roofing_page_visits').select('visits').eq('date', yesterday).eq('page', '/').maybeSingle(),
        supabase.from('roofing_captures').select('id', { count: 'exact', head: true }).gte('created_at', yesterday + 'T00:00:00'),
      ]);

      const wList = whales || [];
      const logs = recentLogs || [];
      const emailSent = logs.length;
      const emailOpened = logs.filter(l => l.opened).length;
      const openRate = emailSent > 0 ? Math.round(emailOpened / emailSent * 100) : 0;
      const touchCount = (touchesToday || []).length;
      const queuedCalls = ariaQueued || 0;
      const pendingContent = contentPending || 0;
      const visits = (visitRow as { visits?: number } | null)?.visits || 0;
      const signups = signupsYesterday || 0;
      const convRate = visits > 0 ? Math.round(signups / visits * 100) : 0;

      const dayStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

      // Derive one most urgent action
      let oneThing: string;
      if (wList.length > 0) {
        const w = wList[0];
        const t = w.last_activity_at ? timeAgo(w.last_activity_at) : '?';
        oneThing = `Call ${w.owner_name} — clicked ${t} ago`;
      } else if (queuedCalls > 0) {
        oneThing = `${queuedCalls} Aria calls queued — run them`;
      } else if (pendingContent > 0) {
        oneThing = `Approve ${pendingContent} content piece${pendingContent !== 1 ? 's' : ''}`;
      } else if (touchCount > 0) {
        oneThing = `${touchCount} sequence touches fire today`;
      } else {
        oneThing = 'Pipeline looks quiet — check Brain for next move';
      }

      const lines: string[] = [
        `☀️ *Good morning Zach — ${dayStr}*`,
        ``,
      ];

      if (wList.length > 0) {
        lines.push(`🐋 *Whales to call: ${wList.length}*`);
        for (const w of wList) {
          const t = w.last_activity_at ? timeAgo(w.last_activity_at) : '?';
          lines.push(`   ${w.owner_name} — ${w.company_name || '—'} — clicked ${t} ago`);
        }
        lines.push(``);
      } else {
        lines.push(`🐋 No portal clicks yet today`);
        lines.push(``);
      }

      lines.push(`📧 *Email:* ${emailSent} sent · ${emailOpened} opened · ${openRate}% rate`);
      if (touchCount > 0) lines.push(`   Touch fires today for ${touchCount} prospect${touchCount !== 1 ? 's' : ''}`);
      lines.push(``);

      lines.push(`📞 *Aria:* ${queuedCalls} call${queuedCalls !== 1 ? 's' : ''} queued`);
      lines.push(``);

      if (pendingContent > 0) {
        lines.push(`🎬 *Content:* ${pendingContent} script${pendingContent !== 1 ? 's' : ''} need approval`);
        lines.push(`   → app.nexuszc.com/roofing/content`);
        lines.push(``);
      }

      lines.push(`🚀 *Growth:* ${visits} visits · ${signups} signups · ${convRate}% conversion`);
      lines.push(``);
      lines.push(`⚡ *One thing:* ${oneThing}`);

      await tg(lines.join('\n'));
    } catch (e) {
      console.error('Owner digest error:', e);
    }
  }

  await supabase.from('system_heartbeats').insert({
    function_name: 'morning-digest',
    status: 'ok',
    response_ms: 0,
    metadata: { contractor_sms_sent: sent },
    recorded_at: new Date().toISOString(),
  }).catch(() => {});

  return Response.json({ ok: true, digests_sent: sent });
});

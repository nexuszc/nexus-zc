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

  return Response.json({ ok: true, digests_sent: sent });
});

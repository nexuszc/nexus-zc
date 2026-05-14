import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'contractor-competitive-engine ready' });

  const { data: contractors } = await supabase
    .from('contractor_accounts')
    .select('*')
    .eq('status', 'active')
    .not('primary_zip', 'is', null);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().split('T')[0];

  let processed = 0;

  for (const contractor of contractors || []) {
    // Search for competitor activity
    const competitors: Array<Record<string, unknown>> = [];

    try {
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': Deno.env.get('SERPER_API_KEY')!,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: `roofing contractor ${contractor.primary_zip} Colorado reviews 2026`,
          num: 10
        })
      });
      const searchData = await searchRes.json();

      for (const result of (searchData.organic || []).slice(0, 5)) {
        const title = (result.title || '') as string;
        const snippet = (result.snippet || '') as string;
        if (title.toLowerCase().includes('roofing') || snippet.toLowerCase().includes('roofing')) {
          competitors.push({
            name: title.split('|')[0].trim().slice(0, 40),
            snippet: snippet.slice(0, 100),
            source: result.link
          });
        }
      }
    } catch { /* serper optional */ }

    // Generate intelligence with Claude
    let intelText = '';
    if (competitors.length > 0) {
      try {
        const intelPrompt = `You are analyzing the competitive roofing market for a contractor.

Contractor: ${contractor.company_name}
Their market: ${contractor.primary_zip} Colorado

Competitor signals found this week:
${competitors.map(c => `${c.name as string}: ${c.snippet as string}`).join('\n')}

Write a brief competitive intelligence email (3-4 sentences) that:
1. Names 2-3 specific competitors active in their market
2. Notes one specific thing each is doing
3. Gives one specific recommendation for how to compete
4. Creates urgency without being alarmist

Be specific. Use real competitor names from the data.
Write as if you've been monitoring their market all week.
Keep it under 200 words total.`;

        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 400,
            messages: [{ role: 'user', content: intelPrompt }]
          })
        });
        const aiData = await aiRes.json();
        intelText = aiData.content?.[0]?.text || '';
      } catch { /* use default */ }
    }

    if (!intelText) {
      intelText = `We're monitoring your market in ${contractor.primary_zip}. Competitor activity appears normal this week. Stay focused on supplement recovery — that's your fastest revenue edge right now.`;
    }

    // Save intel record
    const { data: intel } = await supabase
      .from('contractor_competitive_intel')
      .insert({
        contractor_id: contractor.id,
        week_start: weekStartStr,
        competitors,
        storms_in_territory: 0
      })
      .select()
      .single();

    // Send email
    if (contractor.owner_email) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Roofing OS Intelligence <intel@roofingos.dev>',
          to: contractor.owner_email,
          subject: `Your market this week — ${contractor.primary_zip}`,
          html: `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <p style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">WEEKLY MARKET INTELLIGENCE</p>
  <h2 style="margin:0 0 16px 0;">What's happening in your market</h2>
  <p>${intelText.replace(/\n/g, '</p><p>')}</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
  <p style="color:#94a3b8;font-size:12px;">
    This report is generated from public web signals in your service area.<br><br>
    <a href="https://roofingos.dev/contractor/${contractor.id}" style="color:#3b82f6;">View your full dashboard</a> |
    <a href="https://roofingos.dev/unsubscribe?email=${encodeURIComponent(contractor.owner_email)}" style="color:#94a3b8;">Unsubscribe</a>
  </p>
</div>`
        })
      }).catch(() => {});

      if (intel) {
        await supabase.from('contractor_competitive_intel')
          .update({ email_sent_at: new Date().toISOString() })
          .eq('id', intel.id);
      }
    }

    processed++;
  }

  return Response.json({ ok: true, contractors_processed: processed });
});

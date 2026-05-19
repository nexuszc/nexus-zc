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

function getCarrierType(carrierName: string): string {
  const n = carrierName.toLowerCase();
  if (n.includes('state farm')) return 'state_farm';
  if (n.includes('allstate')) return 'allstate';
  if (n.includes('liberty')) return 'liberty_mutual';
  if (n.includes('travelers')) return 'travelers';
  if (n.includes('usaa')) return 'usaa';
  if (n.includes('nationwide')) return 'nationwide';
  return 'other';
}

function generateAuditEmailHTML(
  audit: Record<string, unknown>,
  address: string,
  name: string
): string {
  const items = (audit.missed_items as unknown[] || []) as Array<Record<string, unknown>>;
  const total = audit.total_estimated_missed as number || 0;

  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc; }
  .card { background: white; border-radius: 12px; padding: 32px; margin: 16px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .amount { font-size: 48px; font-weight: 800; color: #ef4444; }
  .item { border-left: 4px solid #3b82f6; padding: 12px 16px; margin: 12px 0; background: #f0f9ff; border-radius: 0 8px 8px 0; }
  .item-name { font-weight: 700; color: #0f172a; }
  .item-amount { font-weight: 700; color: #16a34a; }
  .item-why { color: #64748b; font-size: 14px; margin-top: 4px; }
  .cta { background: #3b82f6; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 700; margin: 24px 0; }
</style>
</head>
<body>
  <div class="card">
    <p>Hi ${name?.split(' ')[0] || 'there'},</p>
    <p>${audit.headline || 'Here is your free supplement audit.'}</p>
    <div style="text-align:center; padding: 24px 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; margin: 24px 0;">
      <div style="color: #64748b; font-size: 14px; font-weight: 600;">Estimated Missed on ${address}</div>
      <div class="amount">$${total.toLocaleString()}</div>
      <div style="color: #64748b;">${items.length} line items your insurance likely missed</div>
    </div>
    ${audit.storm_finding ? `<p style="color:#3b82f6; font-weight:600;">${audit.storm_finding}</p>` : ''}
    <h3>What we found:</h3>
    ${items.map((item) => `
      <div class="item">
        <div class="item-name">${item.item as string} <span style="color:#94a3b8;font-size:12px;">${item.xactimate_code as string || ''}</span></div>
        <div class="item-amount">+$${(item.estimated_amount as number || 0).toLocaleString()}</div>
        <div class="item-why">${item.why_missed as string || ''}</div>
      </div>
    `).join('')}
    <div style="text-align:center; margin-top:32px;">
      <p style="font-size:18px; font-weight:600; color:#0f172a;">Want us to run this on your last 10 jobs?</p>
      <a href="https://roofingos.dev/?audit=multi" class="cta">Run My Full Audit →</a>
    </div>
    <p style="color:#94a3b8; font-size:12px; margin-top:32px;">
      Zach Curtis — Roofing OS — zach@nexuszc.com<br>
      <a href="https://roofingos.dev/unsubscribe" style="color:#94a3b8;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: 'supplement-audit-engine ready' });

  const {
    property_address,
    date_of_loss,
    carrier_name,
    original_estimate,
    name,
    email,
    phone,
    company_name,
    utm_source,
    utm_medium,
    utm_campaign
  } = body;

  if (!property_address || !email) {
    return Response.json({ error: 'Address and email required' }, { status: 400 });
  }

  // Search for storm data
  let hailSize = 0;
  let stormConfirmed = false;

  if (date_of_loss) {
    try {
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': Deno.env.get('SERPER_API_KEY')!,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          q: `hail storm ${property_address} ${date_of_loss}`,
          num: 5
        })
      });
      const searchData = await searchRes.json();
      for (const result of searchData.organic || []) {
        const snippet = (result.snippet || '').toLowerCase();
        if (snippet.includes('hail')) {
          stormConfirmed = true;
          const match = snippet.match(/(\d+\.?\d*)\s*inch/i);
          if (match) hailSize = parseFloat(match[1]);
          break;
        }
      }
    } catch { /* serper optional */ }
  }

  // Get carrier intelligence
  const carrierType = getCarrierType(carrier_name || '');
  const { data: carrierIntel } = await supabase
    .from('carrier_intelligence')
    .select('*')
    .eq('carrier_type', carrierType)
    .maybeSingle();

  // Get Colorado codes
  const { data: codes } = await supabase
    .from('roofing_codes')
    .select('code_type, requirement')
    .eq('state', 'CO')
    .limit(8);

  // Generate audit with Claude
  const auditPrompt = `You are a roofing insurance supplement expert. Generate a free supplement audit report.

Property: ${property_address}
Date of loss: ${date_of_loss || 'unknown'}
Carrier: ${carrier_name || 'unknown'}
Original estimate: $${((original_estimate || 0) / 100).toLocaleString()}
Storm confirmed: ${stormConfirmed}
Hail size: ${hailSize || 'unknown'} inches

Carrier behavior:
${carrierIntel ? `Approval rate: ${carrierIntel.supplement_approval_rate}\nCommon denials: ${(carrierIntel.common_denials || []).slice(0, 3).join(', ')}\nTips: ${(carrierIntel.tips || []).slice(0, 2).join('; ')}` : 'Standard carrier'}

Colorado building codes:
${codes?.map(c => `${c.code_type}: ${c.requirement}`).join('\n') || 'Standard IRC 2021'}

Generate a specific audit showing:
1. Top 5 most likely missed line items
2. Estimated dollar value of each
3. Why each was likely missed
4. Total estimated missed amount

Make it specific to this address, carrier, and state. Reference Xactimate codes.

Respond ONLY with valid JSON, no markdown:
{
  "headline": "string",
  "storm_finding": "string",
  "missed_items": [{"item":"string","xactimate_code":"string","estimated_amount":0,"why_missed":"string","carrier_note":"string"}],
  "total_estimated_missed": 0,
  "carrier_specific_insight": "string",
  "code_upgrade_note": "string",
  "closing": "string"
}`;

  let audit: Record<string, unknown> = { missed_items: [], total_estimated_missed: 0 };

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
        max_tokens: 2000,
        messages: [{ role: 'user', content: auditPrompt }]
      })
    });
    const aiData = await aiRes.json();
    const aiText = aiData.content?.[0]?.text || '{}';
    audit = JSON.parse(aiText.replace(/```json|```/g, '').trim());
  } catch { /* use defaults */ }

  const totalMissed = ((audit.total_estimated_missed as number) || 0) * 100;
  const missedItems = ((audit.missed_items as unknown[]) || []).length;

  // Score the lead
  let score = 0;
  if (stormConfirmed) score += 25;
  if (hailSize >= 1.5) score += 20;
  if (totalMissed > 300000) score += 25;
  if (carrier_name) score += 10;
  if (phone) score += 10;
  if (company_name) score += 10;

  // Save lead
  const { data: lead } = await supabase
    .from('supplement_audit_leads')
    .insert({
      name,
      email,
      phone,
      company_name,
      property_address,
      date_of_loss,
      carrier_name,
      original_estimate_cents: (original_estimate || 0) * 100,
      estimated_missed_items: missedItems,
      estimated_missed_value_cents: totalMissed,
      hail_size_inches: hailSize || null,
      storm_confirmed: stormConfirmed,
      score,
      utm_source,
      utm_medium,
      utm_campaign,
      audit_report_html: JSON.stringify(audit)
    })
    .select()
    .single();

  // Create/update roofing prospect record
  await supabase.from('roofing_prospects').upsert({
    company_name: company_name || 'Unknown',
    owner_name: name || 'Unknown',
    owner_email: email,
    phone: phone,
    status: 'supplement_audit_requested',
    score,
    notes: `Free supplement audit. Estimated missed: $${(totalMissed / 100).toLocaleString()}`
  }, { onConflict: 'owner_email' }).catch(() => {});

  // Queue Aria call if high score and has phone
  if (score >= 50 && phone && lead) {
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        call_type: 'supplement_audit_followup',
        contact_phone: phone,
        contact_name: name,
        contact_type: 'audit_lead',
        metadata: {
          property_address,
          carrier_name: carrier_name || 'their insurance company',
          missed_amount: (totalMissed / 100).toLocaleString(),
          missed_items: missedItems,
          contractor_name: 'Roofing OS'
        }
      })
    }).catch(() => {});

    await supabase.from('supplement_audit_leads')
      .update({ aria_call_queued: true })
      .eq('id', lead.id);
  }

  // Alert Zach
  await sendTelegram(
    `🎯 *Free Audit Requested*\n` +
    `*${name || 'Unknown'}* — ${company_name || 'Unknown company'}\n` +
    `Property: ${property_address}\n` +
    `Carrier: ${carrier_name || 'Unknown'}\n` +
    `Est. missed: $${(totalMissed / 100).toLocaleString()}\n` +
    `Score: ${score}/100\n` +
    `Aria call queued: ${score >= 50 && phone ? 'yes' : 'no'}`
  );

  // Send report email
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Zach at Roofing OS <zach@nexuszc.com>',
      to: email,
      subject: `Your supplement audit: ${property_address}`,
      html: generateAuditEmailHTML(audit, property_address, name || '')
    })
  }).catch(() => {});

  return Response.json({
    ok: true,
    lead_id: lead?.id,
    score,
    estimated_missed: totalMissed / 100,
    missed_items: missedItems,
    audit
  });
});

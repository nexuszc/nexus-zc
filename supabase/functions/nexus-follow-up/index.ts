import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const BLAND_API_KEY = Deno.env.get("BLAND_API_KEY") || "";
const CALENDLY_LINK = Deno.env.get("CALENDLY_LINK") || "https://calendly.com/zach-nexuszc/30min";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SEQUENCE = [
  { touch: 1, days_after: 0, channel: "email", angle: "report_delivery" },
  { touch: 2, days_after: 1, channel: "email", angle: "open_check" },
  { touch: 3, days_after: 2, channel: "email", angle: "specific_insight" },
  { touch: 4, days_after: 3, channel: "email", angle: "competitor_intel" },
  { touch: 5, days_after: 5, channel: "email", angle: "case_study" },
  { touch: 6, days_after: 7, channel: "voice", angle: "bland_call" },
  { touch: 7, days_after: 10, channel: "email", angle: "urgency" },
  { touch: 8, days_after: 14, channel: "email", angle: "final_touch" },
  { touch: 9, days_after: 21, channel: "email", angle: "nurture_monthly" },
  { touch: 10, days_after: 90, channel: "email", angle: "fresh_diagnostic" }
];

async function claude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 600, messages: [{ role: "user", content: prompt }] })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return { skipped: true };
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Zach Curtis <zach@nexuszc.com>", to, subject, html })
  }).then(r => r.json());
}

async function generateContent(diagnostic: Record<string, unknown>, angle: string): Promise<{ subject: string; html: string }> {
  const d = diagnostic as any;

  if (angle === "report_delivery") {
    return {
      subject: `Your Nexus Score: ${d.nexus_score}/100 — ${d.business_name}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <p>Hi ${d.owner_name || "there"},</p>
        <p>Your Nexus diagnostic for <strong>${d.business_name}</strong> is complete.</p>
        <p style="font-size:32px;font-weight:bold;color:#1a1a1a">Nexus Score: ${d.nexus_score}/100</p>
        <p>We identified approximately <strong>$${(d.estimated_revenue_leakage || 0).toLocaleString()}/year</strong> in potential improvements.</p>
        <p><a href="https://nexuszc.com/report/${d.slug}" style="background:#1a1a1a;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;margin:16px 0">View Your Full Report →</a></p>
        <p style="color:#888;font-size:13px">Access code: <strong>${d.report_password}</strong></p>
        <p>— Zach | Nexus</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="font-size:11px;color:#aaa">Nexus ZC LLC, 2812 11th Street, Boulder CO 80304<br>
        <a href="https://nexuszc.com/unsubscribe?email=${encodeURIComponent(d.owner_email)}" style="color:#aaa">Unsubscribe</a></p>
      </div>`
    };
  }

  const angles: Record<string, string> = {
    open_check: `Write a short email asking if ${d.owner_name || "they"} had a chance to view their Nexus diagnostic report for ${d.business_name}. Their score was ${d.nexus_score}/100. Include report link: nexuszc.com/report/${d.slug} (password: ${d.report_password}). 2-3 sentences max. Feel like a quick check-in from a real person, not a marketing email.`,
    specific_insight: `Write a short personalized email sharing one specific insight from a ${d.industry} business diagnostic. Their biggest stated challenge was: "${d.intake_biggest_fix}". Reference this directly and show how their Nexus Score of ${d.nexus_score}/100 connects to it. Include report link. 3-4 sentences.`,
    competitor_intel: `Write a short email to a ${d.industry} business owner sharing one competitive intelligence insight relevant to their industry. Make it feel timely and useful. Mention their diagnostic report has competitor comparison. Report: nexuszc.com/report/${d.slug}. Keep it under 100 words.`,
    case_study: `Write a short email with a brief anonymized case study of a ${d.industry} business that improved after implementing Nexus recommendations. Results-focused. Include: nexuszc.com/report/${d.slug} as CTA. Keep it punchy — under 120 words.`,
    urgency: `Write a final urgency email for a ${d.industry} business prospect. Their cost of inaction: "${d.intake_urgency || "continued loss"}". Offer one free 30-minute strategy call. Calendly: ${CALENDLY_LINK}. Under 100 words. Not pushy.`,
    final_touch: `Write a soft final email. Keep a door open. Mention the report is still available: nexuszc.com/report/${d.slug}. Under 75 words. No pressure.`,
    nurture_monthly: `Write a brief monthly check-in email for ${d.business_name}. Offer a fresh angle on their industry. Keep it educational and genuine. Under 100 words.`,
    fresh_diagnostic: `Write a 90-day re-engagement email for ${d.business_name}. A lot changes in 3 months. Offer a fresh diagnostic. Make it feel relevant and timely. Under 100 words.`
  };

  const prompt = `${angles[angle] || angles.open_check}

CAN-SPAM rules: include physical address and unsubscribe link in footer.
From: Zach | Nexus | zach@nexuszc.com
Footer: Nexus ZC LLC, 2812 11th Street, Boulder CO 80304 | <a href="https://nexuszc.com/unsubscribe?email=${encodeURIComponent(d.owner_email)}">Unsubscribe</a>

Respond with JSON only (no markdown): { "subject": "...", "html": "..." }`;

  const response = await claude(prompt);
  try {
    return JSON.parse(response.replace(/```json|```/g, "").trim());
  } catch {
    return { subject: `Following up — ${d.business_name}`, html: `<p>Hi ${d.owner_name || "there"}, just following up on your Nexus diagnostic. <a href="https://nexuszc.com/report/${d.slug}">View your report here</a>.</p><p style="font-size:11px;color:#aaa">Nexus ZC LLC, 2812 11th Street, Boulder CO 80304 | <a href="https://nexuszc.com/unsubscribe?email=${encodeURIComponent(d.owner_email)}">Unsubscribe</a></p>` };
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, test: true });

  const now = new Date();
  let sent = 0;

  const { data: diagnostics } = await supabase
    .from("nexus_diagnostics")
    .select("*, nexus_outreach_log(*)")
    .in("status", ["report_ready", "report_sent", "follow_up"])
    .not("recommended_model", "eq", "nurture")
    .limit(30);

  for (const diagnostic of diagnostics || []) {
    const logs = (diagnostic.nexus_outreach_log || []) as any[];
    const touchCount = logs.length;
    const lastTouch = logs.sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0];
    const daysSinceLast = lastTouch
      ? (now.getTime() - new Date(lastTouch.sent_at).getTime()) / 86400000
      : 999;

    const nextTouchDef = SEQUENCE.find(s => s.touch === touchCount + 1);
    if (!nextTouchDef) continue;
    if (daysSinceLast < nextTouchDef.days_after) continue;

    // Check unsubscribe
    const { data: unsub } = await supabase.from("nexus_unsubscribes").select("id").eq("email", diagnostic.owner_email).eq("channel", nextTouchDef.channel).maybeSingle();
    if (unsub) continue;

    if (nextTouchDef.channel === "email") {
      const content = await generateContent(diagnostic, nextTouchDef.angle);
      const emailResult = await sendEmail(diagnostic.owner_email, content.subject, content.html);

      await supabase.from("nexus_outreach_log").insert({
        diagnostic_id: diagnostic.id,
        channel: "email",
        touch_number: nextTouchDef.touch,
        subject: content.subject,
        content: content.html.replace(/<[^>]+>/g, "").slice(0, 500)
      });

      await supabase.from("nexus_diagnostics").update({ status: "report_sent", updated_at: now.toISOString() }).eq("id", diagnostic.id);
      sent++;
    } else if (nextTouchDef.channel === "voice" && BLAND_API_KEY) {
      const { data: consent } = await supabase.from("nexus_consents").select("consent_voice, dnc_listed").eq("email", diagnostic.owner_email).maybeSingle();
      if (consent?.consent_voice && !consent?.dnc_listed && diagnostic.owner_phone) {
        fetch(`${SUPABASE_URL}/functions/v1/nexus-voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ diagnostic_id: diagnostic.id })
        }).catch(() => {});
        await supabase.from("nexus_outreach_log").insert({ diagnostic_id: diagnostic.id, channel: "voice", touch_number: nextTouchDef.touch, content: "AI call scheduled" });
        sent++;
      }
    }
  }

  return Response.json({ ok: true, sent });
});

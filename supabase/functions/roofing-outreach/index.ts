import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TOUCH_SCHEDULE = [0, 2, 4, 7, 10, 14, 18, 21, 25, 28, 35, 45, 55, 65, 75, 85];

const TOUCH_ANGLES = [
  "cold_intro", "homeowner_experience", "competitor_angle", "pain_point",
  "hail_or_social_proof", "quick_question", "objection_preempt", "free_trial",
  "video_demo", "month1_breakup", "reengagement", "seasonal_hook",
  "case_study", "month2_final", "things_changed", "final_final"
];

async function generateEmail(prospect: Record<string, unknown>, touchNumber: number): Promise<{ subject: string; html: string; text: string }> {
  const angle = TOUCH_ANGLES[touchNumber - 1] || "followup";
  const portalDemo = "https://app.nexuszc.com/roofing/portal/64afb2c5c1eacfd790a899493b23b867ce8ef8a277d31ee8";
  const trialLink = "https://roofingos.dev?ref=email";
  const calendlyLink = Deno.env.get("CALENDLY_LINK") || "https://calendly.com/zachcurtis/roofing-os-demo";

  const angleInstructions: Record<string, string> = {
    cold_intro: "Introduce Roofing OS. Focus on the homeowner portal — roofers look more professional, win more bids. Include portal demo link. Keep it SHORT. 3 paragraphs max.",
    homeowner_experience: "Focus on what the homeowner sees — real-time updates, photos, documents, messaging. They rave about you. You win referrals.",
    competitor_angle: "Their competitors are already using tools like this. They're losing bids to roofers who look more organized and professional.",
    pain_point: "The pain: chasing homeowners for updates, phone tag, unhappy customers who don't know what's happening with their roof.",
    hail_or_social_proof: prospect.source === "hail_zone" ? "With all the hail damage jobs coming in, this is exactly when you need a system to keep homeowners informed and happy." : "Other Denver roofers using Roofing OS are closing 20% more jobs.",
    quick_question: "Just ask one short question — 'Is managing homeowner communication during jobs a challenge for you?' Make it easy to reply yes or no.",
    objection_preempt: "Address the top 3 objections: too expensive ($499 = 1 extra job/month), too complicated (setup in under 30 min), don't have time (saves time on calls and texts).",
    free_trial: "Offer 2 weeks free. No credit card. Just try it on one job. If it doesn't impress a homeowner, cancel.",
    video_demo: "Tell them to watch the 60-second demo at the portal link. Show them exactly what their homeowner would see.",
    month1_breakup: "Friendly breakup. 'I'll stop emailing after this. But if you ever want to see what your competitors are using, here's the link.' Keep a door open.",
    reengagement: "It's been a few weeks. New angle. What changed: new feature, new pricing option, or new case study.",
    seasonal_hook: "Seasonal angle — spring roofing rush, storm season, end of year. Why now is the right time.",
    case_study: "A Denver roofer (anonymized) used Roofing OS on 12 jobs last month. Homeowners left 5-star reviews mentioning the portal specifically.",
    month2_final: "Last email this month. Softer close. 'Whenever you're ready, the door is open.'",
    things_changed: "Things have changed since last time. New feature, or new angle on value. Worth a fresh look.",
    final_final: "This is truly the last email. Moving them to a quarterly list. Leave on a positive note with zero pressure."
  };

  const prompt = `You are writing a sales email for Roofing OS — software that gives roofing contractors a branded homeowner portal for $499/month.

Prospect info:
- Company: ${prospect.company_name}
- Owner: ${prospect.owner_name || "there"}
- City: ${prospect.city}
- Hook 1: ${prospect.hook_1}
- Hook 2: ${prospect.hook_2}
- Hail zone: ${prospect.source === "hail_zone" ? "YES - recent hail damage in their area" : "No"}
- Touch number: ${touchNumber} of 16
- Angle: ${angle}

Portal demo URL: ${portalDemo}
Trial signup: ${trialLink}
Book a call: ${calendlyLink}

ANGLE: ${angleInstructions[angle] || "General follow-up"}

RULES:
- Write from: Zach Curtis, Roofing OS (roofing@nexuszc.com)
- Keep it SHORT — roofers don't read long emails
- Plain text feel — no fancy HTML, just clean and readable
- Never sound salesy or desperate
- Use their company name naturally
- One clear CTA per email
- Subject line: NOT clickbait, feels personal

Respond with JSON only (no backticks):
{
  "subject": "email subject line",
  "text": "plain text version of email",
  "html": "simple HTML version with minimal styling"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  try {
    return JSON.parse(data.content[0].text.replace(/```json|```/g, "").trim());
  } catch {
    return { subject: "Quick question", html: "<p>Hi,</p>", text: "Hi," };
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Zach Curtis <roofing@nexuszc.com>",
      to,
      subject,
      html
    })
  });
  const data = await res.json();
  return data.id || null;
}

function getNextTouchAt(firstContactAt: Date, nextTouchNumber: number): Date | null {
  if (nextTouchNumber > 16) return null;
  const daysFromStart = TOUCH_SCHEDULE[nextTouchNumber - 1];
  const next = new Date(firstContactAt);
  next.setDate(next.getDate() + daysFromStart);
  return next;
}

Deno.serve(async (_req) => {
  const now = new Date().toISOString();

  const { data: prospects } = await supabase
    .from("roofing_prospects")
    .select("*")
    .in("status", ["researched", "outreach_active"])
    .not("email", "is", null)
    .lte("next_touch_at", now)
    .order("lead_score", { ascending: false })
    .limit(20);

  if (!prospects || prospects.length === 0) {
    return Response.json({ ok: true, sent: 0 });
  }

  let sent = 0;

  for (const prospect of prospects) {
    const nextTouch = (prospect.current_touch || 0) + 1;

    if (nextTouch > 16) {
      await supabase.from("roofing_prospects")
        .update({ status: "no_response", updated_at: now })
        .eq("id", prospect.id);
      continue;
    }

    const email = await generateEmail(prospect, nextTouch);
    const emailId = await sendEmail(prospect.email, email.subject, email.html);
    if (!emailId) continue;

    const firstContact = prospect.last_contacted_at
      ? new Date(prospect.last_contacted_at)
      : new Date();

    const nextTouchAt = getNextTouchAt(
      prospect.current_touch === 0 ? new Date() : firstContact,
      nextTouch + 1
    );

    await supabase.from("roofing_prospects").update({
      status: "outreach_active",
      current_touch: nextTouch,
      last_contacted_at: now,
      next_touch_at: nextTouchAt?.toISOString() || null,
      total_emails_sent: (prospect.total_emails_sent || 0) + 1,
      updated_at: now
    }).eq("id", prospect.id);

    await supabase.from("roofing_outreach_log").insert({
      prospect_id: prospect.id,
      touch_number: nextTouch,
      direction: "outbound",
      subject: email.subject,
      body: email.text,
      resend_email_id: emailId
    });

    sent++;
  }

  if (sent > 0) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: `📧 *Roofing OS Outreach*\n\nSent ${sent} emails today.\nReply \`roofing pipeline\` to see full status.`,
        parse_mode: "Markdown"
      })
    });
  }

  return Response.json({ ok: true, sent });
});

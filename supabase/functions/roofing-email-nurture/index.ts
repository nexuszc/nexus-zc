// roofing-email-nurture v1
// 7-touch email sequence for roofing prospects — enroll + send actions

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") || "").replace(/[^\x20-\x7E]/g, "").trim();
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME  = Deno.env.get("RESEND_FROM_NAME")  || "Zach @ Roofing OS";


const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const EMAIL_SEQUENCE = [
  {
    step: 1,
    delay_days: 0,
    subject_formula: "Quick question about your supplements",
    template_angle: "Storm intelligence for their market — you have data they don't. No pitch. Pure value.",
    portal_tease: null,
    cta: null,
    pre_written_body: `Hey {first_name} — Zach Curtis here, founder of Roofing OS. Quick question: on your last State Farm job, did you get paid for starter strip as a separate line item? Most contractors in Colorado are not. We find an average of $4,200 per job that adjusters miss. I built a tool that catches it automatically. Worth a 10-minute look? roofingos.dev`
  },
  {
    step: 2,
    delay_days: 2,
    subject_formula: "The State Farm starter strip issue",
    template_angle: "Specific dollar amount left on table. One Xactimate code. Actionable immediately.",
    portal_tease: "Our system auto-generates this line item — contractors ask us how",
    cta: "portal_demo",
    pre_written_body: `Hey {first_name} — following up. State Farm has been bundling starter strip into shingle costs on Colorado claims. That is $200-400 per job you are not getting. Here is the Xactimate code to add it back: RFG STRTR. Takes 2 minutes. Our system adds it automatically on every job. roofingos.dev`
  },
  {
    step: 3,
    delay_days: 4,
    subject_formula: "Free supplement audit for your last job",
    template_angle: "Paint a picture of a contractor using modern tools — homeowner updates, supplement tracking, crew management. Not a pitch. A story.",
    portal_tease: "This is what the homeowner portal looks like on a real job",
    cta: "portal_demo",
    pre_written_body: `Hey {first_name} — enter any job address at roofingos.dev and we will show you exactly what your adjuster missed. Free. 90 seconds. No credit card. Most contractors find $2,000-6,000 on jobs they already closed.`
  },
  {
    step: 4,
    delay_days: 14,
    subject_formula: "Quick question",
    template_angle: "One sentence: what's the #1 thing slowing down your supplement approvals right now? Reply only.",
    portal_tease: null,
    cta: "reply"
  },
  {
    step: 5,
    delay_days: 21,
    subject_formula: "The [MARKET] carrier report — [MONTH] data",
    template_angle: "Carrier-specific intelligence for their market. Approval rates, denied items, what's working.",
    portal_tease: "Roofing OS tracks this automatically for every active contractor",
    cta: "portal_demo"
  },
  {
    step: 6,
    delay_days: 30,
    subject_formula: "What's your supplement ROI?",
    template_angle: "Walk them through a simple calculation: jobs/month × average supplement × approval rate. Show what they're leaving behind.",
    portal_tease: null,
    cta: "roi_calculator"
  },
  {
    step: 7,
    delay_days: 45,
    subject_formula: "Last email — wanted to make sure you saw this",
    template_angle: "Final touch. Not desperate. Honest: 'We've sent a few emails about what contractors in [MARKET] are doing. If timing is off, no worries. When it's right, we're here.'",
    portal_tease: null,
    cta: "book_call"
  }
];

async function claude(prompt: string, maxTokens = 500): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function sendEmail(to: string, name: string, subject: string, body: string): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6; color: #333;">${body.replace(/\n/g, "<br>")}</div>`
    })
  });
  const data = await res.json();
  return data.id || null;
}

async function generateEmailBody(
  step: typeof EMAIL_SEQUENCE[0],
  prospect: { name: string; company: string; market: string; email: string }
): Promise<{ subject: string; body: string }> {
  const month = new Date().toLocaleString("en-US", { month: "long" });
  const subject = step.subject_formula
    .replace("[MARKET]", prospect.market || "your market")
    .replace("[CONTRACTOR_NAME]", prospect.company || "one contractor")
    .replace("[MONTH]", month);

  if ((step as any).pre_written_body) {
    const firstName = prospect.name?.split(" ")[0] || "there";
    const body = (step as any).pre_written_body.replace(/\{first_name\}/g, firstName);
    return { subject, body };
  }

  const prompt = `Write a short, direct email for a roofing contractor prospect. No fluff, no filler.

RECIPIENT: ${prospect.name} at ${prospect.company} in ${prospect.market || "their market"}
STEP: ${step.step} of 7
ANGLE: ${step.template_angle}
PORTAL TEASE: ${step.portal_tease || "none — pure value only"}
CTA: ${step.cta || "none — no ask"}

Rules:
- Under 200 words
- No "I hope this finds you well"
- No subject line in the output — just the body
- Sign off as: Zach Curtis, Roofing OS
- Plain text, conversational
- If CTA is portal_demo: end with "Reply and I'll send you a 2-minute video of the portal on a live job."
- If CTA is reply: end with just the question, nothing else
- If CTA is roi_calculator: end with the math, invite them to run their own numbers
- If CTA is book_call: end with "15 minutes on my calendar: [CALENDAR_LINK]"
- If no CTA: end naturally, no ask

Write only the email body. Start with the first sentence — no greeting preamble.`;

  const body = await claude(prompt, 500);
  return { subject, body };
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-email-nurture ready" });

  const { action } = body;

  // Enroll a prospect (or batch of prospects) into the sequence
  if (action === "enroll") {
    const prospects = body.prospects || (body.prospect_id ? [{ id: body.prospect_id }] : []);
    if (!prospects.length) {
      return Response.json({ error: "prospects array or prospect_id required" }, { status: 400 });
    }

    let enrolled = 0;
    for (const p of prospects) {
      // Fetch prospect details
      const { data: prospect } = await supabase
        .from("roofing_prospects")
        .select("id, owner_name, company_name, email, city, state")
        .eq("id", p.id)
        .maybeSingle();

      if (!prospect?.email) continue;

      // Check if already enrolled
      const { data: existing } = await supabase
        .from("email_sequences")
        .select("id")
        .eq("prospect_id", prospect.id)
        .eq("completed", false)
        .maybeSingle();

      if (existing) continue;

      const market = [prospect.city, prospect.state].filter(Boolean).join(", ") || "your market";
      const nextSendAt = new Date();
      nextSendAt.setUTCHours(15, 0, 0, 0); // 15:00 UTC = 9am MT

      await supabase.from("email_sequences").insert({
        prospect_id: prospect.id,
        prospect_email: prospect.email,
        prospect_name: prospect.owner_name,
        market,
        current_step: 1,
        next_send_at: nextSendAt.toISOString(),
        completed: false,
        unsubscribed: false
      });
      enrolled++;
    }

    return Response.json({ ok: true, action: "enrolled", enrolled });
  }

  // Enroll all uncontacted prospects with email
  if (action === "enroll_all") {
    const { data: prospects } = await supabase
      .from("roofing_prospects")
      .select("id, owner_name, company_name, email, city, state")
      .not("email", "is", null)
      .eq("status", "researched");

    let enrolled = 0;
    for (const prospect of prospects || []) {
      const { data: existing } = await supabase
        .from("email_sequences")
        .select("id")
        .eq("prospect_id", prospect.id)
        .eq("completed", false)
        .maybeSingle();
      if (existing) continue;

      const market = [prospect.city, prospect.state].filter(Boolean).join(", ") || "Colorado";
      const nextSendAt = new Date();
      nextSendAt.setUTCHours(15, 0, 0, 0);
      if (nextSendAt < new Date()) nextSendAt.setDate(nextSendAt.getDate() + 1);

      await supabase.from("email_sequences").insert({
        prospect_id: prospect.id,
        prospect_email: prospect.email,
        prospect_name: prospect.owner_name,
        market,
        current_step: 1,
        next_send_at: nextSendAt.toISOString(),
        completed: false,
        unsubscribed: false
      });

      await supabase.from("roofing_prospects")
        .update({ status: "email_enrolled" })
        .eq("id", prospect.id);

      enrolled++;
    }

    // MOVED_TO_DASHBOARD [date: 2026-05-17]: enrollment count visible in Pipeline tab (email_sequences table)
    // if (enrolled > 0) { await tg(`✉️ *Prospects Enrolled*\n${enrolled} ...`); }
    return Response.json({ ok: true, action: "enroll_all", enrolled });
  }

  // Send all due emails
  if (action === "send" || !action) {
    const { data: dueSequences } = await supabase
      .from("email_sequences")
      .select("id, prospect_id, prospect_email, prospect_name, market, current_step")
      .lte("next_send_at", new Date().toISOString())
      .eq("completed", false)
      .eq("unsubscribed", false)
      .limit(50);

    if (!dueSequences?.length) {
      return Response.json({ ok: true, sent: 0, message: "no sequences due" });
    }

    let sent = 0;
    let errors = 0;

    for (const seq of dueSequences) {
      const stepDef = EMAIL_SEQUENCE.find(s => s.step === seq.current_step);
      if (!stepDef) {
        // Past the end of sequence
        await supabase.from("email_sequences")
          .update({ completed: true })
          .eq("id", seq.id);
        continue;
      }

      try {
        // Fetch company name from prospect
        const { data: prospect } = await supabase
          .from("roofing_prospects")
          .select("company_name")
          .eq("id", seq.prospect_id)
          .maybeSingle();

        const { subject, body: emailBody } = await generateEmailBody(stepDef, {
          name: seq.prospect_name || "there",
          company: prospect?.company_name || "your company",
          market: seq.market,
          email: seq.prospect_email
        });

        const resendId = await sendEmail(seq.prospect_email, seq.prospect_name || "", subject, emailBody);

        // Log the send
        await supabase.from("email_log").insert({
          sequence_id: seq.id,
          prospect_email: seq.prospect_email,
          prospect_name: seq.prospect_name,
          step: seq.current_step,
          subject,
          body: emailBody,
          resend_id: resendId,
          status: "sent"
        });

        // Advance sequence
        const nextStep = seq.current_step + 1;
        const nextStepDef = EMAIL_SEQUENCE.find(s => s.step === nextStep);

        if (!nextStepDef) {
          await supabase.from("email_sequences")
            .update({ current_step: nextStep, completed: true })
            .eq("id", seq.id);
        } else {
          const nextSendAt = new Date();
          nextSendAt.setDate(nextSendAt.getDate() + nextStepDef.delay_days - stepDef.delay_days);
          nextSendAt.setUTCHours(15, 0, 0, 0);
          await supabase.from("email_sequences")
            .update({ current_step: nextStep, next_send_at: nextSendAt.toISOString() })
            .eq("id", seq.id);
        }

        sent++;
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        errors++;
        console.error("Email send error:", err);
      }
    }

    // MOVED_TO_DASHBOARD [date: 2026-05-17]: email send counts visible in Pipeline tab (email_log table)
    // if (sent > 0) { await tg(`✉️ *Email Nurture Sent*\n${sent} emails sent | ${errors} errors`); }

    return Response.json({ ok: true, action: "send", sent, errors });
  }

  // Stats endpoint
  if (action === "stats") {
    const { data: totals } = await supabase
      .from("email_sequences")
      .select("completed, unsubscribed, current_step");

    const active = (totals || []).filter((s: any) => !s.completed && !s.unsubscribed).length;
    const completed = (totals || []).filter((s: any) => s.completed).length;
    const unsubscribed = (totals || []).filter((s: any) => s.unsubscribed).length;

    const { data: logTotals } = await supabase
      .from("email_log")
      .select("status")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const sent7d = (logTotals || []).length;

    return Response.json({ ok: true, active, completed, unsubscribed, sent_last_7d: sent7d });
  }

  return Response.json({ ok: true });
});

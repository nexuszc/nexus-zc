import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const STRIPE_PAYMENT_LINK = Deno.env.get("STRIPE_PAYMENT_LINK") || "https://buy.stripe.com/roofingos499";
const CALENDLY_LINK = Deno.env.get("CALENDLY_LINK") || "https://calendly.com/zachcurtis/roofing-os-demo";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME  = Deno.env.get("RESEND_FROM_NAME")  || "Zach @ Roofing OS";

const PORTAL_DEMO = "https://app.nexuszc.com/roofing/portal/64afb2c5c1eacfd790a899493b23b867ce8ef8a277d31ee8";

Deno.serve(async (req) => {
  const { from_email, from_name, subject, body, prospect_id } = await req.json();

  let prospect;
  if (prospect_id) {
    const { data } = await supabase.from("roofing_prospects").select("*").eq("id", prospect_id).single();
    prospect = data;
  } else {
    const { data } = await supabase.from("roofing_prospects").select("*").eq("email", from_email).maybeSingle();
    prospect = data;
  }

  if (!prospect) {
    return Response.json({ ok: true, action: "unknown_sender" });
  }

  const classifyPrompt = `You are Nexus, the autonomous sales AI for Roofing OS.

A roofing contractor replied to our sales email.

Prospect: ${prospect.company_name}
Their reply: "${body}"

Classify their intent and decide the next action:

INTENTS:
- "interested" — they want to know more, positive tone
- "wants_demo" — they want to see it, try it, or have a call
- "has_question" — specific question about price, features, setup
- "not_interested" — clear no, remove them
- "unsubscribe" — wants off the list
- "neutral" — unclear, needs gentle follow-up

ACTIONS based on intent:
- interested → send trial link + invite to book call if they want
- wants_demo → send Calendly link to book a call
- has_question → answer the question, then invite to trial
- not_interested → thank them, mark closed_lost, stop emailing
- unsubscribe → confirm removal, mark unsubscribed
- neutral → send gentle follow-up, offer trial link

Respond with JSON only (no backticks):
{
  "intent": "interested",
  "action": "send_trial",
  "sentiment": "positive",
  "response_email": {
    "subject": "reply subject",
    "body": "the full email reply to send — conversational, short, from Zach"
  },
  "update_status": "hot",
  "alert_zach": false,
  "alert_reason": ""
}

Alert Zach (alert_zach: true) only if:
- They explicitly ask to talk to someone
- They're clearly ready to buy but hesitating
- The reply is complex/unusual`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [{ role: "user", content: classifyPrompt }]
    })
  });
  const aiData = await res.json();

  let decision;
  try {
    decision = JSON.parse(aiData.content[0].text.replace(/```json|```/g, "").trim());
  } catch {
    return Response.json({ error: "Parse failed" }, { status: 500 });
  }

  await supabase.from("roofing_outreach_log").insert({
    prospect_id: prospect.id,
    touch_number: prospect.current_touch,
    direction: "inbound",
    subject,
    body,
    replied: true,
    replied_at: new Date().toISOString(),
    sentiment: decision.sentiment
  });

  await supabase.from("roofing_prospects").update({
    status: decision.update_status || prospect.status,
    last_reply_text: body,
    last_reply_sentiment: decision.sentiment,
    last_replied_at: new Date().toISOString(),
    total_replies: (prospect.total_replies || 0) + 1,
    call_requested: decision.action === "book_call",
    updated_at: new Date().toISOString()
  }).eq("id", prospect.id);

  if (decision.response_email) {
    let responseBody = decision.response_email.body;
    if (decision.action === "send_trial" || decision.action === "send_payment") {
      responseBody += `\n\nStart here: ${STRIPE_PAYMENT_LINK}`;
    }
    if (decision.action === "book_call" || decision.action === "wants_demo") {
      responseBody += `\n\nBook a time: ${CALENDLY_LINK}`;
    }
    if (decision.action === "send_demo") {
      responseBody += `\n\nSee the homeowner portal: ${PORTAL_DEMO}`;
    }

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: prospect.email,
        subject: decision.response_email.subject,
        text: responseBody
      })
    });
  }

  if (decision.intent === "not_interested" || decision.intent === "unsubscribe") {
    await supabase.from("roofing_prospects").update({
      status: decision.intent === "unsubscribe" ? "unsubscribed" : "closed_lost",
      next_touch_at: null,
      rejection_reason: body.slice(0, 200)
    }).eq("id", prospect.id);
  }

  if (decision.alert_zach) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: `🔥 *Hot Roofing OS Lead*\n\n*${prospect.company_name}* replied:\n"${body.slice(0, 200)}"\n\n*Reason:* ${decision.alert_reason}\n\nNexus responded. You may want to follow up personally.`,
        parse_mode: "Markdown"
      })
    });
  }

  return Response.json({ ok: true, action: decision.action, intent: decision.intent });
});

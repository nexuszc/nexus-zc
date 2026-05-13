import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const BLAND_API_KEY = Deno.env.get("BLAND_API_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const CALENDLY_LINK = Deno.env.get("CALENDLY_LINK") || "https://calendly.com/zach-nexuszc/30min";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function claude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, test: true });

  // Webhook mode (Bland.ai call completion)
  if (body.call_id && body.status) {
    const diagnosticId = body.metadata?.diagnostic_id;
    if (!diagnosticId) return Response.json({ ok: true });

    const transcript = body.transcript || body.concatenated_transcript || "";
    const analysis = await claude(`Analyze this AI sales call transcript. Determine:
1. Was the prospect interested? (yes/no/maybe)
2. What objection came up (if any)?
3. Did they agree to next steps? (yes/no)
4. Sentiment: positive/neutral/negative
5. Recommended next action

Transcript: ${transcript.slice(0, 2000)}

Respond in JSON: { interested, objection, agreed_next_steps, sentiment, next_action }`);

    let parsed = { interested: false, objection: "", agreed_next_steps: false, sentiment: "neutral", next_action: "follow_up_email" };
    try { parsed = { ...parsed, ...JSON.parse(analysis.replace(/```json|```/g, "").trim()) }; } catch { /* ignore */ }

    await supabase.from("nexus_outreach_log").update({
      replied_at: new Date().toISOString(),
      reply_content: transcript.slice(0, 1000),
      reply_sentiment: parsed.sentiment,
      outcome: parsed.interested ? "positive" : "no_response"
    }).eq("diagnostic_id", diagnosticId).eq("channel", "voice").order("sent_at", { ascending: false }).limit(1);

    const { data: diagnostic } = await supabase.from("nexus_diagnostics").select("business_name, slug").eq("id", diagnosticId).single();

    if (parsed.objection && !parsed.interested) {
      await tg(`📞 *AI Call — Needs Your Touch*\n*Business:* ${diagnostic?.business_name || "unknown"}\n*Objection:* ${parsed.objection}\n*Transcript:* ${transcript.slice(0, 200)}\nReply \`call: ${diagnosticId}\` for full brief.`);
    }
    if (parsed.interested) {
      await tg(`🔥 *Hot Signal from AI Call*\n*Business:* ${diagnostic?.business_name || "unknown"}\nProspect showed strong interest. Sending Calendly link now.`);
    }

    return Response.json({ ok: true });
  }

  // Initiate call mode
  const { diagnostic_id } = body;
  if (!diagnostic_id) return Response.json({ error: "diagnostic_id required" }, { status: 400 });

  if (!BLAND_API_KEY) {
    return Response.json({ ok: true, skipped: true, reason: "BLAND_API_KEY not configured" });
  }

  const { data: diagnostic } = await supabase.from("nexus_diagnostics").select("*").eq("id", diagnostic_id).single();
  if (!diagnostic) return Response.json({ error: "Not found" }, { status: 404 });
  if (!diagnostic.owner_phone) return Response.json({ ok: true, skipped: true, reason: "No phone number" });

  // Check voice consent
  const { data: consent } = await supabase.from("nexus_consents").select("consent_voice, dnc_listed").eq("email", diagnostic.owner_email).maybeSingle();
  if (!consent?.consent_voice || consent?.dnc_listed) {
    return Response.json({ ok: true, skipped: true, reason: "No voice consent or DNC listed" });
  }

  const callScript = `You are calling from Nexus, an AI business optimization company. You are reaching out about a free business diagnostic that was recently completed for ${diagnostic.business_name}.

The diagnostic found a Nexus Score of ${diagnostic.nexus_score} out of 100, and identified approximately $${(diagnostic.estimated_revenue_leakage || 0).toLocaleString()} in potential annual improvements.

Your goal: confirm they received the diagnostic report, answer questions, and see if they'd like to schedule a free 30-minute strategy call with Zach at ${CALENDLY_LINK}.

If they have not seen the report: tell them the score and top finding, offer to email the link.
If they seem interested: offer to book a call immediately.
If they are not interested or push back: be gracious, thank them for their time, say you will send one follow-up email and respect their decision.
If it's a voicemail: leave a brief message mentioning the Nexus Score and the free report.

Be professional, brief, and genuinely helpful. Do not be pushy.`;

  const callRes = await fetch("https://api.bland.ai/v1/calls", {
    method: "POST",
    headers: { "Authorization": BLAND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      phone_number: diagnostic.owner_phone,
      task: callScript,
      voice: "maya",
      first_sentence: `Hi, I'm calling from Nexus about the free business diagnostic we completed for ${diagnostic.business_name}. Is this ${diagnostic.owner_name || "the owner"}?`,
      wait_for_greeting: true,
      record: true,
      max_duration: 10,
      answered_by_enabled: true,
      do_not_call_detection: true,
      webhook: `${SUPABASE_URL}/functions/v1/nexus-voice`,
      metadata: { diagnostic_id, slug: diagnostic.slug }
    })
  });

  const callData = await callRes.json();

  await supabase.from("nexus_outreach_log").insert({
    diagnostic_id,
    channel: "voice",
    touch_number: 6,
    content: "Bland.ai call initiated — " + (callData.call_id || "no call id"),
    sent_at: new Date().toISOString()
  });

  return Response.json({ ok: true, call_id: callData.call_id });
});

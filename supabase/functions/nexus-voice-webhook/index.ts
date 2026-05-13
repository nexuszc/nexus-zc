import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const FROM_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

async function sendSMS(to: string, body: string) {
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ From: FROM_NUMBER, To: to, Body: body })
    }
  ).catch(() => {});
}

async function claude(prompt: string, maxTokens = 600): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
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

async function analyzeTranscript(
  transcript: string,
  diagnostic: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!transcript || transcript.length < 30) {
    return {
      outcome: "no_answer",
      pipeline_status: "follow_up",
      objections: [],
      buy_signals: [],
      revenue: 0,
      next_action: "Retry call tomorrow"
    };
  }

  const analysis = await claude(`
Analyze this AI sales call transcript. Classify the outcome accurately.

Business: ${diagnostic.business_name}
Package tier: ${diagnostic.recommended_model}

Transcript:
${transcript.slice(0, 3000)}

Return JSON only:
{
  "outcome": "booked|paid|interested|callback|not_interested|hostile|wrong_number|voicemail|no_answer",
  "pipeline_status": "hot|follow_up|nurture|closed_lost",
  "objections": ["array of objections raised"],
  "buy_signals": ["array of positive signals detected"],
  "revenue": 0,
  "next_action": "specific recommended next step",
  "sentiment": "positive|neutral|negative",
  "summary": "2 sentence summary of the call"
}
`);

  try {
    return JSON.parse(analysis.replace(/```json|```/g, "").trim());
  } catch {
    return {
      outcome: "no_answer",
      pipeline_status: "follow_up",
      objections: [],
      buy_signals: [],
      revenue: 0,
      next_action: "Manual review needed"
    };
  }
}

Deno.serve(async (req) => {
  const event = await req.json().catch(() => ({}));
  const retellCallId = event.call?.call_id;
  if (!retellCallId) return Response.json({ ok: true });

  const { data: callRecord } = await supabase
    .from("voice_calls")
    .select("*, nexus_diagnostics(*)")
    .eq("retell_call_id", retellCallId)
    .maybeSingle();

  if (!callRecord) return Response.json({ ok: true });

  const diagnostic = callRecord.nexus_diagnostics as Record<string, unknown>;

  switch (event.event) {

    case "call_started":
      await supabase.from("voice_calls")
        .update({ answered: true, answered_at: new Date().toISOString() })
        .eq("id", callRecord.id);
      break;

    case "agent_spoke": {
      const content = (event.transcript_object?.content || "").toLowerCase();
      if ((content.includes("texting") || content.includes("sending you the link"))
          && !callRecord.sms_sent_during_call) {
        const smsBody =
          `Your Nexus diagnostic for ${diagnostic.business_name}:\n\n` +
          `Score: ${diagnostic.nexus_score}/100\n` +
          `Report: nexuszc.com/report/${diagnostic.slug}\n` +
          `Code: ${diagnostic.report_password}\n\n` +
          `Reply STOP to opt out.`;
        await sendSMS(callRecord.to_number, smsBody);
        await supabase.from("voice_calls")
          .update({ sms_sent_during_call: true, payment_link_sent: true })
          .eq("id", callRecord.id);
      }
      break;
    }

    case "user_spoke": {
      const userContent = (event.transcript_object?.content || "").toLowerCase();

      const buySignals = [
        "how does it work", "what's included", "how long does it take",
        "can i see an example", "sounds good", "let's do it",
        "yes", "okay", "what happens after", "i'm interested"
      ];
      const detected = buySignals.filter(s => userContent.includes(s));

      if (detected.length > 0 && diagnostic.recommended_model === "custom_enterprise") {
        await sendTelegram(
          `🔥 *Buy signal — Enterprise call*\n` +
          `*${diagnostic.business_name}*\n` +
          `Signal: "${detected[0]}"\n` +
          `Monitor this call closely.`
        );
      }

      if (userContent.includes("speak to a human") ||
          userContent.includes("talk to someone") ||
          userContent.includes("real person")) {
        await sendTelegram(
          `📞 *Human requested on call*\n` +
          `*${diagnostic.business_name}*\n` +
          `${diagnostic.owner_name} wants to speak with you.\n` +
          `Phone: ${callRecord.to_number}\n` +
          `*Call them within the hour.*`
        );
      }
      break;
    }

    case "call_ended": {
      const transcript = event.call?.transcript || "";
      const duration = event.call?.end_timestamp && event.call?.start_timestamp
        ? Math.round((event.call.end_timestamp - event.call.start_timestamp) / 1000)
        : null;
      const isVoicemail = event.call?.disconnection_reason === "voicemail";

      const analysis = await analyzeTranscript(transcript, diagnostic);

      await supabase.from("voice_calls").update({
        ended_at: new Date().toISOString(),
        duration_seconds: duration,
        transcript,
        recording_url: event.call?.recording_url,
        voicemail: isVoicemail,
        outcome: isVoicemail ? "voicemail" : analysis.outcome,
        objections_encountered: analysis.objections,
        buy_signals_detected: analysis.buy_signals,
        revenue_generated: analysis.revenue || 0
      }).eq("id", callRecord.id);

      await supabase.from("nexus_diagnostics")
        .update({ status: analysis.pipeline_status })
        .eq("id", diagnostic.id);

      const outcome = isVoicemail ? "voicemail" : (analysis.outcome as string);

      if (outcome === "voicemail") {
        const callNum = callRecord.call_number || 1;
        const retryDelays = [0, 24, 48, 96];
        const nextDelay = retryDelays[callNum] || null;
        if (nextDelay !== null && callNum < 4) {
          await supabase.from("reminders").insert({
            chat_id: TELEGRAM_CHAT_ID,
            message: `Retry voice call #${callNum + 1}: ${diagnostic.business_name}`,
            fire_at: new Date(Date.now() + nextDelay * 60 * 60 * 1000).toISOString()
          });
        }

      } else if (outcome === "booked") {
        await sendTelegram(
          `📅 *Call booked!*\n*${diagnostic.business_name}*\nCheck your Calendly.`
        );

      } else if (outcome === "paid") {
        await sendTelegram(
          `💰 *Payment collected on AI call!*\n` +
          `*${diagnostic.business_name}* — $${analysis.revenue || 0}\n` +
          `Onboarding triggered automatically.`
        );

      } else if (outcome === "interested") {
        await supabase.from("reminders").insert({
          chat_id: TELEGRAM_CHAT_ID,
          message: `Follow-up needed: ${diagnostic.business_name} showed strong interest on call`,
          fire_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });
        await sendTelegram(
          `✨ *Interested lead*\n*${diagnostic.business_name}*\n` +
          `${(analysis as any).summary}\nFollow-up scheduled for tomorrow.`
        );

      } else if (["hostile", "not_interested"].includes(outcome)) {
        await supabase.from("nexus_unsubscribes").insert({
          phone: callRecord.to_number,
          email: (diagnostic as any).owner_email,
          channel: "voice",
          reason: outcome
        });
      }

      // Update opener performance stats
      if (callRecord.opener_used) {
        const converted = ["booked", "paid", "interested"].includes(outcome);
        const { data: script } = await supabase
          .from("voice_scripts")
          .select("times_converted, times_used, conversion_rate")
          .eq("name", callRecord.opener_used)
          .maybeSingle();
        if (script) {
          const newConverted = (script.times_converted || 0) + (converted ? 1 : 0);
          const newUsed = script.times_used || 1;
          await supabase.from("voice_scripts")
            .update({
              times_converted: newConverted,
              conversion_rate: newConverted / newUsed
            })
            .eq("name", callRecord.opener_used);
        }
      }
      break;
    }

    case "call_failed":
      await supabase.from("voice_calls").update({
        outcome: "failed",
        ended_at: new Date().toISOString()
      }).eq("id", callRecord.id);
      break;
  }

  return Response.json({ ok: true });
});

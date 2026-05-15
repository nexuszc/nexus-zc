import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const FROM_NUMBER = Deno.env.get("RETELL_PHONE_NUMBER") || Deno.env.get("TWILIO_PHONE_NUMBER") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

async function sendSMS(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ From: FROM_NUMBER, To: to, Body: body })
  }).catch(() => {});
}

async function analyzeCallOutcome(
  transcript: string,
  callRecord: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!transcript || transcript.length < 30) {
    return {
      outcome: callRecord.voicemail ? "voicemail" : "no_answer",
      appointment_booked: false,
      revenue: 0,
      next_action: "Retry call tomorrow"
    };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Analyze this roofing sales call transcript.

Call type: ${callRecord.call_type}
Contact: ${callRecord.contact_name}

Transcript: ${transcript.slice(0, 3000)}

Return JSON only:
{
  "outcome": "appointment_booked|portal_sent|interested|callback_scheduled|not_interested|hostile|wrong_number|voicemail|no_answer",
  "appointment_booked": false,
  "next_action": "specific action",
  "sentiment": "positive|neutral|negative",
  "key_insight": "one sentence"
}`
      }]
    })
  });
  const data = await res.json();
  try {
    return JSON.parse((data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim());
  } catch {
    return { outcome: "unknown", appointment_booked: false };
  }
}

async function triggerPostCallActions(
  analysis: Record<string, unknown>,
  callRecord: Record<string, unknown>
) {
  const outcome = analysis.outcome as string;

  if (outcome === "appointment_booked") {
    await tg(
      `📅 *Roofing inspection booked*\n` +
      `*${callRecord.contact_name || "Unknown"}*\n` +
      `${callRecord.contact_phone}\n` +
      `Call type: ${callRecord.call_type}`
    );
    if (callRecord.job_id) {
      await supabase.from("portal_activities").insert({
        job_id: callRecord.job_id,
        activity_type: "adjuster_scheduled",
        title: "Inspection scheduled",
        description: "Your free roof inspection has been scheduled.",
        description_es: "Su inspección gratuita ha sido programada.",
        icon: "📅"
      });
    }

  } else if (outcome === "interested") {
    const callNum = (callRecord.call_number as number) || 1;
    if (callNum < 4) {
      await supabase.from("reminders").insert({
        chat_id: TELEGRAM_CHAT_ID,
        message: `Follow-up roofing call: ${callRecord.contact_name} ${callRecord.contact_phone}`,
        fire_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
    }

  } else if (outcome === "not_interested" || outcome === "hostile") {
    await supabase.from("nexus_unsubscribes").insert({
      phone: callRecord.contact_phone as string,
      channel: "voice",
      reason: outcome
    }).catch(() => {});

  } else if (outcome === "voicemail") {
    const callNum = (callRecord.call_number as number) || 1;
    if (callNum <= 3) {
      const firstName = (callRecord.contact_name as string)?.split(" ")[0] || "there";
      await sendSMS(
        callRecord.contact_phone as string,
        `Hi ${firstName}, this is Aria from your roofing company. We detected storm activity in your area and wanted to reach out. Call us back or reply to schedule a free inspection.`
      );
    }
  }
}

Deno.serve(async (req) => {
  const event = await req.json().catch(() => ({}));
  if (!event.event) return Response.json({ ok: true });

  const retellCallId = event.call?.call_id;
  if (!retellCallId) return Response.json({ ok: true });

  const { data: callRecord } = await supabase
    .from("roofing_aria_calls")
    .select("*")
    .eq("retell_call_id", retellCallId)
    .maybeSingle();

  if (!callRecord) return Response.json({ ok: true });

  switch (event.event) {
    case "call_started":
      await supabase.from("roofing_aria_calls")
        .update({ answered: true })
        .eq("id", callRecord.id);
      break;

    case "agent_spoke": {
      const content = (event.transcript_object?.content || "").toLowerCase();
      if ((content.includes("texting you") || content.includes("sending you a link")) && !callRecord.sms_sent_during_call) {
        if (callRecord.job_id) {
          const { data: session } = await supabase
            .from("homeowner_sessions")
            .select("magic_link_token")
            .eq("job_id", callRecord.job_id)
            .maybeSingle();
          if (session?.magic_link_token) {
            const portalUrl = `https://roofingos.dev/portal/${session.magic_link_token}`;
            await sendSMS(callRecord.contact_phone, `Your roofing project portal: ${portalUrl}\nTrack your project, view photos, and sign documents.`);
            await supabase.from("roofing_aria_calls").update({ portal_link_sent: true, sms_sent_during_call: true }).eq("id", callRecord.id);
          }
        } else {
          await sendSMS(callRecord.contact_phone, `Thanks for your interest in our roofing services. We'll follow up shortly to confirm your inspection.`);
          await supabase.from("roofing_aria_calls").update({ sms_sent_during_call: true }).eq("id", callRecord.id);
        }
      }
      break;
    }

    case "user_spoke": {
      const content = (event.transcript_object?.content || "").toLowerCase();
      const buySignals = ["sounds good", "yes", "okay", "sure", "let's do it", "schedule", "tomorrow", "morning", "afternoon", "what time", "how much", "when can you"];
      const detected = buySignals.filter(s => content.includes(s));
      if (detected.length > 0) {
        const existing = callRecord.buy_signals || [];
        await supabase.from("roofing_aria_calls").update({ buy_signals: [...new Set([...existing, ...detected])] }).eq("id", callRecord.id);
      }
      if (content.includes("speak to a human") || content.includes("talk to someone") || content.includes("real person")) {
        await tg(`📞 *Human requested on roofing call*\n*${callRecord.contact_name || "Unknown"}*\nPhone: ${callRecord.contact_phone}\nType: ${callRecord.call_type}\n*Call them within the hour.*`);
      }
      if (content.includes("stop calling") || content.includes("remove me") || content.includes("don't call")) {
        await supabase.from("nexus_unsubscribes").insert({ phone: callRecord.contact_phone, channel: "voice", reason: "Requested removal during call" }).catch(() => {});
      }
      break;
    }

    case "call_ended": {
      const transcript = event.call?.transcript || "";
      const duration = (event.call?.end_timestamp && event.call?.start_timestamp)
        ? Math.round((event.call.end_timestamp - event.call.start_timestamp) / 1000)
        : null;
      const isVoicemail = event.call?.disconnection_reason === "voicemail";

      const analysis = await analyzeCallOutcome(transcript, callRecord);

      await supabase.from("roofing_aria_calls").update({
        ended_at: new Date().toISOString(),
        duration_seconds: duration,
        transcript,
        recording_url: event.call?.recording_url,
        voicemail: isVoicemail,
        outcome: isVoicemail ? "voicemail" : analysis.outcome,
        appointment_booked: !!(analysis.appointment_booked)
      }).eq("id", callRecord.id);

      await triggerPostCallActions(isVoicemail ? { ...analysis, outcome: "voicemail" } : analysis, callRecord);

      // Update script performance
      if (callRecord.script_used) {
        const { data: scriptRec } = await supabase
          .from("roofing_aria_scripts")
          .select("times_used, times_converted")
          .eq("name", callRecord.script_used)
          .eq("call_type", callRecord.call_type)
          .maybeSingle();
        if (scriptRec) {
          const converted = ["appointment_booked", "portal_sent", "interested"].includes(analysis.outcome as string);
          const newUsed = (scriptRec.times_used || 0) + 1;
          const newConverted = (scriptRec.times_converted || 0) + (converted ? 1 : 0);
          await supabase.from("roofing_aria_scripts").update({
            times_used: newUsed,
            times_converted: newConverted,
            conversion_rate: newUsed > 0 ? newConverted / newUsed : 0
          }).eq("name", callRecord.script_used).eq("call_type", callRecord.call_type);
        }
      }
      break;
    }

    case "call_analyzed": {
      const analysisData = (event.call?.call_analysis?.custom_analysis_data || {}) as Record<string, unknown>;
      const updatePayload: Record<string, unknown> = {};
      if (analysisData.call_outcome) updatePayload.outcome = analysisData.call_outcome;
      if (typeof analysisData.sentiment_score === "number") updatePayload.sentiment_score = analysisData.sentiment_score;
      if (analysisData.primary_objection) updatePayload.primary_objection = analysisData.primary_objection;
      if (analysisData.appointment_time) updatePayload.appointment_time = analysisData.appointment_time;
      if (Object.keys(updatePayload).length > 0) {
        await supabase.from("roofing_aria_calls").update(updatePayload).eq("id", callRecord.id);
      }
      break;
    }

    case "call_failed":
      await supabase.from("roofing_aria_calls").update({ outcome: "failed", ended_at: new Date().toISOString() }).eq("id", callRecord.id);
      break;
  }

  return Response.json({ ok: true });
});

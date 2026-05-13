import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RETELL_API_KEY = Deno.env.get("RETELL_API_KEY")!;
const RETELL_AGENT_ID = Deno.env.get("RETELL_AGENT_ID") || "";
const FROM_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

async function sendSMS(to: string, body: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const auth = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const authHeader = btoa(`${sid}:${auth}`);
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ From: FROM_NUMBER, To: to, Body: body })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "Voice engine ready" });

  const { diagnostic_id, call_number = 1 } = body;
  if (!diagnostic_id) {
    return Response.json({ error: "diagnostic_id required" }, { status: 400 });
  }

  const { data: diagnostic } = await supabase
    .from("nexus_diagnostics")
    .select("*")
    .eq("id", diagnostic_id)
    .single();

  if (!diagnostic?.owner_phone) {
    return Response.json({ error: "No phone number for this lead" }, { status: 400 });
  }

  // Compliance check
  const complianceRes = await fetch(
    `${SUPABASE_URL}/functions/v1/nexus-voice-compliance`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ diagnostic_id, phone_number: diagnostic.owner_phone })
    }
  );
  const compliance = await complianceRes.json();

  if (!compliance.approved) {
    if (compliance.reason?.includes("Outside calling hours")) {
      await supabase.from("reminders").insert({
        chat_id: TELEGRAM_CHAT_ID,
        message: `Retry voice call: ${diagnostic.business_name} (call #${call_number})`,
        fire_at: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString()
      });
    }
    return Response.json({ ok: false, reason: compliance.reason });
  }

  // Get champion opener
  const { data: openers } = await supabase
    .from("voice_scripts")
    .select("*")
    .eq("module_type", "opener")
    .eq("status", "active")
    .order("conversion_rate", { ascending: false })
    .limit(1);

  const opener = openers?.[0];

  // Get objection handlers
  const { data: objections } = await supabase
    .from("voice_objections")
    .select("objection_category, response_script")
    .eq("status", "active")
    .order("resolution_rate", { ascending: false });

  const dynamicVars = {
    owner_name: diagnostic.owner_name || "there",
    business_name: diagnostic.business_name || "your business",
    nexus_score: String(diagnostic.nexus_score || 0),
    revenue_leakage: Number(diagnostic.estimated_revenue_leakage || 0).toLocaleString(),
    industry: diagnostic.industry || "your industry",
    package_price: diagnostic.recommended_model === "custom_starter"
      ? "$1,500" : diagnostic.recommended_model === "custom_growth"
      ? "$5,000" : "$15,000",
    breakeven_days: "60",
    report_url: `nexuszc.com/report/${diagnostic.slug}`,
    report_password: diagnostic.report_password || "",
    calendly_link: Deno.env.get("CALENDLY_LINK") || "",
    payment_link: Deno.env.get("STRIPE_PAYMENT_LINK") || "",
    recording_disclosure: compliance.recording_disclosure || "",
    call_number: String(call_number)
  };

  const agentPrompt = `You are Aria, an AI sales assistant from Nexus.
CRITICAL: Always disclose you are an AI in your first sentence.
${compliance.two_party_state ? dynamicVars.recording_disclosure : ""}

PROSPECT DATA:
Name: ${dynamicVars.owner_name}
Business: ${dynamicVars.business_name}
Nexus Score: ${dynamicVars.nexus_score}/100
Revenue leakage: $${dynamicVars.revenue_leakage}/year
Report: ${dynamicVars.report_url} (code: ${dynamicVars.report_password})
Package target: ${diagnostic.recommended_model}

YOUR GOAL: ${
  diagnostic.recommended_model === "custom_starter"
    ? "Close the sale. Send payment link when ready: " + dynamicVars.payment_link
    : "Book a call with Zach: " + dynamicVars.calendly_link
}

OPENER: ${opener?.content || dynamicVars.owner_name + " — Aria from Nexus. I am an AI assistant. Your Nexus score came back at " + dynamicVars.nexus_score + " out of 100. Do you have 90 seconds?"}

OBJECTION HANDLING:
${(objections || []).map((o: any) => `If ${o.objection_category}: ${o.response_script}`).join("\n")}

RULES:
- Always use their name and business name
- Reference specific dollar amounts
- If they say "send me the link" — say "I am texting it to you right now" then end sentence
- If they want a human — say Zach will call within the hour
- If hostile — apologize and end call gracefully
- Keep responses under 3 sentences
- Always end with a question
- Never make up data`;

  // Create call record
  const { data: callRecord } = await supabase
    .from("voice_calls")
    .insert({
      diagnostic_id,
      from_number: FROM_NUMBER,
      to_number: diagnostic.owner_phone,
      prospect_name: diagnostic.owner_name,
      business_name: diagnostic.business_name,
      call_number,
      persona: "aria",
      opener_used: opener?.name || "Score Reveal",
      script_version: `v${opener?.version || 1}`
    })
    .select()
    .single();

  // Initiate Retell call
  const retellRes = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RETELL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from_number: FROM_NUMBER,
      to_number: diagnostic.owner_phone,
      override_agent_id: RETELL_AGENT_ID,
      retell_llm_dynamic_variables: dynamicVars,
      metadata: {
        diagnostic_id: diagnostic.id,
        call_record_id: callRecord?.id,
        call_number,
        agent_prompt: agentPrompt
      }
    })
  });

  if (!retellRes.ok) {
    const err = await retellRes.text();
    await sendTelegram(`❌ Voice call failed for ${diagnostic.business_name}: ${err.slice(0, 200)}`);
    return Response.json({ error: "Retell call failed", details: err }, { status: 500 });
  }

  const retellData = await retellRes.json();

  await supabase.from("voice_calls")
    .update({ retell_call_id: retellData.call_id })
    .eq("id", callRecord?.id);

  if (opener) {
    await supabase.from("voice_scripts")
      .update({ times_used: (opener.times_used || 0) + 1 })
      .eq("id", opener.id);
  }

  await sendTelegram(
    `📞 *Voice call initiated*\n` +
    `*${diagnostic.business_name}* (call #${call_number})\n` +
    `${diagnostic.owner_name} | ${diagnostic.owner_phone}\n` +
    `Score: ${diagnostic.nexus_score}/100 | $${dynamicVars.revenue_leakage} leakage`
  );

  return Response.json({
    ok: true,
    call_id: callRecord?.id,
    retell_call_id: retellData.call_id
  });
});

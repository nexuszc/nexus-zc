import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RETELL_API_KEY = Deno.env.get("RETELL_API_KEY")!;
const RETELL_AGENT_ID = Deno.env.get("RETELL_AGENT_ID") || "";
const RETELL_PHONE = Deno.env.get("RETELL_PHONE_NUMBER") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
// SMS_DISABLED: 10DLC pending — re-enable Monday May 18 2026
// const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
// const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
// const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") || Deno.env.get("TWILIO_PHONE_NUMBER") || RETELL_PHONE;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// SMS_DISABLED: 10DLC pending — re-enable Monday May 18 2026
// To re-enable: uncomment below, remove this block, re-enable SMS in cold_outbound_contractor block
// async function sendSMS(to: string, body: string): Promise<void> {
//   if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return;
//   const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
//   await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
//     method: "POST",
//     headers: {
//       "Authorization": `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
//       "Content-Type": "application/x-www-form-urlencoded",
//     },
//     body: params.toString(),
//   }).catch(() => {});
// }

async function sendProspectEmail(to: string, firstName: string): Promise<void> {
  if (!RESEND_API_KEY) return;
  const portalLink = "https://app.nexuszc.com/roofing/portal/DEMO2026ROOFINGOS";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Zach Curtis <ops@nexuszc.com>",
      reply_to: "zach@nexuszc.com",
      to: [to],
      subject: "Here's that portal I mentioned",
      html: `<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.7;color:#333;">
<p>Hey ${firstName} —</p>
<p>Here's the link I mentioned on the call:</p>
<p><a href="${portalLink}">${portalLink}</a></p>
<p>30 seconds to see it. This is what your homeowners see instead of calling you.</p>
<p>$49/month. No contract.</p>
<p>Zach<br>Roofing OS</p>
</div>`,
    }),
  }).catch(() => {});
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

function fillScript(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`{${k}}`, "g"), v);
  }
  return out;
}

function buildAgentPrompt(
  callType: string,
  script: string,
  vars: Record<string, string>,
  compliance: Record<string, unknown>,
  language: string
): string {
  const baseEn =
    `You are Aria, an AI assistant from ${vars.contractor_name}.\n` +
    `CRITICAL: You MUST disclose you are an AI in your first sentence.\n` +
    `${compliance.two_party_state ? "This call may be recorded for quality purposes. " : ""}` +
    `Keep responses under 3 sentences. Always end with a question.\n` +
    `Never make up specific dates or numbers you don't have.\n` +
    `If asked to be removed: confirm immediately.\n` +
    `If they want a human: say their rep will call within the hour.`;

  const baseEs =
    `Eres Aria, una asistente de IA de ${vars.contractor_name}.\n` +
    `CRÍTICO: DEBES decir que eres una IA en tu primera oración.\n` +
    `${compliance.two_party_state ? "Esta llamada puede ser grabada. " : ""}` +
    `Mantén las respuestas bajo 3 oraciones. Siempre termina con una pregunta.\n` +
    `Responde solo en español.`;

  const base = language === "es" ? baseEs : baseEn;
  return `${base}\n\nSCRIPT:\n${fillScript(script, vars)}`;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-aria-engine ready" });

  const {
    call_type,
    contact_phone,
    contact_name,
    contact_type = "unknown",
    job_id,
    language = "en",
    bypass_gate = false,
    metadata = {}
  } = body;

  if (!call_type || !contact_phone) {
    return Response.json({ error: "call_type and contact_phone required" }, { status: 400 });
  }

  // CALL GATE — timing compliance; bypass_gate skips entirely for test calls
  if (!bypass_gate) {
    const gateRes = await fetch(`${SUPABASE_URL}/functions/v1/aria-call-gate`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contact_phone, call_type })
    });
    const gate = await gateRes.json().catch(() => ({ allowed: true }));

    if (!gate.allowed) {
      try {
        await supabase.from("system_heartbeats").insert({
          function_name: "aria-call-gate",
          status: gate.permanent ? "error" : "ok",
          response_ms: 0,
          error_message: `blocked:${gate.reason} phone:${contact_phone} type:${call_type}`,
          metadata: { reason: gate.reason, local_time: gate.local_time, timezone: gate.recipient_timezone }
        });
      } catch { /* ignore */ }

      if (!gate.permanent && gate.next_allowed_at) {
        const { data: existingQueued } = await supabase
          .from("aria_call_queue")
          .select("id")
          .eq("contact_phone", contact_phone)
          .eq("status", "queued")
          .maybeSingle();

        if (!existingQueued) {
          await supabase.from("aria_call_queue").insert({
            call_type, contact_phone, contact_name, contact_type,
            job_id: job_id || null, language, metadata,
            fire_at: gate.next_allowed_at,
            recipient_timezone: gate.recipient_timezone || "America/Denver",
            queue_reason: gate.reason,
            status: "queued"
          });
        }
      }

      return Response.json({
        ok: false, blocked: true, reason: gate.reason,
        next_allowed_at: gate.next_allowed_at,
        queued: !gate.permanent && !!gate.next_allowed_at
      });
    }
  }

  // Compliance check
  const complianceRes = await fetch(`${SUPABASE_URL}/functions/v1/nexus-voice-compliance`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ diagnostic_id: job_id || "roofing", phone_number: contact_phone })
  });
  const compliance = await complianceRes.json().catch(() => ({ approved: false, reason: "Compliance check failed" }));

  if (!compliance.approved) {
    if (compliance.reason?.includes("Outside calling hours")) {
      await supabase.from("reminders").insert({
        chat_id: TELEGRAM_CHAT_ID,
        message: `Retry roofing aria call: ${contact_name || contact_phone} (${call_type})`,
        fire_at: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString()
      });
    }
    return Response.json({ ok: false, reason: compliance.reason });
  }

  // Get champion script
  const { data: scripts } = await supabase
    .from("roofing_aria_scripts")
    .select("*")
    .eq("call_type", call_type)
    .eq("language", language)
    .eq("status", "active")
    .order("conversion_rate", { ascending: false })
    .limit(1);

  const script = scripts?.[0];

  // Get job context if provided
  let jobRow: Record<string, unknown> | null = null;
  if (job_id) {
    const { data: job } = await supabase.from("roofing_jobs").select("*").eq("id", job_id).single();
    jobRow = job;
  }

  const vars: Record<string, string> = {
    contact_name: contact_name || "there",
    contractor_name: metadata.contractor_name || "your roofing company",
    property_address: metadata.property_address || (jobRow?.property_address as string) || "your property",
    hail_size: metadata.hail_size || "1.5",
    rep_name: metadata.rep_name || "our team",
    days_ago: metadata.days_ago || "recently",
    claim_number: metadata.claim_number || "",
    submitted_date: metadata.submitted_date || "",
    calendly_link: Deno.env.get("CALENDLY_LINK") || "",
    portal_link: metadata.portal_link || "",
    ai_disclosure: compliance.two_party_state ? "This call may be recorded for quality purposes. " : ""
  };

  const agentPrompt = buildAgentPrompt(call_type, script?.content || "", vars, compliance, language);

  // Create call record
  const { data: callRecord, error: callErr } = await supabase
    .from("roofing_aria_calls")
    .insert({
      call_type,
      contact_name,
      contact_phone,
      contact_type,
      job_id: job_id || null,
      from_number: RETELL_PHONE,
      language,
      persona: "aria",
      script_used: script?.name || "default",
      script_version: `v${script?.version || 1}`
    })
    .select()
    .single();

  if (callErr || !callRecord) {
    return Response.json({ error: "Failed to create call record" }, { status: 500 });
  }

  // Initiate Retell call
  const retellRes = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RETELL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from_number: RETELL_PHONE,
      to_number: contact_phone,
      override_agent_id: RETELL_AGENT_ID,
      retell_llm_dynamic_variables: vars,
      metadata: {
        call_record_id: callRecord.id,
        call_type,
        job_id: job_id || null,
        language,
        agent_prompt: agentPrompt
      }
    })
  });

  if (!retellRes.ok) {
    const err = await retellRes.text();
    await tg(`❌ Roofing Aria call failed for ${contact_name || contact_phone}: ${err.slice(0, 200)}`);
    return Response.json({ error: "Retell call failed", details: err }, { status: 500 });
  }

  const retellData = await retellRes.json();

  if (retellData.call_id) {
    await supabase.from("roofing_aria_calls")
      .update({ retell_call_id: retellData.call_id })
      .eq("id", callRecord.id);
  }

  if (script) {
    await supabase.from("roofing_aria_scripts")
      .update({ times_used: (script.times_used || 0) + 1 })
      .eq("id", script.id);
  }

  // Belt-and-suspenders: send portal link 10s after call starts.
  // SMS_DISABLED: 10DLC pending — re-enable Monday May 18 2026
  if (call_type === "cold_outbound_contractor") {
    EdgeRuntime.waitUntil((async () => {
      await new Promise(r => setTimeout(r, 10000));
      // SMS_DISABLED: 10DLC pending — re-enable Monday May 18 2026
      // await sendSMS(
      //   contact_phone,
      //   `Hey — Aria from Roofing OS. Here's that portal:\napp.nexuszc.com/roofing/portal/DEMO2026ROOFINGOS\n\n30 seconds. This is what your homeowners see.`
      // );
      const { data: prospect } = await supabase
        .from("roofing_prospects")
        .select("email, owner_name")
        .eq("phone", contact_phone)
        .maybeSingle();
      if (prospect?.email) {
        const fn = (prospect.owner_name as string || "").split(" ")[0] || "there";
        await sendProspectEmail(prospect.email as string, fn);
      }
    })());
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "roofing-aria-engine",
    status: "ok",
    response_ms: 0,
    error_message: null,
    metadata: { call_type, contact_phone },
    recorded_at: new Date().toISOString()
  }).catch(() => {});

  return Response.json({ ok: true, call_id: callRecord.id, retell_call_id: retellData.call_id });
});

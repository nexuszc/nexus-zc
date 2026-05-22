// roofing-aria-inbound v2
// Twilio TwiML state machine for 7205006668 — Roofing OS sales line
// Flows: contractor signup → magic link, homeowner status, patch to Zach, voicemail → Telegram
//
// SECRETS REQUIRED:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN — for webhook setup + phone number update
//   ZACH_CELL_PHONE                        — e.g. "+13031234567", patching target
//   RESEND_API_KEY                         — magic link email delivery
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  — voicemail + call summary alerts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID  = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN   = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const ZACH_CELL           = Deno.env.get("ZACH_CELL_PHONE") || "";
const RESEND_API_KEY      = (Deno.env.get("RESEND_API_KEY") || "").replace(/[^\x20-\x7E]/g, "").trim();
const TELEGRAM_BOT_TOKEN  = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID    = Deno.env.get("TELEGRAM_CHAT_ID")!;
const INBOUND_PHONE       = "7205006668";
const FUNCTION_BASE       = `${SUPABASE_URL}/functions/v1/roofing-aria-inbound`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── TwiML helpers ────────────────────────────────────────────────────────────

function xml(body: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { headers: { "Content-Type": "application/xml" } }
  );
}

function say(text: string): string {
  // Polly.Joanna — natural American female voice
  return `<Say voice="Polly.Joanna">${esc(text)}</Say>`;
}

function gather(action: string, inner: string, timeout = 6): string {
  return `<Gather input="speech" speechTimeout="auto" timeout="${timeout}" action="${FUNCTION_BASE}?step=${encodeURIComponent(action)}" method="POST">${inner}</Gather>`;
}

function redirect(step: string): string {
  return `<Redirect method="POST">${FUNCTION_BASE}?step=${encodeURIComponent(step)}</Redirect>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function stepUrl(step: string, extra: Record<string, string> = {}): string {
  const u = new URL(FUNCTION_BASE);
  u.searchParams.set("step", step);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

// ── Utilities ────────────────────────────────────────────────────────────────

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

function parseEmail(speech: string): string | null {
  const s = speech.toLowerCase()
    .replace(/\bat\b/g, "@")
    .replace(/\bdot\b/g, ".")
    .replace(/\bunderscore\b/g, "_")
    .replace(/\bdash\b|\bhyphen\b/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.+/g, ".")
    .replace(/@+/g, "@");
  // Basic email sanity check
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

function classifyCaller(speech: string): "contractor" | "homeowner" | "patch" | "general" {
  const s = speech.toLowerCase();
  const humanKw = ["person", "human", "someone", "talk to", "speak to", "manager", "owner", "real person", "staff", "representative", "rep", "agent", "zach"];
  const contractorKw = ["contractor", "roofer", "roofing", "business", "company", "install", "crew", "sub", "contractor"];
  const homeownerKw = ["homeowner", "home owner", "my home", "my house", "my roof", "project", "job", "claim", "property", "repair", "customer"];
  if (humanKw.some(kw => s.includes(kw))) return "patch";
  if (contractorKw.some(kw => s.includes(kw))) return "contractor";
  if (homeownerKw.some(kw => s.includes(kw))) return "homeowner";
  return "general";
}

function wantsHuman(speech: string): boolean {
  const s = speech.toLowerCase();
  return ["person", "human", "someone", "speak to", "talk to", "manager", "owner", "real person", "zach"].some(kw => s.includes(kw));
}

function fmtPhone(p: string): string {
  return p.replace(/\D/g, "").replace(/^1?(\d{3})(\d{3})(\d{4})$/, "+1$1$2$3");
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async function logCall(fields: Record<string, unknown>): Promise<string | null> {
  const { data } = await supabase.from("roofing_inbound_calls").insert(fields).select("id").single().catch(() => ({ data: null }));
  return data?.id || null;
}

async function updateCall(id: string | null, fields: Record<string, unknown>) {
  if (!id) return;
  await supabase.from("roofing_inbound_calls").update(fields).eq("id", id).catch(() => {});
}

async function lookupJob(speech: string, callerPhone: string) {
  // Try caller's phone first
  const byPhone = await supabase
    .from("roofing_jobs")
    .select("id, homeowner_name, property_address, status, portal_token, contractor_id")
    .eq("homeowner_phone", fmtPhone(callerPhone))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byPhone.data) return byPhone.data;

  // Try searching by contractor name or job keywords in speech
  const s = speech.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (s.length > 3) {
    const byContractor = await supabase
      .from("roofing_jobs")
      .select("id, homeowner_name, property_address, status, portal_token")
      .ilike("internal_notes", `%${s}%`)
      .limit(1)
      .maybeSingle();
    if (byContractor.data) return byContractor.data;
  }
  return null;
}

async function enrollContractor(email: string, phone: string, name = ""): Promise<boolean> {
  const { error } = await supabase.from("supplement_audit_leads").insert({
    email,
    phone: fmtPhone(phone),
    name: name || "Inbound Call Lead",
    source: "inbound_call",
  });
  return !error;
}

async function sendMagicLink(email: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const dashLink = "https://roofingos.dev/dashboard";
  const html = `<p>Hi there,</p><p>Thanks for calling Roofing OS! Here's your direct link to get started — completely free, no credit card:</p><p><a href="${dashLink}" style="font-size:18px;font-weight:bold;color:#f97316;">→ Set Up Your Free Portal</a></p><p>Takes 4 minutes. You'll have your first homeowner portal live today.</p><p>Questions? Reply to this email or call us at (720) 500-6668.</p><p>— Zach<br>Roofing OS</p>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Zach at Roofing OS <zach@nexuszc.com>",
      reply_to: "zach@nexuszc.com",
      to: [email],
      subject: "Your free Roofing OS portal — direct link inside",
      html,
    }),
  }).catch(() => null);
  if (!r?.ok) return false;
  const d = await r.json().catch(() => ({}));
  return !!d.id;
}

// ── Twilio webhook setup ──────────────────────────────────────────────────────

async function setupTwilioWebhook(): Promise<Record<string, unknown>> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return { ok: false, error: "Twilio credentials not set" };
  }
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  // Find the phone number SID for 7205006668
  const listRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=%2B1${INBOUND_PHONE}`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const list = await listRes.json();
  const numbers = list.incoming_phone_numbers || [];
  if (numbers.length === 0) {
    return { ok: false, error: `Phone +1${INBOUND_PHONE} not found in account` };
  }
  const sid = numbers[0].sid;
  const voiceUrl = FUNCTION_BASE;

  // Update the voice webhook
  const updateRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${sid}.json`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        VoiceUrl: voiceUrl,
        VoiceMethod: "POST",
        StatusCallback: `${FUNCTION_BASE}?step=status_callback`,
        StatusCallbackMethod: "POST",
        FriendlyName: "Roofing OS Sales Line",
      }).toString(),
    }
  );
  const updated = await updateRes.json();
  return {
    ok: updateRes.ok,
    phone_number_sid: sid,
    voice_url: updated.voice_url,
    status_callback: updated.status_callback,
  };
}

// ── TwiML step handlers ───────────────────────────────────────────────────────

// STEP: start — fires on initial incoming call
function stepStart(): Response {
  return xml(
    say("Thank you for calling Roofing OS — the free homeowner portal for roofing contractors. This is Aria. How can I help you today?") +
    gather("route",
      say("Are you a roofing contractor looking to learn more, or are you a homeowner with a question about your project?")
    ) +
    redirect("route_timeout")
  );
}

// STEP: route — classify caller type from first speech response
function stepRoute(speech: string, callerPhone: string): Response {
  const type = classifyCaller(speech || "");
  switch (type) {
    case "contractor": return xml(redirect("contractor_greet"));
    case "homeowner":  return xml(redirect("homeowner_greet"));
    case "patch":      return xml(redirect("patch"));
    default:           return xml(redirect("general_info"));
  }
}

// STEP: route_timeout — caller didn't say anything
function stepRouteTimeout(): Response {
  return xml(
    say("Sorry about that, I didn't catch that.") +
    gather("route",
      say("Are you a roofing contractor looking to learn more, or a homeowner with a question?")
    ) +
    redirect("general_info")
  );
}

// STEP: contractor_greet — explain product, ask for email
function stepContractorGreet(): Response {
  return xml(
    gather("contractor_email",
      say("Perfect. Roofing OS is completely free for contractors — no credit card, no trial. You get a homeowner portal, A.I. supplement tool, storm leads, and Aria handling your homeowner calls.") +
      say("Can I get your email address and I'll send you the direct signup link right now?")
    ) +
    redirect("contractor_email_timeout")
  );
}

// STEP: contractor_email — parse email, enroll, send link
async function stepContractorEmail(speech: string, callerPhone: string, callId: string | null): Promise<Response> {
  if (wantsHuman(speech)) return xml(redirect("patch"));

  const email = parseEmail(speech);
  if (!email) {
    return xml(
      say("I'm sorry, I didn't quite catch that email address. Could you say it again slowly?") +
      gather("contractor_email",
        say("For example: john at gmail dot com")
      ) +
      redirect("patch")
    );
  }

  // Enroll and send link
  await enrollContractor(email, callerPhone);
  const sent = await sendMagicLink(email);
  await updateCall(callId, { outcome: "signed_up", caller_name: email, call_type: "contractor" });

  return xml(
    say(`Got it. I've sent the signup link to ${email.replace(/@/g, " at ").replace(/\./g, " dot ")}.`) +
    say("Check your email in the next minute — the link is on its way.") +
    gather("contractor_followup",
      say("Any questions before I let you go?"),
      5
    ) +
    say("Great. Welcome to Roofing OS. Talk soon!") +
    `<Hangup/>`
  );
}

// STEP: contractor_email_timeout — never gave email
function stepContractorEmailTimeout(): Response {
  return xml(
    say("No problem. You can sign up for free at roofingos.dev/dashboard — takes about 4 minutes.") +
    say("Feel free to call back anytime or we can connect you with Zach directly.") +
    gather("contractor_followup",
      say("Any other questions?"),
      4
    ) +
    `<Hangup/>`
  );
}

// STEP: contractor_followup — answer any final question
function stepContractorFollowup(speech: string): Response {
  if (wantsHuman(speech)) return xml(redirect("patch"));
  const s = (speech || "").toLowerCase();
  if (s.match(/no|nope|that.?s all|good|thanks|bye/)) {
    return xml(say("Perfect. Welcome to Roofing OS. Talk soon!") + `<Hangup/>`);
  }
  // Any other question — brief answer then close
  return xml(
    say("Great question. Roofing OS is free for the core portal, and has paid add-ons for A.I. supplements and Aria calling. You can see everything at roofingos.dev.") +
    say("I'll let you check it out. Talk soon!") +
    `<Hangup/>`
  );
}

// STEP: homeowner_greet — ask for contractor or job number
function stepHomeownerGreet(): Response {
  return xml(
    gather("homeowner_lookup",
      say("I can help with that. Can you give me the name of your roofing contractor, or your job number?")
    ) +
    redirect("patch")
  );
}

// STEP: homeowner_lookup — search DB
async function stepHomeownerLookup(speech: string, callerPhone: string, callId: string | null): Promise<Response> {
  if (wantsHuman(speech)) return xml(redirect("patch"));

  const job = await lookupJob(speech, callerPhone);
  if (!job) {
    await updateCall(callId, { call_type: "homeowner", outcome: "patched" });
    return xml(
      say("I wasn't able to find your job in our system right now.") +
      redirect("patch")
    );
  }

  const status = (job.status || "in progress").replace(/_/g, " ");
  const address = job.property_address || "your property";
  const portalUrl = job.portal_token ? `roofingos.dev/portal/${job.portal_token}` : "roofingos.dev";

  await updateCall(callId, { call_type: "homeowner", job_id: job.id, outcome: "info" });

  return xml(
    say(`I found your project at ${esc(address)}.`) +
    say(`Current status is ${esc(status)}.`) +
    say(`You can also track everything in real time at ${esc(portalUrl)} — we'll send that link to your phone if you'd like.`) +
    gather("homeowner_followup",
      say("Is there anything else I can help you with?"),
      5
    ) +
    say("Sounds good. Take care!") +
    `<Hangup/>`
  );
}

// STEP: homeowner_followup
function stepHomeownerFollowup(speech: string): Response {
  if (wantsHuman(speech)) return xml(redirect("patch"));
  const s = (speech || "").toLowerCase();
  if (s.match(/no|nope|that.?s all|good|thanks|bye/)) {
    return xml(say("Great. Take care!") + `<Hangup/>`);
  }
  return xml(
    say("For detailed questions about your project, let me connect you with someone directly.") +
    redirect("patch")
  );
}

// STEP: general_info — product questions
function stepGeneralInfo(): Response {
  return xml(
    gather("general_followup",
      say("Roofing OS gives every homeowner a free real-time portal for their roofing job — photos, insurance claim status, and direct messaging with their contractor. For contractors it's completely free to use.") +
      say("Can I answer any specific questions, or would you like me to connect you with Zach directly?")
    ) +
    redirect("patch")
  );
}

// STEP: general_followup
function stepGeneralFollowup(speech: string): Response {
  if (wantsHuman(speech) || (speech || "").toLowerCase().includes("connect")) {
    return xml(redirect("patch"));
  }
  const s = (speech || "").toLowerCase();
  if (s.match(/price|cost|free|pay|paid/)) {
    return xml(
      say("The homeowner portal is completely free for contractors — no credit card, no expiration. Paid add-ons include A.I. supplement packages at ninety-nine dollars per job, and full Aria adjuster handling at three hundred twenty-nine dollars per job.") +
      gather("general_followup2",
        say("Any other questions?"),
        4
      ) +
      `<Hangup/>`
    );
  }
  return xml(
    say("You can learn more at roofingos.dev — or I can have Zach call you back to walk through it.") +
    gather("patch_confirm",
      say("Would you like me to connect you?"),
      4
    ) +
    `<Hangup/>`
  );
}

// STEP: general_followup2 (after pricing answer)
function stepGeneralFollowup2(speech: string): Response {
  if (wantsHuman(speech)) return xml(redirect("patch"));
  return xml(say("Great. Check out roofingos.dev to get started. Take care!") + `<Hangup/>`);
}

// STEP: patch_confirm — optional confirm before patching
function stepPatchConfirm(speech: string): Response {
  const s = (speech || "").toLowerCase();
  if (s.match(/yes|yeah|sure|please|connect|ok/)) return xml(redirect("patch"));
  return xml(say("No problem. You can reach us at roofingos.dev anytime. Take care!") + `<Hangup/>`);
}

// STEP: patch — dial Zach directly
function stepPatch(): Response {
  if (!ZACH_CELL) {
    return xml(
      say("Let me connect you with our team. One moment please.") +
      redirect("voicemail")
    );
  }
  return xml(
    say("Absolutely — let me connect you with Zach right now. One moment please.") +
    `<Dial action="${stepUrl("patch_result")}" method="POST" timeout="20" callerId="+1${INBOUND_PHONE}">` +
    `<Number>${esc(ZACH_CELL)}</Number>` +
    `</Dial>`
  );
}

// STEP: patch_result — fires after Dial completes
function stepPatchResult(dialStatus: string): Response {
  const answered = dialStatus === "completed";
  if (answered) {
    return xml(`<Hangup/>`);
  }
  // Not answered → voicemail
  return xml(redirect("voicemail"));
}

// STEP: voicemail — record message
function stepVoicemail(): Response {
  return xml(
    say("You've reached Roofing OS. Please leave your name, number, and question and Zach will call you back within the hour.") +
    `<Record action="${stepUrl("voicemail_done")}" method="POST" maxLength="120" ` +
    `transcribe="true" transcribeCallback="${stepUrl("voicemail_transcript")}" playBeep="true"/>` +
    say("I didn't catch a message. Goodbye!") +
    `<Hangup/>`
  );
}

// STEP: voicemail_done — after recording
function stepVoicemailDone(): Response {
  return xml(
    say("Thank you. We'll be in touch shortly.") +
    `<Hangup/>`
  );
}

// STEP: voicemail_transcript — transcription callback from Twilio
async function stepVoicemailTranscript(params: URLSearchParams): Promise<Response> {
  const transcript = params.get("TranscriptionText") || "(no transcript)";
  const from = params.get("From") || "unknown";
  const recordingUrl = params.get("RecordingUrl") || "";

  await tg(
    `📞 *Voicemail — Roofing OS*\n\n` +
    `From: \`${from}\`\n` +
    `Transcript: ${transcript}\n` +
    `${recordingUrl ? `Recording: ${recordingUrl}` : ""}` +
    `\n\nCall back: \`${from}\``
  );

  // Log to DB
  await supabase.from("roofing_inbound_calls").insert({
    from_number: fmtPhone(from),
    call_type: "voicemail",
    outcome: "voicemail",
    transcript,
    recording_url: recordingUrl,
  }).catch(() => {});

  return new Response("OK");
}

// STEP: status_callback — fires when call ends
async function stepStatusCallback(params: URLSearchParams): Promise<Response> {
  const from      = params.get("From") || "unknown";
  const callSid   = params.get("CallSid") || "";
  const duration  = parseInt(params.get("CallDuration") || "0");
  const status    = params.get("CallStatus") || "unknown";

  // Look up the call log by matching from_number + recent creation
  const { data: callRecord } = await supabase
    .from("roofing_inbound_calls")
    .select("id, call_type, outcome, caller_name")
    .eq("from_number", fmtPhone(from))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const callerType = callRecord?.call_type || "unknown";
  const outcome    = callRecord?.outcome || status;
  const email      = callRecord?.caller_name || "";

  // Update duration
  if (callRecord?.id) {
    await supabase.from("roofing_inbound_calls").update({ duration_seconds: duration }).eq("id", callRecord.id).catch(() => {});
  }

  // Also log to roofing_aria_calls for full analytics
  await supabase.from("roofing_aria_calls").insert({
    from_number: fmtPhone(from),
    contact_phone: fmtPhone(from),
    call_type: "inbound",
    contact_type: callerType,
    duration_seconds: duration,
    outcome,
    answered: status === "completed",
    voicemail: outcome === "voicemail",
  }).catch(() => {});

  // Telegram summary
  let msg = `📞 *Inbound call — Roofing OS*\n\nFrom: \`${from}\`\nType: ${callerType}\nOutcome: ${outcome}\nDuration: ${duration}s`;
  if (email) msg += `\nEmail captured: ${email}`;
  if (outcome === "patched") msg += `\nPatching to you now`;
  await tg(msg);

  return new Response("OK");
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url   = new URL(req.url);
  const step  = url.searchParams.get("step") || "start";

  // ── Health check / setup ──────────────────────────────────────────────────
  if (req.method === "GET" && step === "start") {
    return Response.json({ ok: true, message: "roofing-aria-inbound v2 — TwiML state machine" });
  }

  // ── Webhook setup action ──────────────────────────────────────────────────
  if (step === "setup_webhook") {
    const result = await setupTwilioWebhook();
    return Response.json(result);
  }

  // ── Parse Twilio form body ────────────────────────────────────────────────
  const body    = req.method === "POST" ? await req.text().catch(() => "") : "";
  const params  = new URLSearchParams(body);

  const from        = params.get("From") || url.searchParams.get("From") || "";
  const speech      = (params.get("SpeechResult") || "").trim();
  const callSid     = params.get("CallSid") || "";
  const dialStatus  = params.get("DialCallStatus") || "";

  // ── Log initial call ──────────────────────────────────────────────────────
  let callId: string | null = null;
  if (step === "start" && callSid) {
    callId = await logCall({
      from_number: fmtPhone(from),
      call_type: "unknown",
      outcome: "in_progress",
    });
  } else if (callSid) {
    // Retrieve existing record for this call session (best effort via from_number)
    const { data } = await supabase
      .from("roofing_inbound_calls")
      .select("id")
      .eq("from_number", fmtPhone(from))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .catch(() => ({ data: null }));
    callId = data?.id || null;
  }

  // ── State machine dispatch ────────────────────────────────────────────────
  switch (step) {
    case "start":               return stepStart();
    case "route":               return stepRoute(speech, from);
    case "route_timeout":       return stepRouteTimeout();
    case "contractor_greet":    return stepContractorGreet();
    case "contractor_email":    return stepContractorEmail(speech, from, callId);
    case "contractor_email_timeout": return stepContractorEmailTimeout();
    case "contractor_followup": return stepContractorFollowup(speech);
    case "homeowner_greet":     return stepHomeownerGreet();
    case "homeowner_lookup":    return stepHomeownerLookup(speech, from, callId);
    case "homeowner_followup":  return stepHomeownerFollowup(speech);
    case "general_info":        return stepGeneralInfo();
    case "general_followup":    return stepGeneralFollowup(speech);
    case "general_followup2":   return stepGeneralFollowup2(speech);
    case "patch_confirm":       return stepPatchConfirm(speech);
    case "patch":               return stepPatch();
    case "patch_result":        return stepPatchResult(dialStatus);
    case "voicemail":           return stepVoicemail();
    case "voicemail_done":      return stepVoicemailDone();
    case "voicemail_transcript": return stepVoicemailTranscript(params);
    case "status_callback":     return stepStatusCallback(params);
    default:
      return stepStart();
  }
});

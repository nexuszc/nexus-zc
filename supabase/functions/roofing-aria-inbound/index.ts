// roofing-aria-inbound v3
// Twilio TwiML state machine for 7205006668 — Roofing OS sales line
// v3: ElevenLabs TTS with Supabase Storage caching replaces Polly.Joanna
//     Falls back to Polly if ElevenLabs unavailable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID  = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN   = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const ZACH_CELL           = Deno.env.get("ZACH_CELL_PHONE") || "";
const RESEND_API_KEY      = (Deno.env.get("RESEND_API_KEY") || "").replace(/[^\x20-\x7E]/g, "").trim();
const TELEGRAM_BOT_TOKEN  = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID    = Deno.env.get("TELEGRAM_CHAT_ID")!;
const ELEVENLABS_API_KEY  = Deno.env.get("ELEVENLABS_API_KEY") || "";
const ELEVENLABS_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") || "21m00Tcm4TlvDq8ikWAM";
const TTS_BUCKET          = "aria-tts";
const INBOUND_PHONE       = "7205006668";
const FUNCTION_BASE       = `${SUPABASE_URL}/functions/v1/roofing-aria-inbound`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── ElevenLabs TTS with storage cache ────────────────────────────────────────

async function tts(text: string): Promise<string | null> {
  if (!ELEVENLABS_API_KEY) return null;
  try {
    const enc = new TextEncoder();
    const hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(text.toLowerCase().trim()));
    const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,"0")).join("").slice(0,20);
    const path = `tts/${hash}.mp3`;
    const publicUrl = supabase.storage.from(TTS_BUCKET).getPublicUrl(path).data.publicUrl;

    // Check cache via HEAD — cache hits add ~80ms, worth it for quality
    const probe = await fetch(publicUrl, { method: "HEAD" }).catch(() => null);
    if (probe?.ok) return publicUrl;

    // Generate via ElevenLabs turbo_v2 (fastest, lowest latency)
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.15 },
      }),
    }).catch(() => null);

    if (!ttsRes?.ok) return null;

    const audio = await ttsRes.arrayBuffer();
    await supabase.storage.from(TTS_BUCKET).upload(path, audio, { contentType: "audio/mpeg", upsert: false }).catch(() => {});
    return publicUrl;
  } catch {
    return null;
  }
}

// sayEl: returns <Play>url</Play> on ElevenLabs success, falls back to <Say voice="Polly.Joanna">
async function sayEl(text: string): Promise<string> {
  const url = await tts(text);
  if (url) return `<Play>${url}</Play>`;
  return `<Say voice="Polly.Joanna">${esc(text)}</Say>`;
}

// Pre-warm all static TTS phrases — call once after deploy
const STATIC_PHRASES = [
  "Thank you for calling Roofing OS — the free homeowner portal for roofing contractors. This is Aria. How can I help you today?",
  "Are you a roofing contractor looking to learn more, or are you a homeowner with a question about your project?",
  "Sorry about that, I didn't catch that.",
  "Are you a roofing contractor looking to learn more, or a homeowner with a question?",
  "Perfect. Roofing OS is completely free for contractors — no credit card, no trial. You get a homeowner portal, A.I. supplement tool, storm leads, and Aria handling your homeowner calls.",
  "Can I get your email address and I'll send you the direct signup link right now?",
  "I'm sorry, I didn't quite catch that email address. Could you say it again slowly?",
  "For example: john at gmail dot com",
  "Check your email in the next minute — the link is on its way.",
  "Any questions before I let you go?",
  "Great. Welcome to Roofing OS. Talk soon!",
  "No problem. You can sign up for free at roofingos.dev/dashboard — takes about 4 minutes.",
  "Feel free to call back anytime or we can connect you with Zach directly.",
  "Any other questions?",
  "Perfect. Welcome to Roofing OS. Talk soon!",
  "Great question. Roofing OS is free for the core portal, and has paid add-ons for A.I. supplements and Aria calling. You can see everything at roofingos.dev.",
  "I'll let you check it out. Talk soon!",
  "I can help with that. Can you give me the name of your roofing contractor, or your job number?",
  "I wasn't able to find your job in our system right now.",
  "Is there anything else I can help you with?",
  "Sounds good. Take care!",
  "For detailed questions about your project, let me connect you with someone directly.",
  "Great. Take care!",
  "Roofing OS gives every homeowner a free real-time portal for their roofing job — photos, insurance claim status, and direct messaging with their contractor. For contractors it's completely free to use.",
  "Can I answer any specific questions, or would you like me to connect you with Zach directly?",
  "You can learn more at roofingos.dev — or I can have Zach call you back to walk through it.",
  "Would you like me to connect you?",
  "No problem. You can reach us at roofingos.dev anytime. Take care!",
  "Absolutely — let me connect you with Zach right now. One moment please.",
  "Let me connect you with our team. One moment please.",
  "You've reached Roofing OS. Please leave your name, number, and question and Zach will call you back within the hour.",
  "I didn't catch a message. Goodbye!",
  "Thank you. We'll be in touch shortly.",
  "Roofing OS is completely free for contractors — no credit card, no expiration. Paid add-ons include A.I. supplement packages at ninety-nine dollars per job, and full Aria adjuster handling at three hundred twenty-nine dollars per job.",
];

// ── TwiML helpers ─────────────────────────────────────────────────────────────

function xml(body: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { headers: { "Content-Type": "application/xml" } }
  );
}

function gather(action: string, inner: string, timeout = 6): string {
  return `<Gather input="speech" speechTimeout="auto" timeout="${timeout}" action="${FUNCTION_BASE}?step=${encodeURIComponent(action)}" method="POST">${inner}</Gather>`;
}

function redirect(step: string): string {
  return `<Redirect method="POST">${FUNCTION_BASE}?step=${encodeURIComponent(step)}</Redirect>`;
}

function esc(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

function stepUrl(step: string, extra: Record<string, string> = {}): string {
  const u = new URL(FUNCTION_BASE);
  u.searchParams.set("step", step);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0,4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

function parseEmail(speech: string): string | null {
  const s = speech.toLowerCase()
    .replace(/\bat\b/g,"@").replace(/\bdot\b/g,".").replace(/\bunderscore\b/g,"_")
    .replace(/\bdash\b|\bhyphen\b/g,"-").replace(/\s+/g,"").replace(/\.+/g,".").replace(/@+/g,"@");
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

function classifyCaller(speech: string): "contractor" | "homeowner" | "patch" | "general" {
  const s = speech.toLowerCase();
  if (["person","human","someone","talk to","speak to","manager","owner","real person","staff","rep","agent","zach"].some(kw=>s.includes(kw))) return "patch";
  if (["contractor","roofer","roofing","business","company","install","crew"].some(kw=>s.includes(kw))) return "contractor";
  if (["homeowner","home owner","my home","my house","my roof","project","job","claim","property","repair","customer"].some(kw=>s.includes(kw))) return "homeowner";
  return "general";
}

function wantsHuman(speech: string): boolean {
  const s = speech.toLowerCase();
  return ["person","human","someone","speak to","talk to","manager","owner","real person","zach"].some(kw=>s.includes(kw));
}

function fmtPhone(p: string): string {
  return p.replace(/\D/g,"").replace(/^1?(\d{3})(\d{3})(\d{4})$/,"+1$1$2$3");
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function logCall(fields: Record<string,unknown>): Promise<string|null> {
  const { data } = await supabase.from("roofing_inbound_calls").insert(fields).select("id").single().catch(()=>({data:null}));
  return data?.id || null;
}

async function updateCall(id: string|null, fields: Record<string,unknown>) {
  if (!id) return;
  await supabase.from("roofing_inbound_calls").update(fields).eq("id",id).catch(()=>{});
}

async function lookupJob(speech: string, callerPhone: string) {
  const byPhone = await supabase.from("roofing_jobs").select("id,homeowner_name,property_address,status,portal_token,contractor_id")
    .eq("homeowner_phone", fmtPhone(callerPhone)).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if (byPhone.data) return byPhone.data;
  const s = speech.toLowerCase().replace(/[^a-z0-9 ]/g,"").trim();
  if (s.length > 3) {
    const byNote = await supabase.from("roofing_jobs").select("id,homeowner_name,property_address,status,portal_token")
      .ilike("internal_notes",`%${s}%`).limit(1).maybeSingle();
    if (byNote.data) return byNote.data;
  }
  return null;
}

async function enrollContractor(email: string, phone: string): Promise<void> {
  await supabase.from("supplement_audit_leads").insert({ email, phone: fmtPhone(phone), name:"Inbound Call Lead", source:"inbound_call" }).catch(()=>{});
}

async function sendMagicLink(email: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Zach at Roofing OS <zach@nexuszc.com>", reply_to: "zach@nexuszc.com", to: [email],
      subject: "Your free Roofing OS portal — direct link inside",
      html: `<p>Hi there,</p><p>Thanks for calling Roofing OS! Here's your direct link:</p><p><a href="https://roofingos.dev/dashboard" style="font-size:18px;font-weight:bold;color:#f97316;">→ Set Up Your Free Portal</a></p><p>4 minutes. Free forever.</p><p>— Zach<br>Roofing OS</p>`,
    }),
  }).catch(()=>null);
  return !!(r?.ok && (await r.json().catch(()=>({}))).id);
}

// ── Twilio webhook auto-setup ─────────────────────────────────────────────────

async function setupTwilioWebhook(): Promise<Record<string,unknown>> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return { ok: false, error: "Twilio creds not set" };
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const listRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=%2B1${INBOUND_PHONE}`,
    { headers: { Authorization: `Basic ${auth}` } });
  const list = await listRes.json();
  const numbers = list.incoming_phone_numbers || [];
  if (!numbers.length) return { ok: false, error: `+1${INBOUND_PHONE} not found` };
  const sid = numbers[0].sid;
  const updateRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${sid}.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      VoiceUrl: FUNCTION_BASE, VoiceMethod: "POST",
      StatusCallback: `${FUNCTION_BASE}?step=status_callback`, StatusCallbackMethod: "POST",
      FriendlyName: "Roofing OS Sales Line",
    }).toString(),
  });
  const updated = await updateRes.json();
  return { ok: updateRes.ok, phone_number_sid: sid, voice_url: updated.voice_url };
}

// ── TwiML step handlers (all async for ElevenLabs TTS) ───────────────────────

async function stepStart(): Promise<Response> {
  const [s1, s2] = await Promise.all([
    sayEl("Thank you for calling Roofing OS — the free homeowner portal for roofing contractors. This is Aria. How can I help you today?"),
    sayEl("Are you a roofing contractor looking to learn more, or are you a homeowner with a question about your project?"),
  ]);
  return xml(s1 + gather("route", s2) + redirect("route_timeout"));
}

async function stepRoute(speech: string): Promise<Response> {
  const type = classifyCaller(speech || "");
  switch (type) {
    case "contractor": return xml(redirect("contractor_greet"));
    case "homeowner":  return xml(redirect("homeowner_greet"));
    case "patch":      return xml(redirect("patch"));
    default:           return xml(redirect("general_info"));
  }
}

async function stepRouteTimeout(): Promise<Response> {
  const [s1, s2] = await Promise.all([
    sayEl("Sorry about that, I didn't catch that."),
    sayEl("Are you a roofing contractor looking to learn more, or a homeowner with a question?"),
  ]);
  return xml(s1 + gather("route", s2) + redirect("general_info"));
}

async function stepContractorGreet(): Promise<Response> {
  const [s1, s2] = await Promise.all([
    sayEl("Perfect. Roofing OS is completely free for contractors — no credit card, no trial. You get a homeowner portal, A.I. supplement tool, storm leads, and Aria handling your homeowner calls."),
    sayEl("Can I get your email address and I'll send you the direct signup link right now?"),
  ]);
  return xml(gather("contractor_email", s1 + s2) + redirect("contractor_email_timeout"));
}

async function stepContractorEmail(speech: string, callerPhone: string, callId: string|null): Promise<Response> {
  if (wantsHuman(speech)) return xml(redirect("patch"));
  const email = parseEmail(speech);
  if (!email) {
    const [s1, s2] = await Promise.all([
      sayEl("I'm sorry, I didn't quite catch that email address. Could you say it again slowly?"),
      sayEl("For example: john at gmail dot com"),
    ]);
    return xml(s1 + gather("contractor_email", s2) + redirect("patch"));
  }
  await enrollContractor(email, callerPhone);
  await sendMagicLink(email);
  await updateCall(callId, { outcome: "signed_up", caller_name: email, call_type: "contractor" });
  const spokenEmail = email.replace(/@/g," at ").replace(/\./g," dot ");
  const [s1, s2, s3] = await Promise.all([
    sayEl(`Got it. I've sent the signup link to ${spokenEmail}.`),
    sayEl("Check your email in the next minute — the link is on its way."),
    sayEl("Any questions before I let you go?"),
  ]);
  return xml(s1 + s2 + gather("contractor_followup", s3, 5) + await sayEl("Great. Welcome to Roofing OS. Talk soon!") + `<Hangup/>`);
}

async function stepContractorEmailTimeout(): Promise<Response> {
  const [s1, s2, s3] = await Promise.all([
    sayEl("No problem. You can sign up for free at roofingos.dev/dashboard — takes about 4 minutes."),
    sayEl("Feel free to call back anytime or we can connect you with Zach directly."),
    sayEl("Any other questions?"),
  ]);
  return xml(s1 + s2 + gather("contractor_followup", s3, 4) + `<Hangup/>`);
}

async function stepContractorFollowup(speech: string): Promise<Response> {
  if (wantsHuman(speech)) return xml(redirect("patch"));
  const s = (speech || "").toLowerCase();
  if (s.match(/no|nope|that.?s all|good|thanks|bye/)) {
    return xml(await sayEl("Perfect. Welcome to Roofing OS. Talk soon!") + `<Hangup/>`);
  }
  const [s1, s2] = await Promise.all([
    sayEl("Great question. Roofing OS is free for the core portal, and has paid add-ons for A.I. supplements and Aria calling. You can see everything at roofingos.dev."),
    sayEl("I'll let you check it out. Talk soon!"),
  ]);
  return xml(s1 + s2 + `<Hangup/>`);
}

async function stepHomeownerGreet(): Promise<Response> {
  const s = await sayEl("I can help with that. Can you give me the name of your roofing contractor, or your job number?");
  return xml(gather("homeowner_lookup", s) + redirect("patch"));
}

async function stepHomeownerLookup(speech: string, callerPhone: string, callId: string|null): Promise<Response> {
  if (wantsHuman(speech)) return xml(redirect("patch"));
  const job = await lookupJob(speech, callerPhone);
  if (!job) {
    await updateCall(callId, { call_type: "homeowner", outcome: "patched" });
    return xml(await sayEl("I wasn't able to find your job in our system right now.") + redirect("patch"));
  }
  const status = (job.status || "in progress").replace(/_/g," ");
  const address = job.property_address || "your property";
  const portalUrl = job.portal_token ? `roofingos.dev/portal/${job.portal_token}` : "roofingos.dev";
  await updateCall(callId, { call_type: "homeowner", job_id: job.id, outcome: "info" });
  const [s1, s2, s3, s4] = await Promise.all([
    sayEl(`I found your project at ${esc(address)}.`),
    sayEl(`Current status is ${esc(status)}.`),
    sayEl(`You can also track everything in real time at ${esc(portalUrl)} — we'll send that link to your phone.`),
    sayEl("Is there anything else I can help you with?"),
  ]);
  return xml(s1 + s2 + s3 + gather("homeowner_followup", s4, 5) + await sayEl("Sounds good. Take care!") + `<Hangup/>`);
}

async function stepHomeownerFollowup(speech: string): Promise<Response> {
  if (wantsHuman(speech)) return xml(redirect("patch"));
  const s = (speech || "").toLowerCase();
  if (s.match(/no|nope|that.?s all|good|thanks|bye/)) {
    return xml(await sayEl("Great. Take care!") + `<Hangup/>`);
  }
  return xml(await sayEl("For detailed questions about your project, let me connect you with someone directly.") + redirect("patch"));
}

async function stepGeneralInfo(): Promise<Response> {
  const [s1, s2] = await Promise.all([
    sayEl("Roofing OS gives every homeowner a free real-time portal for their roofing job — photos, insurance claim status, and direct messaging with their contractor. For contractors it's completely free to use."),
    sayEl("Can I answer any specific questions, or would you like me to connect you with Zach directly?"),
  ]);
  return xml(gather("general_followup", s1 + s2) + redirect("patch"));
}

async function stepGeneralFollowup(speech: string): Promise<Response> {
  if (wantsHuman(speech) || (speech||"").toLowerCase().includes("connect")) return xml(redirect("patch"));
  const s = (speech||"").toLowerCase();
  if (s.match(/price|cost|free|pay|paid/)) {
    const [s1, s2] = await Promise.all([
      sayEl("Roofing OS is completely free for contractors — no credit card, no expiration. Paid add-ons include A.I. supplement packages at ninety-nine dollars per job, and full Aria adjuster handling at three hundred twenty-nine dollars per job."),
      sayEl("Any other questions?"),
    ]);
    return xml(s1 + gather("general_followup2", s2, 4) + `<Hangup/>`);
  }
  const [s1, s2] = await Promise.all([
    sayEl("You can learn more at roofingos.dev — or I can have Zach call you back to walk through it."),
    sayEl("Would you like me to connect you?"),
  ]);
  return xml(s1 + gather("patch_confirm", s2, 4) + `<Hangup/>`);
}

async function stepGeneralFollowup2(speech: string): Promise<Response> {
  if (wantsHuman(speech)) return xml(redirect("patch"));
  return xml(await sayEl("Great. Check out roofingos.dev to get started. Take care!") + `<Hangup/>`);
}

async function stepPatchConfirm(speech: string): Promise<Response> {
  const s = (speech||"").toLowerCase();
  if (s.match(/yes|yeah|sure|please|connect|ok/)) return xml(redirect("patch"));
  return xml(await sayEl("No problem. You can reach us at roofingos.dev anytime. Take care!") + `<Hangup/>`);
}

async function stepPatch(): Promise<Response> {
  if (!ZACH_CELL) {
    return xml(await sayEl("Let me connect you with our team. One moment please.") + redirect("voicemail"));
  }
  return xml(
    await sayEl("Absolutely — let me connect you with Zach right now. One moment please.") +
    `<Dial action="${stepUrl("patch_result")}" method="POST" timeout="20" callerId="+1${INBOUND_PHONE}">` +
    `<Number>${esc(ZACH_CELL)}</Number>` +
    `</Dial>`
  );
}

function stepPatchResult(dialStatus: string): Response {
  if (dialStatus === "completed") return xml(`<Hangup/>`);
  return xml(redirect("voicemail"));
}

async function stepVoicemail(): Promise<Response> {
  return xml(
    await sayEl("You've reached Roofing OS. Please leave your name, number, and question and Zach will call you back within the hour.") +
    `<Record action="${stepUrl("voicemail_done")}" method="POST" maxLength="120" ` +
    `transcribe="true" transcribeCallback="${stepUrl("voicemail_transcript")}" playBeep="true"/>` +
    await sayEl("I didn't catch a message. Goodbye!") +
    `<Hangup/>`
  );
}

async function stepVoicemailDone(): Promise<Response> {
  return xml(await sayEl("Thank you. We'll be in touch shortly.") + `<Hangup/>`);
}

async function stepVoicemailTranscript(params: URLSearchParams): Promise<Response> {
  const transcript = params.get("TranscriptionText") || "(no transcript)";
  const from = params.get("From") || "unknown";
  const recordingUrl = params.get("RecordingUrl") || "";
  await tg(`📞 *Voicemail — Roofing OS*\n\nFrom: \`${from}\`\nTranscript: ${transcript}\n${recordingUrl ? `Recording: ${recordingUrl}` : ""}\n\nCall back: \`${from}\``);
  await supabase.from("roofing_inbound_calls").insert({
    from_number: fmtPhone(from), call_type: "voicemail", outcome: "voicemail", transcript, recording_url: recordingUrl,
  }).catch(()=>{});
  return new Response("OK");
}

async function stepStatusCallback(params: URLSearchParams): Promise<Response> {
  const from     = params.get("From") || "unknown";
  const duration = parseInt(params.get("CallDuration") || "0");
  const status   = params.get("CallStatus") || "unknown";
  const { data: callRecord } = await supabase.from("roofing_inbound_calls").select("id,call_type,outcome,caller_name")
    .eq("from_number", fmtPhone(from)).order("created_at",{ascending:false}).limit(1).maybeSingle();
  const callerType = callRecord?.call_type || "unknown";
  const outcome    = callRecord?.outcome || status;
  if (callRecord?.id) {
    await supabase.from("roofing_inbound_calls").update({ duration_seconds: duration }).eq("id", callRecord.id).catch(()=>{});
  }
  await supabase.from("roofing_aria_calls").insert({
    from_number: fmtPhone(from), contact_phone: fmtPhone(from), call_type: "inbound",
    contact_type: callerType, duration_seconds: duration, outcome, answered: status==="completed", voicemail: outcome==="voicemail",
  }).catch(()=>{});
  let msg = `📞 *Inbound call — Roofing OS*\n\nFrom: \`${from}\`\nType: ${callerType}\nOutcome: ${outcome}\nDuration: ${duration}s`;
  if (callRecord?.caller_name) msg += `\nEmail: ${callRecord.caller_name}`;
  await tg(msg);
  return new Response("OK");
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const url  = new URL(req.url);
  const step = url.searchParams.get("step") || "start";

  if (req.method === "GET" && step === "start") {
    return Response.json({ ok: true, message: "roofing-aria-inbound v3 — ElevenLabs TTS" });
  }

  if (step === "setup_webhook") {
    return Response.json(await setupTwilioWebhook());
  }

  // Pre-warm TTS cache for all static phrases
  if (step === "prewarm") {
    const results: string[] = [];
    for (const phrase of STATIC_PHRASES) {
      const url = await tts(phrase);
      results.push(url ? `✓ cached: ${phrase.slice(0,50)}` : `✗ failed: ${phrase.slice(0,50)}`);
      await new Promise(r => setTimeout(r, 200)); // rate limit
    }
    return Response.json({ ok: true, total: STATIC_PHRASES.length, results });
  }

  // Test endpoint — returns JSON (not TwiML)
  const bodyText = req.method === "POST" ? await req.text().catch(() => "") : "";
  const params   = new URLSearchParams(bodyText);

  if (params.get("test") === "true" || url.searchParams.get("test") === "true") {
    return Response.json({ ok: true, message: "roofing-aria-inbound v3 — ElevenLabs TTS active" });
  }

  const from       = params.get("From") || url.searchParams.get("From") || "";
  const speech     = (params.get("SpeechResult") || "").trim();
  const callSid    = params.get("CallSid") || "";
  const dialStatus = params.get("DialCallStatus") || "";

  let callId: string|null = null;
  if (step === "start" && callSid) {
    callId = await logCall({ from_number: fmtPhone(from), call_type: "unknown", outcome: "in_progress" });
  } else if (callSid) {
    const { data } = await supabase.from("roofing_inbound_calls").select("id")
      .eq("from_number", fmtPhone(from)).order("created_at",{ascending:false}).limit(1).maybeSingle().catch(()=>({data:null}));
    callId = data?.id || null;
  }

  switch (step) {
    case "start":                    return stepStart();
    case "route":                    return stepRoute(speech);
    case "route_timeout":            return stepRouteTimeout();
    case "contractor_greet":         return stepContractorGreet();
    case "contractor_email":         return stepContractorEmail(speech, from, callId);
    case "contractor_email_timeout": return stepContractorEmailTimeout();
    case "contractor_followup":      return stepContractorFollowup(speech);
    case "homeowner_greet":          return stepHomeownerGreet();
    case "homeowner_lookup":         return stepHomeownerLookup(speech, from, callId);
    case "homeowner_followup":       return stepHomeownerFollowup(speech);
    case "general_info":             return stepGeneralInfo();
    case "general_followup":         return stepGeneralFollowup(speech);
    case "general_followup2":        return stepGeneralFollowup2(speech);
    case "patch_confirm":            return stepPatchConfirm(speech);
    case "patch":                    return stepPatch();
    case "patch_result":             return stepPatchResult(dialStatus);
    case "voicemail":                return stepVoicemail();
    case "voicemail_done":           return stepVoicemailDone();
    case "voicemail_transcript":     return stepVoicemailTranscript(params);
    case "status_callback":          return stepStatusCallback(params);
    default:                         return stepStart();
  }
});

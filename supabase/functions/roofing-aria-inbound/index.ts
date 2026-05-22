// roofing-aria-inbound v1 — simple TwiML handler (inbound + outbound call flow)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_PHONE = Deno.env.get("TWILIO_PHONE_NUMBER") || Deno.env.get("TWILIO_FROM_NUMBER") || "";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME  = Deno.env.get("RESEND_FROM_NAME")  || "Zach @ Roofing OS";

const SELF = `${SUPABASE_URL}/functions/v1/roofing-aria-inbound`;
const ZACH = "+17203948574";

function xml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}
const say = (t: string) => `<Say voice="alice">${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Say>`;

async function tg(msg: string) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function sendLink(email: string, name = "there") {
  if (!RESEND_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`, reply_to: FROM_EMAIL, to: [email],
      subject: "Your free Roofing OS link",
      html: `<p>Hey ${name} &mdash;</p><p>Sign up free at <a href="https://roofingos.dev">roofingos.dev</a>. Takes 4 minutes. No credit card ever.</p><p>Zach<br>Roofing OS</p>`,
    }),
  }).catch(() => {});
}

function extractEmail(text: string): string | null {
  const direct = text.match(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}/i);
  if (direct) return direct[0];
  const spoken = text.toLowerCase().replace(/\bat\b/g, "@").replace(/\bdot\b/g, ".").replace(/\s+/g, "");
  const m = spoken.match(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}/i);
  return m ? m[0] : null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const step = url.searchParams.get("step") || "";
  const name = url.searchParams.get("name") || "there";
  const form: Record<string, string> = req.method === "POST"
    ? Object.fromEntries(new URLSearchParams(await req.text()))
    : {};
  const digits = form.Digits || "";
  const speech = (form.SpeechResult || "").toLowerCase();
  const transcript = form.TranscriptionText || "";

  // Setup Twilio webhook utility
  if (step === "setup_webhook") {
    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_PHONE) return Response.json({ error: "Twilio env missing" });
    const num = TWILIO_PHONE.replace(/\D/g, "").replace(/^1/, "");
    const listRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers.json?PhoneNumber=%2B1${num}`,
      { headers: { Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}` } }
    ).catch(() => null);
    if (!listRes?.ok) return Response.json({ error: "Twilio list failed" });
    const list = await listRes.json();
    const numSid = list?.incoming_phone_numbers?.[0]?.sid;
    if (!numSid) return Response.json({ error: "Phone not found in Twilio" });
    const upd = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/IncomingPhoneNumbers/${numSid}.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ VoiceUrl: SELF, VoiceMethod: "POST" }).toString(),
    }).catch(() => null);
    const result = await upd?.json().catch(() => ({}));
    return Response.json({ ok: upd?.ok, voice_url: result?.voice_url });
  }

  // INBOUND: default greeting
  if (!step) {
    return xml(
      say("Thanks for calling Roofing OS. Press 1 if you're a roofing contractor. Press 2 to speak with someone directly.") +
      `<Gather numDigits="1" timeout="10" action="${SELF}?step=menu" method="POST"></Gather>` +
      say("Visit roofingos.dev to sign up free. Have a great day.")
    );
  }

  if (step === "menu") {
    if (digits === "1") return xml(
      say("Roofing OS is completely free for contractors. No credit card ever. Visit roofingos.dev to sign up. It takes 4 minutes. We will also send you a link right now. What is your email address?") +
      `<Record maxLength="8" transcribe="true" transcribeCallback="${SELF}?step=capture&phone=${encodeURIComponent(form.From || "")}" playBeep="true" action="${SELF}?step=done"/>`
    );
    if (digits === "2") return xml(say("Connecting you now.") + `<Dial>${ZACH}</Dial>`);
    return xml(say("Visit roofingos.dev to sign up free. Have a great day."));
  }

  if (step === "capture") {
    const email = extractEmail(transcript);
    const phone = url.searchParams.get("phone") || "";
    if (email) {
      await sendLink(email);
      await tg(`📞 *Inbound* — ${phone} gave email: ${email}`);
    }
    return new Response("", { status: 204 });
  }

  if (step === "done") return xml(say("Check your email. The link is on its way. Have a great day."));

  // OUTBOUND: script plays when call is answered
  if (step === "outbound") {
    return xml(
      `<Gather input="speech" timeout="5" speechTimeout="auto" action="${SELF}?step=outbound_response&name=${encodeURIComponent(name)}" method="POST">` +
      say(`Hey ${name}, this is Aria from Roofing OS. We built a free homeowner portal for roofing contractors. Your clients see photos and updates in real time. They stop calling you mid-job. Completely free, no credit card ever. Can I send you a link to check it out?`) +
      `</Gather>` +
      say("No problem at all. Have a great day.")
    );
  }

  if (step === "outbound_response") {
    const yes = /yes|sure|yeah|yep|^ok|okay|send|absolutely|please|love to|sounds good|go ahead/i.test(speech);
    const phone = form.To || form.Called || "";
    if (yes) return xml(
      say("Perfect. What is your email address?") +
      `<Record maxLength="8" transcribe="true" transcribeCallback="${SELF}?step=outbound_capture&name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}" playBeep="true" action="${SELF}?step=outbound_done"/>`
    );
    return xml(say("No problem at all. Have a great day."));
  }

  if (step === "outbound_capture") {
    const email = extractEmail(transcript);
    const phone = url.searchParams.get("phone") || "";
    if (email) {
      await sendLink(email, name);
      await tg(`🎯 *Aria YES* — ${name} (${phone}) said YES. Email: ${email}`);
    }
    return new Response("", { status: 204 });
  }

  if (step === "outbound_done") return xml(say("Check your email. The link is on its way. Have a great day."));

  return xml(say("Thanks for calling Roofing OS. Visit roofingos.dev. Have a great day."));
});

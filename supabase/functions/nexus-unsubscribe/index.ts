// nexus-unsubscribe v3
// GET /nexus-unsubscribe?email=x&channel=email|sms|voice
// POST { email, channel }
// Returns JSON { ok: true } or HTML page based on Accept header

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const HTML = (msg: string, isError = false) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe</title>
<style>body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.card{background:#111;border:1px solid #222;border-radius:16px;padding:40px;max-width:440px;width:100%;text-align:center}h1{font-size:24px;margin-bottom:8px;color:${isError ? "#ef4444" : "#fff"}}p{color:#888;line-height:1.6;margin:8px 0}a{color:#888;font-size:13px}</style>
</head>
<body><div class="card">
  <h1>${isError ? "Something went wrong" : "You've been unsubscribed."}</h1>
  <p>${msg}</p>
  <p style="margin-top:32px"><a href="https://roofingos.dev">roofingos.dev</a></p>
</div></body></html>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const url = new URL(req.url);
    const wantsHtml = req.headers.get("accept")?.includes("text/html");

    let email = "";
    let channel = "email";

    if (req.method === "GET") {
      email = url.searchParams.get("email") || "";
      channel = url.searchParams.get("channel") || "email";
    } else {
      const body = await req.json().catch(() => ({}));
      if (body.test) return Response.json({ ok: true, message: "nexus-unsubscribe v3 ready" }, { headers: CORS });
      email = body.email || "";
      channel = body.channel || "email";
    }

    if (!email) {
      const msg = "No email address provided.";
      if (wantsHtml) return new Response(HTML(msg, true), { headers: { ...CORS, "Content-Type": "text/html" } });
      return Response.json({ ok: false, error: "email required" }, { status: 400, headers: CORS });
    }

    // Each write is independent — failures don't abort the others

    // 1. Record the unsubscribe
    const { error: e1 } = await supabase.from("nexus_unsubscribes")
      .upsert({ email, channel, reason: "user_request" }, { onConflict: "email,channel" });
    if (e1) console.error("upsert error:", e1.message);

    // 2. Mark consent record
    const consentField = channel === "sms" ? "unsubscribed_sms_at"
                       : channel === "voice" ? "unsubscribed_voice_at"
                       : "unsubscribed_email_at";
    const { error: e2 } = await supabase.from("nexus_consents")
      .update({ [consentField]: new Date().toISOString() })
      .eq("email", email);
    if (e2) console.error("consent error:", e2.message);

    // 3. Mark email sequence as unsubscribed (column is prospect_email)
    const { error: e3 } = await supabase.from("email_sequences")
      .update({ unsubscribed: true })
      .eq("prospect_email", email);
    if (e3) console.error("sequence error:", e3.message);

    // 4. Set do_not_call for voice/SMS opt-outs
    if (channel === "sms" || channel === "voice") {
      const { error: e4 } = await supabase.from("roofing_prospects")
        .update({ do_not_call: true })
        .or(`phone.eq.${email},email.eq.${email}`);
      if (e4) console.error("dnc error:", e4.message);
    }

    if (wantsHtml) {
      const chLabel = channel === "sms" ? "SMS" : channel === "voice" ? "voice call" : "email";
      return new Response(
        HTML(`You've been removed from our ${chLabel} list. This takes effect immediately.<br><br>If this was a mistake, email <a href="mailto:zach@nexuszc.com" style="color:#888">zach@nexuszc.com</a>.`),
        { headers: { ...CORS, "Content-Type": "text/html" } }
      );
    }

    return Response.json({ ok: true, email, channel }, { headers: CORS });

  } catch (err) {
    console.error("nexus-unsubscribe fatal:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

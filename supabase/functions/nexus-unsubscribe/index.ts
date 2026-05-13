// =========================================
// NEXUS nexus-unsubscribe — v1.0 — unsubscribe handler (GET + POST, HTML + JSON)
// =========================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const PAGE = (msg: string, isError = false) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe — Nexus</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}
  .card{background:#111;border:1px solid #222;border-radius:16px;padding:40px;max-width:440px;width:100%;text-align:center}
  h1{font-size:24px;margin-bottom:8px;color:${isError ? "#ef4444" : "#fff"}}
  p{color:#888;line-height:1.6;margin:8px 0}
  a{color:#888;font-size:13px}
</style>
</head>
<body>
<div class="card">
  <h1>${isError ? "Something went wrong" : "You've been unsubscribed."}</h1>
  <p>${msg}</p>
  <p style="margin-top:32px"><a href="https://nexuszc.com">nexuszc.com</a></p>
</div>
</body></html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const isWeb = req.headers.get("accept")?.includes("text/html");

  let email: string | null = null;
  let channel = "email";

  if (req.method === "GET") {
    email = url.searchParams.get("email");
    channel = url.searchParams.get("channel") || "email";
  } else {
    const body = await req.json().catch(() => ({}));
    email = body.email;
    channel = body.channel || "email";
    // test mode: just return 200
    if (body.test) return Response.json({ ok: true, test: true });
  }

  if (!email) {
    if (isWeb) return new Response(PAGE("No email address provided.", true), { headers: { "Content-Type": "text/html" } });
    return Response.json({ error: "email required" }, { status: 400 });
  }

  // Insert unsubscribe record (ignore duplicate errors)
  await supabase.from("nexus_unsubscribes").insert({ email, channel, reason: "user_request" }).catch(() => {});

  // Update consents table
  const field = channel === "sms" ? "unsubscribed_sms_at" : channel === "voice" ? "unsubscribed_voice_at" : "unsubscribed_email_at";
  await supabase.from("nexus_consents").update({ [field]: new Date().toISOString() }).eq("email", email).catch(() => {});

  if (isWeb) {
    return new Response(
      PAGE(`You've been removed from our ${channel} list. This takes effect immediately.<br><br>If this was a mistake, email <a href="mailto:zach@nexuszc.com" style="color:#888">zach@nexuszc.com</a>.`),
      { headers: { "Content-Type": "text/html" } }
    );
  }
  return Response.json({ ok: true, email, channel });
});

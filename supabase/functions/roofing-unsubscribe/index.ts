// roofing-unsubscribe v1
// One-click unsubscribe handler for roofing email sequences
// GET  /roofing-unsubscribe?pid=<prospect_id>  → mark unsubscribed, show confirmation page
// POST /roofing-unsubscribe                     → JSON { prospect_id } → mark unsubscribed

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const PAGE_OK = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed — Roofing OS</title>
  <style>
    body { font-family: -apple-system, Arial, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { max-width: 480px; padding: 48px 40px; background: #1e293b; border-radius: 12px; text-align: center; }
    h1 { font-size: 24px; margin: 0 0 16px; }
    p { color: #94a3b8; line-height: 1.6; margin: 0 0 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>You're unsubscribed.</h1>
    <p>You won't receive any more emails from Roofing OS.</p>
    <p style="margin-top:24px;font-size:14px;">If you change your mind, visit <a href="https://roofingos.dev" style="color:#06b6d4;">roofingos.dev</a>.</p>
  </div>
</body>
</html>`;

const PAGE_ERR = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Error — Roofing OS</title>
  <style>body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}.card{max-width:480px;padding:48px 40px;background:#1e293b;border-radius:12px;text-align:center;}</style>
</head>
<body>
  <div class="card"><h1>Something went wrong.</h1><p style="color:#94a3b8;">Please try again or reply to the email to unsubscribe.</p></div>
</body>
</html>`;

async function unsubscribe(prospectId: string): Promise<boolean> {
  const now = new Date().toISOString();

  // Mark the email sequence as unsubscribed
  await supabase
    .from("email_sequences")
    .update({ unsubscribed: true, unsubscribed_at: now, status: "unsubscribed" })
    .eq("prospect_id", prospectId);

  // Also record on the prospect itself
  await supabase
    .from("roofing_prospects")
    .update({ in_sequence: false, outcome: "unsubscribed", sequence_paused: true })
    .eq("id", prospectId);

  // Log to nexus_unsubscribes for CAN-SPAM record-keeping
  await supabase.from("nexus_unsubscribes").insert({
    email: null, // will be filled by trigger if needed
    channel: "roofing_email",
    prospect_id: prospectId,
  }).catch(() => {});

  return true;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (url.searchParams.get("test") === "1") {
    return Response.json({ ok: true, message: "roofing-unsubscribe v1 ready" });
  }

  // GET: one-click unsubscribe link in email footer
  if (req.method === "GET") {
    const pid = url.searchParams.get("pid");
    if (!pid) {
      return new Response(PAGE_ERR, { status: 400, headers: { "Content-Type": "text/html" } });
    }
    try {
      await unsubscribe(pid);
      return new Response(PAGE_OK, { headers: { "Content-Type": "text/html" } });
    } catch {
      return new Response(PAGE_ERR, { status: 500, headers: { "Content-Type": "text/html" } });
    }
  }

  // POST: programmatic unsubscribe (webhook, admin action)
  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty */ }

    const prospectId = body.prospect_id as string;
    if (!prospectId) {
      return Response.json({ ok: false, error: "prospect_id required" }, { status: 400 });
    }
    try {
      await unsubscribe(prospectId);
      return Response.json({ ok: true, unsubscribed: true, prospect_id: prospectId });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  return Response.json({ ok: false, error: "method not allowed" }, { status: 405 });
});

// ae-login v1
// POST { email }           → send magic link via Resend
// POST { validate_token }  → validate session token (returns ae info)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const RESEND_KEY  = Deno.env.get("RESEND_API_KEY") || "";
const APP_URL     = "https://app.nexuszc.com";

function genToken(): string {
  const a = crypto.randomUUID().replace(/-/g, "");
  const b = crypto.randomUUID().replace(/-/g, "");
  return a + b;
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "ae-login v1 ready" }, { headers: cors });

  // ── Send magic link ────────────────────────────────────────────────────
  if (body.email) {
    const email = (body.email as string).toLowerCase().trim();

    const { data: ae } = await supabase
      .from("ae_accounts")
      .select("id, name")
      .eq("email", email)
      .eq("active", true)
      .maybeSingle();

    if (!ae) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: cors });
    }

    const token     = genToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const link      = `${APP_URL}/roofing/ae?token=${token}`;

    await supabase.from("ae_sessions").insert({ ae_id: ae.id, token, expires_at: expiresAt });

    if (RESEND_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Roofing OS <zach@nexuszc.com>",
          to: [email],
          subject: "Your Roofing OS login link",
          text: `Hi ${ae.name},\n\nHere is your login link:\n\n${link}\n\nThis link expires in 12 hours. If you did not request this, ignore this email.\n\n— Roofing OS`,
        }),
      }).catch((e) => console.error("Resend error:", e));
    }

    return Response.json({ ok: true }, { headers: cors });
  }

  // ── Validate token ─────────────────────────────────────────────────────
  if (body.validate_token) {
    const token = body.validate_token as string;

    const { data: session } = await supabase
      .from("ae_sessions")
      .select("id, ae_id, expires_at, ae_accounts(name, email, role)")
      .eq("token", token)
      .maybeSingle();

    if (!session) {
      return Response.json({ valid: false, reason: "not_found" }, { headers: cors });
    }

    if (new Date(session.expires_at) < new Date()) {
      return Response.json({ valid: false, reason: "expired" }, { headers: cors });
    }

    // Auto-refresh if fewer than 6 hours remain
    const remaining = new Date(session.expires_at).getTime() - Date.now();
    if (remaining < 6 * 60 * 60 * 1000) {
      await supabase
        .from("ae_sessions")
        .update({ expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() })
        .eq("id", session.id);
    }

    return Response.json({ valid: true, ae: session.ae_accounts }, { headers: cors });
  }

  return Response.json({ error: "email or validate_token required" }, { status: 400, headers: cors });
});

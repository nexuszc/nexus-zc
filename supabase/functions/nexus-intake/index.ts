// =========================================
// NEXUS nexus-intake — v1.0 — full intake handler
// =========================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME  = Deno.env.get("RESEND_FROM_NAME")  || "Zach @ Roofing OS";


const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });

  const body = await req.json().catch(() => ({}));
  const ip = req.headers.get("x-forwarded-for") || "unknown";

  // 1. Validate required fields
  if (!body.email || !body.business_name) {
    return Response.json({ error: "Missing required fields: email, business_name" }, { status: 400 });
  }

  // 2. Check unsubscribe list
  const { data: unsub } = await supabase
    .from("nexus_unsubscribes")
    .select("id")
    .eq("email", body.email)
    .eq("channel", "email")
    .maybeSingle();
  if (unsub) return Response.json({ ok: true, message: "Already opted out" });

  // 3. Log consent
  await supabase.from("nexus_consents").insert({
    email: body.email,
    phone: body.phone || null,
    consent_email: body.consent_email || false,
    consent_sms: body.consent_sms || false,
    consent_voice: body.consent_voice || false,
    ip_address: ip,
    form_source: "nexuszc_intake"
  });

  // 4. Generate slug and password
  const slug = body.business_name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30) + "-" + Date.now();
  const password = (body.business_name.toLowerCase().replace(/[^a-z]/g, "") + "000").slice(0, 3);

  // 5. Create diagnostic record
  const { data: diagnostic, error: diagError } = await supabase
    .from("nexus_diagnostics")
    .insert({
      slug,
      business_name: body.business_name,
      business_url: body.business_url || null,
      owner_name: body.name || null,
      owner_email: body.email,
      owner_phone: body.phone || null,
      industry: body.industry || null,
      intake_biggest_fix: body.q1 || null,
      intake_revenue_goal: body.q2 || null,
      intake_bottleneck: body.q3 || null,
      intake_tried_before: body.q4 || null,
      intake_urgency: body.q5 || null,
      report_password: password,
      source: body.referral_code ? "referral" : "form",
      status: "new",
      proactive_run: body.proactive || false
    })
    .select()
    .single();

  if (diagError) return Response.json({ error: diagError.message }, { status: 500 });

  // 6. Handle referral code
  if (body.referral_code) {
    await supabase.from("nexus_referrals")
      .update({ referred_diagnostic_id: diagnostic.id, status: "referred" })
      .eq("referral_code", body.referral_code);
  }

  // 7. Send confirmation email (only if consent given and RESEND_API_KEY exists)
  if (body.consent_email && RESEND_API_KEY) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: body.email,
        subject: "Your Nexus diagnostic is running...",
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <h2 style="color:#1a1a1a">Your Nexus diagnostic is running.</h2>
          <p>Hi ${body.name || "there"},</p>
          <p>We received your information for <strong>${body.business_name}</strong>.</p>
          <p>Nexus is running your 24-layer diagnostic right now. You'll receive your Nexus Score and full report within 10 minutes.</p>
          <p style="color:#888">— Zach at Nexus</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="font-size:12px;color:#aaa">
            Nexus ZC LLC | 2812 11th Street, Boulder CO 80304<br>
            <a href="https://nexuszc.com/privacy" style="color:#aaa">Privacy Policy</a> |
            <a href="https://nexuszc.com/terms" style="color:#aaa">Terms</a> |
            <a href="https://nexuszc.com/unsubscribe?email=${encodeURIComponent(body.email)}" style="color:#aaa">Unsubscribe</a>
          </p>
        </div>`
      })
    }).catch(() => {});
  }

  // 8. Trigger diagnostic async (fire and forget)
  if (body.business_url || body.business_name) {
    fetch(`${SUPABASE_URL}/functions/v1/nexus-diagnostic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ diagnostic_id: diagnostic.id })
    }).catch(() => {});
  }

  return Response.json({ ok: true, slug, message: "Diagnostic started" }, {
    headers: { "Access-Control-Allow-Origin": "*" }
  });
});

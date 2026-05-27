import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TOOL_URLS: Record<string, string> = {
  "supplement-checklist": "https://roofingos.dev/tools/supplement-checklist",
  "hail-damage-checklist": "https://roofingos.dev/tools/hail-damage-checklist",
  "estimate-template":     "https://roofingos.dev/tools/estimate-template",
  "material-calculator":   "https://roofingos.dev/tools/material-calculator",
  "claim-tracker":         "https://roofingos.dev/tools/claim-tracker",
};

const TOOL_NAMES: Record<string, string> = {
  "supplement-checklist": "Roofing Supplement Checklist",
  "hail-damage-checklist": "Hail Damage Documentation Guide",
  "estimate-template":     "Roofing Estimate Template",
  "material-calculator":   "Material Quantity Calculator",
  "claim-tracker":         "Insurance Claim Tracker",
};

async function sendWelcomeEmail(email: string, toolSlug: string): Promise<boolean> {
  if (!RESEND_KEY) return false;

  const toolName = TOOL_NAMES[toolSlug] || "Roofing OS Free Tool";
  const toolUrl  = TOOL_URLS[toolSlug] || "https://roofingos.dev/tools";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:    "Zach from Roofing OS <zach@roofingos.dev>",
        to:      [email],
        subject: `Your free ${toolName} is ready`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:40px 24px;background:#0a0f1a;color:#f1f5f9">
<div style="margin-bottom:32px">
  <strong style="font-size:20px;color:#fff">Roofing<span style="color:#3b82f6">OS</span></strong>
</div>
<h1 style="font-size:26px;font-weight:800;color:#fff;margin:0 0 16px">Your ${toolName} is ready.</h1>
<p style="color:#94a3b8;font-size:16px;margin:0 0 28px">Here's your direct link — bookmark it so you always have it on the job:</p>
<a href="${toolUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:14px 28px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none">
  Open ${toolName} →
</a>
<hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:40px 0">
<p style="color:#64748b;font-size:14px;margin:0 0 12px">
  While you have this — Roofing OS tracks supplements, manages jobs, and keeps homeowners updated automatically. 100% free to start.
</p>
<a href="https://app.nexuszc.com/roofing/signup" style="color:#3b82f6;font-size:14px">Try it free →</a>
<p style="color:#374151;font-size:12px;margin:32px 0 0">
  You're receiving this because you downloaded a free tool from roofingos.dev.<br>
  <a href="https://roofingos.dev/nexus-unsubscribe?email=${encodeURIComponent(email)}" style="color:#374151">Unsubscribe</a>
</p>
</div>`,
        text: `Your ${toolName} is ready: ${toolUrl}\n\nRoofing OS is free to start: https://app.nexuszc.com/roofing/signup`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.test) {
      return Response.json({ ok: true, message: "tool-lead-capture v1 ready" }, { headers: CORS });
    }

    const { email, tool_name, contractor_name } = body;

    if (!email || !email.includes("@")) {
      return Response.json({ ok: false, error: "Valid email required" }, { status: 400, headers: CORS });
    }

    const toolSlug = (tool_name || "").toLowerCase().replace(/[^a-z0-9-]/g, "-");

    // Save lead
    const { error } = await supabase.from("tool_leads").insert({
      email: email.toLowerCase().trim(),
      tool_name: toolSlug,
      contractor_name: contractor_name?.trim() || null,
    });

    // Duplicate is fine — still send email
    if (error && error.code !== "23505") {
      console.error("tool-lead-capture insert error:", error.message);
    }

    // Send welcome email (fire and forget)
    sendWelcomeEmail(email.toLowerCase().trim(), toolSlug).catch(() => {});

    // Also enqueue to keyword finder so we see what tools are getting traction
    await supabase.from("telegram_digest_queue").insert({
      message: `🔧 Tool download: ${TOOL_NAMES[toolSlug] || toolSlug} — ${email}`,
      category: "seo",
    }).catch(() => {});

    return Response.json({ ok: true }, { headers: CORS });

  } catch (err) {
    console.error("tool-lead-capture error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

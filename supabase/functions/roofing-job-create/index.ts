import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-job-create ready" });

  const {
    session_token,
    homeowner_name,
    property_address,
    city,
    state,
    insurance_carrier,
    homeowner_email,
    homeowner_phone,
    damage_type,
    notes,
    scheduled_start,
  } = body;

  if (!session_token) {
    return Response.json({ error: "session_token required" }, { status: 401, headers: corsHeaders });
  }

  // Verify session
  const { data: session } = await supabase
    .from("contractor_sessions")
    .select("contractor_id, expires_at")
    .eq("token", session_token)
    .single();

  if (!session || new Date(session.expires_at) < new Date()) {
    return Response.json({ error: "Invalid or expired session" }, { status: 401, headers: corsHeaders });
  }

  if (!homeowner_name && !property_address) {
    return Response.json({ error: "homeowner_name or property_address required" }, { status: 400, headers: corsHeaders });
  }

  // Generate portal token
  const token = `ROS-${Date.now().toString(36).toUpperCase()}`;

  // Create job
  const { data: job, error: jobErr } = await supabase
    .from("roofing_jobs")
    .insert({
      contractor_id: session.contractor_id,
      homeowner_name: homeowner_name || null,
      homeowner_email: homeowner_email || null,
      homeowner_phone: homeowner_phone || null,
      property_address: property_address || null,
      city: city || null,
      state: state || null,
      insurance_carrier: insurance_carrier || null,
      job_type: damage_type || null,
      notes: notes || null,
      scheduled_start: scheduled_start || null,
      status: "active",
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return Response.json({ error: jobErr?.message || "Failed to create job" }, { status: 500, headers: corsHeaders });
  }

  // Create homeowner portal session
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await supabase.from("homeowner_sessions").insert({
    job_id: job.id,
    contractor_id: session.contractor_id,
    homeowner_name: homeowner_name || null,
    homeowner_email: homeowner_email || null,
    homeowner_phone: homeowner_phone || null,
    property_address: property_address || null,
    magic_link_token: token,
    magic_link_expires_at: expiresAt.toISOString(),
  });

  // First portal activity
  await supabase.from("portal_activities").insert({
    job_id: job.id,
    activity_type: "job_created",
    title: "Your project file is open",
    title_es: "Tu archivo de proyecto está abierto",
    description: "Your contractor opened your project file. You can track everything here in real time.",
    description_es: "Tu contratista abrió tu archivo de proyecto. Puedes rastrear todo aquí en tiempo real.",
    icon: "folder",
    visible_to_homeowner: true,
    created_by: "Roofing OS",
  });

  const portalUrl = `https://roofingos.dev/portal/?token=${token}`;

  // Send homeowner portal email
  if (homeowner_email) {
    const firstName = (homeowner_name || "").split(" ")[0] || "there";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Roofing OS <zach@nexuszc.com>",
        to: homeowner_email,
        subject: "Your roofing project is underway",
        html: `<div style="font-family:-apple-system,sans-serif;max-width:520px;line-height:1.7;color:#1a1a1a;padding:20px;">
<p>Hi ${firstName} —</p>
<p>Your contractor just opened your project file.</p>
<p>Track everything here — crew updates, photos, your insurance status in plain English:</p>
<p style="margin:24px 0"><a href="${portalUrl}" style="background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View Your Project →</a></p>
<p>No need to call your contractor. Everything updates in real time.</p>
<p style="color:#64748b;font-size:14px;">Roofing OS · roofingos.dev</p>
</div>`,
      }),
    }).catch(() => {});
  }

  // Advance onboarding on first job
  const { count } = await supabase
    .from("roofing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("contractor_id", session.contractor_id);

  if ((count || 0) <= 1) {
    await supabase.from("contractor_accounts")
      .update({ onboarding_step: "first_job_added", first_job_at: new Date().toISOString() })
      .eq("id", session.contractor_id);

    const { data: ca } = await supabase.from("contractor_accounts")
      .select("company_name")
      .eq("id", session.contractor_id)
      .maybeSingle();

    const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const tgChatId = Deno.env.get("TELEGRAM_CHAT_ID");
    if (tgToken && tgChatId) {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChatId,
          text: `🎉 First job created — ${ca?.company_name || session.contractor_id}\nHomeowner: ${homeowner_name || "unknown"}\nThey're live.`,
        }),
      }).catch(() => {});
    }
  }

  return Response.json({
    ok: true,
    job_id: job.id,
    portal_token: token,
    portal_url: portalUrl,
  }, { headers: corsHeaders });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });

  const { job_id, homeowner_email, homeowner_name, homeowner_phone, contractor_name } = await req.json().catch(() => ({}));

  if (!job_id || !homeowner_email) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const { data: session, error } = await supabase
    .from("homeowner_sessions")
    .upsert({
      job_id,
      homeowner_email,
      homeowner_name,
      homeowner_phone,
      magic_link_token: token,
      magic_link_expires_at: expires.toISOString()
    }, { onConflict: "job_id" })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const portalUrl = `https://roofingos.dev/portal/${token}`;
  const firstName = homeowner_name?.split(" ")[0] || "there";
  const contractorLabel = contractor_name || "Your contractor";

  if (homeowner_phone) {
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioFrom = Deno.env.get("TWILIO_PHONE_NUMBER") || Deno.env.get("RETELL_PHONE_NUMBER") || "";
    if (twilioSid && twilioAuth) {
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({
            From: twilioFrom,
            To: homeowner_phone,
            Body: `Hi ${firstName}, your ${contractorLabel} project portal is ready. Track your roof project, view photos, and sign documents: ${portalUrl}`
          })
        }
      ).catch(() => {});
    }
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `${contractorLabel} <roofing@nexuszc.com>`,
        to: homeowner_email,
        subject: `Your ${contractorLabel} project portal is ready`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0f;color:#f8fafc;padding:32px;border-radius:12px">
            <h2 style="color:#60a5fa;margin-bottom:8px">Your project portal is ready, ${firstName}</h2>
            <p style="color:#94a3b8">Track your roof project in real time, view photos as your crew works, sign documents, and communicate with your team — all in one place.</p>
            <a href="${portalUrl}" style="display:inline-block;background:#3b82f6;color:white;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0;font-size:16px">Open Your Project Portal →</a>
            <p style="color:#475569;font-size:14px">This link is personal to you and never expires. Bookmark it for easy access.</p>
            <hr style="border:none;border-top:1px solid #1e1e2e;margin:24px 0">
            <p style="color:#475569;font-size:12px">${contractorLabel} | Powered by Roofing OS</p>
          </div>
        `
      })
    }).catch(() => {});
  }

  await supabase.from("portal_activities").insert({
    job_id,
    activity_type: "portal_created",
    title: "Your project portal is ready",
    description: `Welcome to your ${contractorLabel} project portal. You can track every step of your roof project here.`,
    description_es: `Bienvenido a su portal de proyecto. Puede seguir cada paso de su proyecto de techo aquí.`,
    icon: "🏠"
  });

  return Response.json({ ok: true, portal_url: portalUrl, token });
});

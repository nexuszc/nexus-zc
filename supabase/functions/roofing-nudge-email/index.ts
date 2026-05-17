import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true });

  const { prospect_id, subject, html } = body as {
    prospect_id?: string;
    subject?: string;
    html?: string;
  };

  if (!prospect_id) {
    return Response.json({ error: "prospect_id required" }, { status: 400 });
  }

  const { data: prospect } = await supabase
    .from("roofing_prospects")
    .select("*")
    .eq("id", prospect_id)
    .single();

  if (!prospect?.email) {
    return Response.json({ error: "No email for prospect" }, { status: 400 });
  }

  const firstName = (prospect.owner_name || "there").split(" ")[0];
  const defaultSubject = "Quick follow up";
  const defaultHtml = `<div style="font-family:-apple-system,sans-serif;max-width:520px;line-height:1.7;color:#1a1a1a;padding:20px;">
<p>Hey ${firstName} —</p>
<p>Just wanted to make sure my last email didn't get buried.</p>
<p>Worth 30 seconds:<br>
<a href="https://app.nexuszc.com/roofing/portal/DEMO2026ROOFINGOS" style="color:#3b82f6;">
See the homeowner portal →</a></p>
<p>$49/month. No contract.<br>— Zach @ Roofing OS</p>
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Zach Curtis <zach@roofingos.dev>",
      reply_to: "zach@roofingos.dev",
      to: prospect.email,
      subject: subject || defaultSubject,
      html: html || defaultHtml,
      track_opens: true,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return Response.json({ error: data?.message || "Resend error" }, {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  await supabase.from("roofing_outreach_log").insert({
    prospect_id: prospect.id,
    touch_type: "manual_email",
    touch_number: 99,
    subject: subject || defaultSubject,
    resend_email_id: data.id,
    sent_at: new Date().toISOString(),
  });

  return Response.json({ ok: true, id: data.id }, {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
});

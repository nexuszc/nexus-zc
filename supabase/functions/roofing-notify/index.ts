import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME  = Deno.env.get("RESEND_FROM_NAME")  || "Zach @ Roofing OS";


const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sendSMS(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.warn("Twilio secrets not configured — SMS skipped");
    return { skipped: true };
  }
  const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: body }),
    }
  );
  return res.json();
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not configured — email skipped");
    return { skipped: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    }),
  });
  return res.json();
}

Deno.serve(async (req) => {
  const { event, job_id, data } = await req.json();

  if (!job_id) return Response.json({ error: "job_id required" }, { status: 400 });

  const { data: job } = await supabase
    .from("roofing_jobs")
    .select("*, clients(name, phone, notification_email, notify_sms, notify_email, primary_color, logo_url, company_tagline)")
    .eq("id", job_id)
    .single();

  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

  const contractor = job.clients;
  const portalUrl = `https://app.nexuszc.com/roofing/portal/${job.portal_token}`;
  const jobUrl = `https://app.nexuszc.com/roofing/jobs/${job_id}`;

  const notifications: Promise<unknown>[] = [];

  if (event === "homeowner_message") {
    const msg = data?.message || "";

    if (contractor.notify_sms && contractor.phone) {
      notifications.push(sendSMS(
        contractor.phone,
        `New message from ${job.homeowner_name} (${job.property_address}):\n"${msg.slice(0, 120)}"\n\nReply at: ${jobUrl}`
      ));
    }

    if (contractor.notify_email && contractor.notification_email) {
      notifications.push(sendEmail(
        contractor.notification_email,
        `New message from ${job.homeowner_name}`,
        `<p><strong>${job.homeowner_name}</strong> sent a message about their job at ${job.property_address}:</p>
         <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555">${msg}</blockquote>
         <p><a href="${jobUrl}" style="background:#1a1a1a;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">View Job</a></p>`
      ));
    }
  }

  if (event === "payment_received") {
    const amount = data?.amount || 0;

    if (contractor.notify_sms && contractor.phone) {
      notifications.push(sendSMS(
        contractor.phone,
        `💰 Payment received: $${amount} from ${job.homeowner_name} (${job.property_address}). Total paid: $${(job.amount_paid || 0) + amount}.`
      ));
    }

    if (contractor.notify_email && contractor.notification_email) {
      notifications.push(sendEmail(
        contractor.notification_email,
        `Payment received: $${amount} from ${job.homeowner_name}`,
        `<p>You received a payment of <strong>$${amount}</strong> from <strong>${job.homeowner_name}</strong>.</p>
         <p>Property: ${job.property_address}</p>
         <p>Contract total: $${job.contract_amount} | Paid so far: $${(job.amount_paid || 0) + amount}</p>
         <p><a href="${jobUrl}" style="background:#1a1a1a;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">View Job</a></p>`
      ));
    }
  }

  if (event === "job_created") {
    if (contractor.notify_email && contractor.notification_email) {
      notifications.push(sendEmail(
        contractor.notification_email,
        `New job created: ${job.homeowner_name}`,
        `<p>A new job has been created for <strong>${job.homeowner_name}</strong> at ${job.property_address}.</p>
         <p>Job type: ${job.job_type?.replace(/_/g, " ") || "roofing"}</p>
         <p><a href="${jobUrl}" style="background:#1a1a1a;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">View Job</a></p>`
      ));
    }
  }

  if (event === "portal_link") {
    if (job.homeowner_email) {
      const brandColor = contractor.primary_color || "#1a1a1a";
      notifications.push(sendEmail(
        job.homeowner_email,
        `Your roofing project portal — ${contractor.name}`,
        `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <div style="background:${brandColor};padding:24px;border-radius:8px 8px 0 0">
            ${contractor.logo_url ? `<img src="${contractor.logo_url}" alt="logo" style="height:40px;margin-bottom:8px" />` : ""}
            <h2 style="color:#fff;margin:0">${contractor.name}</h2>
            ${contractor.company_tagline ? `<p style="color:rgba(255,255,255,0.7);margin:4px 0 0">${contractor.company_tagline}</p>` : ""}
          </div>
          <div style="padding:24px;background:#f9f9f9;border-radius:0 0 8px 8px">
            <p>Hi ${job.homeowner_name},</p>
            <p>Your roofing project portal is ready. Track your job progress, view photos, review documents, and message us directly.</p>
            <p style="text-align:center;margin:32px 0">
              <a href="${portalUrl}" style="background:${brandColor};color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-size:16px">View Your Project Portal</a>
            </p>
            <p style="color:#888;font-size:12px">This link is unique to your project. Bookmark it for easy access.</p>
          </div>
        </div>`
      ));
    }

    if (job.homeowner_phone) {
      notifications.push(sendSMS(
        job.homeowner_phone,
        `Hi ${job.homeowner_name}! ${contractor.name} has set up your roofing project portal. Track progress, photos, and documents here: ${portalUrl}`
      ));
    }
  }

  if (event === "document_ready") {
    const docType = data?.doc_type || "document";
    if (job.homeowner_email) {
      notifications.push(sendEmail(
        job.homeowner_email,
        `Your ${docType} is ready — ${contractor.name}`,
        `<p>Hi ${job.homeowner_name},</p>
         <p>Your <strong>${docType}</strong> from ${contractor.name} is ready to view in your project portal.</p>
         <p><a href="${portalUrl}" style="background:#1a1a1a;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">View in Portal</a></p>`
      ));
    }
    if (job.homeowner_phone) {
      notifications.push(sendSMS(
        job.homeowner_phone,
        `Your ${docType} from ${contractor.name} is ready. View it here: ${portalUrl}`
      ));
    }
  }

  if (event === "portal_viewed") {
    await supabase.from("roofing_jobs")
      .update({ portal_last_viewed_at: new Date().toISOString() })
      .eq("id", job_id);
    return Response.json({ ok: true, event: "portal_viewed" });
  }

  await Promise.allSettled(notifications);
  return Response.json({ ok: true, event, notifications_sent: notifications.length });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

function insurancePlainEnglish(claim: Record<string, unknown> | null): string {
  if (!claim) return "No insurance claim has been filed yet.";
  const status = claim.status as string || "";
  const carrier = claim.carrier_name as string || "your insurance company";
  const adjuster = claim.adjuster_name as string || "";
  const estimate = claim.estimate_amount ? `$${((claim.estimate_amount as number) / 100).toLocaleString()}` : null;
  const supplement = claim.supplement_requested ? `$${((claim.supplement_requested as number) / 100).toLocaleString()}` : null;

  const statusMessages: Record<string, string> = {
    filed: `Your claim has been filed with ${carrier}. We're waiting for them to assign an adjuster.`,
    adjuster_assigned: `${carrier} has assigned ${adjuster ? `adjuster ${adjuster}` : "an adjuster"}. We're scheduling the inspection.`,
    inspection_scheduled: `The insurance adjuster is coming to inspect your roof. We'll be there too.`,
    estimate_received: `${carrier} has sent their estimate${estimate ? ` of ${estimate}` : ""}. We're reviewing it now.`,
    supplement_requested: `We've requested additional money from ${carrier}${supplement ? ` — ${supplement} more` : ""}. Waiting for their response.`,
    supplement_approved: `${carrier} approved the extra money${supplement ? ` (${supplement})` : ""}. Ready to finalize your repair scope.`,
    supplement_denied: `${carrier} denied part of our request. We're working on a rebuttal to get you what you're owed.`,
    approved: `Your claim is approved${estimate ? ` for ${estimate}` : ""}. We're scheduling your installation.`,
    check_received: `Your insurance check has arrived. We're processing it now.`,
    closed: `Your insurance claim is fully closed. Repair and payment complete.`,
  };
  return statusMessages[status] || `Your claim with ${carrier} is in progress (status: ${status}). We'll update you as things move.`;
}

async function generateAriaResponse(
  message: string,
  session: Record<string, unknown>,
  job: Record<string, unknown> | null,
  claim: Record<string, unknown> | null,
  supplements?: Record<string, unknown>[],
  recentActivities?: Record<string, unknown>[]
): Promise<string | null> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `You are Aria, a helpful AI assistant for a roofing company. Answer this homeowner's question using their specific job data.

Homeowner: ${session.homeowner_name}
Property: ${job?.property_address || "on file"}
Job status: ${job?.status || "in progress"}
Insurance: ${insurancePlainEnglish(claim)}
Open supplements: ${(supplements || []).filter(s => !["approved", "closed"].includes(s.status as string)).length} in progress
Recent activity: ${(recentActivities || []).slice(0, 3).map(a => a.title).join("; ") || "none"}

Question: "${message}"

Rules:
- Use their first name
- Reference their specific situation
- Plain English only — no insurance jargon
- Under 3 sentences
- If unsure, say "Let me get that confirmed for you — your rep will follow up shortly"
- Never make up specific numbers or dates

Respond with just the message text.`
      }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      }
    });
  }

  const url = new URL(req.url);
  let token = url.searchParams.get("token");
  let action = url.searchParams.get("action");

  // For POST requests, token and action may come from body
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
    if (!token) token = body.token as string;
    if (!action) action = body.action as string;
  }

  if (!token) {
    return Response.json({ error: "No token provided" }, {
      status: 401,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  const { data: session } = await supabase
    .from("homeowner_sessions")
    .select("*, roofing_jobs(*)")
    .eq("magic_link_token", token)
    .gt("magic_link_expires_at", new Date().toISOString())
    .maybeSingle();

  if (!session) {
    return Response.json({ error: "Invalid or expired link" }, {
      status: 401,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  await supabase
    .from("homeowner_sessions")
    .update({
      last_accessed_at: new Date().toISOString(),
      access_count: (session.access_count || 0) + 1
    })
    .eq("id", session.id);

  const jobId = session.job_id;
  const job = session.roofing_jobs as Record<string, unknown> | null;

  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  switch (action) {
    case "overview": {
      const [
        activitiesRes,
        photosRes,
        claimRes,
        supplementsRes,
        documentsRes,
        paymentsRes,
        messagesRes,
        monitoringRes,
        integrationsRes
      ] = await Promise.all([
        supabase.from("portal_activities").select("*").eq("job_id", jobId).eq("visible_to_homeowner", true).order("created_at", { ascending: false }).limit(20),
        supabase.from("portal_photos").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
        supabase.from("insurance_claims").select("*").eq("job_id", jobId).maybeSingle(),
        supabase.from("supplement_tracker").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
        supabase.from("portal_documents").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
        supabase.from("portal_payments").select("*").eq("job_id", jobId).order("due_date", { ascending: true }),
        supabase.from("portal_messages").select("*").eq("job_id", jobId).order("created_at", { ascending: false }).limit(50),
        supabase.from("roof_monitoring").select("*").eq("job_id", jobId).maybeSingle(),
        supabase.from("contractor_integrations").select("integration_type, status, last_sync_at").eq("contractor_id", job.contractor_id).eq("status", "active")
      ]);

      const progressMap: Record<string, number> = {
        lead: 5, assessment_scheduled: 10, assessed: 20, estimate_sent: 30,
        contracted: 40, insurance_submitted: 50, materials_ordered: 60,
        scheduled: 70, in_progress: 80, complete: 95, paid: 100
      };
      const progress = progressMap[job?.status as string] || 0;

      const address = job?.property_address as string;
      const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
      const satelliteUrl = address && googleKey
        ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(address)}&zoom=19&size=600x400&maptype=satellite&key=${googleKey}`
        : null;

      const allActivities = activitiesRes.data || [];
      const timeline = [...allActivities].reverse(); // chronological for timeline view

      return new Response(JSON.stringify({
        ok: true,
        session: {
          homeowner_name: session.homeowner_name,
          language: session.preferred_language,
          notifications: session.notification_preferences
        },
        job: { ...job, progress, satellite_url: satelliteUrl },
        activities: allActivities,
        timeline,
        insurance_status_plain: insurancePlainEnglish(claimRes.data),
        claim: claimRes.data,
        supplements: supplementsRes.data || [],
        documents: documentsRes.data || [],
        payments: paymentsRes.data || [],
        messages: (messagesRes.data || []).reverse(),
        monitoring: monitoringRes.data,
        integration_sources: (integrationsRes.data || []).map((i: Record<string, unknown>) => i.integration_type)
      }), { headers: corsHeaders });
    }

    case "send_message": {
      const msg = body.message as string;
      if (!msg?.trim()) {
        return new Response(JSON.stringify({ error: "Message required" }), { status: 400, headers: corsHeaders });
      }

      await supabase.from("portal_messages").insert({
        job_id: jobId,
        sender_type: "homeowner",
        sender_name: session.homeowner_name || "Homeowner",
        message: msg,
        requires_response: true
      });

      await sendTelegram(
        `💬 *Homeowner message*\n` +
        `*${session.homeowner_name}* — ${job?.property_address || "unknown address"}\n` +
        `"${msg}"\n` +
        `Reply in the portal or call ${session.homeowner_phone}`
      );

      const [{ data: claimData }, { data: suppData }, { data: actData }] = await Promise.all([
        supabase.from("insurance_claims").select("*").eq("job_id", jobId).maybeSingle(),
        supabase.from("supplement_tracker").select("status, description").eq("job_id", jobId).limit(10),
        supabase.from("portal_activities").select("title").eq("job_id", jobId).eq("visible_to_homeowner", true).order("created_at", { ascending: false }).limit(5)
      ]);
      const ariaResponse = await generateAriaResponse(msg, session, job, claimData, suppData || [], actData || []);

      if (ariaResponse) {
        await supabase.from("portal_messages").insert({
          job_id: jobId,
          sender_type: "aria",
          sender_name: "Aria",
          message: ariaResponse
        });
      }

      return new Response(JSON.stringify({ ok: true, aria_response: ariaResponse }), { headers: corsHeaders });
    }

    case "sign_document": {
      const { document_id, document_title, signature_data } = body as Record<string, string>;
      if (!document_id) {
        return new Response(JSON.stringify({ error: "document_id required" }), { status: 400, headers: corsHeaders });
      }

      await supabase.from("portal_documents")
        .update({ status: "signed", signed_at: new Date().toISOString(), signature_data })
        .eq("id", document_id)
        .eq("job_id", jobId);

      await supabase.from("portal_activities").insert({
        job_id: jobId,
        activity_type: "document_signed",
        title: "Document signed",
        description: `${session.homeowner_name} signed the ${document_title || "document"}.`,
        description_es: `${session.homeowner_name} firmó el documento.`,
        icon: "✍️"
      });

      // MOVED_TO_DASHBOARD [date: 2026-05-17]: document signatures visible in Portal tab (portal_documents.status='signed')
      // await sendTelegram(`✍️ *Document signed*\n${session.homeowner_name} signed: ${document_title || "document"}`);

      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    case "submit_referral": {
      const { name, address: refAddress, phone: refPhone } = body as Record<string, string>;
      const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      await supabase.from("portal_referrals").insert({
        referring_job_id: jobId,
        referring_homeowner_email: session.homeowner_email,
        referral_code: referralCode,
        referred_name: name,
        referred_address: refAddress,
        referred_phone: refPhone
      });

      // MOVED_TO_DASHBOARD [date: 2026-05-17]: homeowner referrals visible in Portal tab (portal_referrals table)
      // await sendTelegram(`🎯 *New referral*\nFrom: ${session.homeowner_name}\nReferred: ${name} at ${refAddress}\nPhone: ${refPhone}`);

      return new Response(JSON.stringify({ ok: true, referral_code: referralCode }), { headers: corsHeaders });
    }

    case "update_preferences": {
      const { preferences, language } = body as { preferences?: Record<string, boolean>; language?: string };

      await supabase.from("homeowner_sessions")
        .update({ notification_preferences: preferences, preferred_language: language || "en" })
        .eq("id", session.id);

      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
  }
});

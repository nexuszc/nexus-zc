import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// v1 scheduling: call this endpoint every 15 minutes from an external cron
// (e.g. GitHub Actions). No native Supabase Edge Function cron yet.
// Max 50 enrollments per run: ~300ms/send × 50 = ~15s, well within 150s limit.
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME  = Deno.env.get("RESEND_FROM_NAME")  || "Zach @ Roofing OS";

const BATCH_LIMIT = 50;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const FUNCTION_BASE_URL = "https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1";

// ── Personalization ───────────────────────────────────────────────────────────
function personalize(template: string, lead: Record<string, unknown>): string {
  return template
    .replace(/\{\{first_name\}\}/gi, (lead.first_name as string) ?? "")
    .replace(/\{\{last_name\}\}/gi,  (lead.last_name  as string) ?? "")
    .replace(/\{\{address\}\}/gi,    (lead.address    as string) ?? "")
    .replace(/\{\{phone\}\}/gi,      (lead.phone      as string) ?? "")
    .replace(/\{\{city\}\}/gi,       (lead.city       as string) ?? "")
    .replace(/\{\{state\}\}/gi,      (lead.state      as string) ?? "");
}

// ── Tracking injection ────────────────────────────────────────────────────────
function injectPixel(html: string, token: string): string {
  const pixel = `<img src="${FUNCTION_BASE_URL}/email-webhook/pixel/${token}" `
    + `width="1" height="1" style="display:none" alt="">`;
  return html.includes("</body>") ? html.replace("</body>", `${pixel}</body>`) : html + pixel;
}

function wrapLinks(html: string, token: string): string {
  return html.replace(
    /href=(["'])(https?:\/\/[^"']+)\1/gi,
    (_, q, url) =>
      `href=${q}${FUNCTION_BASE_URL}/email-webhook/click/${token}?url=${encodeURIComponent(url)}${q}`
  );
}

// ── Send + log helper ─────────────────────────────────────────────────────────
// Inlined here to avoid an internal HTTP hop to send-email.
async function sendAndLog(
  supabase: SupabaseClient,
  apiKey: string,
  params: {
    lead_id: string;
    enrollment_id: string;
    step_id: string;
    email_template_id: string;
    to_email: string;
    subject: string;
    body_html: string;
    body_text: string;
    from_name?: string;
  }
): Promise<string> { // returns email_send_id
  const {
    lead_id, enrollment_id, step_id, email_template_id,
    to_email, subject, body_html, body_text, from_name,
  } = params;

  const { data: row, error: insertErr } = await supabase
    .from("email_sends")
    .insert({ lead_id, enrollment_id, step_id, email_template_id, to_email, subject, body_html })
    .select("id, tracking_token")
    .single();

  if (insertErr || !row) {
    throw new Error(`email_sends insert failed: ${insertErr?.message}`);
  }

  const { id: emailSendId, tracking_token: token } = row as { id: string; tracking_token: string };
  const trackedHtml = injectPixel(wrapLinks(body_html, token), token);
  const sender = `${FROM_NAME} <${FROM_EMAIL}>`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sender,
      to: [to_email],
      reply_to: FROM_EMAIL,
      subject,
      html: trackedHtml,
      text: body_text,
      tags: [{ name: "tracking_token", value: token }],
    }),
  });

  if (!resendRes.ok) {
    await supabase.from("email_sends").delete().eq("id", emailSendId);
    const errBody = await resendRes.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Resend ${resendRes.status}: ${errBody.message ?? resendRes.statusText}`);
  }

  // Store post-tracking HTML (with pixel + click links) as the canonical snapshot.
  await supabase.from("email_sends").update({ body_html: trackedHtml, sent_at: new Date().toISOString() }).eq("id", emailSendId);
  return emailSendId;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY secret not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const { client_id } = body; // optional — omit to process all clients

    const now = new Date().toISOString();

    // ── Fetch due enrollments with lead data ──────────────────────────────────
    // lead_enrollments has no client_id; filter via lead data in Deno.
    const { data: enrollments, error: enrollErr } = await supabase
      .from("lead_enrollments")
      .select(`
        id, lead_id, template_id, current_step_number,
        leads(id, first_name, last_name, email, phone, address, city, state,
              unsubscribed_from_email, client_id)
      `)
      .is("completed_at", null)
      .lte("next_step_due_at", now)
      .limit(BATCH_LIMIT);

    if (enrollErr) return bad(`Enrollment fetch error: ${enrollErr.message}`);
    if (!enrollments || enrollments.length === 0) {
      return ok({ processed: 0, sent: 0, skipped: 0, errors: [] });
    }

    // ── Batch-fetch sequence steps for all active templates ───────────────────
    const templateIds = [...new Set(enrollments.map(e => e.template_id as string))];

    const { data: allSteps, error: stepsErr } = await supabase
      .from("sequence_steps")
      .select("id, template_id, step_number, days_after_previous, channel, email_template_id")
      .in("template_id", templateIds);

    if (stepsErr) return bad(`Steps fetch error: ${stepsErr.message}`);

    const stepMap = new Map<string, Record<string, unknown>>();
    for (const s of allSteps ?? []) {
      stepMap.set(`${s.template_id}:${s.step_number}`, s as Record<string, unknown>);
    }

    // ── Batch-fetch email templates for any email/both steps ──────────────────
    const emailTemplateIds = [...new Set(
      (allSteps ?? [])
        .filter(s => s.email_template_id && s.channel !== "call")
        .map(s => s.email_template_id as string)
    )];

    let emailTemplateMap = new Map<string, Record<string, unknown>>();
    if (emailTemplateIds.length > 0) {
      const { data: emailTemplates } = await supabase
        .from("email_templates")
        .select("id, subject, body_html, body_text")
        .in("id", emailTemplateIds);

      emailTemplateMap = new Map((emailTemplates ?? []).map(t => [t.id as string, t as Record<string, unknown>]));
    }

    // ── Process each enrollment ───────────────────────────────────────────────
    let processed = 0;
    let sent = 0;
    let skipped = 0;
    const errors: { enrollment_id: string; reason: string }[] = [];

    for (const enrollment of enrollments) {
      processed++;
      const enrollmentId = enrollment.id as string;
      const lead = enrollment.leads as Record<string, unknown> | null;

      // Filter by client_id if provided.
      if (client_id && lead?.client_id !== client_id) { skipped++; continue; }

      const stepKey = `${enrollment.template_id}:${enrollment.current_step_number}`;
      const step = stepMap.get(stepKey);

      if (!step) {
        errors.push({ enrollment_id: enrollmentId, reason: `step ${stepKey} not found` });
        continue;
      }

      // Skip call-only steps — VA advances these when they log a call.
      if (step.channel === "call") { skipped++; continue; }

      // Skip unsubscribed leads.
      if (lead?.unsubscribed_from_email) { skipped++; continue; }

      // Skip leads with no email address.
      if (!lead?.email) {
        errors.push({ enrollment_id: enrollmentId, reason: "lead has no email address" });
        continue;
      }

      const emailTemplate = emailTemplateMap.get(step.email_template_id as string);
      if (!emailTemplate) {
        errors.push({ enrollment_id: enrollmentId, reason: `email_template ${step.email_template_id} not found` });
        continue;
      }

      // Personalize subject and body.
      const subject  = personalize(emailTemplate.subject  as string, lead);
      const bodyHtml = personalize(emailTemplate.body_html as string, lead);
      const bodyText = personalize(emailTemplate.body_text as string, lead);

      // Send.
      try {
        await sendAndLog(supabase, apiKey, {
          lead_id:           lead.id          as string,
          enrollment_id:     enrollmentId,
          step_id:           step.id          as string,
          email_template_id: step.email_template_id as string,
          to_email:          lead.email       as string,
          subject,
          body_html: bodyHtml,
          body_text: bodyText,
        });
        sent++;
      } catch (sendErr) {
        errors.push({ enrollment_id: enrollmentId, reason: (sendErr as Error).message });
        continue;
      }

      // ── Advance enrollment ────────────────────────────────────────────────
      const nextStepNum = (enrollment.current_step_number as number) + 1;
      const nextStep = stepMap.get(`${enrollment.template_id}:${nextStepNum}`);

      if (nextStep) {
        const nextDue = new Date();
        nextDue.setDate(nextDue.getDate() + (nextStep.days_after_previous as number));
        await supabase.from("lead_enrollments").update({
          current_step_number: nextStepNum,
          next_step_due_at: nextDue.toISOString(),
        }).eq("id", enrollmentId);
      } else {
        // No more steps — enrollment complete.
        await supabase.from("lead_enrollments").update({
          completed_at:  new Date().toISOString(),
          exited_reason: "completed",
        }).eq("id", enrollmentId);
      }
    }

    return ok({ processed, sent, skipped, errors });

  } catch (err) {
    console.error("process-email-queue error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bad(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

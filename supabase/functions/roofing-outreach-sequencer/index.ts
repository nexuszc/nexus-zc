// roofing-outreach-sequencer v6
// 3-touch lead gen sequence: email → voice drop + SMS → email
// Runs daily at 9am MT (14:00 UTC)
// Touch 1 (day 0): email — "Your homeowners are calling too much"
// Touch 2 (day 2): voice drop + SMS
// Touch 3 (day 4): final email

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") || "").replace(/[^\x20-\x7E]/g, "").trim();
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CLICK_TRACKER_BASE = `${SUPABASE_URL}/functions/v1/roofing-click-tracker`;
const EMAIL_TRACKER_BASE = `${SUPABASE_URL}/functions/v1/roofing-email-tracker`;

function trackerUrl(prospectId: string, touch: number, dest: "portal" | "website"): string {
  return `${CLICK_TRACKER_BASE}?pid=${prospectId}&touch=${touch}&dest=${dest}`;
}

function firstName(name: string | null): string {
  return (name || "").split(" ")[0] || "there";
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

function pixelHtml(logId: string): string {
  return `<img src="${EMAIL_TRACKER_BASE}?lid=${logId}" width="1" height="1" style="display:block;width:1px;height:1px;" alt="" />`;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<string | null> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Zach Curtis <ops@nexuszc.com>",
        reply_to: "zach@nexuszc.com",
        to: [to],
        subject,
        html,
        track_opens: true,
        track_clicks: true,
      }),
    });
    const data = await res.json();
    if (data.id) return data.id;
    console.error("Resend error:", JSON.stringify(data));
    return null;
  } catch (e) {
    console.error("sendEmail threw:", e);
    return null;
  }
}

async function sendSMS(to: string, body: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return;
  const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  ).catch(() => {});
}

async function fireVoiceDrop(prospect: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        call_type: "voice_drop",
        contact_phone: prospect.phone,
        contact_name: prospect.owner_name,
        contact_type: "prospect",
        language: "en",
        metadata: {
          contractor_name: prospect.company_name,
          first_name: firstName(prospect.owner_name as string),
        },
      }),
    });
  } catch { /* non-fatal */ }
}

function emailTouch1(prospect: Record<string, unknown>): { subject: string; html: string } {
  const fn = firstName(prospect.owner_name as string);
  const link = trackerUrl(prospect.id as string, 1, "portal");
  const text = [
    `Hey ${fn} —`,
    ``,
    `Zach Curtis here, founder of Roofing OS.`,
    ``,
    `Quick question — how many times did a homeowner call you during an installation last week?`,
    ``,
    `We built something that makes those calls stop completely.`,
    ``,
    `Homeowners see their house from satellite, their job progress in real time, their insurance status in plain English. Aria — our AI — answers their questions 24 hours a day.`,
    ``,
    `They stop calling because they already know everything.`,
    ``,
    `Takes 30 seconds to see it:`,
    link,
    ``,
    `Full product at roofingos.dev.`,
    `Starts at $49/month. No contract.`,
    ``,
    `Zach`,
    `Founder, Roofing OS`,
    `roofingos.dev`,
  ].join("\n");

  return {
    subject: "Your homeowners are calling too much",
    html: `<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.7;color:#333;">${text.replace(/\n/g, "<br>")}</div>`,
  };
}

function emailTouch3(prospect: Record<string, unknown>): { subject: string; html: string } {
  const fn = firstName(prospect.owner_name as string);
  const company = (prospect.company_name as string) || "";
  const link = trackerUrl(prospect.id as string, 3, "portal");
  const text = [
    `Hey ${fn} —`,
    ``,
    `Last one from me.`,
    ``,
    `If your homeowners ever stop calling during installations on their own — you found a better solution.`,
    ``,
    `If not — we solve it for $49/month.`,
    ``,
    `See it in 30 seconds:`,
    link,
    ``,
    `Or see everything at roofingos.dev.`,
    ``,
    `Zach`,
    `Roofing OS`,
  ].join("\n");

  return {
    subject: `Last note — ${company}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.7;color:#333;">${text.replace(/\n/g, "<br>")}</div>`,
  };
}

function smsTouch2(prospect: Record<string, unknown>): string {
  const fn = firstName(prospect.owner_name as string);
  const link = trackerUrl(prospect.id as string, 2, "portal");
  return `${fn} — this is what your homeowners see instead of calling you during installations:\n${link}\n\n$49/month. roofingos.dev\n— Zach @ Roofing OS`;
}

async function logTouch(
  prospectId: string,
  touchType: string,
  touchNumber: number,
  subject: string | null,
  body: string | null,
  resendEmailId?: string | null
): Promise<string | null> {
  try {
    const { data } = await supabase.from("roofing_outreach_log").insert({
      prospect_id: prospectId,
      touch_type: touchType,
      touch_number: touchNumber,
      direction: "outbound",
      subject: subject || "",
      body: body || "",
      resend_email_id: resendEmailId || null,
    }).select("id").single();
    return data?.id || null;
  } catch (e) {
    console.error("logTouch error:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* empty body or non-JSON — fine */ }

  if (body.test) return Response.json({ ok: true, message: "roofing-outreach-sequencer ready" });

  // Debug: fire one test email and return raw Resend response
  if (body.debug_email) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Zach Curtis <ops@nexuszc.com>",
          to: [body.debug_email],
          subject: "Resend test",
          html: "<p>test</p>",
        }),
      });
      const data = await res.json();
      return Response.json({ ok: true, resend_status: res.status, resend_response: data });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) });
    }
  }

  const startMs = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();

  let enrolled = 0;
  let emailsSent = 0;
  let voiceDrops = 0;
  let smsSent = 0;
  let errors = 0;

  // ── STEP A — Enroll new prospects ──────────────────────────────────────────
  console.log("STEP A: enrolling new prospects");
  try {
    const { data: toEnroll, error: enrollErr } = await supabase
      .from("roofing_prospects")
      .select("id")
      .eq("in_sequence", false)
      .not("email", "is", null)
      .is("outcome", null)
      .eq("clicked", false);

    if (enrollErr) console.error("Enroll query error:", enrollErr);

    for (const p of toEnroll || []) {
      try {
        await supabase.from("roofing_prospects").update({
          in_sequence: true,
          sequence_started_at: nowIso,
          sequence_day: 0,
        }).eq("id", p.id);
        enrolled++;
      } catch (e) {
        console.error("Enroll update error:", e);
        errors++;
      }
    }
    console.log(`STEP A done: enrolled=${enrolled}`);
  } catch (err) {
    console.error("Enrollment step failed:", err);
    errors++;
  }

  // ── STEP B — Process active sequences ─────────────────────────────────────
  console.log("STEP B: processing active sequences");
  try {
    const { data: active, error: activeErr } = await supabase
      .from("roofing_prospects")
      .select("id, owner_name, company_name, email, phone, city, state, sequence_started_at, sequence_day")
      .eq("in_sequence", true)
      .eq("clicked", false)
      .is("outcome", null)
      .not("email", "is", null);

    if (activeErr) console.error("Active query error:", activeErr);
    console.log(`STEP B: found ${(active || []).length} active prospects`);

    for (const prospect of active || []) {
      try {
        const started = new Date(prospect.sequence_started_at || nowIso);
        const daysSinceStart = (now.getTime() - started.getTime()) / (1000 * 60 * 60 * 24);
        const day = prospect.sequence_day ?? 0;

        // Touch 1 — day 0 email
        if (daysSinceStart >= 0 && day === 0) {
          // Pre-create log to get ID for pixel
          const logId = await logTouch(prospect.id as string, "email_1", 1, null, "Touch 1 email");
          const { subject, html: baseHtml } = emailTouch1(prospect);
          const html = logId ? baseHtml.replace("</div>", `${pixelHtml(logId)}</div>`) : baseHtml;
          const emailId = await sendEmail(prospect.email as string, subject, html);
          if (emailId) {
            // Backfill resend_email_id and subject
            if (logId) {
              await supabase.from("roofing_outreach_log").update({ resend_email_id: emailId, subject }).eq("id", logId);
            }
            await supabase.from("roofing_prospects").update({
              sequence_day: 1,
              last_touch_at: nowIso,
            }).eq("id", prospect.id);
            emailsSent++;
          } else {
            errors++;
          }
          continue;
        }

        // Touch 2 — day 2 voice drop + SMS
        if (daysSinceStart >= 2 && day === 1) {
          if (prospect.phone) {
            await fireVoiceDrop(prospect);
            voiceDrops++;
            const smsBody = smsTouch2(prospect);
            await sendSMS(prospect.phone as string, smsBody);
            smsSent++;
            await logTouch(prospect.id as string, "voice_drop", 2, null, "Voice drop + SMS");
          }
          await supabase.from("roofing_prospects").update({
            sequence_day: 2,
            last_touch_at: nowIso,
          }).eq("id", prospect.id);
          continue;
        }

        // Touch 3 — day 4 final email
        if (daysSinceStart >= 4 && day === 2) {
          const logId = await logTouch(prospect.id as string, "email_3", 3, null, "Touch 3 final email");
          const { subject, html: baseHtml } = emailTouch3(prospect);
          const html = logId ? baseHtml.replace("</div>", `${pixelHtml(logId)}</div>`) : baseHtml;
          const emailId = await sendEmail(prospect.email as string, subject, html);
          if (emailId) {
            if (logId) {
              await supabase.from("roofing_outreach_log").update({ resend_email_id: emailId, subject }).eq("id", logId);
            }
            await supabase.from("roofing_prospects").update({
              sequence_day: 3,
              in_sequence: false,
              last_touch_at: nowIso,
            }).eq("id", prospect.id);
            emailsSent++;
          } else {
            errors++;
          }
          continue;
        }

      } catch (err) {
        console.error("Prospect processing error:", err);
        errors++;
      }
    }
    console.log(`STEP B done: emailsSent=${emailsSent}, errors=${errors}`);
  } catch (err) {
    console.error("Sequence processing failed:", err);
    errors++;
  }

  // ── Telegram summary (only on immediate/manual runs, not cron) ────────────
  if (body.notify_on_complete && (enrolled > 0 || emailsSent > 0)) {
    console.log("Sending Telegram summary");
    try {
      const { data: stats } = await supabase
        .from("roofing_prospects")
        .select("in_sequence, clicked, outcome, whale_alerted");

      const allProspects = stats || [];
      const inSeq = allProspects.filter((p: Record<string, unknown>) => p.in_sequence).length;
      const clicked = allProspects.filter((p: Record<string, unknown>) => p.clicked).length;
      const whales = allProspects.filter((p: Record<string, unknown>) => p.whale_alerted).length;
      const booked = allProspects.filter((p: Record<string, unknown>) => p.outcome === "booked").length;

      await tg(
        `✅ *Lead Gen Machine Live*\n\n` +
        `Prospects enrolled: ${enrolled}\n` +
        `Emails sent tonight: ${emailsSent}\n` +
        `Voice drops queued: ${voiceDrops}\n` +
        `Whales identified: ${whales}\n\n` +
        `Active in sequence: ${inSeq}\n` +
        `Clicked portal: ${clicked}\n` +
        `Booked: ${booked}\n\n` +
        `Sequence runs daily at 9am MT.\n` +
        `Whale alerts fire instantly on any click.\n` +
        `You call the whales. Nexus handles everything else.`
      );
    } catch (e) {
      console.error("Telegram summary error:", e);
    }
  }

  try {
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-outreach-sequencer",
      status: errors > 0 ? "error" : "ok",
      response_ms: Date.now() - startMs,
      error_message: errors > 0 ? `${errors} errors` : null,
      metadata: { enrolled, emailsSent, voiceDrops, smsSent, errors },
      recorded_at: nowIso,
    });
  } catch { /* ignore */ }

  return Response.json({
    ok: true,
    enrolled,
    emails_sent: emailsSent,
    voice_drops: voiceDrops,
    sms_sent: smsSent,
    errors,
    duration_ms: Date.now() - startMs,
  });
});

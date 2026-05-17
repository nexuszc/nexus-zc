// roofing-outreach-sequencer v13
// 7-touch branching narrative sequence
//
// Touch 1  Day 0  email: "Your homeowners are calling too much"
// Touch 2  Day 2  email: "47 calls. One installation."
// Touch 3  Day 3  voice drop (skip if branch=cold)
// Touch 4  Day 4  email: "What Sarah saw instead of calling"
// Touch 5  Day 5  voice drop (skip if branch=cold/ghost)
// Touch 6  Day 7  email: "Last note"
//
// Branches:
//   standard → normal schedule
//   hot      → opens>=3, not clicked → skip to Touch 4 immediately
//   cold     → no opens after Touch 2 → skip voice drops
//   ghost    → no opens after Touch 4 → skip Touch 5, go to Touch 6
//   whale    → clicked → pause sequence, queue Aria warm call
//
// SMS_DISABLED: 10DLC pending — re-enable Monday May 18 2026

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") || "").replace(/[^\x20-\x7E]/g, "").trim();
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

async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
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

async function fireVoiceDrop(
  prospect: Record<string, unknown>,
  touchNumber: number
): Promise<void> {
  if (!prospect.phone) return;
  const fn = firstName(prospect.owner_name as string);
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
          first_name: fn,
          touch_number: touchNumber,
          // Touch 3 script hint: 47 calls story follow-up
          // Touch 5 script hint: final check-in, $49/month
        },
      }),
    });
  } catch { /* non-fatal */ }
}

// ── EMAIL TEMPLATES ────────────────────────────────────────────────────────────

function emailTouch1(prospect: Record<string, unknown>): { subject: string; html: string } {
  const fn = firstName(prospect.owner_name as string);
  const link = trackerUrl(prospect.id as string, 1, "portal");
  const lines = [
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
    `Full product at roofingos.dev. Starts at $49/month. No contract.`,
    ``,
    `Zach`,
    `Founder, Roofing OS`,
  ].join("\n");
  return {
    subject: "Your homeowners are calling too much",
    html: `<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.7;color:#333;">${lines.replace(/\n/g, "<br>")}</div>`,
  };
}

function emailTouch2(prospect: Record<string, unknown>): { subject: string; html: string } {
  const fn = firstName(prospect.owner_name as string);
  const link = trackerUrl(prospect.id as string, 2, "portal");
  const html = `<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.7;color:#333;">
<p>Hey ${fn} —</p>
<p>Marcus runs a 6-man crew in Denver.</p>
<p>Last August he did a full replacement on a 3,200 sq ft home in Lakewood.</p>
<p>His homeowner called 47 times during the 3-day installation.</p>
<p>47 times.</p>
<p>"Where are you?" — 11 calls<br>
"When will you be done?" — 9 calls<br>
"Did you find more damage?" — 8 calls<br>
"What's happening with my insurance?" — 19 calls</p>
<p>On day 2, Marcus answered a call mid-install, lost track of a flashing detail, and had to reshingle an entire valley.</p>
<p>$2,400 in labor. Half a day gone.</p>
<p>His homeowner didn't mean any harm. She just didn't know what was happening.</p>
<p>That's the problem we solve.</p>
<p><a href="${link}" style="color:#3b82f6;">See what Sarah sees instead →</a></p>
</div>`;
  return { subject: "47 calls. One installation.", html };
}

function emailTouch4(prospect: Record<string, unknown>): { subject: string; html: string } {
  const fn = firstName(prospect.owner_name as string);
  const link = trackerUrl(prospect.id as string, 4, "portal");
  const html = `<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.7;color:#333;">
<p>Hey ${fn} —</p>
<p>Sarah is a homeowner in Aurora.</p>
<p>When her contractor started her job, she got a text with a link.</p>
<p>She opened it and saw her house from satellite. She saw photos of her roof — before, during, after tear-off — as they were taken.</p>
<p>She saw her State Farm claim status in plain English. Not insurance jargon. Plain English.</p>
<p>When she had a question at 9pm — she typed it into the portal. Aria answered in 11 seconds.</p>
<p>She never called her contractor once.</p>
<p>Her contractor finished the job without a single interruption.</p>
<p>That contractor now sends every homeowner this link the moment he creates a job. It takes him 30 seconds. It costs him $49 a month.</p>
<p><a href="${link}" style="color:#3b82f6;">See exactly what Sarah saw →</a></p>
</div>`;
  return { subject: "What Sarah saw instead of calling", html };
}

function emailTouch6(prospect: Record<string, unknown>): { subject: string; html: string } {
  const fn = firstName(prospect.owner_name as string);
  const link = trackerUrl(prospect.id as string, 6, "portal");
  const html = `<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.7;color:#333;">
<p>Hey ${fn} —</p>
<p>Last one from me.</p>
<p>If your homeowners ever stop calling during installations on their own — you found a better solution.</p>
<p>If not — we stop them for $49/month.</p>
<p><a href="${link}" style="color:#3b82f6;">See it in 30 seconds →</a></p>
</div>`;
  return { subject: "Last note", html };
}

// ── BRANCH DETECTION ───────────────────────────────────────────────────────────

function detectBranch(prospect: Record<string, unknown>, day: number): string | null {
  // Clicked → whale (immediately)
  if (prospect.clicked) return "whale";

  // Opens >= 3 and not clicked and not yet hot → hot
  const opens = (prospect.total_opens as number) || 0;
  const branch = (prospect.sequence_branch as string) || "standard";
  if (opens >= 3 && branch !== "hot" && branch !== "whale") return "hot";

  // No opens after touch 2 sent (day >= 2) → cold
  if (day >= 2 && opens === 0 && branch === "standard") return "cold";

  // No opens after touch 4 sent (day >= 4) → ghost
  if (day >= 4 && opens === 0 && branch !== "ghost" && branch !== "whale") return "ghost";

  return null;
}

// ── MAIN ───────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body — fine */ }

  if (body.test) return Response.json({ ok: true, message: "roofing-outreach-sequencer ready" });

  if (body.debug_email) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Zach Curtis <ops@nexuszc.com>", to: [body.debug_email], subject: "Resend test", html: "<p>test</p>" }),
      });
      return Response.json({ ok: true, resend_status: res.status, resend_response: await res.json() });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) });
    }
  }

  const startMs = Date.now();
  const now = new Date();
  const nowIso = now.toISOString();
  let enrolled = 0, emailsSent = 0, voiceDrops = 0, errors = 0;

  // ── STEP A — Enroll new prospects ──────────────────────────────────────────
  try {
    const { data: toEnroll } = await supabase
      .from("roofing_prospects")
      .select("id")
      .eq("in_sequence", false)
      .not("email", "is", null)
      .is("outcome", null)
      .eq("clicked", false);

    for (const p of toEnroll || []) {
      try {
        await supabase.from("roofing_prospects").update({
          in_sequence: true,
          sequence_started_at: nowIso,
          sequence_day: 0,
          sequence_branch: "standard",
          sequence_paused: false,
        }).eq("id", p.id);
        enrolled++;
      } catch (e) {
        console.error("Enroll error:", e);
        errors++;
      }
    }
  } catch (err) {
    console.error("Enrollment step failed:", err);
    errors++;
  }

  // ── STEP B — Process active sequences ─────────────────────────────────────
  try {
    const { data: active } = await supabase
      .from("roofing_prospects")
      .select("id, owner_name, company_name, email, phone, sequence_started_at, sequence_day, sequence_branch, sequence_paused, total_opens, clicked, outcome")
      .eq("in_sequence", true)
      .eq("sequence_paused", false)
      .is("outcome", null)
      .not("email", "is", null);

    for (const prospect of active || []) {
      try {
        const day = (prospect.sequence_day as number) ?? 0;
        const branch = (prospect.sequence_branch as string) || "standard";

        // Detect branch transitions
        const newBranch = detectBranch(prospect, day);
        if (newBranch && newBranch !== branch) {
          await supabase.from("roofing_prospects")
            .update({ sequence_branch: newBranch })
            .eq("id", prospect.id);
          (prospect as Record<string, unknown>).sequence_branch = newBranch;

          if (newBranch === "whale") {
            // Pause sequence and queue Aria warm call
            await supabase.from("roofing_prospects")
              .update({ sequence_paused: true, in_sequence: false })
              .eq("id", prospect.id);
            await fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
              method: "POST",
              headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                call_type: "whale_warm_followup",
                contact_phone: prospect.phone,
                contact_name: prospect.owner_name,
                contact_type: "prospect",
                language: "en",
                metadata: { contractor_name: prospect.company_name },
              }),
            }).catch(() => {});
            continue;
          }

          if (newBranch === "hot") {
            // Accelerate: send touch 4 immediately if not yet at day 4
            if (day < 4) {
              const logId = await logTouch(prospect.id as string, "email_4_hot", 4, null, "Hot branch — skipping to touch 4");
              const { subject, html: baseHtml } = emailTouch4(prospect);
              const html = logId ? baseHtml.replace("</div>", `${pixelHtml(logId)}</div>`) : baseHtml;
              const emailId = await sendEmail(prospect.email as string, subject, html);
              if (emailId) {
                if (logId) await supabase.from("roofing_outreach_log").update({ resend_email_id: emailId, subject }).eq("id", logId);
                await supabase.from("roofing_prospects").update({ sequence_day: 4, last_touch_at: nowIso }).eq("id", prospect.id);
                emailsSent++;
              } else errors++;
              continue;
            }
          }
        }

        const currentBranch = (prospect.sequence_branch as string) || "standard";
        const started = new Date(prospect.sequence_started_at || nowIso);
        const daysSinceStart = (now.getTime() - started.getTime()) / (1000 * 60 * 60 * 24);

        // Touch 1 — Day 0
        if (day === 0 && daysSinceStart >= 0) {
          const logId = await logTouch(prospect.id as string, "email_1", 1, null, "Touch 1");
          const { subject, html: baseHtml } = emailTouch1(prospect);
          const html = logId ? baseHtml.replace("</div>", `${pixelHtml(logId)}</div>`) : baseHtml;
          const emailId = await sendEmail(prospect.email as string, subject, html);
          if (emailId) {
            if (logId) await supabase.from("roofing_outreach_log").update({ resend_email_id: emailId, subject }).eq("id", logId);
            await supabase.from("roofing_prospects").update({ sequence_day: 1, last_touch_at: nowIso }).eq("id", prospect.id);
            emailsSent++;
          } else errors++;
          continue;
        }

        // Touch 2 — Day 2: story email
        if (day === 1 && daysSinceStart >= 2) {
          const logId = await logTouch(prospect.id as string, "email_2", 2, null, "Touch 2 — story");
          const { subject, html: baseHtml } = emailTouch2(prospect);
          const html = logId ? baseHtml.replace("</div>", `${pixelHtml(logId)}</div>`) : baseHtml;
          const emailId = await sendEmail(prospect.email as string, subject, html);
          if (emailId) {
            if (logId) await supabase.from("roofing_outreach_log").update({ resend_email_id: emailId, subject }).eq("id", logId);
            await supabase.from("roofing_prospects").update({ sequence_day: 2, last_touch_at: nowIso }).eq("id", prospect.id);
            emailsSent++;
          } else errors++;
          continue;
        }

        // Touch 3 — Day 3: voice drop (skip if cold)
        if (day === 2 && daysSinceStart >= 3) {
          if (currentBranch !== "cold" && prospect.phone) {
            await fireVoiceDrop(prospect, 3);
            voiceDrops++;
            await logTouch(prospect.id as string, "voice_drop_3", 3, null, "Touch 3 voice drop");
          }
          await supabase.from("roofing_prospects").update({ sequence_day: 3, last_touch_at: nowIso }).eq("id", prospect.id);
          continue;
        }

        // Touch 4 — Day 4: portal story email
        if (day === 3 && daysSinceStart >= 4) {
          const logId = await logTouch(prospect.id as string, "email_4", 4, null, "Touch 4 — portal");
          const { subject, html: baseHtml } = emailTouch4(prospect);
          const html = logId ? baseHtml.replace("</div>", `${pixelHtml(logId)}</div>`) : baseHtml;
          const emailId = await sendEmail(prospect.email as string, subject, html);
          if (emailId) {
            if (logId) await supabase.from("roofing_outreach_log").update({ resend_email_id: emailId, subject }).eq("id", logId);
            await supabase.from("roofing_prospects").update({ sequence_day: 4, last_touch_at: nowIso }).eq("id", prospect.id);
            emailsSent++;
          } else errors++;
          continue;
        }

        // Touch 5 — Day 5: voice drop (skip if cold or ghost)
        if (day === 4 && daysSinceStart >= 5) {
          const skipVoice = currentBranch === "cold" || currentBranch === "ghost";
          if (!skipVoice && prospect.phone) {
            await fireVoiceDrop(prospect, 5);
            voiceDrops++;
            await logTouch(prospect.id as string, "voice_drop_5", 5, null, "Touch 5 voice drop");
          }
          await supabase.from("roofing_prospects").update({ sequence_day: 5, last_touch_at: nowIso }).eq("id", prospect.id);
          continue;
        }

        // Touch 6 — Day 7: final email
        if (day === 5 && daysSinceStart >= 7) {
          const logId = await logTouch(prospect.id as string, "email_6", 6, null, "Touch 6 — final");
          const { subject, html: baseHtml } = emailTouch6(prospect);
          const html = logId ? baseHtml.replace("</div>", `${pixelHtml(logId)}</div>`) : baseHtml;
          const emailId = await sendEmail(prospect.email as string, subject, html);
          if (emailId) {
            if (logId) await supabase.from("roofing_outreach_log").update({ resend_email_id: emailId, subject }).eq("id", logId);
            await supabase.from("roofing_prospects").update({
              sequence_day: 6,
              in_sequence: false,
              last_touch_at: nowIso,
            }).eq("id", prospect.id);
            emailsSent++;
          } else errors++;
          continue;
        }

      } catch (err) {
        console.error("Prospect processing error:", err);
        errors++;
      }
    }
  } catch (err) {
    console.error("Sequence processing failed:", err);
    errors++;
  }

  // MOVED_TO_DASHBOARD [date: 2026-05-17]: outreach sequencer stats visible in Pipeline tab (roofing_prospects table)
  // if (body.notify_on_complete && (enrolled > 0 || emailsSent > 0)) { await tg(`✅ *Outreach Sequencer Run*\n\n...`); }

  try {
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-outreach-sequencer",
      status: errors > 0 ? "error" : "ok",
      response_ms: Date.now() - startMs,
      error_message: errors > 0 ? `${errors} errors` : null,
      metadata: { enrolled, emailsSent, voiceDrops, errors },
      recorded_at: nowIso,
    });
  } catch { /* ignore */ }

  return Response.json({ ok: true, enrolled, emails_sent: emailsSent, voice_drops: voiceDrops, errors, duration_ms: Date.now() - startMs });
});

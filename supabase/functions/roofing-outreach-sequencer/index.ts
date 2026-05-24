// roofing-outreach-sequencer v17
// Email System v2: 9-touch story arc + warm bonus "why I built this", tier-based smart frequency
// Sources: email_sequences (state), email_templates (copy), roofing_prospects (engagement signals)
// Tiers: cold / warm / hot / dead
// Warm bonus: template 11 fires between touch 3→4 for warm/hot prospects with 2+ opens

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") || "").replace(/[^\x20-\x7E]/g, "").trim();
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME  = Deno.env.get("RESEND_FROM_NAME")  || "Zach from Roofing OS";

const EMAIL_TRACKER_BASE = `${SUPABASE_URL}/functions/v1/roofing-email-tracker`;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// GAPS[tier][N] = days to wait after sending touch N before touch N+1 (N is 1-indexed, maps to array index directly)
// Index 0 = gap before first touch (always 0 = send immediately on enrollment)
const GAPS: Record<string, number[]> = {
  hot:  [0, 1, 2, 3, 3, 4, 7, 7, 14, 14],
  warm: [0, 3, 5, 7, 7, 7, 8, 9,  7,  7],
  cold: [0, 2, 4, 7, 8, 9, 5, 9,  0,  0],
};
const MAX_TOUCHES = 10;
const WARM_BONUS_TEMPLATE = 11;

function firstName(name: string | null | undefined): string {
  return (name || "").split(" ")[0] || "there";
}

function gapDays(tier: string, touchJustSent: number): number {
  const gaps = GAPS[tier] ?? GAPS.cold;
  return gaps[touchJustSent] ?? 7;
}

function scoreProspect(openCount: number, clicked: boolean, touchNumber: number, tier: string): number {
  let score = 0;
  if (clicked) score += 40;
  score += Math.min(openCount * 10, 30);
  if (tier === "hot") score += 20;
  else if (tier === "warm") score += 10;
  score -= touchNumber * 2;
  return Math.max(0, Math.min(100, score));
}

function evaluateTier(
  prospect: { clicked?: boolean; total_opens?: number } | undefined,
  currentTier: string,
  currentTouch: number
): string {
  if (!prospect) return currentTier;
  if (prospect.clicked) return "hot";
  if ((prospect.total_opens ?? 0) >= 1) return "warm"; // accelerate on first open
  // No opens after touch 3 → dead
  if (currentTouch >= 3 && (prospect.total_opens ?? 0) === 0) return "dead";
  return currentTier;
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

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        reply_to: FROM_EMAIL,
        to: [to],
        subject,
        html,
        text,
        headers: { "List-Unsubscribe": "<mailto:unsubscribe@roofingos.dev>" },
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
  prospectId: string | null,
  touchNumber: number,
  subject: string,
  bodySnippet: string,
): Promise<string | null> {
  if (!prospectId) return null;
  try {
    const { data } = await supabase.from("roofing_outreach_log").insert({
      prospect_id: prospectId,
      touch_type: "email",
      touch_number: touchNumber,
      direction: "outbound",
      subject,
      body: bodySnippet,
    }).select("id").single();
    return data?.id || null;
  } catch (e) {
    console.error("logTouch error:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  try {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body fine */ }

  if (body.test) return Response.json({ ok: true, message: "roofing-outreach-sequencer v17 ready" });

  if (body.debug_email) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [body.debug_email],
          subject: "Resend test — roofing-outreach-sequencer v17",
          html: "<p>Sequencer v17 test email. If you see this, Resend is working.</p>",
        }),
      });
      return Response.json({ ok: true, resend_status: res.status, resend_response: await res.json() });
    } catch (e) {
      return Response.json({ ok: false, error: String(e) });
    }
  }

  const startMs = Date.now();
  const now = new Date();
  let emailsSent = 0, errors = 0, skipped = 0;

  // ── Fetch sequences due for next touch ─────────────────────────────────────
  const { data: dueSequences, error: seqErr } = await supabase
    .from("email_sequences")
    .select("id, prospect_id, prospect_email, prospect_name, current_touch, tier, status, warm_bonus_sent")
    .eq("status", "active")
    .neq("unsubscribed", true)
    .lte("next_touch_at", now.toISOString())
    .lt("current_touch", MAX_TOUCHES)
    .limit(50);

  if (seqErr) {
    try { await supabase.from("system_heartbeats").insert({ function_name: "roofing-outreach-sequencer", status: "error", response_ms: Date.now() - startMs, error_message: seqErr.message, recorded_at: now.toISOString() }); } catch { /* non-fatal */ }
    return Response.json({ ok: false, error: seqErr.message }, { status: 500 });
  }

  if (!dueSequences?.length) {
    try { await supabase.from("system_heartbeats").insert({ function_name: "roofing-outreach-sequencer", status: "ok", response_ms: Date.now() - startMs, metadata: { emailsSent: 0, skipped: 0, errors: 0, message: "no sequences due" }, recorded_at: now.toISOString() }); } catch { /* non-fatal */ }
    return Response.json({ ok: true, emails_sent: 0, errors: 0, message: "no sequences due", duration_ms: Date.now() - startMs });
  }

  // ── Fetch all templates once ────────────────────────────────────────────────
  const { data: templates } = await supabase
    .from("email_templates")
    .select("touch_number, subject, body_html, body_text")
    .order("touch_number");

  const templateMap = new Map<number, { subject: string; body_html: string; body_text: string }>();
  for (const t of templates || []) {
    if (t.touch_number) templateMap.set(t.touch_number, t);
  }

  // ── Batch-fetch prospect engagement signals ─────────────────────────────────
  const prospectIds = [...new Set(dueSequences.map(s => s.prospect_id).filter(Boolean))];
  const { data: prospects } = prospectIds.length
    ? await supabase.from("roofing_prospects").select("id, clicked, total_opens").in("id", prospectIds)
    : { data: [] };

  const prospectMap = new Map<string, { clicked: boolean; total_opens: number }>();
  for (const p of prospects || []) prospectMap.set(p.id, p);

  // ── Process each due sequence ───────────────────────────────────────────────
  for (const seq of dueSequences) {
    try {
      const prospect = seq.prospect_id ? prospectMap.get(seq.prospect_id) : undefined;
      const currentTouch = seq.current_touch ?? 0;
      let tier = evaluateTier(prospect, seq.tier || "cold", currentTouch);

      if (tier === "dead") {
        await supabase.from("email_sequences").update({
          status: "dead",
          tier: "dead",
          completed_at: now.toISOString(),
        }).eq("id", seq.id);
        skipped++;
        continue;
      }

      if (tier !== seq.tier) {
        await supabase.from("email_sequences").update({ tier }).eq("id", seq.id);
      }

      const nextTouch = currentTouch + 1;

      // Warm bonus: "why I built this" fires between touch 3→4 for engaged prospects
      const totalOpens = prospect?.total_opens ?? 0;
      const isWarmBonus = (
        nextTouch === 4 &&
        (tier === "warm" || tier === "hot") &&
        totalOpens >= 2 &&
        !seq.warm_bonus_sent
      );
      const templateKey = isWarmBonus ? WARM_BONUS_TEMPLATE : nextTouch;

      const template = templateMap.get(templateKey);

      if (!template) {
        console.error(`No template for touch ${templateKey} — skipping sequence ${seq.id}`);
        errors++;
        continue;
      }

      const fn = firstName(seq.prospect_name);
      const companyName = seq.prospect_name || "your company";
      const prospectId = seq.prospect_id || seq.id;

      let htmlBody = (template.body_html || `<p>${template.body_text}</p>`)
        .replace(/\[firstName\]/gi, fn)
        .replace(/\[companyName\]/gi, companyName)
        .replace(/\[prospectId\]/gi, prospectId);

      const textBody = (template.body_text || "")
        .replace(/\[firstName\]/gi, fn)
        .replace(/\[companyName\]/gi, companyName);

      const subject = template.subject
        .replace(/\[firstName\]/gi, fn)
        .replace(/\[companyName\]/gi, companyName);

      // Pre-log the touch to get a tracking pixel ID
      const logId = await logTouch(
        seq.prospect_id,
        templateKey,
        subject,
        (template.body_text || "").slice(0, 500),
      );
      if (logId) {
        const pixel = pixelHtml(logId);
        htmlBody = htmlBody.includes("</body>")
          ? htmlBody.replace("</body>", `${pixel}</body>`)
          : htmlBody + pixel;
      }

      const emailId = await sendEmail(seq.prospect_email, subject, htmlBody, textBody);

      if (emailId) {
        if (logId) {
          await supabase.from("roofing_outreach_log").update({ resend_email_id: emailId }).eq("id", logId);
        }

        // Update prospect engagement score
        if (seq.prospect_id) {
          const p = seq.prospect_id ? prospectMap.get(seq.prospect_id) : undefined;
          const engScore = scoreProspect(p?.total_opens ?? 0, p?.clicked ?? false, nextTouch, tier);
          await supabase.from("roofing_prospects").update({ lead_score: engScore }).eq("id", seq.prospect_id).catch(() => {});
        }

        if (isWarmBonus) {
          // Warm bonus sent: stay at current_touch=3 so next run fires touch 4 normally
          const nextTouchAt = new Date(now.getTime() + gapDays(tier, 3) * 24 * 60 * 60 * 1000).toISOString();
          await supabase.from("email_sequences").update({
            current_touch: 3,
            tier,
            warm_bonus_sent: true,
            next_touch_at: nextTouchAt,
            status: "active",
          }).eq("id", seq.id);
        } else {
          const isLastTouch = nextTouch >= MAX_TOUCHES;
          const nextTouchAt = isLastTouch
            ? null
            : new Date(now.getTime() + gapDays(tier, nextTouch) * 24 * 60 * 60 * 1000).toISOString();

          await supabase.from("email_sequences").update({
            current_touch: nextTouch,
            tier,
            next_touch_at: nextTouchAt,
            status: isLastTouch ? "completed" : "active",
            completed_at: isLastTouch ? now.toISOString() : null,
          }).eq("id", seq.id);
        }

        emailsSent++;
      } else {
        // Send failed — clean up pre-logged touch and kill the sequence so we don't retry indefinitely
        if (logId) await supabase.from("roofing_outreach_log").delete().eq("id", logId);
        await supabase.from("email_sequences").update({ status: "dead", tier: "dead" }).eq("id", seq.id).catch(() => {});
        errors++;
      }

      // Brief pause between sends to respect Resend rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.error("Sequence processing error:", seq.id, err);
      errors++;
    }
  }

  if (errors > 0) {
    await tg(`⚠️ roofing-outreach-sequencer: ${errors} send errors (${emailsSent} sent ok)`);
  }

  try { await supabase.from("system_heartbeats").insert({ function_name: "roofing-outreach-sequencer", status: errors > 0 ? "error" : "ok", response_ms: Date.now() - startMs, error_message: errors > 0 ? `${errors} send errors` : null, metadata: { emailsSent, errors, skipped, due: dueSequences.length }, recorded_at: now.toISOString() }); } catch { /* non-fatal */ }

  return Response.json({
    ok: true,
    emails_sent: emailsSent,
    errors,
    skipped,
    due: dueSequences.length,
    duration_ms: Date.now() - startMs,
  });

  } catch (fatal) {
    console.error("roofing-outreach-sequencer fatal:", fatal);
    return Response.json({ ok: false, error: String(fatal) }, { status: 500 });
  }
});

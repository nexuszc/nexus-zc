// roofing-email-webhook v2
// Handles Resend webhook events: delivered, opened, bounced, spam_complaint, replied
// Phase 4: adds Telegram alert on first open + updates email_sequences total_opens

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function findLog(emailId: string) {
  const { data } = await supabase
    .from("roofing_outreach_log")
    .select("id, prospect_id, open_count, first_opened_at, touch_number, subject")
    .eq("resend_email_id", emailId)
    .maybeSingle();
  return data;
}

async function updateEmailLog(emailId: string, type: string, now: string) {
  const { data: logRow } = await supabase
    .from("email_log")
    .select("id, opened_at, clicked_at")
    .eq("resend_id", emailId)
    .maybeSingle();
  if (!logRow) return;
  if (type === "email.opened" && !logRow.opened_at) {
    await supabase.from("email_log").update({ opened_at: now, status: "opened" }).eq("id", logRow.id);
  } else if (type === "email.clicked" && !logRow.clicked_at) {
    await supabase.from("email_log").update({ clicked_at: now, opened_at: logRow.opened_at || now, status: "clicked" }).eq("id", logRow.id);
  } else if (type === "email.bounced") {
    await supabase.from("email_log").update({ status: "bounced" }).eq("id", logRow.id);
  } else if (type === "email.delivered") {
    await supabase.from("email_log").update({ status: "delivered" }).eq("id", logRow.id);
  }
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

Deno.serve(async (req) => {
  // One-shot webhook registration check
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("action") === "check_webhook") {
      try {
        const listRes = await fetch("https://api.resend.com/webhooks", {
          headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
        });
        const listData = await listRes.json();
        const webhooks: Array<{ id: string; endpoint: string; events: string[] }> = listData.data || [];
        const existing = webhooks.find(w => w.endpoint.includes("roofing-email-webhook"));
        if (existing) {
          return Response.json({ ok: true, status: "already_registered", webhook: existing });
        }
        const webhookUrl = `${SUPABASE_URL}/functions/v1/roofing-email-webhook`;
        const regRes = await fetch("https://api.resend.com/webhooks", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: webhookUrl,
            events: ["email.opened", "email.clicked", "email.bounced", "email.delivered", "email.complained"],
          }),
        });
        const regData = await regRes.json();
        return Response.json({ ok: true, status: "registered", webhook: regData });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 500 });
      }
    }
    return Response.json({ ok: true });
  }

  if (req.method !== "POST") return Response.json({ ok: true });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: true });
  }

  const type = payload.type as string || "";
  const data = (payload.data || {}) as Record<string, unknown>;
  const emailId = (data.email_id as string) || "";
  const now = new Date().toISOString();

  if (!emailId) return Response.json({ ok: true });

  const log = await findLog(emailId);
  if (!log) return Response.json({ ok: true });

  try {
    if (type === "email.delivered") {
      await supabase.from("roofing_outreach_log").update({
        delivered: true,
        delivered_at: now,
      }).eq("id", log.id);
    }

    else if (type === "email.opened") {
      const newCount = (log.open_count || 0) + 1;
      const isFirst = !log.first_opened_at;

      await supabase.from("roofing_outreach_log").update({
        opened: true,
        open_count: newCount,
        first_opened_at: isFirst ? now : log.first_opened_at,
        last_opened_at: now,
        opened_at: isFirst ? now : undefined,
      }).eq("id", log.id);

      if (log.prospect_id) {
        await supabase.from("roofing_prospects").update({ last_activity_at: now }).eq("id", log.prospect_id);

        // Increment total_opens on email_sequences
        await supabase.rpc("increment_sequence_opens", { p_prospect_id: log.prospect_id }).catch(() => {
          // Fallback: manual increment
          supabase
            .from("email_sequences")
            .select("id, total_opens")
            .eq("prospect_id", log.prospect_id)
            .eq("status", "active")
            .maybeSingle()
            .then(({ data: seq }) => {
              if (seq) {
                supabase.from("email_sequences")
                  .update({ total_opens: (seq.total_opens || 0) + 1 })
                  .eq("id", seq.id)
                  .catch(() => {});
              }
            });
        });
      }

      // First open: fetch prospect and fire Telegram alert
      if (isFirst && log.prospect_id) {
        const { data: prospect } = await supabase
          .from("roofing_prospects")
          .select("owner_name, company_name, phone")
          .eq("id", log.prospect_id)
          .maybeSingle();

        if (prospect) {
          const company = prospect.company_name || prospect.owner_name || "Unknown";
          const phone = prospect.phone || "no phone";
          const subject = log.subject || `touch ${log.touch_number}`;
          await tg(
            `👀 *${company}* opened your email\n` +
            `📧 "${subject}"\n` +
            `📞 ${phone}\n` +
            `Call them now.`
          );
        }
      }
    }

    else if (type === "email.replied") {
      await supabase.from("roofing_outreach_log").update({
        replied: true,
        replied_at: now,
      }).eq("id", log.id);

      if (log.prospect_id) {
        await supabase.from("email_sequences").update({
          status: "replied",
        }).eq("prospect_id", log.prospect_id);

        const { data: prospect } = await supabase
          .from("roofing_prospects")
          .select("owner_name, company_name, email, phone")
          .eq("id", log.prospect_id)
          .maybeSingle();

        if (prospect) {
          await tg(
            `💬 *Email Reply — Touch ${log.touch_number}*\n\n` +
            `*${prospect.owner_name || "Unknown"} — ${prospect.company_name || ""}*\n` +
            `📧 ${prospect.email || ""}\n` +
            `📞 ${prospect.phone || "no phone"}\n\n` +
            `They replied to touch ${log.touch_number}. Sequence paused.\n` +
            `Reply to them within the hour.`
          );
          await supabase.from("roofing_prospects").update({
            funnel_stage: "engaged",
            funnel_stage_updated_at: now,
            last_activity_at: now,
          }).eq("id", log.prospect_id);
        }
      }
    }

    else if (type === "email.bounced") {
      await supabase.from("roofing_outreach_log").update({ bounced: true }).eq("id", log.id);

      if (log.prospect_id) {
        const { data: prospect } = await supabase
          .from("roofing_prospects")
          .select("owner_name, company_name, email")
          .eq("id", log.prospect_id)
          .maybeSingle();

        if (prospect) {
          await tg(
            `⚠️ *Email Bounced*\n\n` +
            `${prospect.owner_name || "Unknown"} — ${prospect.company_name || ""}\n` +
            `📧 ${prospect.email || "unknown"}\n` +
            `Touch ${log.touch_number} bounced — email may be invalid.`
          );
          await supabase.from("roofing_prospects").update({
            last_activity_at: now,
          }).eq("id", log.prospect_id);
        }
      }
    }

    else if (type === "email.spam_complaint") {
      await supabase.from("roofing_outreach_log").update({ spam: true }).eq("id", log.id);

      if (log.prospect_id) {
        const { data: prospect } = await supabase
          .from("roofing_prospects")
          .select("owner_name, company_name, email")
          .eq("id", log.prospect_id)
          .maybeSingle();

        if (prospect) {
          await tg(
            `🚫 *Spam Complaint*\n\n` +
            `${prospect.owner_name || "Unknown"} — ${prospect.company_name || ""}\n` +
            `📧 ${prospect.email || ""}\n\n` +
            `Marking as unsubscribed.`
          );
          await supabase.from("roofing_prospects").update({
            outcome: "unsubscribed",
            in_sequence: false,
            last_activity_at: now,
          }).eq("id", log.prospect_id);
          await supabase.from("email_sequences").update({
            unsubscribed: true,
          }).eq("prospect_id", log.prospect_id);
        }
      }
    }

    // Mirror status to email_log (nurture sequences)
    await updateEmailLog(emailId, type, now);
  } catch (e) {
    console.error("webhook processing error:", e);
  }

  return Response.json({ ok: true });
});

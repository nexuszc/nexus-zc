// roofing-email-webhook v1
// Handles Resend webhook events: delivered, opened, bounced, spam_complaint
// Webhook URL: https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/roofing-email-webhook

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
    .select("id, prospect_id, open_count, first_opened_at, touch_number")
    .eq("resend_email_id", emailId)
    .maybeSingle();
  return data;
}

Deno.serve(async (req) => {
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
      // Resend open events supplement the pixel tracker
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
      }
    }

    else if (type === "email.bounced") {
      await supabase.from("roofing_outreach_log").update({ bounced: true }).eq("id", log.id);

      // Fetch prospect for alert
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
          // Mark prospect email as bad
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
          // Unsubscribe from all sequences
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
  } catch (e) {
    console.error("webhook processing error:", e);
  }

  return Response.json({ ok: true });
});

// roofing-whale-alert v1
// Fires Telegram alert when a prospect clicks for the first time

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
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text.slice(0, 4000),
      parse_mode: "Markdown",
    }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-whale-alert ready" });

  const { prospect_id, touch_number } = body;
  if (!prospect_id) {
    return Response.json({ error: "prospect_id required" }, { status: 400 });
  }

  try {
    const { data: prospect } = await supabase
      .from("roofing_prospects")
      .select("id, owner_name, company_name, phone, city, state, whale_alerted")
      .eq("id", prospect_id)
      .maybeSingle();

    if (!prospect) {
      return Response.json({ error: "prospect not found" }, { status: 404 });
    }

    const firstName = (prospect.owner_name || "").split(" ")[0] || "them";
    const location = [prospect.city, prospect.state].filter(Boolean).join(", ") || "unknown";

    const msg =
      `🐋 *${prospect.owner_name || "Unknown"} just clicked — call now*\n\n` +
      `*${prospect.company_name || ""}*\n` +
      `📞 ${prospect.phone || "no phone on file"}\n` +
      `📍 ${location}\n\n` +
      `*What they did:*\n` +
      `Clicked touch ${touch_number} link\n` +
      `Just now\n\n` +
      `*Call script:*\n` +
      `Hey ${firstName} — Zach Curtis\\.\n` +
      `You just looked at the homeowner portal demo\\.\n` +
      `What did you think — is that something\n` +
      `your homeowners would actually use?\n\n` +
      `*Demo link if they want it again:*\n` +
      `app\\.nexuszc\\.com/roofing/portal/DEMO2026ROOFINGOS\n\n` +
      `*Full product:*\n` +
      `roofingos\\.dev — starts at \\$49/month\n\n` +
      `Reply to log outcome:\n` +
      `\`booked ${firstName}\`\n` +
      `\`dead ${firstName}\``;

    await tg(msg);

    await supabase.from("roofing_prospects").update({
      whale_alerted: true,
      whale_alerted_at: new Date().toISOString(),
    }).eq("id", prospect_id);

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-whale-alert",
      status: "ok",
      response_ms: 0,
      metadata: { prospect_id, touch_number },
      recorded_at: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({ ok: true, alerted: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});

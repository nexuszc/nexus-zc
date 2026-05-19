// roofing-email-tracker v2
// 1x1 tracking pixel — counts opens, advances funnel stage on re-open

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// 1x1 transparent PNG
const PIXEL = new Uint8Array([
  137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,
  31,21,196,137,0,0,0,10,73,68,65,84,120,156,98,0,1,0,0,5,0,1,13,10,45,180,
  0,0,0,0,73,69,78,68,174,66,96,130
]);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const lid = url.searchParams.get("lid") || "";

  const pixel = () => new Response(PIXEL, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    },
  });

  if (!lid) return pixel();

  EdgeRuntime.waitUntil((async () => {
    try {
      const now = new Date().toISOString();

      const { data: log } = await supabase
        .from("roofing_outreach_log")
        .select("id, prospect_id, open_count, first_opened_at, touch_number, created_at")
        .eq("id", lid)
        .maybeSingle();

      if (!log) return;

      // Bot detection: opens within 3 seconds of send = scanner/prefetch, not a human
      const timeSinceSend = log.created_at
        ? (Date.now() - new Date(log.created_at).getTime())
        : 99999;

      if (timeSinceSend < 3000) {
        await supabase.from("roofing_outreach_log")
          .update({ bot_open: true })
          .eq("id", lid);
        return; // Don't count, don't alert
      }

      const openTimeSecs = Math.round(timeSinceSend / 1000);
      const newCount = (log.open_count || 0) + 1;
      const isFirstOpen = !log.first_opened_at;

      await supabase.from("roofing_outreach_log").update({
        opened: true,
        open_count: newCount,
        open_time_seconds: isFirstOpen ? openTimeSecs : undefined,
        first_opened_at: isFirstOpen ? now : log.first_opened_at,
        last_opened_at: now,
        opened_at: isFirstOpen ? now : undefined,
      }).eq("id", lid);

      if (log.prospect_id) {
        await supabase.from("roofing_prospects").update({
          last_activity_at: now,
        }).eq("id", log.prospect_id);
      }

      const secondsApart = log.first_opened_at
        ? (Date.now() - new Date(log.first_opened_at).getTime()) / 1000
        : 999;

      // Hot-open alert + funnel advance on 2nd open (debounced, >30s)
      if (newCount >= 2 && secondsApart > 30 && log.prospect_id) {
        const { data: prospect } = await supabase
          .from("roofing_prospects")
          .select("owner_name, company_name, phone, city, state, funnel_stage")
          .eq("id", log.prospect_id)
          .maybeSingle();

        if (prospect) {
          const name = prospect.owner_name || "Unknown";
          const fn = name.split(" ")[0] || name;
          const loc = [prospect.city, prospect.state].filter(Boolean).join(", ") || "unknown";

          await tg(
            `🔥 *Hot Open — ${name || prospect.company_name} re-read touch ${log.touch_number}*\n\n` +
            `*${prospect.company_name || ""}*\n` +
            `📞 ${prospect.phone || "no phone"}\n` +
            `📍 ${loc}\n\n` +
            `Opened ${newCount}x — they're thinking about it. Good time to call.\n\n` +
            `Call script: "Hey ${fn} — just following up on the email I sent about homeowner callbacks."`
          );

          // Advance to 'engaged' if not already hot or beyond
          const currentStage = (prospect.funnel_stage as string) || "new_lead";
          const advanceableStages = ["new_lead", "contacted"];
          if (advanceableStages.includes(currentStage)) {
            await supabase.from("roofing_prospects").update({
              funnel_stage: "engaged",
              funnel_stage_updated_at: now,
            }).eq("id", log.prospect_id);
            await supabase.from("funnel_stage_history").insert({
              prospect_id: log.prospect_id,
              from_stage: currentStage,
              to_stage: "engaged",
              reason: `email_open_count_${newCount}`,
            }).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.error("tracker error:", e);
    }
  })());

  return pixel();
});

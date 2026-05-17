// roofing-content-publisher v1
// Cron: Mon/Wed/Fri 14:00 UTC (0 14 * * 1,3,5)
//
// Picks up approved YouTube content for today's slot and runs the full
// publish pipeline (voiceover → blog → youtube_upload_ready).
//
// Slot logic:
//   'now'  → always included (highest priority, publish next window)
//   'mon'  → included on Mondays
//   'wed'  → included on Wednesdays
//   'fri'  → included on Fridays
//
// Delegates to roofing-youtube-publisher per item (voiceover + blog + DB update).
// Sends Telegram summary when done.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN   = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID     = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOW_SLOT: Record<number, string> = { 1: "mon", 3: "wed", 5: "fri" };

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

async function heartbeat(status: string, ms: number, meta: Record<string, unknown>) {
  try {
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-content-publisher",
      status,
      response_ms: ms,
      metadata: meta,
      recorded_at: new Date().toISOString(),
    });
  } catch (_) { /* non-fatal */ }
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.test) return Response.json({ ok: true, message: "roofing-content-publisher ready" });

    const startMs = Date.now();

    // Determine today's active slots
    const dow = new Date().getUTCDay();
    const daySlot = DOW_SLOT[dow] ?? null;
    const activeSlots = daySlot ? ["now", daySlot] : ["now"];

    // Allow manual override: force a specific slot or process everything
    if (body.slot) activeSlots.splice(0, activeSlots.length, body.slot);
    if (body.all) activeSlots.splice(0, activeSlots.length, "now", "mon", "wed", "fri");

    // Find approved YouTube content due today
    const { data: dueContent, error: queryErr } = await supabase
      .from("roofing_content")
      .select("id, title, format, schedule_slot, schedule_date")
      .eq("status", "approved")
      .eq("channel", "youtube")
      .in("schedule_slot", activeSlots)
      .order("approved_at", { ascending: true })
      .limit(body.limit ?? 3);

    if (queryErr) {
      await heartbeat("error", Date.now() - startMs, { error: queryErr.message });
      return Response.json({ ok: false, error: queryErr.message }, { status: 500 });
    }

    if (!dueContent?.length) {
      await heartbeat("ok", Date.now() - startMs, {
        published: 0,
        slots: activeSlots,
        day: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow],
      });
      return Response.json({
        ok: true,
        published: 0,
        message: `No content scheduled for today (${activeSlots.join(", ")})`,
        slots: activeSlots,
      });
    }

    // Process each item via roofing-youtube-publisher
    const results: Array<{
      id: string;
      title: string;
      slot: string;
      ok: boolean;
      mp3_url?: string | null;
      blog_url?: string | null;
      error?: string;
      duration_ms?: number;
    }> = [];

    for (const item of dueContent) {
      const itemStart = Date.now();
      console.log(`Publishing: ${item.title} [${item.schedule_slot}]`);

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-publisher`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content_id: item.id }),
          signal: AbortSignal.timeout(90_000), // 90s per item
        });

        const data = await res.json().catch(() => ({}));
        const itemMs = Date.now() - itemStart;

        if (!res.ok || data.error) {
          const errMsg = data.error || `HTTP ${res.status}`;
          console.error(`Publisher failed for ${item.id}: ${errMsg}`);
          results.push({ id: item.id, title: item.title, slot: item.schedule_slot, ok: false, error: errMsg, duration_ms: itemMs });
        } else {
          results.push({
            id: item.id,
            title: item.title,
            slot: item.schedule_slot,
            ok: true,
            mp3_url: data.mp3_url ?? null,
            blog_url: data.blog_url ?? null,
            duration_ms: itemMs,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Publisher threw for ${item.id}: ${msg}`);
        results.push({ id: item.id, title: item.title, slot: item.schedule_slot, ok: false, error: msg.slice(0, 120), duration_ms: Date.now() - itemStart });
      }

      // Brief pause between items to avoid hammering ElevenLabs
      if (results.length < dueContent.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    const successes = results.filter(r => r.ok);
    const failures  = results.filter(r => !r.ok);
    const totalMs   = Date.now() - startMs;

    // Telegram summary
    const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dow];
    if (successes.length > 0) {
      const lines = successes.map(r =>
        `✅ *${r.title.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&")}*\n${r.blog_url ? `📖 ${r.blog_url}` : "_(blog pending)_"}`
      );
      await tg(
        `🎬 *${dayName} Content Published*\n\n${lines.join("\n\n")}` +
        (failures.length > 0 ? `\n\n⚠️ ${failures.length} failed — check logs` : "")
      );
    } else if (failures.length > 0) {
      await tg(`❌ *Content publisher failed (${dayName})*\n\n${failures.map(f => `• ${f.title}: ${f.error}`).join("\n")}`);
    }

    await heartbeat(failures.length > 0 && successes.length === 0 ? "error" : "ok", totalMs, {
      published: successes.length,
      failed: failures.length,
      total: results.length,
      slots: activeSlots,
      day: dayName,
    });

    return Response.json({
      ok: true,
      published: successes.length,
      failed: failures.length,
      duration_ms: totalMs,
      results,
    });

  } catch (fatal) {
    console.error("roofing-content-publisher fatal:", fatal);
    return Response.json({ ok: false, error: String(fatal) }, { status: 500 });
  }
});

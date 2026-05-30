import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function callFunction(name: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return r.json();
  } catch (e) {
    return { error: String(e) };
  }
}

async function sendTelegram(msg: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: "HTML" }),
    });
  } catch { /* non-critical */ }
}

async function getSystemHealth() {
  const [posts, keywords, videos, backlinks, locations, pendingVideos] = await Promise.all([
    supabase.from("seo_posts").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("seo_keyword_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("youtube_video_queue").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("seo_backlink_targets").select("id", { count: "exact", head: true }).eq("status", "draft_ready"),
    supabase.from("seo_location_pages").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("youtube_video_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  return {
    posts: posts.count || 0,
    keywords: keywords.count || 0,
    videos: videos.count || 0,
    backlinks: backlinks.count || 0,
    locations: locations.count || 0,
    pendingVideos: pendingVideos.count || 0,
  };
}

async function decideActions(health: Awaited<ReturnType<typeof getSystemHealth>>): Promise<string[]> {
  const actions: string[] = [];

  // Low keyword queue → find more
  if (health.keywords < 20) {
    actions.push("seo-keyword-finder");
    actions.push("seo-trend-detector");
    actions.push("seo-competitor-hunter");
  }

  // Always write content
  actions.push("seo-content-writer");

  // Low video queue → generate scripts
  if (health.pendingVideos < 5) {
    actions.push("youtube-script-engine");
  }

  // Always link internally
  actions.push("seo-internal-linker");

  // Backlinks needing attention
  if (health.backlinks < 5) {
    actions.push("seo-backlink-engine");
  }

  return actions;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "seo-orchestrator v1 ready" }, { headers: CORS });
  }

  const health = await getSystemHealth();
  const actions = await decideActions(health);
  const results: Record<string, unknown> = {};

  for (const action of actions) {
    console.log(`Running: ${action}`);
    results[action] = await callFunction(action, { scheduled: true });
    await new Promise((r) => setTimeout(r, 2000));
  }

  const summary = `🤖 <b>SEO Orchestrator</b>\n\n` +
    `<b>System health:</b>\n` +
    `📝 Posts: ${health.posts}\n` +
    `🎬 Videos: ${health.videos}\n` +
    `📍 Locations: ${health.locations}\n` +
    `🔑 Keywords queued: ${health.keywords}\n` +
    `🔗 Backlinks ready: ${health.backlinks}\n\n` +
    `<b>Actions taken:</b>\n` +
    actions.map((a) => `✓ ${a}`).join("\n");

  await sendTelegram(summary);

  return Response.json({ ok: true, health, actions_taken: actions, results }, { headers: CORS });
});

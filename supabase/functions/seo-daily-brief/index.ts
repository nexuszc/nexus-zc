import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function gatherStats() {
  const [posts, keywords, backlinks, videos, queue, performance] = await Promise.all([
    supabase
      .from("seo_posts")
      .select("status, google_position, google_impressions, google_clicks, word_count")
      .eq("status", "published"),
    supabase
      .from("seo_keyword_queue")
      .select("id, status")
      .eq("status", "pending"),
    supabase
      .from("seo_backlink_targets")
      .select("id, status")
      .eq("status", "draft_ready"),
    supabase
      .from("youtube_video_queue")
      .select("id, status")
      .eq("status", "published"),
    supabase
      .from("youtube_video_queue")
      .select("id")
      .eq("status", "pending"),
    supabase
      .from("seo_performance")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const publishedPosts = posts.data || [];
  const totalImpressions = publishedPosts.reduce((s, p) => s + (p.google_impressions || 0), 0);
  const totalClicks = publishedPosts.reduce((s, p) => s + (p.google_clicks || 0), 0);
  const top3 = publishedPosts.filter((p) => p.google_position > 0 && p.google_position <= 3).length;
  const top10 = publishedPosts.filter((p) => p.google_position > 0 && p.google_position <= 10).length;
  const avgPos = publishedPosts.filter((p) => p.google_position > 0).length > 0
    ? publishedPosts.filter((p) => p.google_position > 0).reduce((s, p) => s + p.google_position, 0) /
      publishedPosts.filter((p) => p.google_position > 0).length
    : 0;

  return {
    totalPosts: publishedPosts.length,
    totalImpressions,
    totalClicks,
    ctr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : "0.0",
    avgPosition: avgPos > 0 ? avgPos.toFixed(1) : "N/A",
    top3,
    top10,
    pendingKeywords: keywords.data?.length || 0,
    readyOutreach: backlinks.data?.length || 0,
    publishedVideos: videos.data?.length || 0,
    videoQueue: queue.data?.length || 0,
  };
}

async function generateBrief(stats: Record<string, unknown>): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Write a 100-word morning SEO brief for Zach Curtis (Roofing OS founder).

Stats:
- ${stats.totalPosts} published posts
- ${stats.totalImpressions} Google impressions, ${stats.totalClicks} clicks (CTR: ${stats.ctr}%)
- Avg position: ${stats.avgPosition}, Top 3: ${stats.top3}, Top 10: ${stats.top10}
- ${stats.pendingKeywords} keywords in queue
- ${stats.readyOutreach} outreach emails ready to send
- ${stats.publishedVideos} YouTube videos live, ${stats.videoQueue} in queue

Be direct. Lead with what needs attention. End with one clear action item for today.
Write in second person ("Your site..."). No bullet points. Flowing sentences.`,
      }],
    }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "Daily SEO brief unavailable.";
}

async function sendTelegram(text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: "HTML" }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "seo-daily-brief ready" }, { headers: CORS });
  }

  const stats = await gatherStats();
  const brief = await generateBrief(stats);

  const message = `📊 <b>SEO Daily Brief</b> — ${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}

${brief}

<i>roofingos.dev | ${stats.totalPosts} posts | ${stats.totalImpressions} impressions | ${stats.publishedVideos} videos</i>`;

  await sendTelegram(message);

  return Response.json({ ok: true, stats }, { headers: CORS });
});

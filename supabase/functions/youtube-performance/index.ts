import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const YT_API_KEY = Deno.env.get("YOUTUBE_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getVideoStats(
  videoId: string,
): Promise<{ views: number; likes: number; comments: number } | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${YT_API_KEY}`;
  const r = await fetch(url);
  const d = await r.json();
  const stats = d.items?.[0]?.statistics;
  if (!stats) return null;
  return {
    views: parseInt(stats.viewCount || "0"),
    likes: parseInt(stats.likeCount || "0"),
    comments: parseInt(stats.commentCount || "0"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "youtube-performance ready" }, { headers: CORS });
  }

  // Get published videos from the queue (where youtube_id is set)
  const { data: published } = await supabase
    .from("youtube_video_queue")
    .select("id, youtube_id, title, video_type")
    .eq("status", "published")
    .not("youtube_id", "is", null)
    .limit(50);

  const results: Array<{ youtube_id: string; views: number; type: string }> = [];
  const byType: Record<string, { views: number; count: number }> = {};

  for (const video of (published || [])) {
    try {
      const stats = await getVideoStats(video.youtube_id);
      if (!stats) continue;

      // Upsert into youtube_videos for analytics tracking
      try {
        await supabase
          .from("youtube_videos")
          .upsert({
            youtube_id: video.youtube_id,
            title: video.title,
            video_type: video.video_type,
            views: stats.views,
            likes: stats.likes,
            comments: stats.comments,
            updated_at: new Date().toISOString(),
          }, { onConflict: "youtube_id" });
      } catch { /* table may not have all columns */ }

      results.push({ youtube_id: video.youtube_id, views: stats.views, type: video.video_type });

      const t = video.video_type || "unknown";
      if (!byType[t]) byType[t] = { views: 0, count: 0 };
      byType[t].views += stats.views;
      byType[t].count++;
    } catch { /* non-critical */ }
  }

  const totalViews = results.reduce((s, r) => s + r.views, 0);
  const topVideo = results.sort((a, b) => b.views - a.views)[0];

  // Send weekly digest
  try {
    const summary = Object.entries(byType)
      .map(([type, d]) => `${type}: ${d.count} videos, ${d.views} total views`)
      .join("\n");

    await supabase
      .from("telegram_digest_queue")
      .insert({
        category: "youtube",
        message: `📺 YouTube Weekly Report\n\nTotal views this week: ${totalViews}\nVideos tracked: ${results.length}\n\n${summary}\n\nTop video: ${topVideo?.youtube_id || "none"} (${topVideo?.views || 0} views)`,
        priority: 5,
      });
  } catch { /* non-critical */ }

  return Response.json({
    ok: true,
    tracked: results.length,
    totalViews,
    byType,
    topVideo,
  }, { headers: CORS });
});

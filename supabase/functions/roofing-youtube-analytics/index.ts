// roofing-youtube-analytics v1
// Daily 6am MT (12:00 UTC) cron.
// Pulls YouTube view/watch hours/likes/comments per video → updates roofing_content.
// Telegram milestones: 100/500/1000 subs, 4000 watch hours.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID") || "";
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") || "";
const YOUTUBE_REFRESH_TOKEN = Deno.env.get("YOUTUBE_REFRESH_TOKEN") || "";
const TELEGRAM_BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID      = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const MILESTONES = {
  subs:  [100, 500, 1000, 2000, 5000, 10000],
  hours: [500, 1000, 2000, 4000, 8000],
};

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function getYouTubeAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      refresh_token: YOUTUBE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`OAuth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function getChannelStats(accessToken: string): Promise<{ subscribers: number; totalViews: number } | null> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true",
    { headers: { "Authorization": `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const stats = data.items?.[0]?.statistics;
  if (!stats) return null;
  return {
    subscribers: parseInt(stats.subscriberCount || "0", 10),
    totalViews:  parseInt(stats.viewCount || "0", 10),
  };
}

async function getVideoStats(
  accessToken: string,
  videoIds: string[]
): Promise<Map<string, { views: number; likes: number; comments: number }>> {
  const map = new Map<string, { views: number; likes: number; comments: number }>();
  if (!videoIds.length) return map;

  // YouTube API supports up to 50 per request
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${batch.join(",")}&maxResults=50`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of data.items || []) {
      const s = item.statistics || {};
      map.set(item.id, {
        views:    parseInt(s.viewCount    || "0", 10),
        likes:    parseInt(s.likeCount    || "0", 10),
        comments: parseInt(s.commentCount || "0", 10),
      });
    }
  }
  return map;
}

async function getWatchHours(
  accessToken: string,
  videoIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!videoIds.length) return map;

  const endDate   = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Analytics API supports up to 200 video IDs in filter
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({
      ids:        "channel==MINE",
      startDate,
      endDate,
      metrics:    "estimatedMinutesWatched",
      dimensions: "video",
      filters:    `video==${batch.join(",")}`,
    });

    const res = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?${params}`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    if (!res.ok) continue;
    const data = await res.json();
    for (const row of data.rows || []) {
      const videoId    = row[0];
      const minutes    = parseFloat(row[1] || "0");
      const hours      = minutes / 60;
      map.set(videoId, (map.get(videoId) || 0) + hours);
    }
  }
  return map;
}

async function checkMilestones(
  subs: number,
  totalWatchHours: number,
  prevSubs: number,
  prevHours: number,
): Promise<void> {
  for (const ms of MILESTONES.subs) {
    if (prevSubs < ms && subs >= ms) {
      if (ms === 1000) {
        await tg(`📺 *1,000 subscribers!* Apply for monetization now.\nstudio.youtube.com → Earn → Apply\nWatch hours: ${totalWatchHours.toFixed(0)} / 4,000 needed`);
      } else if (ms === 500) {
        await tg(`📺 *500 subscribers!* Halfway to monetization.\nWatch hours: ${totalWatchHours.toFixed(0)} / 4,000`);
      } else {
        await tg(`📺 *${ms} subscribers!*`);
      }
    }
  }
  for (const ms of MILESTONES.hours) {
    if (prevHours < ms && totalWatchHours >= ms) {
      if (ms === 4000) {
        await tg(`📺 *4,000 watch hours reached!* Apply for monetization now.\nstudio.youtube.com → Earn → Apply\nSubscribers: ${subs} / 1,000 needed`);
      } else {
        await tg(`📺 *${ms} watch hours!* ${totalWatchHours.toFixed(0)} total`);
      }
    }
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-analytics v1 ready" });

  const startMs = Date.now();

  const missingYT = [
    !YOUTUBE_CLIENT_ID     && "YOUTUBE_CLIENT_ID",
    !YOUTUBE_CLIENT_SECRET && "YOUTUBE_CLIENT_SECRET",
    !YOUTUBE_REFRESH_TOKEN && "YOUTUBE_REFRESH_TOKEN",
  ].filter(Boolean);
  if (missingYT.length) return Response.json({ ok: false, error: `Missing: ${missingYT.join(", ")}` });

  try {
    const accessToken = await getYouTubeAccessToken();

    // Get all published videos
    const { data: videos } = await supabase
      .from("roofing_content")
      .select("id, youtube_video_id, view_count, watch_hours")
      .not("youtube_video_id", "is", null)
      .not("youtube_posted_at", "is", null);

    if (!videos?.length) {
      return Response.json({ ok: true, message: "No published videos", duration_ms: Date.now() - startMs });
    }

    const videoIds = videos.map((v: Record<string, unknown>) => String(v.youtube_video_id)).filter(Boolean);

    const [channelStats, statsMap, hoursMap] = await Promise.all([
      getChannelStats(accessToken),
      getVideoStats(accessToken, videoIds),
      getWatchHours(accessToken, videoIds),
    ]);

    // Update each video
    let updated = 0;
    for (const video of videos) {
      const ytId = String(video.youtube_video_id || "");
      const stats = statsMap.get(ytId);
      const hours = hoursMap.get(ytId) || 0;
      if (!stats) continue;

      try {
        await supabase.from("roofing_content").update({
          view_count:    stats.views,
          like_count:    stats.likes,
          comment_count: stats.comments,
          watch_hours:   parseFloat(hours.toFixed(2)),
        }).eq("id", video.id);
        updated++;
      } catch { /* non-fatal */ }
    }

    // Channel totals
    const totalViews      = [...statsMap.values()].reduce((sum, s) => sum + s.views, 0);
    const totalWatchHours = [...hoursMap.values()].reduce((sum, h) => sum + h, 0);
    const subs            = channelStats?.subscribers || 0;

    // Check milestones (compare to previous stored values)
    const { data: prevSnap } = await supabase
      .from("system_heartbeats")
      .select("metadata")
      .eq("function_name", "roofing-youtube-analytics")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevMeta = (prevSnap?.metadata as Record<string, number>) || {};
    await checkMilestones(subs, totalWatchHours, prevMeta.subscribers || 0, prevMeta.watch_hours || 0);

    try {
      await supabase.from("system_heartbeats").insert({
        function_name: "roofing-youtube-analytics",
        status: "ok",
        response_ms: Date.now() - startMs,
        recorded_at: new Date().toISOString(),
        metadata: { subscribers: subs, total_views: totalViews, watch_hours: parseFloat(totalWatchHours.toFixed(2)), videos_updated: updated },
      });
    } catch { /* non-fatal */ }

    return Response.json({
      ok: true,
      videos_updated: updated,
      subscribers: subs,
      total_views: totalViews,
      watch_hours: parseFloat(totalWatchHours.toFixed(2)),
      monetization_subs_pct:  `${Math.min(100, Math.round(subs / 1000 * 100))}%`,
      monetization_hours_pct: `${Math.min(100, Math.round(totalWatchHours / 4000 * 100))}%`,
      duration_ms: Date.now() - startMs,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("roofing-youtube-analytics fatal:", msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

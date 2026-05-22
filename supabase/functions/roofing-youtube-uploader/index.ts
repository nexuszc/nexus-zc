// roofing-youtube-uploader v4
// Three modes:
//   1. {content_id} with video_url in DB → download MP4 + upload to YouTube now
//   2. {content_id} with mp3_url, no video_url → render via Shotstack (webhook completes upload)
//   3. {force_upload: true, limit: N} → batch: picks N items from queue, runs mode 1 or 2
//
// Render chain for mode 2:
//   this function → Shotstack API → roofing-shotstack-webhook → this function (mode 1)
//
// No GitHub Actions dependency.
//
// Required secrets: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
//                   SHOTSTACK_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID") || "";
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") || "";
const YOUTUBE_REFRESH_TOKEN = Deno.env.get("YOUTUBE_REFRESH_TOKEN") || "";
const SHOTSTACK_API_KEY     = Deno.env.get("SHOTSTACK_API_KEY") || "";
const TELEGRAM_BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID      = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  if (!data.access_token) throw new Error(`OAuth token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── YouTube upload ────────────────────────────────────────────────────────────

async function uploadToYouTube(
  content: Record<string, unknown>,
  videoBuffer: ArrayBuffer,
): Promise<{ youtubeId: string; youtubeUrl: string }> {
  const accessToken = await getYouTubeAccessToken();

  const estSeconds = (content.duration_estimate as number) || 0;
  const isShort = content.type === "youtube_short" || (estSeconds > 0 && estSeconds <= 60);
  const ytTitle = isShort
    ? `${content.title} #Shorts`.slice(0, 100)
    : String(content.title).slice(0, 100);

  const description =
    String(content.seo_description || content.youtube_description || content.title) +
    "\n\n🏠 roofingos.dev\n📱 Free demo: roofingos.dev/portal-demo";

  const tags = (content.tags as string[]) ||
    ["roofing", "insurance claim", "roofing contractor", "storm damage", "roofing os", "homeowner portal"];

  const contentLength = videoBuffer.byteLength;

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(contentLength),
      },
      body: JSON.stringify({
        snippet: {
          title: ytTitle,
          description: description.slice(0, 5000),
          tags: tags.slice(0, 500),
          categoryId: "22",
          defaultLanguage: "en",
        },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    }
  );
  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error(`No upload URL (YouTube init status ${initRes.status})`);

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(contentLength) },
    body: videoBuffer,
  });
  const videoData = await uploadRes.json();
  const youtubeId = videoData.id;
  if (!youtubeId) throw new Error(`YouTube upload failed: ${JSON.stringify(videoData).slice(0, 300)}`);

  return { youtubeId, youtubeUrl: `https://youtube.com/watch?v=${youtubeId}` };
}

// ── Shotstack render ──────────────────────────────────────────────────────────

async function getAudioDuration(mp3Url: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.shotstack.io/v1/probe/${encodeURIComponent(mp3Url)}`,
      { headers: { "x-api-key": SHOTSTACK_API_KEY } }
    );
    if (!res.ok) return 59;
    const data = await res.json();
    return Math.ceil(data.response?.mediaDuration || 59);
  } catch {
    return 59;
  }
}

async function triggerShotstackRender(content: {
  id: string;
  title: string;
  type: string;
  mp3_url: string;
  duration_estimate?: number | null;
}): Promise<string> {
  if (!SHOTSTACK_API_KEY) throw new Error("SHOTSTACK_API_KEY not configured");

  const isShort = content.type === "youtube_short";
  const probedDuration = await getAudioDuration(content.mp3_url);
  const maxDuration = isShort ? 59 : 600;
  const duration = Math.min(probedDuration, maxDuration);

  const titleText = content.title.slice(0, 80).toUpperCase();

  const timeline = {
    background: "#000000",
    tracks: [
      {
        clips: [{
          asset: {
            type: "title",
            text: titleText,
            style: "minimal",
            color: "#ffffff",
            size: isShort ? "medium" : "large",
            position: "center",
          },
          start: 0,
          length: duration,
        }],
      },
      {
        clips: [{
          asset: {
            type: "title",
            text: "roofingos.dev",
            style: "minimal",
            color: "#e85d26",
            size: "x-small",
            position: "bottomLeft",
          },
          start: 0,
          length: duration,
        }],
      },
      {
        clips: [{
          asset: { type: "audio", src: content.mp3_url, volume: 1 },
          start: 0,
          length: duration,
        }],
      },
    ],
  };

  const output = isShort
    ? { format: "mp4", resolution: "sd", aspectRatio: "9:16", fps: 25 }
    : { format: "mp4", resolution: "hd", aspectRatio: "16:9", fps: 25 };

  const res = await fetch("https://api.shotstack.io/v1/render", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": SHOTSTACK_API_KEY,
    },
    body: JSON.stringify({
      timeline,
      output,
      callback: `${SUPABASE_URL}/functions/v1/roofing-shotstack-webhook`,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.response?.id) {
    throw new Error(`Shotstack render failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const renderId: string = data.response.id;

  await supabase.from("roofing_content").update({
    shotstack_render_id: renderId,
    video_render_status: "rendering",
  }).eq("id", content.id);

  console.log(`Shotstack render queued: ${renderId} for content ${content.id}`);
  return renderId;
}

// ── Core: process one content item ───────────────────────────────────────────

interface ProcessResult {
  uploaded: boolean;
  queued: boolean;
  already_uploaded?: boolean;
  youtube_url?: string;
  render_id?: string;
}

async function processOne(contentId: string): Promise<ProcessResult> {
  const { data: content, error: contentErr } = await supabase
    .from("roofing_content")
    .select("*")
    .eq("id", contentId)
    .single();

  if (contentErr || !content) throw new Error("Content not found");

  // Already uploaded
  if (content.youtube_video_id) {
    return { uploaded: false, queued: false, already_uploaded: true, youtube_url: content.youtube_url };
  }

  // Mode 1: video_url is set — upload to YouTube now
  if (content.video_url) {
    const missingYT = [
      !YOUTUBE_CLIENT_ID     && "YOUTUBE_CLIENT_ID",
      !YOUTUBE_CLIENT_SECRET && "YOUTUBE_CLIENT_SECRET",
      !YOUTUBE_REFRESH_TOKEN && "YOUTUBE_REFRESH_TOKEN",
    ].filter(Boolean);
    if (missingYT.length > 0) throw new Error(`Missing YouTube credentials: ${missingYT.join(", ")}`);

    console.log(`Fetching video: ${content.video_url}`);
    const videoRes = await fetch(content.video_url);
    if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`);
    const videoBuffer = await videoRes.arrayBuffer();
    console.log(`Video: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

    const { youtubeId, youtubeUrl } = await uploadToYouTube(content, videoBuffer);
    console.log(`YouTube upload complete: ${youtubeUrl}`);

    try {
      await supabase.from("roofing_content").update({
        status: "published",
        youtube_video_id: youtubeId,
        youtube_url: youtubeUrl,
        youtube_posted_at: new Date().toISOString(),
        published_at: new Date().toISOString(),
      }).eq("id", contentId);
    } catch (dbErr) {
      console.error("DB update failed (upload succeeded):", dbErr);
    }

    fetch(`${SUPABASE_URL}/functions/v1/roofing-social-poster`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content_id: contentId,
        youtube_url: youtubeUrl,
        title: content.title,
        hook: content.hook_text || content.title,
      }),
    }).catch(() => {});

    return { uploaded: true, queued: false, youtube_url: youtubeUrl };
  }

  // Mode 2: no video_url, has mp3_url — render via Shotstack
  if (!content.mp3_url) {
    throw new Error("No video or audio available — run voiceover engine first");
  }

  // Don't re-trigger if already rendering
  if (content.shotstack_render_id && content.video_render_status === "rendering") {
    return { uploaded: false, queued: true, render_id: content.shotstack_render_id };
  }

  const renderId = await triggerShotstackRender({
    id: content.id,
    title: content.title,
    type: content.type || "youtube_short",
    mp3_url: content.mp3_url,
    duration_estimate: content.duration_estimate,
  });

  return { uploaded: false, queued: true, render_id: renderId };
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-uploader v4 ready" });

  // Batch mode: query pending queue, process up to limit items
  if (body.force_upload) {
    const limit = Math.min(body.limit ?? 1, 5);

    const { data: queue } = await supabase
      .from("roofing_content")
      .select("id, title, type, mp3_url, video_url, video_render_status, shotstack_render_id, youtube_video_id")
      .eq("youtube_upload_ready", true)
      .is("youtube_posted_at", null)
      .not("mp3_url", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (!queue?.length) {
      return Response.json({ ok: true, processed: 0, message: "Queue empty — nothing to upload" });
    }

    const results = [];
    for (const item of queue) {
      try {
        const result = await processOne(item.id);
        results.push({ id: item.id, title: item.title, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`processOne failed for ${item.id}:`, msg);
        await tg(`❌ YouTube uploader failed for \`${String(item.title).slice(0, 60)}\`\n${msg.slice(0, 200)}`);
        results.push({ id: item.id, title: item.title, ok: false, error: msg });
      }
      if (results.length < queue.length) await new Promise(r => setTimeout(r, 500));
    }

    return Response.json({ ok: true, processed: results.length, results });
  }

  // Single content_id mode (also called by roofing-shotstack-webhook)
  const { content_id } = body;
  if (!content_id) return Response.json({ error: "content_id or force_upload required" }, { status: 400 });

  try {
    const result = await processOne(content_id);
    return Response.json({ ok: true, content_id, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`roofing-youtube-uploader error for ${content_id}:`, msg);
    await tg(`❌ YouTube uploader failed for \`${content_id}\`\n${msg.slice(0, 200)}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

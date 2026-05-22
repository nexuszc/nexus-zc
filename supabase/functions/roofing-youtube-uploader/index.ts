// roofing-youtube-uploader v6
// Upload flow for content with mp3_url but no video_url:
//   1. Creatomate renders MP4 from mp3 + branded template (inline composition, no dashboard template needed)
//   2. Poll until render complete (max ~4 min)
//   3. Download rendered MP4
//   4. Upload to YouTube via resumable API
//   5. Set youtube_video_id + youtube_posted_at
//
// For content with video_url already set: skip to step 3.
// Batch mode: {force_upload: true, limit: N} processes queue.
//
// Required secrets: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
//                   CREATOMATE_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID") || "";
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") || "";
const YOUTUBE_REFRESH_TOKEN = Deno.env.get("YOUTUBE_REFRESH_TOKEN") || "";
const CREATOMATE_API_KEY     = Deno.env.get("CREATOMATE_API_KEY") || "";
const CREATOMATE_TEMPLATE_ID = Deno.env.get("CREATOMATE_TEMPLATE_ID") || "";
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

// ── Creatomate: render MP3 → MP4 ─────────────────────────────────────────────

function buildCreatomateSource(content: {
  title: string;
  hook_text?: string | null;
  type?: string;
  mp3_url: string;
}): Record<string, unknown> {
  const isShort = (content.type || "youtube_short").includes("short");
  const titleText = content.title.slice(0, 120);
  const hookText = (content.hook_text || "").slice(0, 160);

  return {
    output_format: "mp4",
    frame_rate: 25,
    width: isShort ? 1080 : 1920,
    height: isShort ? 1920 : 1080,
    duration: "auto",
    elements: [
      // Background
      {
        type: "rectangle",
        track: 1,
        time: 0,
        width: "100%",
        height: "100%",
        fill_color: "#0f1923",
      },
      // Gradient overlay — subtle top fade
      {
        type: "rectangle",
        track: 2,
        time: 0,
        width: "100%",
        height: "40%",
        y: "0%",
        y_alignment: "0%",
        fill_color: [
          { position: 0, color: "#1a2332" },
          { position: 1, color: "rgba(15,25,35,0)" },
        ],
      },
      // Title text
      {
        type: "text",
        track: 3,
        time: 0,
        width: "84%",
        height: "auto",
        x_alignment: "50%",
        y_alignment: isShort ? "32%" : "40%",
        text: titleText,
        font_family: "Montserrat",
        font_weight: "800",
        font_size: isShort ? "54" : "72",
        fill_color: "#ffffff",
        letter_spacing: "-1",
        line_height: "1.15",
        x_alignment_text: "center",
        animations: [
          {
            time: "start",
            duration: 0.7,
            type: "slide",
            direction: "up",
            easing: "quadratic-out",
          },
        ],
      },
      // Hook / subtitle (if present)
      ...(hookText ? [{
        type: "text",
        track: 4,
        time: 0.4,
        width: "80%",
        height: "auto",
        x_alignment: "50%",
        y_alignment: isShort ? "52%" : "60%",
        text: hookText,
        font_family: "Montserrat",
        font_weight: "400",
        font_size: isShort ? "32" : "42",
        fill_color: "rgba(255,255,255,0.75)",
        x_alignment_text: "center",
        animations: [
          {
            time: "start",
            duration: 0.7,
            type: "fade",
            easing: "quadratic-out",
          },
        ],
      }] : []),
      // Roofing OS wordmark bottom left
      {
        type: "text",
        track: 5,
        time: 0,
        x: "5%",
        y: "91%",
        text: "ROOFING OS",
        font_family: "Montserrat",
        font_weight: "700",
        font_size: isShort ? "28" : "36",
        fill_color: "#e85d26",
        letter_spacing: "2",
      },
      // roofingos.dev watermark bottom right
      {
        type: "text",
        track: 6,
        time: 0,
        x: "95%",
        y: "91%",
        x_alignment: "100%",
        text: "roofingos.dev",
        font_family: "Montserrat",
        font_weight: "400",
        font_size: isShort ? "24" : "30",
        fill_color: "rgba(255,255,255,0.5)",
      },
      // Audio track
      {
        type: "audio",
        track: 7,
        time: 0,
        source: content.mp3_url,
        volume: "100%",
      },
    ],
  };
}

async function creatomateRender(content: {
  title: string;
  hook_text?: string | null;
  type?: string;
  mp3_url: string;
}): Promise<string> {
  if (!CREATOMATE_API_KEY) throw new Error("CREATOMATE_API_KEY not configured");

  // Use dashboard template if configured, otherwise fall back to inline source
  const requestBody = CREATOMATE_TEMPLATE_ID
    ? {
        template_id: CREATOMATE_TEMPLATE_ID,
        modifications: {
          title: content.title.slice(0, 120),
          audio: content.mp3_url,
          hook: (content.hook_text || "").slice(0, 160),
          watermark: "roofingos.dev",
        },
      }
    : { source: buildCreatomateSource(content) };

  const res = await fetch("https://api.creatomate.com/v1/renders", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Creatomate render request failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const renderId: string = Array.isArray(data) ? data[0]?.id : data?.id;
  if (!renderId) throw new Error(`Creatomate response missing render id: ${JSON.stringify(data).slice(0, 200)}`);

  console.log(`Creatomate render queued: ${renderId}`);
  return renderId;
}

async function creatomateWaitForRender(renderId: string, timeoutMs = 250_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));

    const res = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
      headers: { "Authorization": `Bearer ${CREATOMATE_API_KEY}` },
    });

    if (!res.ok) {
      console.error(`Creatomate poll error: ${res.status}`);
      continue;
    }

    const data = await res.json();
    const status: string = data.status;
    console.log(`Creatomate render ${renderId}: ${status}`);

    if (status === "succeeded") {
      if (!data.url) throw new Error("Creatomate render succeeded but no url in response");
      return data.url as string;
    }
    if (status === "failed") {
      throw new Error(`Creatomate render failed: ${data.error_message || "unknown error"}`);
    }
    // planned / waiting / rendering — keep polling
  }

  throw new Error(`Creatomate render timed out after ${timeoutMs / 1000}s`);
}

// ── YouTube upload ────────────────────────────────────────────────────────────

async function uploadToYouTube(
  content: Record<string, unknown>,
  videoBuffer: ArrayBuffer,
): Promise<{ youtubeId: string; youtubeUrl: string }> {
  const accessToken = await getYouTubeAccessToken();

  const isShort = String(content.type || "").includes("short");
  const ytTitle = isShort
    ? `${String(content.title)} #Shorts`.slice(0, 100)
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

  if (!initRes.ok) {
    const err = await initRes.text().catch(() => "");
    throw new Error(`YouTube init failed (${initRes.status}): ${err.slice(0, 300)}`);
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("No upload URL in YouTube init response");

  console.log(`Uploading ${(contentLength / 1024 / 1024).toFixed(1)} MB to YouTube...`);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(contentLength) },
    body: videoBuffer,
  });

  const videoData = await uploadRes.json().catch(() => ({}));
  const youtubeId = videoData.id;
  if (!youtubeId) throw new Error(`YouTube upload failed: ${JSON.stringify(videoData).slice(0, 300)}`);

  return { youtubeId, youtubeUrl: `https://youtube.com/watch?v=${youtubeId}` };
}

// ── Core: process one item ────────────────────────────────────────────────────

interface ProcessResult {
  uploaded: boolean;
  already_uploaded?: boolean;
  youtube_url?: string;
  render_id?: string;
}

async function processOne(contentId: string): Promise<ProcessResult> {
  const { data: content, error } = await supabase
    .from("roofing_content")
    .select("*")
    .eq("id", contentId)
    .single();

  if (error || !content) throw new Error("Content not found");
  if (content.youtube_video_id) {
    return { uploaded: false, already_uploaded: true, youtube_url: content.youtube_url };
  }

  const missingYT = [
    !YOUTUBE_CLIENT_ID     && "YOUTUBE_CLIENT_ID",
    !YOUTUBE_CLIENT_SECRET && "YOUTUBE_CLIENT_SECRET",
    !YOUTUBE_REFRESH_TOKEN && "YOUTUBE_REFRESH_TOKEN",
  ].filter(Boolean);
  if (missingYT.length) throw new Error(`Missing YouTube credentials: ${missingYT.join(", ")}`);

  let videoUrl: string | null = content.video_url || null;
  let renderId: string | undefined;

  // No video yet — render via Creatomate
  if (!videoUrl) {
    if (!content.mp3_url) throw new Error("No video or audio — run voiceover engine first");

    renderId = await creatomateRender({
      title: content.title,
      hook_text: content.hook_text || null,
      type: content.type || "youtube_short",
      mp3_url: content.mp3_url,
    });

    videoUrl = await creatomateWaitForRender(renderId);
    console.log(`Render complete: ${videoUrl}`);
  }

  // Download rendered video
  console.log(`Fetching video: ${videoUrl}`);
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Failed to fetch video (${videoRes.status})`);
  const videoBuffer = await videoRes.arrayBuffer();
  console.log(`Downloaded ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

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

  return { uploaded: true, youtube_url: youtubeUrl, render_id: renderId };
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-uploader v6 ready", creatomate: !!CREATOMATE_API_KEY, template: CREATOMATE_TEMPLATE_ID || "inline-source" });

  // Batch mode
  if (body.force_upload) {
    const limit = Math.min(body.limit ?? 1, 20);

    const { data: queue } = await supabase
      .from("roofing_content")
      .select("id, title, type, mp3_url, video_url, youtube_video_id")
      .eq("youtube_upload_ready", true)
      .is("youtube_posted_at", null)
      .not("mp3_url", "is", null)
      .is("shotstack_render_id", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (!queue?.length) {
      return Response.json({ ok: true, processed: 0, message: "Queue empty" });
    }

    const results = [];
    for (const item of queue) {
      try {
        const result = await processOne(item.id);
        results.push({ id: item.id, title: item.title, ...result });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`processOne failed for ${item.id}:`, msg);
        await tg(`❌ YouTube upload failed for \`${String(item.title).slice(0, 60)}\`\n${msg.slice(0, 200)}`);
        results.push({ id: item.id, title: item.title, ok: false, error: msg });
      }
    }

    return Response.json({ ok: true, processed: results.length, results });
  }

  // Single content_id mode
  const { content_id } = body;
  if (!content_id) return Response.json({ error: "content_id or force_upload required" }, { status: 400 });

  try {
    const result = await processOne(content_id);
    return Response.json({ ok: true, content_id, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`uploader error for ${content_id}:`, msg);
    await tg(`❌ YouTube uploader failed for \`${content_id}\`\n${msg.slice(0, 200)}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

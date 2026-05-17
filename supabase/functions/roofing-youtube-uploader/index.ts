// roofing-youtube-uploader v2
// Renders MP4 via Shotstack (script + voiceover → branded video) then uploads to YouTube.
//
// Flow:
//   1. Check YouTube OAuth credentials
//   2. Look up content record
//   3. If already uploaded → return early
//   4. If no video_url and mp3_url exists → render with Shotstack (max 2 min poll)
//   5. Upload MP4 to YouTube via resumable upload
//   6. Update roofing_content with youtube_video_id + youtube_url
//   7. Trigger roofing-social-poster
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

// ── Shotstack ─────────────────────────────────────────────────────────────────

function htmlClip(opts: {
  html: string;
  css?: string;
  width: number;
  height: number;
  start: number;
  length: number;
  position: string;
  transition?: { in?: string; out?: string };
  offset?: { x: number; y: number };
}) {
  const clip: Record<string, unknown> = {
    asset: {
      type: "html",
      html: opts.html,
      css: opts.css ?? "",
      width: opts.width,
      height: opts.height,
      background: "transparent",
    },
    start: opts.start,
    length: opts.length,
    position: opts.position,
  };
  if (opts.transition) clip.transition = opts.transition;
  if (opts.offset)     clip.offset     = opts.offset;
  return clip;
}

function buildShotstackPayload(content: {
  title: string;
  hook_text: string;
  thumbnail_text: string;
  mp3_url: string;
  duration_estimate: number;
  format: string;
}): object {
  const isShort = content.format === "short";
  const dur     = Math.max(content.duration_estimate || (isShort ? 60 : 360), 15);

  const hookEnd  = isShort ? 8  : 20;
  const ctaStart = Math.max(dur - 15, hookEnd + 5);
  const bodyEnd  = ctaStart;

  const hookText = (content.hook_text || content.title).replace(/'/g, "’").slice(0, 200);
  const bodyText = (content.thumbnail_text || content.title).replace(/'/g, "’").slice(0, 100);

  const vw = isShort ? 1080 : 1920;   // canvas width
  const vh = isShort ? 1920 : 1080;   // canvas height
  const tw = Math.round(vw * 0.85);   // text box width (85% of canvas)

  // Font sizes (px, scaled for resolution)
  const hookSize  = isShort ? 72 : 64;
  const bodySize  = isShort ? 56 : 52;
  const ctaSize   = isShort ? 52 : 48;
  const labelSize = isShort ? 28 : 24;

  const tracks = [];

  // Brand label — top, full duration
  tracks.push({ clips: [htmlClip({
    html: `<p>ROOFING OS</p>`,
    css:  `p { font-family: Arial, sans-serif; font-size: ${labelSize}px; font-weight: 700; color: #6b7280; text-align: center; letter-spacing: 6px; margin: 0; }`,
    width: tw, height: Math.round(labelSize * 2.5),
    start: 0, length: dur,
    position: "top",
    offset: { x: 0, y: -0.06 },
  })] });

  // URL watermark — bottom, full duration
  tracks.push({ clips: [htmlClip({
    html: `<p>roofingos.dev</p>`,
    css:  `p { font-family: Arial, sans-serif; font-size: ${labelSize}px; color: #9ca3af; text-align: center; margin: 0; }`,
    width: tw, height: Math.round(labelSize * 2.5),
    start: 0, length: dur,
    position: "bottom",
    offset: { x: 0, y: 0.06 },
  })] });

  // Hook text — centered, opening
  tracks.push({ clips: [htmlClip({
    html: `<p>${hookText}</p>`,
    css:  `p { font-family: 'Arial Black', Arial, sans-serif; font-size: ${hookSize}px; font-weight: 900; color: #ffffff; text-align: center; line-height: 1.25; margin: 0; padding: 0 20px; word-wrap: break-word; }`,
    width: tw, height: Math.round(vh * 0.45),
    start: 0, length: hookEnd,
    position: "center",
    transition: { in: "fade", out: "fade" },
  })] });

  // Body text — centered, middle
  if (bodyEnd > hookEnd + 1) {
    tracks.push({ clips: [htmlClip({
      html: `<p>${bodyText}</p>`,
      css:  `p { font-family: 'Arial Black', Arial, sans-serif; font-size: ${bodySize}px; font-weight: 700; color: #e5e7eb; text-align: center; line-height: 1.3; margin: 0; padding: 0 20px; word-wrap: break-word; }`,
      width: tw, height: Math.round(vh * 0.35),
      start: hookEnd,
      length: bodyEnd - hookEnd,
      position: "center",
      transition: { in: "fade", out: "fade" },
    })] });
  }

  // CTA — top layer, last 15 s
  tracks.push({ clips: [htmlClip({
    html: `<p>roofingos.dev<br><span>Free Trial &nbsp;•&nbsp; 14 Days &nbsp;•&nbsp; No Credit Card</span></p>`,
    css:  `p { font-family: Arial, sans-serif; font-size: ${ctaSize}px; font-weight: 900; color: #4ade80; text-align: center; line-height: 1.35; margin: 0; padding: 0 20px; } span { font-size: ${Math.round(ctaSize * 0.55)}px; font-weight: 400; }`,
    width: tw, height: Math.round(vh * 0.35),
    start: ctaStart, length: dur - ctaStart,
    position: "center",
    transition: { in: "fade" },
  })] });

  return {
    timeline: {
      soundtrack: { src: content.mp3_url, effect: "fadeOut", volume: 1 },
      background: "#0a0a0a",
      tracks,
    },
    output: {
      format: "mp4",
      size: { width: vw, height: vh },
      fps: 30,
    },
  };
}

async function renderWithShotstack(content: {
  id: string;
  title: string;
  hook_text: string;
  thumbnail_text: string;
  mp3_url: string;
  duration_estimate: number;
  format: string;
}): Promise<string> {
  if (!SHOTSTACK_API_KEY) throw new Error("SHOTSTACK_API_KEY not configured");

  const payload = buildShotstackPayload(content);

  console.log(`Shotstack render start: ${content.title}`);

  const renderRes = await fetch("https://api.shotstack.io/v1/render", {
    method: "POST",
    headers: {
      "x-api-key": SHOTSTACK_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const renderBody = await renderRes.json();
  if (!renderRes.ok || !renderBody.response?.id) {
    throw new Error(`Shotstack render submit failed (${renderRes.status}): ${JSON.stringify(renderBody).slice(0, 300)}`);
  }

  const renderId = renderBody.response.id;
  console.log(`Shotstack render queued: ${renderId}`);

  console.log(`Shotstack render ID: ${renderId}`);

  // Poll for completion — max 24 attempts × 5s = 120s
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise(r => setTimeout(r, 5_000));

    const pollRes = await fetch(`https://api.shotstack.io/v1/render/${renderId}`, {
      headers: { "x-api-key": SHOTSTACK_API_KEY },
    });

    const pollBody = await pollRes.json();
    const status = pollBody.response?.status;
    const url    = pollBody.response?.url;

    console.log(`Shotstack poll ${attempt + 1}/24: ${status}`);

    if (status === "done" && url) {
      console.log(`Shotstack render complete: ${url}`);
      // Cache the rendered URL so we don't re-render if YouTube upload fails
      try {
        await supabase.from("roofing_content").update({ video_url: url }).eq("id", content.id);
      } catch { /* non-fatal */ }
      return url;
    }

    if (status === "failed") {
      const err = pollBody.response?.error || JSON.stringify(pollBody).slice(0, 200);
      throw new Error(`Shotstack render failed: ${err}`);
    }
    // queued / fetching / rendering / saving — keep polling
  }

  throw new Error(`Shotstack render timed out after 120s (render ID: ${renderId})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-uploader v2 ready" });

  // YouTube credentials check
  const missingYT = [
    !YOUTUBE_CLIENT_ID     && "YOUTUBE_CLIENT_ID",
    !YOUTUBE_CLIENT_SECRET && "YOUTUBE_CLIENT_SECRET",
    !YOUTUBE_REFRESH_TOKEN && "YOUTUBE_REFRESH_TOKEN",
  ].filter(Boolean);

  if (missingYT.length > 0) {
    return Response.json({
      ok: false,
      error: "YouTube credentials not configured",
      missing: missingYT,
      setup_instructions: "See function header comment for OAuth setup steps",
    }, { status: 503 });
  }

  const { content_id, video_url: bodyVideoUrl } = body;
  if (!content_id) return Response.json({ error: "content_id required" }, { status: 400 });

  const { data: content, error: contentErr } = await supabase
    .from("roofing_content")
    .select("*")
    .eq("id", content_id)
    .single();

  if (contentErr || !content) return Response.json({ error: "Content not found" }, { status: 404 });
  if (content.youtube_video_id) {
    return Response.json({ ok: true, already_uploaded: true, youtube_video_id: content.youtube_video_id, youtube_url: content.youtube_url });
  }

  try {
    // Resolve video URL — body → content.video_url → Shotstack render → error
    let videoUrl: string | null = bodyVideoUrl || content.video_url || null;

    if (!videoUrl) {
      if (!content.mp3_url) {
        return Response.json({
          ok: false,
          error: "No video or audio available",
          detail: "Run roofing-voiceover-engine first to generate mp3_url, then re-run this function.",
          content_id,
        }, { status: 422 });
      }

      console.log(`No video_url — rendering with Shotstack for: ${content.title}`);
      videoUrl = await renderWithShotstack({
        id:                 content.id,
        title:              content.title,
        hook_text:          content.hook_text || "",
        thumbnail_text:     content.thumbnail_text || "",
        mp3_url:            content.mp3_url,
        duration_estimate:  content.duration_estimate || 60,
        format:             content.format || "short",
      });
    }

    // Get YouTube access token
    const accessToken = await getYouTubeAccessToken();

    const estSeconds = (content.duration_estimate as number) || 0;
    const isShort = estSeconds > 0 && estSeconds <= 60;
    const ytTitle = isShort ? `${content.title} #Shorts` : content.title;

    const description =
      (content.seo_description || content.youtube_description || content.title) +
      "\n\n🏠 roofingos.dev\n📱 Free demo: roofingos.dev/portal-demo";

    const tags = (content.tags as string[]) || ["roofing", "insurance claim", "roofing contractor", "storm damage", "roofing os", "homeowner portal"];

    // Fetch video bytes
    console.log(`Fetching video bytes from: ${videoUrl}`);
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status} ${videoUrl}`);
    const videoBuffer = await videoRes.arrayBuffer();
    const contentLength = videoBuffer.byteLength;
    console.log(`Video size: ${(contentLength / 1024 / 1024).toFixed(1)} MB`);

    // Step 1: Initialize resumable upload
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
            title: ytTitle.slice(0, 100),
            description: description.slice(0, 5000),
            tags: tags.slice(0, 500),
            categoryId: "22",
            defaultLanguage: "en",
          },
          status: {
            privacyStatus: "public",
            selfDeclaredMadeForKids: false,
          },
        }),
      }
    );

    const uploadUrl = initRes.headers.get("Location");
    if (!uploadUrl) throw new Error(`No upload URL returned (status ${initRes.status})`);

    // Step 2: Upload video bytes
    console.log(`Uploading to YouTube...`);
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(contentLength),
      },
      body: videoBuffer,
    });

    const videoData = await uploadRes.json();
    const youtubeId = videoData.id;
    if (!youtubeId) throw new Error(`YouTube upload failed: ${JSON.stringify(videoData).slice(0, 300)}`);

    const youtubeUrl = `https://youtube.com/watch?v=${youtubeId}`;
    console.log(`YouTube upload complete: ${youtubeUrl}`);

    // Update content record
    try {
      await supabase.from("roofing_content").update({
        status: "published",
        youtube_video_id: youtubeId,
        youtube_url: youtubeUrl,
        published_at: new Date().toISOString(),
      }).eq("id", content_id);
    } catch (dbErr) {
      console.error("DB update failed (upload succeeded):", dbErr);
    }

    // Trigger social poster (fire-and-forget)
    fetch(`${SUPABASE_URL}/functions/v1/roofing-social-poster`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content_id, youtube_url: youtubeUrl, title: content.title, hook: content.hook_text || content.title }),
    }).catch(() => {});

    return Response.json({ ok: true, youtube_id: youtubeId, youtube_url: youtubeUrl });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`roofing-youtube-uploader error for ${content_id}:`, msg);
    await tg(`❌ YouTube upload failed for \`${content_id}\`\n${msg.slice(0, 200)}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

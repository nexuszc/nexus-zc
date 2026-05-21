// roofing-youtube-uploader v3
// Two modes:
//   1. {content_id} only — triggers GitHub Actions FFmpeg render (async)
//      GitHub Action renders MP4 → uploads to Supabase Storage
//      → POSTs to roofing-video-webhook → calls this function again
//   2. {content_id} with video_url set in DB — uploads to YouTube immediately
//
// Required secrets: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
//                   GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID") || "";
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") || "";
const YOUTUBE_REFRESH_TOKEN = Deno.env.get("YOUTUBE_REFRESH_TOKEN") || "";
const GITHUB_TOKEN          = Deno.env.get("GITHUB_TOKEN") || "";
const TELEGRAM_BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID      = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const GITHUB_WORKFLOW_URL =
  "https://api.github.com/repos/nexuszc/nexus-zc/actions/workflows/roofing-video-generator.yml/dispatches";

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

// ── GitHub Actions dispatch ───────────────────────────────────────────────────

async function triggerVideoGeneration(content: {
  id: string;
  title: string;
  hook_text: string;
  thumbnail_text: string;
  mp3_url: string;
  format: string;
}): Promise<void> {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not configured");

  const res = await fetch(GITHUB_WORKFLOW_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: {
        content_id:      content.id,
        audio_url:       content.mp3_url,
        title:           content.title.slice(0, 120),
        hook_text:       (content.hook_text || content.title).slice(0, 200),
        thumbnail_text:  (content.thumbnail_text || "ROOFING OS").slice(0, 60),
        format:          content.format || "short",
      },
    }),
  });

  // GitHub returns 204 on success — no body
  if (res.status !== 204) {
    const err = await res.text().catch(() => "");
    throw new Error(`GitHub workflow dispatch failed (${res.status}): ${err.slice(0, 200)}`);
  }

  console.log(`GitHub Actions triggered for content ${content.id}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-uploader v3 ready" });

  const { content_id } = body;
  if (!content_id) return Response.json({ error: "content_id required" }, { status: 400 });

  const { data: content, error: contentErr } = await supabase
    .from("roofing_content")
    .select("*")
    .eq("id", content_id)
    .single();

  if (contentErr || !content) return Response.json({ error: "Content not found" }, { status: 404 });

  // Already uploaded — nothing to do
  if (content.youtube_video_id) {
    return Response.json({
      ok: true,
      already_uploaded: true,
      youtube_video_id: content.youtube_video_id,
      youtube_url: content.youtube_url,
    });
  }

  try {
    // ── Mode 1: video_url is set — upload to YouTube ──────────────────────────
    const videoUrl: string | null = content.video_url || null;

    if (videoUrl) {
      // Check YouTube credentials
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
        }, { status: 503 });
      }

      const accessToken = await getYouTubeAccessToken();

      const estSeconds = (content.duration_estimate as number) || 0;
      const isShort    = estSeconds > 0 && estSeconds <= 60;
      const ytTitle    = isShort ? `${content.title} #Shorts` : content.title;

      const description =
        (content.seo_description || content.youtube_description || content.title) +
        "\n\n🏠 roofingos.dev\n📱 Free demo: roofingos.dev/portal-demo";

      const tags = (content.tags as string[]) ||
        ["roofing", "insurance claim", "roofing contractor", "storm damage", "roofing os", "homeowner portal"];

      // Fetch video bytes
      console.log(`Fetching video: ${videoUrl}`);
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`);
      const videoBuffer = await videoRes.arrayBuffer();
      const contentLength = videoBuffer.byteLength;
      console.log(`Video: ${(contentLength / 1024 / 1024).toFixed(1)} MB`);

      // Step 1: init resumable upload
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
            status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
          }),
        }
      );
      const uploadUrl = initRes.headers.get("Location");
      if (!uploadUrl) throw new Error(`No upload URL returned (status ${initRes.status})`);

      // Step 2: upload bytes
      console.log("Uploading to YouTube...");
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

      try {
        await supabase.from("roofing_content").update({
          status: "published",
          youtube_video_id: youtubeId,
          youtube_url: youtubeUrl,
          youtube_posted_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
        }).eq("id", content_id);
      } catch (dbErr) {
        console.error("DB update failed (upload succeeded):", dbErr);
      }

      // Fire-and-forget social poster
      fetch(`${SUPABASE_URL}/functions/v1/roofing-social-poster`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content_id,
          youtube_url: youtubeUrl,
          title: content.title,
          hook: content.hook_text || content.title,
        }),
      }).catch(() => {});

      return Response.json({ ok: true, youtube_id: youtubeId, youtube_url: youtubeUrl });
    }

    // ── Mode 2: no video_url — trigger GitHub Actions render ─────────────────
    if (!content.mp3_url) {
      return Response.json({
        ok: false,
        error: "No video or audio available",
        detail: "Generate voiceover first (mp3_url must be set), then call again.",
        content_id,
      }, { status: 422 });
    }

    // Don't re-trigger if already rendering
    if (content.video_render_status === "rendering") {
      return Response.json({
        ok: true,
        queued: true,
        message: "Render already in progress — webhook will trigger upload when done",
      });
    }

    await triggerVideoGeneration({
      id:             content.id,
      title:          content.title,
      hook_text:      content.hook_text || "",
      thumbnail_text: content.thumbnail_text || "",
      mp3_url:        content.mp3_url,
      format:         content.format || "short",
    });

    try {
      await supabase.from("roofing_content").update({
        video_render_status: "rendering",
      }).eq("id", content_id);
    } catch { /* non-fatal */ }

    return Response.json({
      ok: true,
      queued: true,
      message: "GitHub Actions render triggered — roofing-video-webhook will fire when done",
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`roofing-youtube-uploader error for ${content_id}:`, msg);
    await tg(`❌ YouTube uploader failed for \`${content_id}\`\n${msg.slice(0, 200)}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

// roofing-youtube-uploader
// Uploads approved + voiceover-ready content to YouTube.
// Triggered by roofing-voiceover-engine after MP3 generation,
// or called manually with { content_id, video_url }.
//
// REQUIRES SECRETS (manual setup in Supabase Dashboard):
//   YOUTUBE_CLIENT_ID       — Google OAuth 2.0 client ID
//   YOUTUBE_CLIENT_SECRET   — Google OAuth 2.0 client secret
//   YOUTUBE_REFRESH_TOKEN   — OAuth refresh token for @ROOFINGOS channel
//   YOUTUBE_CHANNEL_ID      — (optional) channel ID for verification
//
// SETUP STEPS (one-time):
//   1. Google Cloud Console → Enable YouTube Data API v3
//   2. OAuth & Auth → Create OAuth 2.0 Client ID (type: Web)
//   3. Authorized redirect URIs: https://developers.google.com/oauthplayground
//   4. Open OAuth Playground → settings → use your own credentials
//   5. Scope: https://www.googleapis.com/auth/youtube.upload
//   6. Exchange auth code for tokens → copy refresh_token
//   7. Add YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN to Supabase secrets
//
// NOTE: A real video file (MP4) is required. The MP3 alone cannot be uploaded.
// Until roofing-video-generator produces an MP4, pass video_url in the request body
// pointing to an MP4 stored in Supabase storage or any public URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID") || "";
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") || "";
const YOUTUBE_REFRESH_TOKEN = Deno.env.get("YOUTUBE_REFRESH_TOKEN") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function credentialsMissing(): boolean {
  return !YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN;
}

async function getAccessToken(): Promise<string> {
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

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-uploader ready" });

  // Early credential check — fail clearly before doing any work
  if (credentialsMissing()) {
    return Response.json({
      ok: false,
      error: "YouTube credentials not configured",
      missing: [
        !YOUTUBE_CLIENT_ID && "YOUTUBE_CLIENT_ID",
        !YOUTUBE_CLIENT_SECRET && "YOUTUBE_CLIENT_SECRET",
        !YOUTUBE_REFRESH_TOKEN && "YOUTUBE_REFRESH_TOKEN",
      ].filter(Boolean),
      setup_instructions: "See function header comment for one-time OAuth setup steps",
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
  if (content.youtube_video_id) return Response.json({ ok: true, already_uploaded: true, youtube_video_id: content.youtube_video_id });

  // Resolve video URL: request body → content.video_url → fail with clear message
  const videoUrl = bodyVideoUrl || content.video_url || null;
  if (!videoUrl) {
    return Response.json({
      ok: false,
      error: "No video file available",
      detail: "Provide video_url in request body (MP4), or set roofing_content.video_url. MP3 alone cannot be uploaded to YouTube.",
      content_id,
      mp3_url: content.mp3_url || null,
    }, { status: 422 });
  }

  try {
    const accessToken = await getAccessToken();

    // isShort: estimated_length_seconds <= 60
    const estSeconds = (content.estimated_length_seconds as number) || 0;
    const isShort = estSeconds > 0 && estSeconds <= 60;
    const title = isShort ? `${content.title} #Shorts` : content.title;

    const description =
      (content.seo_description || content.youtube_description || content.title) +
      "\n\n🏠 roofingos.dev\n📱 Free demo: roofingos.dev/portal-demo";

    const tags = (content.tags as string[]) || ["roofing", "insurance claim", "roofing contractor", "storm damage", "roofing os", "homeowner portal"];

    // Fetch video bytes
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`);
    const videoBuffer = await videoRes.arrayBuffer();
    const contentLength = videoBuffer.byteLength;

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
            title: title.slice(0, 100),
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
    if (!youtubeId) throw new Error(`Upload failed: ${JSON.stringify(videoData).slice(0, 300)}`);

    const youtubeUrl = `https://youtube.com/watch?v=${youtubeId}`;

    // Update content record
    await supabase.from("roofing_content").update({
      status: "published",
      youtube_video_id: youtubeId,
      youtube_url: youtubeUrl,
      published_at: new Date().toISOString(),
    }).eq("id", content_id);

    // Trigger social poster
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-social-poster`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content_id,
        youtube_url: youtubeUrl,
        title: content.title,
        hook: content.hook || content.title,
      }),
    }).catch(() => {});

    await tg(`🎬 *Video Published*\n\n${title}\n${youtubeUrl}\n\nPosting to Facebook + Reddit now.`);

    return Response.json({ ok: true, youtube_id: youtubeId, youtube_url: youtubeUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await tg(`❌ YouTube upload failed for \`${content_id}\`: ${msg.slice(0, 200)}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

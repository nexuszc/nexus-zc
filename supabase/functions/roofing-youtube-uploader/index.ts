// roofing-youtube-uploader v5
// Two modes:
//   1. {content_id} with video_url in DB → download MP4 + upload to YouTube
//   2. {content_id} with mp3_url, no video_url → download MP3 + upload directly to YouTube (audio/mpeg)
//   3. {force_upload: true, limit: N} → batch: picks N items from queue, runs mode 1 or 2
//
// No GitHub Actions. No Shotstack. No rendering.
//
// Required secrets: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN,
//                   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID") || "";
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") || "";
const YOUTUBE_REFRESH_TOKEN = Deno.env.get("YOUTUBE_REFRESH_TOKEN") || "";
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

// ── Upload to YouTube (video or audio) ───────────────────────────────────────

async function uploadToYouTube(
  content: Record<string, unknown>,
  mediaBuffer: ArrayBuffer,
  mimeType: "video/mp4" | "audio/mpeg",
): Promise<{ youtubeId: string; youtubeUrl: string }> {
  const accessToken = await getYouTubeAccessToken();

  const isShort = content.type === "youtube_short";
  const ytTitle = isShort
    ? `${String(content.title)} #Shorts`.slice(0, 100)
    : String(content.title).slice(0, 100);

  const description =
    String(content.seo_description || content.youtube_description || content.title) +
    "\n\n🏠 roofingos.dev\n📱 Free demo: roofingos.dev/portal-demo";

  const tags = (content.tags as string[]) ||
    ["roofing", "insurance claim", "roofing contractor", "storm damage", "roofing os", "homeowner portal"];

  const contentLength = mediaBuffer.byteLength;

  // Step 1: init resumable upload
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
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
    const errText = await initRes.text().catch(() => "");
    throw new Error(`YouTube init failed (${initRes.status}): ${errText.slice(0, 300)}`);
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error(`No upload URL in YouTube init response`);

  // Step 2: upload bytes
  console.log(`Uploading ${(contentLength / 1024 / 1024).toFixed(1)} MB as ${mimeType}...`);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(contentLength),
    },
    body: mediaBuffer,
  });

  const videoData = await uploadRes.json().catch(() => ({}));
  const youtubeId = videoData.id;
  if (!youtubeId) throw new Error(`YouTube upload failed: ${JSON.stringify(videoData).slice(0, 300)}`);

  return { youtubeId, youtubeUrl: `https://youtube.com/watch?v=${youtubeId}` };
}

// ── Core: process one content item ───────────────────────────────────────────

interface ProcessResult {
  uploaded: boolean;
  already_uploaded?: boolean;
  youtube_url?: string;
  mime?: string;
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

  // Determine source URL and mime type
  const mediaUrl: string | null = content.video_url || content.mp3_url || null;
  if (!mediaUrl) throw new Error("No video or audio available — run voiceover engine first");

  const mimeType: "video/mp4" | "audio/mpeg" = content.video_url ? "video/mp4" : "audio/mpeg";

  console.log(`Fetching ${mimeType} from: ${mediaUrl}`);
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) throw new Error(`Failed to fetch media (${mediaRes.status}): ${mediaUrl}`);
  const mediaBuffer = await mediaRes.arrayBuffer();
  console.log(`Downloaded ${(mediaBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  const { youtubeId, youtubeUrl } = await uploadToYouTube(content, mediaBuffer, mimeType);
  console.log(`Uploaded: ${youtubeUrl}`);

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

  return { uploaded: true, youtube_url: youtubeUrl, mime: mimeType };
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-uploader v5 ready" });

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
      if (results.length < queue.length) await new Promise(r => setTimeout(r, 500));
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

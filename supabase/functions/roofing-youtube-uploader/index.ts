// roofing-youtube-uploader v7
// Pexels stock footage background, improved Creatomate visuals, thumbnail generation,
// pinned comment, full optimized description. Always inline source (no dashboard template).
//
// Flow per video:
//   1. Detect topic from title → fetch Pexels portrait video
//   2. Creatomate: Pexels bg + dark overlay + hook text + title + CTA bar → MP4
//   3. Creatomate thumbnail render (1280×720) in parallel
//   4. Download MP4 → upload to YouTube
//   5. Upload thumbnail via YouTube API
//   6. Post + pin comment
//   7. DB update

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID") || "";
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") || "";
const YOUTUBE_REFRESH_TOKEN = Deno.env.get("YOUTUBE_REFRESH_TOKEN") || "";
const CREATOMATE_API_KEY    = Deno.env.get("CREATOMATE_API_KEY") || "";
const PEXELS_API_KEY        = Deno.env.get("PEXELS_API_KEY") || "";
const TELEGRAM_BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID      = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

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

// ── Pexels stock footage ──────────────────────────────────────────────────────

const PEXELS_QUERIES: Record<string, string> = {
  homeowner_communication: "roofing contractor homeowner house",
  supplement_recovery:     "insurance adjuster roof damage inspection",
  storm_leads:             "hail storm roof damage neighborhood",
  companycam_replacement:  "roofing crew working residential house",
  carrier_tactics:         "insurance paperwork claim documents",
  crew_management:         "construction crew team working",
  reviews_closing:         "contractor handshake client happy",
  product_demo:            "roofing contractor phone app",
  default:                 "roofing contractor house",
};

function detectTopic(title: string): string {
  const t = title.toLowerCase();
  if (/homeowner|call|portal|communication/.test(t)) return "homeowner_communication";
  if (/supplement|carrier|state farm|allstate|usaa|adjuster|denied/.test(t)) return "supplement_recovery";
  if (/storm|hail|weather|market/.test(t)) return "storm_leads";
  if (/companycam|company cam|camera|photo|cancel/.test(t)) return "companycam_replacement";
  if (/crew|team|worker|show up/.test(t)) return "crew_management";
  if (/review|star|closing|close|job/.test(t)) return "reviews_closing";
  return "default";
}

async function getPexelsVideo(topic: string): Promise<string | null> {
  if (!PEXELS_API_KEY) return null;
  try {
    const query = PEXELS_QUERIES[topic] || PEXELS_QUERIES.default;
    const res = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=portrait&size=medium`,
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const video = data.videos?.[0];
    const file = video?.video_files?.find(
      (f: Record<string, unknown>) => f.quality === "hd" && Number(f.height) > Number(f.width)
    ) || video?.video_files?.find(
      (f: Record<string, unknown>) => Number(f.height) > Number(f.width)
    ) || video?.video_files?.[0];
    return file?.link || null;
  } catch {
    return null;
  }
}

// ── Creatomate: video render ──────────────────────────────────────────────────

function buildVideoSource(content: {
  title: string;
  hook_text?: string | null;
  type?: string;
  mp3_url: string;
}, pexelsUrl: string | null): Record<string, unknown> {
  const isShort = (content.type || "youtube_short").includes("short");
  const W = isShort ? 1080 : 1920;
  const H = isShort ? 1920 : 1080;
  const hookText = (content.hook_text || "").slice(0, 120);
  const titleText = content.title.slice(0, 120);

  const elements: Record<string, unknown>[] = [];

  // Layer 1: Background
  if (pexelsUrl) {
    elements.push({
      type: "video", track: 1, time: 0,
      source: pexelsUrl,
      width: "100%", height: "100%",
      x_alignment: "50%", y_alignment: "50%",
      fit: "cover", volume: "0%", loop: true,
      opacity: "40%",
    });
  } else {
    elements.push({
      type: "rectangle", track: 1, time: 0,
      width: "100%", height: "100%",
      fill_color: "#0f1923",
    });
  }

  // Layer 2: Dark overlay
  elements.push({
    type: "rectangle", track: 2, time: 0,
    width: "100%", height: "100%",
    fill_color: "rgba(10,15,26,0.65)",
  });

  // Layer 3: Hook text (top, first 4 seconds)
  if (hookText) {
    elements.push({
      type: "text", track: 3, time: 0, duration: 4,
      width: "88%", height: "auto",
      x_alignment: "50%",
      y: isShort ? "22%" : "26%",
      y_alignment: "50%",
      text: hookText,
      font_family: "Montserrat",
      font_weight: "900",
      font_size: isShort ? "60" : "68",
      fill_color: "#ffffff",
      x_alignment_text: "center",
      line_height: "1.15",
      animations: [{ time: "start", duration: 0.3, type: "slide", direction: "down", easing: "quadratic-out" }],
    });
  }

  // Layer 4: Title (appears at 1.5s, stays)
  elements.push({
    type: "text", track: 4, time: hookText ? 1.8 : 0,
    width: "86%", height: "auto",
    x_alignment: "50%",
    y: isShort ? "50%" : "50%",
    y_alignment: "50%",
    text: titleText,
    font_family: "Montserrat",
    font_weight: "800",
    font_size: isShort ? "50" : "62",
    fill_color: "#ffffff",
    letter_spacing: "-1",
    line_height: "1.2",
    x_alignment_text: "center",
    animations: [{ time: "start", duration: 0.5, type: "fade", easing: "quadratic-out" }],
  });

  // Layer 5: ROOFING OS watermark top-right
  elements.push({
    type: "text", track: 5, time: 0,
    x: "95%", y: "3.5%",
    x_alignment: "100%", y_alignment: "0%",
    text: "ROOFING OS",
    font_family: "Montserrat",
    font_weight: "700",
    font_size: isShort ? "22" : "28",
    fill_color: "rgba(255,255,255,0.2)",
    letter_spacing: "2",
  });

  // Layer 6: CTA bar background (bottom)
  elements.push({
    type: "rectangle", track: 6, time: 0,
    x_alignment: "50%", y_alignment: "100%",
    width: "100%", height: isShort ? "8%" : "10%",
    fill_color: "#4a9eff",
  });

  // Layer 7: CTA text
  elements.push({
    type: "text", track: 7, time: 0,
    width: "90%", height: "auto",
    x_alignment: "50%",
    y: isShort ? "96%" : "95%",
    y_alignment: "50%",
    text: "roofingos.dev — FREE FOREVER",
    font_family: "Montserrat",
    font_weight: "700",
    font_size: isShort ? "30" : "36",
    fill_color: "#ffffff",
    x_alignment_text: "center",
    letter_spacing: "0.5",
  });

  // Layer 8: Audio
  elements.push({
    type: "audio", track: 8, time: 0,
    source: content.mp3_url,
    volume: "100%",
  });

  return { output_format: "mp4", frame_rate: 25, width: W, height: H, duration: "auto", elements };
}

function buildThumbnailSource(content: {
  title: string;
  hook_text?: string | null;
  thumbnail_text?: string | null;
}, pexelsUrl: string | null): Record<string, unknown> {
  const thumbText = (content.thumbnail_text || "").toUpperCase();
  const numMatch  = (content.title + " " + thumbText).match(/\$[\d,]+|\d+%|\d+(?:\s+\w+)?/);
  const statText  = numMatch ? numMatch[0].toUpperCase() : "";
  const hookLine  = (content.hook_text || content.title).slice(0, 55).toUpperCase();

  const elements: Record<string, unknown>[] = [];

  if (pexelsUrl) {
    elements.push({
      type: "video", track: 1, time: 0, duration: 1,
      source: pexelsUrl,
      width: "100%", height: "100%",
      x_alignment: "50%", y_alignment: "50%",
      fit: "cover", volume: "0%",
    });
  } else {
    elements.push({ type: "rectangle", track: 1, time: 0, width: "100%", height: "100%", fill_color: "#0f1923" });
  }

  elements.push({
    type: "rectangle", track: 2, time: 0,
    width: "100%", height: "100%",
    fill_color: "rgba(10,15,26,0.55)",
  });

  if (statText) {
    elements.push({
      type: "text", track: 3, time: 0,
      x: "6%", y: "20%",
      x_alignment: "0%", y_alignment: "50%",
      text: statText,
      font_family: "Montserrat",
      font_weight: "900",
      font_size: "160",
      fill_color: "#FFD700",
    });
  }

  elements.push({
    type: "text", track: 4, time: 0,
    x: "6%", y: statText ? "62%" : "42%",
    x_alignment: "0%", y_alignment: "50%",
    width: "84%",
    text: hookLine,
    font_family: "Montserrat",
    font_weight: "700",
    font_size: "68",
    fill_color: "#ffffff",
    line_height: "1.1",
  });

  elements.push({
    type: "text", track: 5, time: 0,
    x: "96%", y: "90%",
    x_alignment: "100%", y_alignment: "50%",
    text: "ROOFING OS",
    font_family: "Montserrat",
    font_weight: "700",
    font_size: "32",
    fill_color: "rgba(255,255,255,0.55)",
    letter_spacing: "2",
  });

  return { output_format: "jpg", width: 1280, height: 720, elements };
}

async function creatomateSubmit(source: Record<string, unknown>): Promise<string> {
  const res = await fetch("https://api.creatomate.com/v1/renders", {
    method: "POST",
    headers: { "Authorization": `Bearer ${CREATOMATE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!res.ok) throw new Error(`Creatomate ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json();
  const id = Array.isArray(data) ? data[0]?.id : data?.id;
  if (!id) throw new Error(`Creatomate missing render id: ${JSON.stringify(data).slice(0, 100)}`);
  return id;
}

async function creatomateWait(renderId: string, timeoutMs = 260_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
      headers: { "Authorization": `Bearer ${CREATOMATE_API_KEY}` },
    });
    if (!res.ok) continue;
    const d = await res.json();
    if (d.status === "succeeded") {
      if (!d.url) throw new Error("Render succeeded but no url");
      return d.url as string;
    }
    if (d.status === "failed") throw new Error(`Render failed: ${d.error_message || "unknown"}`);
  }
  throw new Error(`Render timed out after ${timeoutMs / 1000}s`);
}

async function creatomateWaitShort(renderId: string): Promise<string | null> {
  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const res = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
        headers: { "Authorization": `Bearer ${CREATOMATE_API_KEY}` },
      });
      if (!res.ok) continue;
      const d = await res.json();
      if (d.status === "succeeded") return d.url as string;
      if (d.status === "failed") return null;
    } catch { continue; }
  }
  return null;
}

// ── YouTube API helpers ───────────────────────────────────────────────────────

function buildTags(): string[] {
  return [
    "roofing", "roofingcontractor", "roofer", "supplement", "homeowner",
    "companycam", "roofingOS", "freeroofingsoftware", "stormrestoration",
    "insuranceclaim", "roofingbusiness", "contractortips", "hail",
    "roofingos", "roofingtools", "supplementrecovery",
  ];
}

async function uploadToYouTube(
  content: Record<string, unknown>,
  videoBuffer: ArrayBuffer,
): Promise<{ youtubeId: string; youtubeUrl: string; accessToken: string }> {
  const accessToken = await getYouTubeAccessToken();

  const isShort = String(content.type || "").includes("short");
  const ytTitle = isShort
    ? `${String(content.title)} #Shorts`.slice(0, 100)
    : String(content.title).slice(0, 100);

  const description = String(content.youtube_description || "").slice(0, 5000) ||
    `${String(content.hook_text || content.title)}\n\n🏠 roofingos.dev\n✅ Free forever — no credit card\n📞 (720) 500-6668\n\n#roofing #roofingcontractor #supplement #stormrestoration #roofingOS`.slice(0, 5000);

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
          description,
          tags: buildTags(),
          categoryId: "22",
          defaultLanguage: "en",
        },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    }
  );

  if (!initRes.ok) throw new Error(`YouTube init failed (${initRes.status}): ${(await initRes.text().catch(() => "")).slice(0, 200)}`);

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("No upload URL from YouTube init");

  console.log(`Uploading ${(contentLength / 1024 / 1024).toFixed(1)} MB to YouTube…`);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(contentLength) },
    body: videoBuffer,
  });

  const videoData = await uploadRes.json().catch(() => ({}));
  const youtubeId = videoData.id;
  if (!youtubeId) throw new Error(`YouTube upload failed: ${JSON.stringify(videoData).slice(0, 200)}`);

  return { youtubeId, youtubeUrl: `https://youtube.com/watch?v=${youtubeId}`, accessToken };
}

async function uploadThumbnail(youtubeId: string, accessToken: string, thumbnailUrl: string): Promise<void> {
  try {
    const thumbRes = await fetch(thumbnailUrl);
    if (!thumbRes.ok) return;
    const thumbBuffer = await thumbRes.arrayBuffer();
    const uploadRes = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${youtubeId}&uploadType=media`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "image/jpeg",
          "Content-Length": String(thumbBuffer.byteLength),
        },
        body: thumbBuffer,
      }
    );
    if (uploadRes.ok) console.log(`Thumbnail uploaded for ${youtubeId}`);
    else console.error(`Thumbnail upload error: ${uploadRes.status}`);
  } catch (err) {
    console.error("Thumbnail upload failed (non-fatal):", err);
  }
}

async function postPinnedComment(youtubeId: string, accessToken: string): Promise<void> {
  try {
    const commentText = `🏠 Try Roofing OS free → roofingos.dev
✅ Free forever — no credit card ever
✅ Homeowner portal in 4 minutes
✅ AI supplement tool
✅ Cancel CompanyCam today
Drop a ❓ below if you have questions`;

    const insertRes = await fetch(
      "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet",
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          snippet: {
            videoId: youtubeId,
            topLevelComment: { snippet: { textOriginal: commentText } },
          },
        }),
      }
    );
    if (insertRes.ok) {
      console.log(`Pinned comment posted for ${youtubeId}`);
    } else {
      const err = await insertRes.text().catch(() => "");
      console.error(`Pinned comment failed ${insertRes.status}: ${err.slice(0, 100)}`);
    }
  } catch (err) {
    console.error("Pinned comment error (non-fatal):", err);
  }
}

// ── Core: process one item ────────────────────────────────────────────────────

interface ProcessResult {
  uploaded: boolean;
  already_uploaded?: boolean;
  youtube_url?: string;
  thumbnail_url?: string;
}

async function processOne(contentId: string): Promise<ProcessResult> {
  const { data: content, error } = await supabase.from("roofing_content").select("*").eq("id", contentId).single();
  if (error || !content) throw new Error("Content not found");
  if (content.youtube_video_id) return { uploaded: false, already_uploaded: true, youtube_url: content.youtube_url };

  const missingYT = [
    !YOUTUBE_CLIENT_ID     && "YOUTUBE_CLIENT_ID",
    !YOUTUBE_CLIENT_SECRET && "YOUTUBE_CLIENT_SECRET",
    !YOUTUBE_REFRESH_TOKEN && "YOUTUBE_REFRESH_TOKEN",
  ].filter(Boolean);
  if (missingYT.length) throw new Error(`Missing YouTube credentials: ${missingYT.join(", ")}`);

  if (!content.mp3_url) throw new Error("No audio — run publisher first");

  const topic = detectTopic(content.title || "");
  const pexelsUrl = await getPexelsVideo(topic);
  console.log(`Topic: ${topic}, Pexels: ${pexelsUrl ? "found" : "none"}`);

  // Kick off both renders in parallel
  const videoRenderId  = await creatomateSubmit(buildVideoSource({
    title:     content.title,
    hook_text: content.hook_text || content.hook || null,
    type:      content.type || "youtube_short",
    mp3_url:   content.mp3_url,
  }, pexelsUrl));

  let thumbRenderId: string | null = null;
  if (CREATOMATE_API_KEY) {
    try {
      thumbRenderId = await creatomateSubmit(buildThumbnailSource({
        title:          content.title,
        hook_text:      content.hook_text || content.hook || null,
        thumbnail_text: content.thumbnail_text || null,
      }, pexelsUrl));
    } catch (err) {
      console.error("Thumbnail render submit failed (non-fatal):", err);
    }
  }

  // Wait for video (long timeout)
  const videoUrl = await creatomateWait(videoRenderId);
  console.log(`Video render done: ${videoUrl}`);

  // Wait for thumbnail (short timeout, non-blocking)
  const thumbnailPromise = thumbRenderId
    ? creatomateWaitShort(thumbRenderId)
    : Promise.resolve(null);

  // Download video
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Failed to fetch video (${videoRes.status})`);
  const videoBuffer = await videoRes.arrayBuffer();
  console.log(`Downloaded ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

  const { youtubeId, youtubeUrl, accessToken } = await uploadToYouTube(content, videoBuffer);
  console.log(`YouTube upload complete: ${youtubeUrl}`);

  // Thumbnail + pinned comment
  const thumbnailUrl = await thumbnailPromise;
  if (thumbnailUrl) await uploadThumbnail(youtubeId, accessToken, thumbnailUrl);
  await postPinnedComment(youtubeId, accessToken);

  try {
    await supabase.from("roofing_content").update({
      status:            "published",
      youtube_video_id:  youtubeId,
      youtube_url:       youtubeUrl,
      youtube_posted_at: new Date().toISOString(),
      published_at:      new Date().toISOString(),
      thumbnail_url:     thumbnailUrl || null,
    }).eq("id", contentId);
  } catch (dbErr) {
    console.error("DB update failed (upload succeeded):", dbErr);
  }

  fetch(`${SUPABASE_URL}/functions/v1/roofing-social-poster`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_id: contentId, youtube_url: youtubeUrl, title: content.title, hook: content.hook_text || content.title }),
  }).catch(() => {});

  return { uploaded: true, youtube_url: youtubeUrl, thumbnail_url: thumbnailUrl || undefined };
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-uploader v7 ready", creatomate: !!CREATOMATE_API_KEY, pexels: !!PEXELS_API_KEY });

  if (body.force_upload) {
    const limit = Math.min(body.limit ?? 2, 20);
    const { data: queue } = await supabase
      .from("roofing_content")
      .select("id, title, type, mp3_url, youtube_video_id")
      .eq("youtube_upload_ready", true)
      .is("youtube_posted_at", null)
      .not("mp3_url", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (!queue?.length) return Response.json({ ok: true, processed: 0, message: "Queue empty" });

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

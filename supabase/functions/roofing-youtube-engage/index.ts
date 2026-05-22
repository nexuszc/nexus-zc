// roofing-youtube-engage v1
// Daily 10am MT (16:00 UTC) cron.
// 1. Fetch new comments on all published videos
// 2. Classify with Claude: question / positive / negative / spam
// 3. Auto-reply to questions and positives
// 4. Flag negatives to Telegram for manual review

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY           = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID") || "";
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET") || "";
const YOUTUBE_REFRESH_TOKEN = Deno.env.get("YOUTUBE_REFRESH_TOKEN") || "";
const ANTHROPIC_API_KEY     = Deno.env.get("ANTHROPIC_API_KEY")!;
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
  if (!data.access_token) throw new Error(`OAuth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function claude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: `You help manage YouTube comments for Roofing OS, a free tool for roofing contractors.
Reply as a knowledgeable, helpful contractor peer. Keep replies under 100 words.
Always mention roofingos.dev when relevant. Sound human, not corporate.
Classify comments as: question, positive, negative, or spam.`,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

interface Comment {
  id: string;
  videoId: string;
  videoTitle: string;
  authorName: string;
  text: string;
  publishedAt: string;
}

async function fetchNewComments(accessToken: string, videoIds: string[], videoTitles: Map<string, string>): Promise<Comment[]> {
  const comments: Comment[] = [];
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // last 25 hours

  for (const videoId of videoIds.slice(0, 20)) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=20&order=time`,
        { headers: { "Authorization": `Bearer ${accessToken}` } }
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const item of data.items || []) {
        const snippet = item.snippet?.topLevelComment?.snippet;
        if (!snippet) continue;
        if (snippet.publishedAt < since) continue;

        // Skip our own comments (channel author)
        if (snippet.authorChannelId?.value === snippet.videoOwnerChannelId) continue;

        comments.push({
          id:          item.snippet.topLevelComment.id,
          videoId,
          videoTitle:  videoTitles.get(videoId) || videoId,
          authorName:  snippet.authorDisplayName || "there",
          text:        snippet.textDisplay || "",
          publishedAt: snippet.publishedAt,
        });
      }
    } catch { continue; }

    await new Promise(r => setTimeout(r, 200));
  }

  return comments;
}

async function postReply(accessToken: string, commentId: string, replyText: string): Promise<boolean> {
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/comments?part=snippet",
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          snippet: {
            parentId:     commentId,
            textOriginal: replyText,
          },
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function classifyAndReply(comment: Comment): Promise<{ type: string; reply: string | null }> {
  const raw = await claude(
    `Video title: "${comment.videoTitle}"
Comment from ${comment.authorName}: "${comment.text}"

First line: classify as exactly one word: question / positive / negative / spam
Second line: if question or positive, write a helpful reply (under 80 words). Include roofingos.dev if relevant.
If negative or spam, write only: NO_REPLY`
  );

  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const type  = lines[0]?.toLowerCase().replace(/[^a-z]/g, "") || "unknown";
  const reply = lines[1] === "NO_REPLY" || !lines[1] ? null : lines[1];

  return { type, reply };
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-engage v1 ready" });

  const startMs = Date.now();

  const missingYT = [
    !YOUTUBE_CLIENT_ID     && "YOUTUBE_CLIENT_ID",
    !YOUTUBE_CLIENT_SECRET && "YOUTUBE_CLIENT_SECRET",
    !YOUTUBE_REFRESH_TOKEN && "YOUTUBE_REFRESH_TOKEN",
  ].filter(Boolean);
  if (missingYT.length) return Response.json({ ok: false, error: `Missing: ${missingYT.join(", ")}` });

  try {
    const accessToken = await getYouTubeAccessToken();

    // Get recently published videos (last 90 days — comments slow after that)
    const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: videos } = await supabase
      .from("roofing_content")
      .select("youtube_video_id, title")
      .not("youtube_video_id", "is", null)
      .gte("youtube_posted_at", since90d)
      .order("youtube_posted_at", { ascending: false })
      .limit(30);

    if (!videos?.length) {
      return Response.json({ ok: true, message: "No recent videos", duration_ms: Date.now() - startMs });
    }

    const videoIds    = videos.map((v: Record<string, string>) => v.youtube_video_id).filter(Boolean) as string[];
    const videoTitles = new Map(videos.map((v: Record<string, string>) => [v.youtube_video_id, v.title]));

    const comments = await fetchNewComments(accessToken, videoIds, videoTitles);
    console.log(`Found ${comments.length} new comments`);

    let replied = 0;
    let flagged = 0;
    const flaggedComments: string[] = [];

    for (const comment of comments.slice(0, 30)) {
      const { type, reply } = await classifyAndReply(comment);

      if (reply && (type === "question" || type === "positive")) {
        const ok = await postReply(accessToken, comment.id, reply);
        if (ok) replied++;
      } else if (type === "negative") {
        flagged++;
        flaggedComments.push(`"${comment.text.slice(0, 80)}" on "${comment.videoTitle.slice(0, 40)}"`);
      }

      await new Promise(r => setTimeout(r, 800));
    }

    if (flaggedComments.length) {
      await tg(`⚠️ *${flaggedComments.length} negative YouTube comment(s) need review:*\n\n${flaggedComments.slice(0, 5).join("\n")}`);
    }

    try {
      await supabase.from("system_heartbeats").insert({
        function_name: "roofing-youtube-engage",
        status: "ok",
        response_ms: Date.now() - startMs,
        recorded_at: new Date().toISOString(),
        metadata: { comments_found: comments.length, replied, flagged },
      });
    } catch { /* non-fatal */ }

    return Response.json({
      ok: true,
      comments_found: comments.length,
      replied,
      flagged,
      duration_ms: Date.now() - startMs,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("roofing-youtube-engage fatal:", msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

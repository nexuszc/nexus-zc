// roofing-content-repurposer
// Takes a published long-form YouTube video and creates:
//   3x YouTube Shorts scripts (60 sec each)
//   1x Reddit text post (value-first, soft mention)
// Triggered automatically by roofing-youtube-uploader or manually.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function claude(prompt: string, maxTokens = 2000): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function generateShorts(content: Record<string, unknown>): Promise<Array<{ title: string; hook: string; script: string }>> {
  const prompt = `Based on this roofing industry video script, create 3 YouTube Shorts scripts (60 seconds each).

Title: ${content.title}
Script: ${((content.body as string) || "").slice(0, 3000)}

Each Short must:
- Start with a scroll-stopping hook (first 3 words must grab attention)
- Cover ONE specific insight from the video
- End with: "Follow for more. Link in bio."
- Be conversational and fast-paced — spoken, not read
- Run 60 seconds when spoken aloud (~150 words max)

Return ONLY a JSON array, no markdown:
[
  {"title": "...", "hook": "...", "script": "..."},
  {"title": "...", "hook": "...", "script": "..."},
  {"title": "...", "hook": "...", "script": "..."}
]`;

  const text = await claude(prompt, 1500);
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    console.error("Failed to parse shorts JSON:", text.slice(0, 200));
    return [];
  }
}

async function generateRedditPost(content: Record<string, unknown>): Promise<{ title: string; body: string } | null> {
  const prompt = `Based on this roofing industry video content, write a Reddit post for r/Roofing.

Title: ${content.title}
Content: ${((content.body as string) || "").slice(0, 2000)}

Requirements:
- Provide genuine value to roofing contractors
- Tell the core story/insight naturally — do NOT sound like an ad
- Mention Roofing OS briefly and naturally at the end only if it fits
- 200-300 words
- Reddit-appropriate tone (peer to peer, no corporate speak)

Return ONLY JSON, no markdown:
{"title": "...", "body": "..."}`;

  const text = await claude(prompt, 600);
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    console.error("Failed to parse reddit JSON:", text.slice(0, 200));
    return null;
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-content-repurposer ready" });

  const { content_id } = body;
  if (!content_id) return Response.json({ error: "content_id required" }, { status: 400 });

  const { data: content, error } = await supabase
    .from("roofing_content")
    .select("*")
    .eq("id", content_id)
    .single();

  if (error || !content) return Response.json({ error: "Content not found" }, { status: 404 });

  let shortsCreated = 0;
  let redditCreated = 0;

  // Generate 3 YouTube Shorts
  try {
    const shorts = await generateShorts(content);
    for (const short of shorts) {
      await supabase.from("roofing_content").insert({
        type: "youtube_short",
        title: short.title,
        body: short.script,
        hook: short.hook,
        status: "pending",
        parent_content_id: content_id,
        estimated_length_seconds: 60,
        tags: content.tags || [],
      });
      shortsCreated++;
    }
  } catch (err) {
    console.error("Shorts generation error:", err);
  }

  // Generate Reddit text post
  try {
    const redditPost = await generateRedditPost(content);
    if (redditPost) {
      await supabase.from("roofing_content").insert({
        type: "reddit_post",
        title: redditPost.title,
        body: redditPost.body,
        status: "pending",
        parent_content_id: content_id,
      });
      redditCreated = 1;
    }
  } catch (err) {
    console.error("Reddit post generation error:", err);
  }

  return Response.json({ ok: true, shorts_created: shortsCreated, reddit_created: redditCreated });
});

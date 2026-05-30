import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function optimizeVideoSEO(
  video: Record<string, unknown>,
): Promise<{ title: string; description: string; tags: string[] }> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `Optimize this YouTube video for SEO.

Video title: ${video.title}
Video type: ${video.video_type}

Generate:
1. Title (under 60 chars, include main keyword near the front)
2. Description (first 150 chars are above the fold — pack the keyword and value prop here)
3. 15 tags (mix of broad and long-tail)

Target audience: Roofing contractors searching on YouTube
Primary keyword cluster: roofing software, roofing CRM, roofing contractor app, roofingos

Return JSON only:
{"title":"...","description":"...","tags":["..."]}`,
      }],
    }),
  });
  const d = await r.json();
  try {
    const text = d.content?.[0]?.text || "{}";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return {
      title: video.title as string,
      description: "Free roofing contractor software at roofingos.dev",
      tags: ["roofing software", "roofing CRM", "roofing contractor app"],
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "youtube-seo-optimizer ready" }, { headers: CORS });
  }

  const { data: videos } = await supabase
    .from("youtube_video_queue")
    .select("*")
    .eq("status", "pending")
    .limit(10);

  let optimized = 0;
  for (const video of (videos || [])) {
    const seo = await optimizeVideoSEO(video);
    try {
      await supabase
        .from("youtube_video_queue")
        .update({
          title: seo.title,
          seo_description: seo.description,
          seo_tags: seo.tags,
        })
        .eq("id", video.id);
      optimized++;
    } catch { /* non-critical */ }
  }

  return Response.json({ ok: true, optimized }, { headers: CORS });
});

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

const BLOG_BASE = "https://roofingos.dev/blog";

async function generateLinkedIn(title: string, context: string, slug: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Write a LinkedIn post for a roofing software company blog post.

Blog title: "${title}"
Context: "${context}"
URL: ${BLOG_BASE}/${slug}

Rules:
- 3-4 paragraphs, ~150 words total
- Hook first line (question or bold statement)
- Value-forward — what contractors will learn
- End with the URL on its own line
- No hashtags in body — add 3 relevant ones at the very end
- Voice: Zach Curtis, founder of Roofing OS, Denver CO. Direct. No fluff.
- Do NOT use "Exciting" or "Thrilled" or "Delighted"`,
      }],
    }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

async function generateX(title: string, slug: string): Promise<string> {
  const url = `${BLOG_BASE}/${slug}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{
        role: "user",
        content: `Write a tweet for this roofing software blog post.

Title: "${title}"
URL: ${url}

Rules:
- Under 240 characters TOTAL including the URL (URL is ~46 chars)
- So your text must be under 194 chars
- Sharp, specific, makes a contractor want to click
- No hashtags
- No "check out" or "excited to share"
- End with the URL`,
      }],
    }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "social-content-generator ready" }, { headers: CORS });
  }

  const limit = body.limit || 5;

  const { data: posts } = await supabase
    .from("seo_posts")
    .select("id, title, slug, keyword, meta_description, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (!posts?.length) {
    return Response.json({ ok: true, generated: 0, message: "no posts found" }, { headers: CORS });
  }

  const { data: existing } = await supabase
    .from("social_queue")
    .select("slug")
    .not("slug", "is", null);

  const existingSlugs = new Set((existing || []).map((r: { slug: string }) => r.slug));

  let generated = 0;
  const now = new Date();

  for (const post of posts) {
    if (existingSlugs.has(post.slug)) continue;

    // X posts go out in 2 hours, LinkedIn in 6 hours — auto-approved, no gate
    const xTime = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const liTime = new Date(now.getTime() + 6 * 60 * 60 * 1000);

    const context = post.meta_description || post.keyword || "";
    const [linkedin, xPost] = await Promise.all([
      generateLinkedIn(post.title, context, post.slug),
      generateX(post.title, post.slug),
    ]);

    try {
      await supabase.from("social_queue").insert([
        {
          platform: "linkedin",
          content: linkedin,
          slug: post.slug,
          post_title: post.title,
          scheduled_for: liTime.toISOString(),
          status: "approved",
        },
        {
          platform: "x",
          content: xPost,
          slug: post.slug,
          post_title: post.title,
          scheduled_for: xTime.toISOString(),
          status: "approved",
        },
      ]);
      generated++;
    } catch { /* skip */ }

    await new Promise((r) => setTimeout(r, 1000));
  }

  return Response.json({ ok: true, generated, posts_checked: posts.length }, { headers: CORS });
});

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

async function haiku(prompt: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

async function rewriteWeakTitles(): Promise<number> {
  // Posts ranking 10-20 with >50 impressions and CTR <3%
  const { data: posts } = await supabase
    .from("seo_posts")
    .select("id, title, keyword, google_position, google_impressions, google_clicks")
    .gte("google_position", 10)
    .lte("google_position", 20)
    .gt("google_impressions", 50)
    .eq("status", "published");

  let rewrote = 0;
  for (const post of (posts || [])) {
    const impressions = post.google_impressions || 0;
    const clicks = post.google_clicks || 0;
    const ctr = impressions > 0 ? clicks / impressions : 0;
    if (ctr >= 0.03) continue;

    const newTitle = await haiku(
      `You are an SEO expert. Rewrite this YouTube/blog title to get more clicks from roofing contractors searching Google.
Current title: "${post.title}"
Target keyword: "${post.keyword}"
Current position: ${Math.round(post.google_position)} (page 1-2 of Google)
Current CTR: ${(ctr * 100).toFixed(1)}% — too low, needs a stronger hook.

Rules:
- Under 60 characters
- Include the keyword near the front
- Use power words: "Free", "Fast", "2025", "Step-by-Step", numbers
- Sound like a contractor talking to a contractor
- Return ONLY the new title, no explanation`,
    );

    const clean = newTitle.replace(/^["']|["']$/g, "").trim();
    if (!clean || clean.length < 10) continue;

    try {
      await supabase
        .from("seo_posts")
        .update({ title: clean, original_title: post.title, rewrite_count: (post.rewrite_count || 0) + 1 })
        .eq("id", post.id);
      rewrote++;
    } catch { /* non-critical */ }
  }
  return rewrote;
}

async function expandThinPosts(): Promise<number> {
  const { data: posts } = await supabase
    .from("seo_posts")
    .select("id, title, keyword, content_html, content_text, word_count")
    .lt("word_count", 800)
    .eq("status", "published")
    .limit(5);

  let expanded = 0;
  for (const post of (posts || [])) {
    const section = await haiku(
      `Add a 300-word section to this roofing contractor blog post.
Post title: "${post.title}"
Target keyword: "${post.keyword}"

Write a new H2 section that:
- Answers a common question roofing contractors have about "${post.keyword}"
- Is practical and specific (include numbers, steps, or examples)
- Naturally uses the keyword 2-3 times
- Does NOT repeat what's already in the post

Return only the HTML section starting with <h2> tag, no explanation.`,
    );

    if (!section || section.length < 100) continue;

    const newHtml = (post.content_html || "") + "\n\n" + section;
    const newWordCount = (post.word_count || 0) + 300;

    try {
      await supabase
        .from("seo_posts")
        .update({ content_html: newHtml, word_count: newWordCount })
        .eq("id", post.id);
      expanded++;
    } catch { /* non-critical */ }
  }
  return expanded;
}

async function queueTrendingKeywords(): Promise<number> {
  // Posts with high impressions but poor position = keyword opportunity
  const { data: posts } = await supabase
    .from("seo_posts")
    .select("keyword, google_impressions, google_position")
    .gt("google_impressions", 100)
    .gt("google_position", 20)
    .eq("status", "published")
    .order("google_impressions", { ascending: false })
    .limit(10);

  let queued = 0;
  for (const post of (posts || [])) {
    try {
      await supabase
        .from("seo_keyword_queue")
        .insert({
          keyword: post.keyword,
          keyword_type: "trending",
          source: "self-optimizer",
          priority: Math.round(post.google_impressions / 10),
        })
        .select()
        .single();
      queued++;
    } catch { /* duplicate or non-critical */ }
  }
  return queued;
}

async function triggerInternalLinker(): Promise<void> {
  try {
    await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/seo-internal-linker`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 20 }),
      },
    );
  } catch { /* non-critical */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "seo-self-optimizer ready" }, { headers: CORS });
  }

  const [titlesRewrote, postsExpanded, keywordsQueued] = await Promise.all([
    rewriteWeakTitles(),
    expandThinPosts(),
    queueTrendingKeywords(),
  ]);

  // Fire internal linker sweep in background
  triggerInternalLinker();

  return Response.json({
    ok: true,
    titlesRewrote,
    postsExpanded,
    keywordsQueued,
  }, { headers: CORS });
});

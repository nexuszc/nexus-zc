import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function ai(prompt: string, maxTokens = 1000): Promise<string> {
  const BASE_DELAYS = [15_000, 30_000, 60_000];
  let res!: Response;
  for (let attempt = 0; attempt <= BASE_DELAYS.length; attempt++) {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (res.status !== 429) break;
    if (attempt === BASE_DELAYS.length) throw new Error("Rate limit exhausted");
    const header = res.headers.get("retry-after");
    let wait = BASE_DELAYS[attempt];
    if (header) { const secs = Number(header); if (!isNaN(secs)) wait = Math.max(wait, secs * 1000); }
    await new Promise(r => setTimeout(r, wait));
  }
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

async function generateScript(post: Record<string, any>): Promise<string> {
  const content = (post.content_text || post.content_html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") || "").slice(0, 2000);

  const prompt = `You are writing a YouTube video script for roofing contractors.

Blog post title: ${post.title}
Keyword: ${post.keyword || "roofing"}
Content summary: ${content}

Write a 60-90 second video script (about 150-200 words). Format:
- Hook (first 5 seconds — one punchy sentence that grabs attention)
- Main content (3-4 key points from the article, spoken naturally)
- CTA (last 10 seconds — "Get Roofing OS free at roofingos.dev")

Write in a direct, professional tone. No intro music cues or stage directions. Just the words to be spoken aloud.

Return ONLY the script text. No labels, no commentary.`;

  return await ai(prompt, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.test) {
      return Response.json({ ok: true, message: "youtube-script-generator v1 ready" }, { headers: CORS });
    }

    const limit = Number(body.limit) || 5;

    // Pull published posts without a script yet
    const { data: posts, error } = await supabase
      .from("seo_posts")
      .select("id, slug, title, keyword, content_html, content_text")
      .eq("status", "published")
      .or("youtube_script.is.null,youtube_script.eq.")
      .order("google_impressions", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`DB query failed: ${error.message}`);
    if (!posts || posts.length === 0) {
      return Response.json({ ok: true, message: "No posts need scripts", generated: 0 }, { headers: CORS });
    }

    let generated = 0;
    const results: Array<{ slug: string; ok: boolean }> = [];

    for (const post of posts) {
      try {
        const script = await generateScript(post);
        const { error: updateErr } = await supabase
          .from("seo_posts")
          .update({ youtube_script: script, updated_at: new Date().toISOString() })
          .eq("id", post.id);

        if (updateErr) {
          console.error(`Script save failed for "${post.slug}":`, updateErr.message);
          results.push({ slug: post.slug, ok: false });
        } else {
          generated++;
          console.log(`youtube-script-generator: script written for "${post.slug}"`);
          results.push({ slug: post.slug, ok: true });
        }
      } catch (err) {
        console.error(`Script generation failed for "${post.slug}":`, err);
        results.push({ slug: post.slug, ok: false });
      }
    }

    return Response.json({ ok: true, generated, results }, { headers: CORS });

  } catch (err) {
    console.error("youtube-script-generator error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

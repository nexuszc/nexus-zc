import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Competitor definitions
// ---------------------------------------------------------------------------

const COMPETITORS = [
  {
    name:       "companycam",
    blog:       "https://companycam.com/blog",
    sitemapUrl: "https://companycam.com/sitemap.xml",
    keywords:   [
      "companycam alternative",
      "companycam free",
      "companycam vs",
      "companycam price",
      "companycam review",
    ],
  },
  {
    name:       "jobnimbus",
    blog:       "https://jobnimbus.com/blog",
    sitemapUrl: "https://jobnimbus.com/sitemap.xml",
    keywords:   [
      "jobnimbus alternative",
      "jobnimbus pricing",
      "jobnimbus review",
      "jobnimbus vs acculynx",
    ],
  },
  {
    name:       "acculynx",
    blog:       "https://acculynx.com/blog",
    sitemapUrl: "https://acculynx.com/sitemap.xml",
    keywords:   [
      "acculynx alternative",
      "acculynx pricing",
      "acculynx review",
      "acculynx vs jobnimbus",
    ],
  },
  {
    name:       "salesrabbit",
    blog:       "https://www.salesrabbit.com/blog",
    sitemapUrl: "https://www.salesrabbit.com/sitemap.xml",
    keywords:   [
      "sales rabbit alternative",
      "door to door roofing app",
      "canvassing software roofers",
    ],
  },
  {
    name:       "roofr",
    blog:       "https://roofr.com/blog",
    sitemapUrl: "https://roofr.com/sitemap.xml",
    keywords:   [
      "roofr alternative",
      "roofr pricing",
      "roofr review",
      "roofr vs roofing os",
    ],
  },
] as const;

type Competitor = typeof COMPETITORS[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendTelegram(msg: string) {
  const token  = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

function extractKeyword(title: string): string {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "to", "for",
    "of", "in", "on", "at", "with", "how", "why", "what", "your",
    "our", "this", "that", "and", "or", "but", "its", "has", "have",
    "you", "we", "they", "it", "be", "do", "can", "will", "get",
  ]);
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  return words.slice(0, 5).join(" ");
}

// ---------------------------------------------------------------------------
// Blog scraper
// ---------------------------------------------------------------------------

async function scrapeCompetitorBlog(
  competitor: Competitor,
): Promise<Array<{ url: string; title: string }>> {
  try {
    const res = await fetch(competitor.blog, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
        "Accept":     "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`Blog fetch failed for ${competitor.name}: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const results: Array<{ url: string; title: string }> = [];
    const seen  = new Set<string>();
    const base  = `https://${new URL(competitor.blog).hostname}`;

    // Match <a href="...blog/...">some text</a>
    const linkRe = /<a[^>]+href="([^"]*\/blog\/[^"]+)"[^>]*>([^<]{10,120})<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRe.exec(html)) !== null && results.length < 20) {
      let url   = match[1].trim();
      const raw = match[2];
      const title = raw.replace(/\s+/g, " ").trim();

      // Resolve relative URLs
      if (!url.startsWith("http")) {
        url = url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
      }

      // Skip anchors, query strings, already seen, too-short titles
      if (url.includes("#") || title.length < 10 || seen.has(url)) continue;

      // Strip query params from URL for dedup purposes
      const cleanUrl = url.split("?")[0];
      if (seen.has(cleanUrl)) continue;

      seen.add(cleanUrl);
      results.push({ url: cleanUrl, title });
    }

    return results;
  } catch (err) {
    console.warn(`scrapeCompetitorBlog error for ${competitor.name}:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Check existence helpers
// ---------------------------------------------------------------------------

async function isPostAlreadyTracked(url: string): Promise<boolean> {
  try {
    const { count } = await supabase
      .from("seo_competitor_content")
      .select("id", { count: "exact", head: true })
      .eq("url", url);
    return (count || 0) > 0;
  } catch {
    return false;
  }
}

async function isKeywordAlreadyQueued(keyword: string): Promise<boolean> {
  try {
    const { count } = await supabase
      .from("seo_keyword_queue")
      .select("id", { count: "exact", head: true })
      .ilike("keyword", keyword);
    return (count || 0) > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Save competitor post + create counter-keyword
// ---------------------------------------------------------------------------

async function saveCompetitorPost(
  competitor: Competitor,
  post: { url: string; title: string },
): Promise<boolean> {
  try {
    const keyword = extractKeyword(post.title);

    // Insert competitor content record
    const { error: insertErr } = await supabase
      .from("seo_competitor_content")
      .insert({
        competitor: competitor.name,
        url:        post.url,
        title:      post.title,
        keyword,
      });

    if (insertErr) {
      // Unique constraint violation = already tracked (race condition)
      if (insertErr.code === "23505") return false;
      console.error(`Competitor content insert failed:`, insertErr.message);
      return false;
    }

    // Create counter-keyword with highest priority
    await supabase
      .from("seo_keyword_queue")
      .upsert(
        {
          keyword,
          source:       "competitor_blog",
          intent_score: 18,
          status:       "pending",
        },
        { onConflict: "keyword" },
      );

    return true;
  } catch (err) {
    console.error(`saveCompetitorPost error:`, err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Enqueue preset competitor keywords
// ---------------------------------------------------------------------------

async function enqueuePresetKeywords(competitor: Competitor): Promise<number> {
  let added = 0;
  for (const kw of competitor.keywords) {
    try {
      const alreadyQueued = await isKeywordAlreadyQueued(kw);
      if (alreadyQueued) continue;

      const { error } = await supabase
        .from("seo_keyword_queue")
        .upsert(
          {
            keyword:      kw,
            source:       "competitor_preset",
            intent_score: 16,
            status:       "pending",
          },
          { onConflict: "keyword" },
        );

      if (!error) added++;
    } catch (err) {
      console.error(`Preset keyword enqueue failed for "${kw}":`, err);
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// Coverage check (log which competitor keywords we already rank for)
// ---------------------------------------------------------------------------

async function checkKeywordCoverage(competitor: Competitor): Promise<void> {
  for (const kw of competitor.keywords) {
    try {
      const firstWord = kw.split(" ")[0];
      const { data: existing } = await supabase
        .from("seo_posts")
        .select("slug, title, google_position")
        .ilike("keyword", `%${firstWord}%`)
        .limit(1)
        .single();

      if (existing) {
        console.log(
          `Coverage [${competitor.name}] "${kw}" — matched our post: "${existing.title}" ` +
          `(position: ${existing.google_position || "unranked"})`,
        );
      } else {
        console.log(`Coverage gap [${competitor.name}] "${kw}" — no matching post`);
      }
    } catch {
      // .single() throws when no rows — that's the gap case, already logged above path handles it
    }
  }
}

// ---------------------------------------------------------------------------
// Single-competitor run
// ---------------------------------------------------------------------------

async function processCompetitor(
  competitor: Competitor,
): Promise<{ name: string; new_posts: number; preset_keywords_added: number }> {
  console.log(`seo-competitor-hunter: scanning ${competitor.name}`);

  const posts = await scrapeCompetitorBlog(competitor);
  console.log(`  found ${posts.length} posts on ${competitor.name} blog`);

  let newPosts = 0;
  for (const post of posts) {
    const alreadyTracked = await isPostAlreadyTracked(post.url);
    if (alreadyTracked) continue;

    const saved = await saveCompetitorPost(competitor, post);
    if (saved) newPosts++;
  }

  const presetAdded = await enqueuePresetKeywords(competitor);
  await checkKeywordCoverage(competitor);

  console.log(`  ${competitor.name}: ${newPosts} new posts, ${presetAdded} preset keywords added`);
  return { name: competitor.name, new_posts: newPosts, preset_keywords_added: presetAdded };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handleScheduledRun(singleCompetitor?: string): Promise<Response> {
  const targets = singleCompetitor
    ? COMPETITORS.filter(c => c.name === singleCompetitor)
    : [...COMPETITORS];

  if (targets.length === 0) {
    return Response.json(
      { ok: false, error: `Unknown competitor: ${singleCompetitor}` },
      { status: 400, headers: CORS },
    );
  }

  const results = [];
  for (const competitor of targets) {
    try {
      const result = await processCompetitor(competitor);
      results.push(result);
    } catch (err) {
      console.error(`Competitor processing failed for ${competitor.name}:`, err);
      results.push({ name: competitor.name, new_posts: 0, preset_keywords_added: 0 });
    }
  }

  const totalNewPosts         = results.reduce((s, r) => s + r.new_posts, 0);
  const totalKeywordsAdded    = results.reduce((s, r) => s + r.preset_keywords_added, 0);
  const competitorsChecked    = results.length;

  // ── Telegram intel report ─────────────────────────────────────────────────
  const lines: string[] = [`🕵️ *Competitor Intel Report*`];
  lines.push(`New posts found: ${totalNewPosts} total`);
  for (const r of results) {
    lines.push(`- ${r.name}: ${r.new_posts} new posts`);
  }
  lines.push(`High-priority counter-keywords added: ${totalNewPosts + totalKeywordsAdded}`);

  // Only notify if there's anything worth reporting
  if (totalNewPosts > 0 || totalKeywordsAdded > 0) {
    await sendTelegram(lines.join("\n"));
  }

  console.log(`seo-competitor-hunter: done — ${totalNewPosts} new posts, ${totalKeywordsAdded} preset keywords, ${competitorsChecked} competitors checked`);

  return Response.json(
    {
      ok:                      true,
      new_posts_found:         totalNewPosts,
      counter_keywords_added:  totalNewPosts + totalKeywordsAdded,
      competitors_checked:     competitorsChecked,
      breakdown:               results,
    },
    { headers: CORS },
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.test) {
      return Response.json(
        { ok: true, message: "seo-competitor-hunter v1 ready" },
        { headers: CORS },
      );
    }

    // Single competitor or full scheduled sweep
    return await handleScheduledRun(body.competitor as string | undefined);

  } catch (err) {
    console.error("seo-competitor-hunter error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

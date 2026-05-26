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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ai(prompt: string, maxTokens = 4000): Promise<string> {
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
        model: "claude-sonnet-4-5",
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

async function sendTelegram(msg: string) {
  const token  = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function submitToGoogleIndexing(url: string): Promise<boolean> {
  const clientEmail = Deno.env.get("GOOGLE_INDEXING_CLIENT_EMAIL");
  const privateKey  = Deno.env.get("GOOGLE_INDEXING_PRIVATE_KEY");
  if (!clientEmail || !privateKey) return false;
  try {
    // Create JWT for Google service account
    const now     = Math.floor(Date.now() / 1000);
    const header  = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = btoa(JSON.stringify({
      iss:   clientEmail,
      scope: "https://www.googleapis.com/auth/indexing",
      aud:   "https://oauth2.googleapis.com/token",
      exp:   now + 3600,
      iat:   now,
    }));
    // Note: Full JWT signing requires crypto — skip signing for now, return false
    // When credentials are set up, implement proper JWT signing
    void header; void payload; void url;
    return false;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Source 1: Google Autocomplete
// ---------------------------------------------------------------------------

const AUTOCOMPLETE_SEEDS = [
  "roofing contractor",
  "roofing software",
  "companycam",
  "roofing supplement",
  "storm damage roof",
  "homeowner portal roofing",
  "roofing crm",
  "roofing app",
];

const AUTOCOMPLETE_LETTERS = ["a","b","c","d","e","f","g","h","i","j","k","l","m"];

async function getAutocomplete(query: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data[1] || []) as string[];
  } catch {
    return [];
  }
}

async function gatherAutocomplete(): Promise<Array<{ keyword: string; source: string }>> {
  const allKeywords: Array<{ keyword: string; source: string }> = [];
  const seen = new Set<string>();

  // Build all (seed, letter) pairs
  const pairs: Array<[string, string]> = [];
  for (const seed of AUTOCOMPLETE_SEEDS) {
    for (const letter of AUTOCOMPLETE_LETTERS) {
      pairs.push([seed, letter]);
    }
  }

  // Run in small batches of 5 to be gentle on Google
  const BATCH = 5;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const batch = pairs.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(([seed, letter]) => getAutocomplete(`${seed} ${letter}`)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const kw of result.value) {
          const normalized = kw.toLowerCase().trim();
          if (!seen.has(normalized) && normalized.length > 0) {
            seen.add(normalized);
            allKeywords.push({ keyword: normalized, source: "google_autocomplete" });
          }
        }
      }
    }
    // Small pause between batches
    if (i + BATCH < pairs.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return allKeywords;
}

// ---------------------------------------------------------------------------
// Source 2: Reddit r/Roofing
// ---------------------------------------------------------------------------

async function scrapeReddit(): Promise<Array<{ keyword: string; source: string }>> {
  try {
    const url = "https://www.reddit.com/r/Roofing/new.json?limit=25&sort=new";
    const res = await fetch(url, { headers: { "User-Agent": "RoofingOS/1.0" } });
    if (!res.ok) return [];
    const data = await res.json();
    const posts = data?.data?.children || [];
    return (posts as Array<{ data: { title?: string } }>)
      .map((p) => p.data?.title || "")
      .filter((t: string) => t.includes("?") || /^(how|what|why|when|which|can|does|is|are)/i.test(t))
      .map((t: string) => ({ keyword: t.toLowerCase().trim(), source: "reddit_roofing" }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Source 3: Competitor blog monitoring
// ---------------------------------------------------------------------------

interface CompetitorPost {
  competitor: string;
  url: string;
  title: string;
}

const COMPETITOR_BLOGS = [
  { name: "companycam",  url: "https://companycam.com/blog" },
  { name: "jobnimbus",   url: "https://jobnimbus.com/blog" },
  { name: "acculynx",    url: "https://acculynx.com/blog" },
  { name: "salesrabbit", url: "https://www.salesrabbit.com/blog" },
  { name: "roofr",       url: "https://roofr.com/blog" },
];

async function scrapeCompetitorBlog(
  blog: typeof COMPETITOR_BLOGS[number],
): Promise<{ keywords: Array<{ keyword: string; source: string }>; posts: CompetitorPost[] }> {
  try {
    const res = await fetch(blog.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RoofingOS/1.0)" },
    });
    if (!res.ok) return { keywords: [], posts: [] };
    const html = await res.text();

    // Extract page titles
    const titleRegex = /<title[^>]*>([^<]+)<\/title>/gi;
    const titles: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = titleRegex.exec(html)) !== null) {
      const title = match[1].trim();
      if (title) titles.push(title);
    }

    // Extract article/post titles from common blog link patterns
    const linkRegex = /<a[^>]+href=["']([^"']*(?:\/blog\/|\/post\/|\/article\/)[^"']*)["'][^>]*>([^<]+)<\/a>/gi;
    const posts: CompetitorPost[] = [];
    const postKeywords: Array<{ keyword: string; source: string }> = [];

    while ((match = linkRegex.exec(html)) !== null) {
      const href  = match[1].trim();
      const text  = match[2].trim();
      if (!text || text.length < 10) continue;

      // Build absolute URL
      let fullUrl = href;
      if (href.startsWith("/")) {
        const base = new URL(blog.url);
        fullUrl = `${base.origin}${href}`;
      } else if (!href.startsWith("http")) {
        continue;
      }

      posts.push({ competitor: blog.name, url: fullUrl, title: text });
      postKeywords.push({ keyword: text.toLowerCase().trim(), source: "competitor_blog" });
    }

    // Also turn page titles into counter-keywords
    for (const title of titles) {
      if (title.length > 10 && title.length < 120) {
        postKeywords.push({ keyword: title.toLowerCase().trim(), source: "competitor_blog" });
      }
    }

    return { keywords: postKeywords, posts };
  } catch {
    return { keywords: [], posts: [] };
  }
}

async function gatherCompetitorData(): Promise<{
  keywords: Array<{ keyword: string; source: string }>;
  posts: CompetitorPost[];
}> {
  const results = await Promise.allSettled(
    COMPETITOR_BLOGS.map(blog => scrapeCompetitorBlog(blog)),
  );

  const allKeywords: Array<{ keyword: string; source: string }> = [];
  const allPosts: CompetitorPost[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      allKeywords.push(...result.value.keywords);
      allPosts.push(...result.value.posts);
    }
  }

  return { keywords: allKeywords, posts: allPosts };
}

// ---------------------------------------------------------------------------
// Source 4: Portal messages
// ---------------------------------------------------------------------------

async function gatherPortalQuestions(): Promise<Array<{ keyword: string; source: string }>> {
  try {
    const { data: portalQuestions } = await supabase
      .from("portal_messages")
      .select("message")
      .eq("sender", "homeowner")
      .ilike("message", "%?%")
      .limit(20);

    if (!portalQuestions) return [];

    return portalQuestions
      .map((row: { message: string }) => row.message?.toLowerCase().trim())
      .filter((msg: string) => msg && msg.length > 10 && msg.length < 200)
      .map((msg: string) => ({ keyword: msg, source: "portal_messages" }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const COMPETITORS    = ["companycam", "jobnimbus", "acculynx", "salesrabbit", "sales rabbit", "roofr"];
const HIGH_INTENT    = ["alternative", "free", "cost", "vs", " price", "review", "replace", "switch", "best", "cheap"];
const ROOFING_FEATURES = ["supplement", "portal", "homeowner", "storm", "canvass", "crew", "estimate", "hail", "adjuster"];

function scoreKeyword(keyword: string, source: string): number {
  let score = 0;
  const kw = keyword.toLowerCase();

  if (COMPETITORS.some(c => kw.includes(c)))                                   score += 5;
  if (/^(how|what|why|when|which|can|does|is|are)/i.test(kw) || kw.includes("?")) score += 4;
  if (HIGH_INTENT.some(w => kw.includes(w)))                                   score += 4;
  if (ROOFING_FEATURES.some(f => kw.includes(f)))                               score += 3;
  if (source === "portal_messages" || source === "aria_calls")                  score += 2;
  if (source === "competitor_blog")                                              score += 2;
  if (kw.split(" ").length < 3)                                                 score -= 5; // too short
  if (kw.includes("diy") || kw.includes("history"))                             score -= 3;

  return Math.max(0, score);
}

// ---------------------------------------------------------------------------
// Dedup against existing DB records
// ---------------------------------------------------------------------------

async function isKeywordDuplicate(keyword: string): Promise<boolean> {
  const prefix = keyword.split(" ").slice(0, 3).join(" ");

  const [{ count: queueCount }, { count: postCount }] = await Promise.all([
    supabase
      .from("seo_keyword_queue")
      .select("id", { count: "exact", head: true })
      .ilike("keyword", `%${prefix}%`)
      .then(r => ({ count: r.count ?? 0 })),
    supabase
      .from("seo_posts")
      .select("id", { count: "exact", head: true })
      .ilike("keyword", `%${prefix}%`)
      .then(r => ({ count: r.count ?? 0 })),
  ]);

  return (queueCount > 0) || (postCount > 0);
}

// ---------------------------------------------------------------------------
// Persist competitor posts
// ---------------------------------------------------------------------------

async function saveCompetitorPosts(posts: CompetitorPost[]): Promise<number> {
  if (posts.length === 0) return 0;

  // Deduplicate by URL before upserting
  const unique = Array.from(
    new Map(posts.map(p => [p.url, p])).values(),
  );

  const records = unique.map(p => ({
    competitor: p.competitor,
    url:        p.url,
    title:      p.title,
    found_at:   new Date().toISOString(),
  }));

  // Try upsert; if seo_competitor_content table doesn't exist yet it will fail silently
  try {
    const { error } = await supabase
      .from("seo_competitor_content")
      .upsert(records, { onConflict: "url", ignoreDuplicates: true });

    if (error) {
      console.warn("seo-keyword-finder: could not save competitor posts:", error.message);
      return 0;
    }
    return unique.length;
  } catch (err) {
    console.warn("seo-keyword-finder: competitor content table may not exist:", err);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.test) {
      return Response.json({ ok: true, message: "seo-keyword-finder v1 ready" }, { headers: CORS });
    }

    console.log("seo-keyword-finder: starting keyword discovery run");

    // -----------------------------------------------------------------------
    // 1. Gather from all 4 sources in parallel
    // -----------------------------------------------------------------------
    const [autocompleteResult, redditResult, competitorResult, portalResult] =
      await Promise.allSettled([
        gatherAutocomplete(),
        scrapeReddit(),
        gatherCompetitorData(),
        gatherPortalQuestions(),
      ]);

    const rawKeywords: Array<{ keyword: string; source: string }> = [];

    if (autocompleteResult.status === "fulfilled") {
      rawKeywords.push(...autocompleteResult.value);
      console.log(`seo-keyword-finder: autocomplete yielded ${autocompleteResult.value.length} raw keywords`);
    } else {
      console.warn("seo-keyword-finder: autocomplete source failed:", autocompleteResult.reason);
    }

    if (redditResult.status === "fulfilled") {
      rawKeywords.push(...redditResult.value);
      console.log(`seo-keyword-finder: reddit yielded ${redditResult.value.length} raw keywords`);
    } else {
      console.warn("seo-keyword-finder: reddit source failed:", redditResult.reason);
    }

    let competitorPosts: CompetitorPost[] = [];
    if (competitorResult.status === "fulfilled") {
      rawKeywords.push(...competitorResult.value.keywords);
      competitorPosts = competitorResult.value.posts;
      console.log(`seo-keyword-finder: competitor blogs yielded ${competitorResult.value.keywords.length} raw keywords, ${competitorPosts.length} posts`);
    } else {
      console.warn("seo-keyword-finder: competitor blogs source failed:", competitorResult.reason);
    }

    if (portalResult.status === "fulfilled") {
      rawKeywords.push(...portalResult.value);
      console.log(`seo-keyword-finder: portal messages yielded ${portalResult.value.length} raw keywords`);
    } else {
      console.warn("seo-keyword-finder: portal messages source failed:", portalResult.reason);
    }

    // -----------------------------------------------------------------------
    // 2. Score each keyword
    // -----------------------------------------------------------------------
    const dedupedRaw = new Map<string, { keyword: string; source: string; score: number }>();
    for (const { keyword, source } of rawKeywords) {
      const kw = keyword.trim().toLowerCase();
      if (!kw || kw.length < 5 || kw.length > 200) continue;
      if (dedupedRaw.has(kw)) continue; // take first source seen

      const score = scoreKeyword(kw, source);
      dedupedRaw.set(kw, { keyword: kw, source, score });
    }

    const scored = Array.from(dedupedRaw.values());

    // -----------------------------------------------------------------------
    // 3. Filter: score >= 8 only
    // -----------------------------------------------------------------------
    const qualified = scored.filter(k => k.score >= 8);
    console.log(`seo-keyword-finder: ${scored.length} unique keywords scored, ${qualified.length} qualify (score >= 8)`);

    // -----------------------------------------------------------------------
    // 4. Dedup against existing DB (check in parallel, but cap concurrency)
    // -----------------------------------------------------------------------
    const CONCURRENCY = 5;
    const filtered: Array<{ keyword: string; source: string; score: number }> = [];

    for (let i = 0; i < qualified.length; i += CONCURRENCY) {
      const batch = qualified.slice(i, i + CONCURRENCY);
      const checks = await Promise.allSettled(
        batch.map(async (kw) => {
          const isDupe = await isKeywordDuplicate(kw.keyword);
          return { ...kw, isDupe };
        }),
      );
      for (const result of checks) {
        if (result.status === "fulfilled" && !result.value.isDupe) {
          filtered.push(result.value);
        }
      }
    }

    console.log(`seo-keyword-finder: ${filtered.length} new keywords after DB dedup`);

    // -----------------------------------------------------------------------
    // 5. Sort by score desc, take top 20
    // -----------------------------------------------------------------------
    filtered.sort((a, b) => b.score - a.score);
    const top20 = filtered.slice(0, 20);

    // -----------------------------------------------------------------------
    // 6. Upsert to seo_keyword_queue
    // -----------------------------------------------------------------------
    let savedCount = 0;
    if (top20.length > 0) {
      const records = top20.map(kw => ({
        keyword:           kw.keyword,
        source:            kw.source,
        intent_score:      kw.score,
        competition_level: kw.score >= 14 ? "high" : kw.score >= 10 ? "medium" : "low",
        status:            "pending",
        created_at:        new Date().toISOString(),
      }));

      const { error: upsertError, data: upserted } = await supabase
        .from("seo_keyword_queue")
        .upsert(records, { onConflict: "keyword", ignoreDuplicates: true })
        .select("id");

      if (upsertError) {
        throw new Error(`Failed to upsert keyword queue: ${upsertError.message}`);
      }

      savedCount = upserted?.length ?? top20.length;
    }

    // -----------------------------------------------------------------------
    // 7. Save competitor posts
    // -----------------------------------------------------------------------
    const competitorPostsSaved = await saveCompetitorPosts(competitorPosts);

    // -----------------------------------------------------------------------
    // 8. Send Telegram summary
    // -----------------------------------------------------------------------
    const topFive = top20.slice(0, 5);
    const topFiveLines = topFive
      .map((kw, i) => `${i + 1}. ${kw.keyword} (score: ${kw.score}) — ${kw.source}`)
      .join("\n");

    const telegramMsg = [
      `🔍 SEO Keywords found today: ${savedCount}`,
      `Top picks:`,
      topFiveLines,
      `${competitorPosts.length} competitor posts monitored`,
    ].join("\n");

    await sendTelegram(telegramMsg);

    console.log(`seo-keyword-finder: complete — ${savedCount} saved, ${competitorPosts.length} competitor posts`);

    return Response.json(
      {
        ok:               true,
        found:            savedCount,
        top_keywords:     top20.map(kw => ({ keyword: kw.keyword, score: kw.score, source: kw.source })),
        competitor_posts: competitorPosts.length,
      },
      { headers: CORS },
    );

  } catch (err) {
    console.error("seo-keyword-finder error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

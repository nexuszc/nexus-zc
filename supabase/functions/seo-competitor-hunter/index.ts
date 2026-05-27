import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Competitor definitions
// ---------------------------------------------------------------------------

const COMPETITORS = [
  {
    name: "companycam",
    sitemap: "https://companycam.com/sitemap.xml",
    blog: "https://companycam.com/blog",
    monthly_traffic: 450000,
    pricing: "$99/mo photos only",
    keywords: ["companycam alternative","companycam free","companycam vs","companycam price","companycam review"],
  },
  {
    name: "jobnimbus",
    sitemap: "https://jobnimbus.com/sitemap.xml",
    blog: "https://jobnimbus.com/blog",
    monthly_traffic: 120000,
    pricing: "$550/mo CRM",
    keywords: ["jobnimbus alternative","jobnimbus pricing","jobnimbus review","jobnimbus vs acculynx"],
  },
  {
    name: "acculynx",
    sitemap: "https://acculynx.com/sitemap.xml",
    blog: "https://acculynx.com/blog",
    monthly_traffic: 80000,
    pricing: "$350/mo",
    keywords: ["acculynx alternative","acculynx pricing","acculynx review","acculynx vs jobnimbus"],
  },
  {
    name: "salesrabbit",
    sitemap: "https://salesrabbit.com/sitemap.xml",
    blog: "https://www.salesrabbit.com/blog",
    monthly_traffic: 60000,
    pricing: "$375/mo canvassing",
    keywords: ["sales rabbit alternative","door to door roofing app","canvassing software roofers"],
  },
  {
    name: "roofr",
    sitemap: "https://roofr.com/sitemap.xml",
    blog: "https://roofr.com/blog",
    monthly_traffic: 200000,
    pricing: "$89/mo measurements",
    keywords: ["roofr alternative","roofr pricing","roofr review","roofr vs roofing os"],
  },
  {
    name: "hover",
    sitemap: "https://hover.to/sitemap.xml",
    blog: "https://hover.to/blog",
    monthly_traffic: 150000,
    pricing: "$50/report",
    keywords: ["hover alternative","hover roofing","hover vs eagleview"],
  },
] as const;

type Competitor = typeof COMPETITORS[number];

// ---------------------------------------------------------------------------
// Telegram digest
// ---------------------------------------------------------------------------

async function sendTelegram(msg: string) {
  await supabase.from("telegram_digest_queue").insert({ message: msg, category: "seo" }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Sitemap parser — handles both sitemap index and regular sitemaps
// ---------------------------------------------------------------------------

async function parseSitemap(url: string, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const urls: string[] = [];
    const locRe = /<loc>(.*?)<\/loc>/g;
    let m: RegExpExecArray | null;
    while ((m = locRe.exec(xml)) !== null) {
      urls.push(m[1].trim());
    }

    // Sitemap index — recurse into sub-sitemaps
    if (xml.includes("<sitemapindex")) {
      const subs = urls.filter(u => u.endsWith(".xml"));
      for (const sub of subs.slice(0, 6)) {
        const subUrls = await parseSitemap(sub, depth + 1);
        urls.push(...subUrls);
      }
    }

    return urls.filter(u => !u.endsWith(".xml"));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Keyword extraction — from URL slug (not title)
// ---------------------------------------------------------------------------

function slugToKeyword(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || parts[parts.length - 2] || "";
    return slug.replace(/-/g, " ").replace(/\.(html|php|aspx)$/g, "").trim().toLowerCase();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Title-based keyword (for blog scraping)
// ---------------------------------------------------------------------------

function extractKeywordFromTitle(title: string): string {
  const stopWords = new Set([
    "the","a","an","is","are","was","were","to","for","of","in","on","at",
    "with","how","why","what","your","our","this","that","and","or","but",
    "its","has","have","you","we","they","it","be","do","can","will","get",
  ]);
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  return words.slice(0, 5).join(" ");
}

// ---------------------------------------------------------------------------
// Gap scoring
// ---------------------------------------------------------------------------

function scoreGap(keyword: string, competitor: Competitor): number {
  let score = 0;
  if (competitor.monthly_traffic > 200000) score += 5;
  else if (competitor.monthly_traffic > 100000) score += 3;
  else if (competitor.monthly_traffic > 50000) score += 2;

  const kw = keyword.toLowerCase();
  if (/\b(how|what|why|when|does|can|is|are)\b/.test(kw)) score += 4;
  if (kw.includes(competitor.name.replace(/[^a-z]/g, ""))) score += 3;
  if (/\b(how.?to|guide|tutorial|tips|checklist)\b/.test(kw)) score += 3;
  if (/\b(roof|contractor|insurance|supplement|hail|storm)\b/.test(kw)) score += 2;
  if (/\b(vs|versus|alternative|compare|comparison)\b/.test(kw)) score += 3;
  if (/\b(price|pricing|cost|free)\b/.test(kw)) score += 2;

  return score;
}

// ---------------------------------------------------------------------------
// Check if we already have a post covering a keyword
// ---------------------------------------------------------------------------

async function hasCounterContent(keyword: string): Promise<boolean> {
  if (!keyword || keyword.length < 3) return true; // skip trivial keywords
  try {
    const firstWord = keyword.split(" ")[0];
    const { count } = await supabase
      .from("seo_posts")
      .select("id", { count: "exact", head: true })
      .or(`keyword.ilike.%${firstWord}%,title.ilike.%${firstWord}%`);
    return (count || 0) > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Save gap to competitor_pages
// ---------------------------------------------------------------------------

async function saveGap(
  competitor: Competitor,
  url: string,
  keyword: string,
  score: number,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("competitor_pages").insert({
      competitor: competitor.name,
      url,
      slug: new URL(url).pathname.replace(/\/$/, "").split("/").pop() || "",
      keyword,
      priority_score: score,
      gap_status: "uncovered",
    });
    if (error?.code === "23505") return false; // already tracked
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sitemap gap analysis — the core new capability
// ---------------------------------------------------------------------------

async function analyzeCompetitorSitemap(competitor: Competitor): Promise<{
  pages_found: number;
  gaps_discovered: number;
  gaps_queued: number;
}> {
  console.log(`  [sitemap] parsing ${competitor.sitemap}`);
  const urls = await parseSitemap(competitor.sitemap);
  console.log(`  [sitemap] ${competitor.name}: ${urls.length} URLs found`);

  // Only look at blog/content URLs — skip product, pricing, legal pages
  const contentUrls = urls.filter(u => {
    const p = new URL(u).pathname.toLowerCase();
    return (
      p.includes("/blog") || p.includes("/guides") || p.includes("/resources") ||
      p.includes("/learn") || p.includes("/articles") || p.includes("/insights") ||
      (p.split("/").length >= 3 && !p.includes("privacy") && !p.includes("terms") &&
       !p.includes("pricing") && !p.includes("login") && !p.includes("signup"))
    );
  });

  let gapsDiscovered = 0;
  let gapsQueued = 0;

  for (const url of contentUrls.slice(0, 200)) {
    const keyword = slugToKeyword(url);
    if (!keyword || keyword.length < 5) continue;

    const covered = await hasCounterContent(keyword);
    if (covered) continue;

    const score = scoreGap(keyword, competitor);
    const saved = await saveGap(competitor, url, keyword, score);
    if (!saved) continue;

    gapsDiscovered++;

    // High-priority gaps → keyword queue
    if (score >= 8) {
      await supabase.from("seo_keyword_queue").upsert(
        { keyword, source: "competitor_sitemap", intent_score: 15, status: "pending" },
        { onConflict: "keyword" },
      ).catch(() => {});
      gapsQueued++;
    }
  }

  return { pages_found: contentUrls.length, gaps_discovered: gapsDiscovered, gaps_queued: gapsQueued };
}

// ---------------------------------------------------------------------------
// Blog scraper (preserved from v1)
// ---------------------------------------------------------------------------

async function scrapeCompetitorBlog(competitor: Competitor): Promise<Array<{ url: string; title: string }>> {
  try {
    const res = await fetch(competitor.blog, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)", "Accept": "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const results: Array<{ url: string; title: string }> = [];
    const seen = new Set<string>();
    const base = `https://${new URL(competitor.blog).hostname}`;
    const linkRe = /<a[^>]+href="([^"]*\/blog\/[^"]+)"[^>]*>([^<]{10,120})<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRe.exec(html)) !== null && results.length < 20) {
      let url = match[1].trim();
      const title = match[2].replace(/\s+/g, " ").trim();
      if (!url.startsWith("http")) url = url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
      const cleanUrl = url.split("?")[0];
      if (url.includes("#") || title.length < 10 || seen.has(cleanUrl)) continue;
      seen.add(cleanUrl);
      results.push({ url: cleanUrl, title });
    }
    return results;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Enqueue preset competitor keywords (preserved from v1)
// ---------------------------------------------------------------------------

async function enqueuePresetKeywords(competitor: Competitor): Promise<number> {
  let added = 0;
  for (const kw of competitor.keywords) {
    const { error } = await supabase.from("seo_keyword_queue").upsert(
      { keyword: kw, source: "competitor_preset", intent_score: 16, status: "pending" },
      { onConflict: "keyword" },
    );
    if (!error) added++;
  }
  return added;
}

// ---------------------------------------------------------------------------
// Full competitor processing — blog + sitemap
// ---------------------------------------------------------------------------

async function processCompetitor(competitor: Competitor): Promise<{
  name: string;
  blog_posts: number;
  sitemap_gaps: number;
  gaps_queued: number;
  preset_keywords: number;
}> {
  console.log(`\nseo-competitor-hunter: processing ${competitor.name}`);

  // 1. Blog scraping → seo_competitor_content (existing table)
  const blogPosts = await scrapeCompetitorBlog(competitor);
  let newBlogPosts = 0;
  for (const post of blogPosts) {
    const keyword = extractKeywordFromTitle(post.title);
    const { error } = await supabase.from("seo_competitor_content").insert({
      competitor: competitor.name, url: post.url, title: post.title, keyword,
    }).catch(() => ({ error: { code: "err" } }));
    if (!error) {
      newBlogPosts++;
      await supabase.from("seo_keyword_queue").upsert(
        { keyword, source: "competitor_blog", intent_score: 18, status: "pending" },
        { onConflict: "keyword" },
      ).catch(() => {});
    }
  }

  // 2. Sitemap gap analysis → competitor_pages (new table)
  const sitemapResult = await analyzeCompetitorSitemap(competitor);

  // 3. Preset keywords
  const presetAdded = await enqueuePresetKeywords(competitor);

  console.log(`  ${competitor.name}: ${newBlogPosts} blog posts, ${sitemapResult.gaps_discovered} gaps found, ${sitemapResult.gaps_queued} queued`);

  return {
    name: competitor.name,
    blog_posts: newBlogPosts,
    sitemap_gaps: sitemapResult.gaps_discovered,
    gaps_queued: sitemapResult.gaps_queued,
    preset_keywords: presetAdded,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handleScheduledRun(singleCompetitor?: string): Promise<Response> {
  const targets = singleCompetitor
    ? COMPETITORS.filter(c => c.name === singleCompetitor)
    : [...COMPETITORS];

  if (targets.length === 0) {
    return Response.json({ ok: false, error: `Unknown competitor: ${singleCompetitor}` }, { status: 400, headers: CORS });
  }

  const results = [];
  for (const competitor of targets) {
    try {
      results.push(await processCompetitor(competitor));
    } catch (err) {
      console.error(`Failed processing ${competitor.name}:`, err);
      results.push({ name: competitor.name, blog_posts: 0, sitemap_gaps: 0, gaps_queued: 0, preset_keywords: 0 });
    }
  }

  const totalBlogPosts   = results.reduce((s, r) => s + r.blog_posts, 0);
  const totalGaps        = results.reduce((s, r) => s + r.sitemap_gaps, 0);
  const totalQueued      = results.reduce((s, r) => s + r.gaps_queued, 0);
  const totalPresets     = results.reduce((s, r) => s + r.preset_keywords, 0);

  if (totalBlogPosts > 0 || totalGaps > 0) {
    const lines = [`🕵️ *Competitor Intel Report*`];
    lines.push(`Gaps discovered: ${totalGaps} total`);
    for (const r of results) {
      lines.push(`- ${r.name}: ${r.blog_posts} blog posts, ${r.sitemap_gaps} sitemap gaps`);
    }
    lines.push(`High-priority keywords queued: ${totalQueued + totalPresets}`);
    await sendTelegram(lines.join("\n"));
  }

  return Response.json({
    ok: true,
    blog_posts_found: totalBlogPosts,
    sitemap_gaps_discovered: totalGaps,
    high_priority_queued: totalQueued,
    preset_keywords_added: totalPresets,
    breakdown: results,
  }, { headers: CORS });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.test) {
      return Response.json({ ok: true, message: "seo-competitor-hunter v2 — sitemap gap analysis ready" }, { headers: CORS });
    }
    return await handleScheduledRun(body.competitor as string | undefined);
  } catch (err) {
    console.error("seo-competitor-hunter error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

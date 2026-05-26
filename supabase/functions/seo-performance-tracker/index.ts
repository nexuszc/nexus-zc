import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const GSC_CLIENT_EMAIL = Deno.env.get("GOOGLE_SC_CLIENT_EMAIL");
const GSC_PRIVATE_KEY  = Deno.env.get("GOOGLE_SC_PRIVATE_KEY");
const GSC_PROPERTY     = Deno.env.get("GOOGLE_SC_PROPERTY_URL") || "https://roofingos.dev";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ai(prompt: string, maxTokens = 3000): Promise<string> {
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

// ---------------------------------------------------------------------------
// Google Search Console JWT + token
// ---------------------------------------------------------------------------

async function getGSCToken(): Promise<string | null> {
  if (!GSC_CLIENT_EMAIL || !GSC_PRIVATE_KEY) return null;

  try {
    const now = Math.floor(Date.now() / 1000);
    const header  = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss:   GSC_CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud:   "https://oauth2.googleapis.com/token",
      exp:   now + 3600,
      iat:   now,
    };

    const pemKey  = GSC_PRIVATE_KEY.replace(/\\n/g, "\n");
    const keyData = pemKey
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s/g, "");

    const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryKey.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const enc        = new TextEncoder();
    const headerB64  = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const sigInput   = enc.encode(`${headerB64}.${payloadB64}`);
    const signature  = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, sigInput);
    const sigB64     = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwt        = `${headerB64}.${payloadB64}.${sigB64}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion:  jwt,
      }),
    });

    if (!tokenRes.ok) {
      console.error("GSC token exchange failed:", tokenRes.status, await tokenRes.text());
      return null;
    }
    const tokenData = await tokenRes.json();
    return tokenData.access_token || null;
  } catch (err) {
    console.error("GSC token error:", err);
    return null;
  }
}

async function queryGSC(token: string, startDate: string, endDate: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(GSC_PROPERTY)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          "Authorization":  `Bearer ${token}`,
          "Content-Type":   "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ["page", "query"],
          rowLimit:   500,
          dimensionFilterGroups: [{
            filters: [{
              dimension:  "page",
              operator:   "contains",
              expression: "/blog/",
            }],
          }],
        }),
      },
    );

    if (!res.ok) {
      console.error("GSC query failed:", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return data.rows || [];
  } catch (err) {
    console.error("GSC query error:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Content boost helpers
// ---------------------------------------------------------------------------

async function boostPostContent(post: Record<string, any>): Promise<string> {
  const prompt = `Here is an existing blog post. Add exactly 300 more words to expand the content.
Add 2 more FAQ questions at the end of the existing FAQ section.
Keep the same voice and style. Return the complete updated HTML.

Current content:
${post.content_html}`;

  return await ai(prompt, 3500);
}

async function rewritePostTitle(post: Record<string, any>): Promise<string> {
  const prompt = `Rewrite this blog post title to be more compelling and click-worthy.
Current title: ${post.title}
Keyword: ${post.keyword}
The new title must contain the keyword, be under 60 characters, and be specific/benefit-focused.
Return ONLY the new title, nothing else.`;

  const result = await ai(prompt, 100);
  return result.trim().replace(/^["']|["']$/g, "").trim();
}

// ---------------------------------------------------------------------------
// Single-post boost handler
// ---------------------------------------------------------------------------

async function handleSinglePostBoost(slug: string): Promise<Response> {
  const { data: post, error } = await supabase
    .from("seo_posts")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !post) {
    return Response.json(
      { ok: false, error: `Post not found: ${slug}` },
      { status: 404, headers: CORS },
    );
  }

  const updatedHtml = await boostPostContent(post);

  const { error: updateError } = await supabase
    .from("seo_posts")
    .update({
      content_html:  updatedHtml,
      rewrite_count: (post.rewrite_count || 0) + 1,
      status:        "approved",
      updated_at:    new Date().toISOString(),
    })
    .eq("slug", slug);

  if (updateError) {
    throw new Error(`DB update failed: ${updateError.message}`);
  }

  console.log(`seo-performance-tracker: boosted single post "${slug}"`);

  return Response.json(
    { ok: true, boosted: 1, post: post.slug },
    { headers: CORS },
  );
}

// ---------------------------------------------------------------------------
// Scheduled run
// ---------------------------------------------------------------------------

async function handleScheduledRun(): Promise<Response> {
  // ── 1. Pull GSC data ──────────────────────────────────────────────────────
  const gscToken = await getGSCToken();
  let gscRows: any[] = [];

  if (gscToken) {
    const now       = new Date();
    const endDate   = now.toISOString().split("T")[0];
    const startDate = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    gscRows = await queryGSC(gscToken, startDate, endDate);
    console.log(`seo-performance-tracker: pulled ${gscRows.length} GSC rows`);
  } else {
    console.log("seo-performance-tracker: no GSC credentials — skipping data pull");
  }

  // ── 2. Aggregate GSC rows by page URL ──────────────────────────────────────
  if (gscRows.length > 0) {
    const pageMap = new Map<string, { impressions: number; clicks: number; positionSum: number; count: number }>();

    for (const row of gscRows) {
      const pageUrl = row.keys?.[0] as string;
      if (!pageUrl) continue;

      const existing = pageMap.get(pageUrl) || { impressions: 0, clicks: 0, positionSum: 0, count: 0 };
      // GSC returns per-query rows for the same page — aggregate impressions/clicks at page level
      existing.impressions += row.impressions || 0;
      existing.clicks      += row.clicks      || 0;
      existing.positionSum += (row.position   || 0) * (row.impressions || 1);
      existing.count       += row.impressions || 1;
      pageMap.set(pageUrl, existing);
    }

    // Deduplicate by page (impressions are double-counted across queries — use max per page)
    const pageImpressions = new Map<string, { impressions: number; clicks: number; positionSum: number; count: number }>();
    for (const row of gscRows) {
      const pageUrl = row.keys?.[0] as string;
      if (!pageUrl) continue;
      const existing = pageImpressions.get(pageUrl);
      if (!existing) {
        pageImpressions.set(pageUrl, {
          impressions: row.impressions || 0,
          clicks:      row.clicks      || 0,
          positionSum: (row.position   || 0) * (row.impressions || 1),
          count:       row.impressions || 1,
        });
      } else {
        existing.clicks      += row.clicks || 0;
        existing.positionSum += (row.position || 0) * (row.impressions || 1);
        existing.count       += row.impressions || 1;
        // impressions already set to first occurrence (page-level)
      }
    }

    for (const [pageUrl, stats] of pageImpressions.entries()) {
      const slug = pageUrl.split("/blog/")[1]?.replace(/\/$/, "");
      if (!slug) continue;

      const avgPosition = stats.count > 0 ? stats.positionSum / stats.count : 0;

      const { error: updateErr } = await supabase
        .from("seo_posts")
        .update({
          google_impressions:   stats.impressions,
          google_clicks:        stats.clicks,
          google_position:      parseFloat(avgPosition.toFixed(1)),
          google_last_checked:  new Date().toISOString(),
        })
        .eq("slug", slug);

      if (updateErr) {
        console.error(`GSC update failed for slug "${slug}":`, updateErr.message);
      }
    }
    console.log(`seo-performance-tracker: updated ${pageImpressions.size} post GSC metrics`);
  }

  // ── 3. Find boost candidates (position 4-15, impressions > 10) ────────────
  const { data: boostCandidates } = await supabase
    .from("seo_posts")
    .select("*")
    .eq("status", "published")
    .gte("google_position", 4)
    .lte("google_position", 15)
    .gte("google_impressions", 10)
    .order("google_impressions", { ascending: false })
    .limit(3);

  let boosted = 0;

  for (const post of (boostCandidates || [])) {
    try {
      const updatedHtml = await boostPostContent(post);
      const { error: boostErr } = await supabase
        .from("seo_posts")
        .update({
          content_html:  updatedHtml,
          rewrite_count: (post.rewrite_count || 0) + 1,
          status:        "approved",
          updated_at:    new Date().toISOString(),
        })
        .eq("id", post.id);

      if (boostErr) {
        console.error(`Boost update failed for "${post.slug}":`, boostErr.message);
      } else {
        boosted++;
        console.log(`seo-performance-tracker: boosted "${post.slug}" (position ${post.google_position})`);
      }
    } catch (err) {
      console.error(`Boost content generation failed for "${post.slug}":`, err);
    }
  }

  // ── 4. Find title rewrite candidates (50+ impressions, 0 clicks) ──────────
  const { data: titleRewriteCandidates } = await supabase
    .from("seo_posts")
    .select("*")
    .eq("status", "published")
    .gt("google_impressions", 50)
    .eq("google_clicks", 0)
    .limit(2);

  let titlesRewritten = 0;

  for (const post of (titleRewriteCandidates || [])) {
    try {
      const newTitle = await rewritePostTitle(post);
      if (!newTitle || newTitle.length < 10) continue;

      const { error: titleErr } = await supabase
        .from("seo_posts")
        .update({
          title:      newTitle,
          updated_at: new Date().toISOString(),
        })
        .eq("id", post.id);

      if (titleErr) {
        console.error(`Title rewrite failed for "${post.slug}":`, titleErr.message);
      } else {
        titlesRewritten++;
        console.log(`seo-performance-tracker: rewrote title for "${post.slug}" → "${newTitle}"`);
      }
    } catch (err) {
      console.error(`Title rewrite generation failed for "${post.slug}":`, err);
    }
  }

  // ── 5. Weekly snapshot ────────────────────────────────────────────────────
  const { data: allPosts } = await supabase
    .from("seo_posts")
    .select("google_impressions, google_clicks, google_position, status")
    .eq("status", "published");

  const posts = allPosts || [];

  const snapshot = {
    snapshot_date:        new Date().toISOString().split("T")[0],
    total_posts:          posts.length,
    total_impressions:    posts.reduce((s, p) => s + (p.google_impressions || 0), 0),
    total_clicks:         posts.reduce((s, p) => s + (p.google_clicks      || 0), 0),
    avg_position:         posts.length
      ? posts.reduce((s, p) => s + (p.google_position || 0), 0) / posts.length
      : 0,
    posts_ranking_top3:   posts.filter(p => p.google_position > 0 && p.google_position <= 3).length,
    posts_ranking_top10:  posts.filter(p => p.google_position > 0 && p.google_position <= 10).length,
    posts_needing_update: posts.filter(p => p.google_position > 15 || !p.google_impressions).length,
  };

  const { error: snapErr } = await supabase
    .from("seo_performance")
    .upsert(snapshot, { onConflict: "snapshot_date" });

  if (snapErr) {
    console.error("Snapshot upsert failed:", snapErr.message);
  } else {
    console.log("seo-performance-tracker: snapshot saved for", snapshot.snapshot_date);
  }

  // ── 6. Telegram summary ───────────────────────────────────────────────────
  const hasInterestingData = snapshot.total_impressions > 0 || boosted > 0 || titlesRewritten > 0;
  if (hasInterestingData) {
    await sendTelegram(
      `📊 *SEO Weekly Report*\n` +
      `Posts: ${snapshot.total_posts} published\n` +
      `Impressions: ${snapshot.total_impressions.toLocaleString()} (last 28 days)\n` +
      `Clicks: ${snapshot.total_clicks}\n` +
      `Avg position: ${snapshot.avg_position.toFixed(1)}\n` +
      `Top 10 rankings: ${snapshot.posts_ranking_top10}\n` +
      `Boosted this week: ${boosted}` +
      (titlesRewritten > 0 ? `\nTitles rewritten: ${titlesRewritten}` : ""),
    );
  }

  return Response.json(
    {
      ok:               true,
      snapshot,
      boosted,
      titles_rewritten: titlesRewritten,
      gsc_rows_pulled:  gscRows.length,
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
        { ok: true, message: "seo-performance-tracker v1 ready" },
        { headers: CORS },
      );
    }

    // Single-post boost
    if (body.post_slug) {
      return await handleSinglePostBoost(body.post_slug as string);
    }

    // Scheduled run (or any other invocation)
    return await handleScheduledRun();

  } catch (err) {
    console.error("seo-performance-tracker error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

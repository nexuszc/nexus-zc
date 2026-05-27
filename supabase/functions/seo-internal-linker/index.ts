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
// Types
// ---------------------------------------------------------------------------

interface PostRecord {
  id: string;
  slug: string;
  title: string;
  keyword: string;
  content_html: string;
  content_text?: string;
  internal_links_added: number;
}

interface PillarRecord {
  id: string;
  slug: string;
  title: string;
  content_html: string;
}

interface LinkResult {
  from_slug: string;
  to_slug: string;
  anchor: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendTelegram(msg: string) {
  await supabase.from("telegram_digest_queue").insert({ message: msg, category: "seo" }).catch(() => {});
}

/**
 * Extract key terms from a post's title and H2 headings.
 * Returns up to 8 unique terms longer than 4 chars.
 */
function extractKeyTerms(post: { title: string; content_html: string }): string[] {
  const titleWords = post.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);

  const h2Matches = [...(post.content_html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gi))]
    .map(m => m[1].toLowerCase());

  const allTerms = [
    ...titleWords,
    ...h2Matches.flatMap(h => h.split(/\s+/).filter(w => w.length > 4)),
  ];

  return [...new Set(allTerms)].slice(0, 8);
}

/**
 * Inject a hyperlink around the first plain-text occurrence of anchorText
 * that is NOT already inside an <a> tag.
 */
function injectLink(html: string, targetSlug: string, _targetTitle: string, anchorText: string): string {
  // Build a regex that matches the anchor text NOT already wrapped in <a>
  const escaped = anchorText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `(?<!<a[^>]*>[^<]*)\\b(${escaped})\\b(?![^<]*<\\/a>)`,
    "i",
  );
  const replacement = `<a href="/blog/${targetSlug}" style="color:#4a9eff;text-decoration:underline">$1</a>`;
  return html.replace(regex, replacement);
}

/**
 * Replace [LINK:topic] placeholders with real <a> tags.
 * If no matching post is found, the placeholder text is kept without the marker.
 */
function resolveLinkPlaceholders(
  html: string,
  availablePosts: Array<{ slug: string; title: string; keyword: string }>,
): string {
  return html.replace(/\[LINK:([^\]]+)\]/g, (_match, topic: string) => {
    const topicWords = topic.toLowerCase().split(/[\s-]+/);
    const best = availablePosts.find(p =>
      topicWords.some(w => p.keyword.toLowerCase().includes(w) || p.slug.includes(w)),
    );
    if (best) {
      return `<a href="/blog/${best.slug}" style="color:#4a9eff;text-decoration:underline">${topic}</a>`;
    }
    return topic; // strip the marker, keep the text
  });
}

// ---------------------------------------------------------------------------
// Core linking logic for a single post
// ---------------------------------------------------------------------------

async function linkPost(newPost: PostRecord): Promise<number> {
  const keyTerms = extractKeyTerms(newPost);
  console.log(`seo-internal-linker: key terms for "${newPost.slug}":`, keyTerms);

  // --- Step 1: find related posts whose content_text mentions the new post's key terms ---
  const relatedPostsMap = new Map<string, PostRecord>();

  for (const term of keyTerms.slice(0, 3)) {
    const { data } = await supabase
      .from("seo_posts")
      .select("id, slug, title, keyword, content_html, internal_links_added")
      .eq("status", "published")
      .neq("id", newPost.id)
      .ilike("content_text", `%${term}%`)
      .limit(2);

    if (data) {
      for (const p of data) {
        if (!relatedPostsMap.has(p.slug)) relatedPostsMap.set(p.slug, p as PostRecord);
      }
    }
  }

  const relatedPosts = [...relatedPostsMap.values()];

  // --- Step 2: find related pillars ---
  const { data: relatedPillars } = await supabase
    .from("seo_pillars")
    .select("id, slug, title, content_html")
    .eq("status", "published")
    .ilike("content_text", `%${newPost.keyword.split(" ")[0]}%`)
    .limit(2);

  // --- Step 3: fetch all published posts for placeholder resolution ---
  const { data: allPublished } = await supabase
    .from("seo_posts")
    .select("slug, title, keyword")
    .eq("status", "published");

  const allPosts = allPublished || [];

  // --- Step 4: resolve [LINK:...] placeholders in the new post itself ---
  let newPostHtml = resolveLinkPlaceholders(newPost.content_html, allPosts);

  // --- Step 5: inject links INTO related posts pointing back to the new post ---
  const addedLinks: LinkResult[] = [];

  for (const related of relatedPosts) {
    // Choose the best anchor: use a 2–3 word phrase from new post's keyword that appears in related post text
    const relatedText = related.content_html.replace(/<[^>]+>/g, " ").toLowerCase();
    const kwWords     = newPost.keyword.toLowerCase().split(/\s+/);

    // Try progressively shorter anchor phrases
    let anchorText = "";
    for (let len = Math.min(kwWords.length, 3); len >= 1; len--) {
      const candidate = kwWords.slice(0, len).join(" ");
      if (relatedText.includes(candidate)) {
        anchorText = candidate;
        break;
      }
    }

    if (!anchorText) {
      // Fall back to the first key term
      anchorText = keyTerms[0] || newPost.keyword.split(" ")[0];
    }

    const updatedHtml = injectLink(related.content_html, newPost.slug, newPost.title, anchorText);

    // Only update if the HTML actually changed (link was injected)
    if (updatedHtml !== related.content_html) {
      const newCount = (related.internal_links_added || 0) + 1;

      const { error } = await supabase
        .from("seo_posts")
        .update({
          content_html:         updatedHtml,
          content_text:         updatedHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          internal_links_added: newCount,
          updated_at:           new Date().toISOString(),
        })
        .eq("id", related.id);

      if (!error) {
        addedLinks.push({ from_slug: related.slug, to_slug: newPost.slug, anchor: anchorText });
        console.log(`seo-internal-linker: injected link in "${related.slug}" → "${newPost.slug}" anchor: "${anchorText}"`);
      } else {
        console.error(`seo-internal-linker: failed to update "${related.slug}":`, error.message);
      }
    }
  }

  // --- Step 6: inject links INTO related pillars pointing back to the new post ---
  for (const pillar of (relatedPillars || []) as PillarRecord[]) {
    const anchorText = newPost.keyword.split(/\s+/).slice(0, 2).join(" ");
    const updatedHtml = injectLink(pillar.content_html, newPost.slug, newPost.title, anchorText);

    if (updatedHtml !== pillar.content_html) {
      const { error } = await supabase
        .from("seo_pillars")
        .update({
          content_html: updatedHtml,
          content_text: updatedHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          updated_at:   new Date().toISOString(),
        })
        .eq("id", pillar.id);

      if (!error) {
        addedLinks.push({ from_slug: `pillar:${pillar.slug}`, to_slug: newPost.slug, anchor: anchorText });
        console.log(`seo-internal-linker: injected link in pillar "${pillar.slug}" → "${newPost.slug}"`);
      }
    }
  }

  // --- Step 7: also inject links FROM the new post INTO other published posts ---
  // i.e. find posts whose keyword appears naturally in the new post's text
  const newPostText = newPostHtml.replace(/<[^>]+>/g, " ").toLowerCase();

  for (const candidate of allPosts) {
    if (candidate.slug === newPost.slug) continue;
    const candKwWords = candidate.keyword.toLowerCase().split(/\s+/).slice(0, 2).join(" ");
    if (!candKwWords || candKwWords.length < 4) continue;
    if (newPostText.includes(candKwWords)) {
      const before   = newPostHtml;
      newPostHtml    = injectLink(newPostHtml, candidate.slug, candidate.title, candKwWords);
      if (newPostHtml !== before) {
        addedLinks.push({ from_slug: newPost.slug, to_slug: candidate.slug, anchor: candKwWords });
        console.log(`seo-internal-linker: injected link in new post → "${candidate.slug}" anchor: "${candKwWords}"`);
      }
    }
  }

  // --- Step 8: save updated new post HTML ---
  const newLinksCount = addedLinks.filter(l => l.from_slug === newPost.slug).length;

  if (newPostHtml !== newPost.content_html || newLinksCount > 0) {
    const { error } = await supabase
      .from("seo_posts")
      .update({
        content_html:         newPostHtml,
        content_text:         newPostHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        internal_links_added: (newPost.internal_links_added || 0) + newLinksCount,
        updated_at:           new Date().toISOString(),
      })
      .eq("id", newPost.id);

    if (error) {
      console.error(`seo-internal-linker: failed to update new post "${newPost.slug}":`, error.message);
    }
  }

  // --- Step 9: log each link to seo_internal_links table ---
  for (const link of addedLinks) {
    await supabase.from("seo_internal_links").insert({
      from_post_slug: link.from_slug,
      to_post_slug:   link.to_slug,
      anchor_text:    link.anchor,
      added_at:       new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.error("seo-internal-linker: failed to log link:", error.message);
    });
  }

  return addedLinks.length;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));

    // ------------------------------------------------------------------
    // TEST
    // ------------------------------------------------------------------
    if (body.test) {
      return Response.json({ ok: true, message: "seo-internal-linker v1 ready" }, { headers: CORS });
    }

    // ------------------------------------------------------------------
    // SINGLE POST MODE
    // ------------------------------------------------------------------
    if (body.post_slug) {
      const { data: newPost, error: fetchError } = await supabase
        .from("seo_posts")
        .select("id, slug, title, keyword, content_html, content_text, internal_links_added")
        .eq("slug", body.post_slug)
        .single();

      if (fetchError || !newPost) {
        return Response.json(
          { ok: false, error: `Post not found: ${body.post_slug}` },
          { status: 404, headers: CORS },
        );
      }

      const linksAdded = await linkPost(newPost as PostRecord);
      console.log(`seo-internal-linker: single post done — "${body.post_slug}" — ${linksAdded} links`);

      return Response.json({ ok: true, post_slug: body.post_slug, links_added: linksAdded }, { headers: CORS });
    }

    // ------------------------------------------------------------------
    // SWEEP MODE — posts published 7+ days ago with 0 internal links
    // ------------------------------------------------------------------
    if (body.sweep) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: stalePosts, error: sweepError } = await supabase
        .from("seo_posts")
        .select("id, slug, title, keyword, content_html, content_text, internal_links_added")
        .eq("status", "published")
        .eq("internal_links_added", 0)
        .lt("published_at", sevenDaysAgo)
        .limit(10); // cap at 10 per sweep to avoid timeout

      if (sweepError) {
        throw new Error(`Sweep query failed: ${sweepError.message}`);
      }

      if (!stalePosts || stalePosts.length === 0) {
        return Response.json({ ok: true, message: "No stale posts to link", links_added: 0 }, { headers: CORS });
      }

      let totalLinks = 0;
      const results: Array<{ slug: string; links_added: number }> = [];

      for (const post of stalePosts) {
        try {
          const count = await linkPost(post as PostRecord);
          totalLinks += count;
          results.push({ slug: post.slug, links_added: count });
        } catch (err) {
          console.error(`seo-internal-linker: sweep error on "${post.slug}":`, err);
          results.push({ slug: post.slug, links_added: 0 });
        }
      }

      if (totalLinks > 0) {
        await sendTelegram(`🔗 SEO sweep: added ${totalLinks} internal links across ${stalePosts.length} posts`);
      }

      console.log(`seo-internal-linker: sweep done — ${stalePosts.length} posts, ${totalLinks} total links`);

      return Response.json(
        { ok: true, posts_processed: stalePosts.length, total_links_added: totalLinks, results },
        { headers: CORS },
      );
    }

    // ------------------------------------------------------------------
    // Missing action
    // ------------------------------------------------------------------
    return Response.json(
      { ok: false, error: 'Provide { "post_slug": "..." } or { "sweep": true }' },
      { status: 400, headers: CORS },
    );

  } catch (err) {
    console.error("seo-internal-linker error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

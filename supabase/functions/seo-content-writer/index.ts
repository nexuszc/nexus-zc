import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

async function ai(prompt: string, maxTokens = 2500): Promise<string> {
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
// Content helpers
// ---------------------------------------------------------------------------

function scorePost(html: string, keyword: string): { score: number; details: Record<string, boolean> } {
  const text      = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
  const wordCount = text.split(" ").filter(Boolean).length;
  const kwWords   = keyword.toLowerCase().split(" ").slice(0, 2).join(" ");

  const details: Record<string, boolean> = {
    direct_answer:  text.substring(0, 300).includes(kwWords),
    has_dollar_amount: /\$[\d,]+/.test(text),
    has_competitor: /companycam|jobnimbus|acculynx|salesrabbit|roofr/.test(text),
    good_word_count: wordCount >= 500 && wordCount <= 950,
    has_faq:  text.includes("frequently asked") || text.includes("faq"),
    has_cta:  text.includes("roofingos.dev") || text.includes("try roofing os"),
  };

  const score =
    (details.direct_answer ? 2 : 0) +
    Object.entries(details)
      .filter(([k, v]) => k !== "direct_answer" && v)
      .length;

  return { score, details };
}

function makeSlug(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 70);
}

function extractMeta(html: string): { meta: string; cleanHtml: string } {
  const lines    = html.split("\n");
  const metaLine = lines.find(l => l.trim().startsWith("META:"));
  const meta     = metaLine ? metaLine.replace(/^META:\s*/i, "").trim().slice(0, 155) : "";
  const cleanHtml = lines.filter(l => !l.trim().startsWith("META:")).join("\n");
  return { meta, cleanHtml };
}

function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return match ? match[1].trim() : fallback;
}

function wordCount(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(keyword: string, internalLinkContext: string, relatedPillar: { slug: string; title: string } | null): string {
  return `You are Zach, founder of Roofing OS. Warm, direct, friendly like texting a roofer you respect. Real numbers. Short sentences. No fluff. No corporate speak.

Write a 700-word blog post answering this exact question/topic: "${keyword}"

RULES:
- Title = the exact question or keyword (H1) — make it specific and compelling
- First paragraph = direct 2-sentence answer that Google can use as a featured snippet
- Use H2 for main sections (max 4 sections)
- Include at least ONE specific dollar amount
- Include at least ONE specific competitor name with their real price: CompanyCam ($99/mo), JobNimbus ($619+/mo), AccuLynx ($250+/mo), Sales Rabbit ($375/mo)
- Mention Roofing OS naturally in 1-2 places (never forced)
- End with ONE clear CTA: "Try Roofing OS free — takes 4 minutes. roofingos.dev"
- Add FAQ section with 4 related questions (H3 "Frequently Asked Questions"), each answered in 2-4 sentences
- Never exceed 850 words total
- Format as clean HTML (no markdown, just HTML tags)
- The very last line must be: META:[155 character meta description starting with the main keyword]

AVAILABLE INTERNAL LINKS (use [LINK:slug] placeholder where natural):
${internalLinkContext || "No existing posts yet — skip internal links"}

${relatedPillar ? `PILLAR PAGE to reference: /blog/${relatedPillar.slug} — "${relatedPillar.title}"` : ""}`;
}

function buildRewritePrompt(keyword: string, internalLinkContext: string, relatedPillar: { slug: string; title: string } | null): string {
  return buildPrompt(keyword, internalLinkContext, relatedPillar) +
    "\n\nIMPORTANT: Make sure the first paragraph directly answers the question in 2 sentences. Add more specific dollar amounts.";
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.test) {
      return Response.json({ ok: true, message: "seo-content-writer v1 ready" }, { headers: CORS });
    }

    // ------------------------------------------------------------------
    // STEP 1 — Pick keyword
    // ------------------------------------------------------------------
    let keywordRow: Record<string, unknown> | null = null;

    if (body.keyword) {
      // Caller specified a keyword directly — build a synthetic row
      keywordRow = { id: null, keyword: body.keyword, source: "manual", intent_score: 0 };
    } else {
      const { data } = await supabase
        .from("seo_keyword_queue")
        .select("*")
        .eq("status", "pending")
        .order("intent_score", { ascending: false })
        .limit(1)
        .single();

      if (!data) {
        return Response.json({ ok: true, message: "No pending keywords" }, { headers: CORS });
      }
      keywordRow = data;
    }

    const keyword = keywordRow.keyword as string;
    console.log(`seo-content-writer: writing post for keyword "${keyword}"`);

    // ------------------------------------------------------------------
    // STEP 2 — Build context from real data
    // ------------------------------------------------------------------
    const { data: relatedPillar } = await supabase
      .from("seo_pillars")
      .select("slug, title")
      .ilike("keyword", `%${(keyword.split(" ")[0])}%`)
      .limit(1)
      .single();

    const { data: existingPosts } = await supabase
      .from("seo_posts")
      .select("slug, title, keyword")
      .eq("status", "published")
      .limit(6);

    const internalLinkContext = (existingPosts || [])
      .map(p => `- /blog/${p.slug}: "${p.title}" (keyword: ${p.keyword})`)
      .join("\n");

    // ------------------------------------------------------------------
    // STEP 3 — Generate content with Claude
    // ------------------------------------------------------------------
    const prompt = buildPrompt(keyword, internalLinkContext, relatedPillar ?? null);
    let rawContent = await ai(prompt, 2500);

    // ------------------------------------------------------------------
    // STEP 4 — Quality gate (first pass)
    // ------------------------------------------------------------------
    const { meta: metaFirst, cleanHtml: cleanHtmlFirst } = extractMeta(rawContent);
    let { score, details } = scorePost(cleanHtmlFirst, keyword);

    let finalHtml  = cleanHtmlFirst;
    let finalMeta  = metaFirst;
    let rewriteCount = 0;

    // ------------------------------------------------------------------
    // STEP 7 — Auto-rewrite logic
    // ------------------------------------------------------------------
    if (score === 5) {
      // Rewrite once
      rewriteCount = 1;
      const rewritePrompt = buildRewritePrompt(keyword, internalLinkContext, relatedPillar ?? null);
      const rewritten = await ai(rewritePrompt, 2500);
      const { meta: metaR, cleanHtml: cleanHtmlR } = extractMeta(rewritten);
      const reScored = scorePost(cleanHtmlR, keyword);
      if (reScored.score > score) {
        finalHtml = cleanHtmlR;
        finalMeta = metaR;
        score     = reScored.score;
        details   = reScored.details;
      } else {
        // Keep rewritten version but use original score path
        finalHtml = cleanHtmlR;
        finalMeta = metaR;
        // score stays at whatever reScored returned (may still be 5)
        score   = reScored.score;
        details = reScored.details;
      }
    } else if (score < 5) {
      // Keep first-pass content — status will be needs_review
    }
    // score 6-7 → keep first-pass as-is

    // Determine status
    let status: string;
    if (score >= 6) {
      status = "approved";
    } else if (score === 5) {
      status = "approved"; // approved after rewrite attempt
    } else {
      status = "needs_review";
    }

    // ------------------------------------------------------------------
    // STEP 5 — Generate slug
    // STEP 6 — Extract title
    // ------------------------------------------------------------------
    const slug  = makeSlug(keyword);
    const title = extractTitle(finalHtml, keyword);
    const wc    = wordCount(finalHtml);

    // ------------------------------------------------------------------
    // STEP 8 — Save to DB
    // ------------------------------------------------------------------
    const { error: upsertError } = await supabase.from("seo_posts").upsert({
      title,
      slug,
      keyword,
      keyword_type:       (keywordRow.source as string) || "general",
      content_html:       finalHtml,
      content_text:       finalHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      meta_description:   finalMeta,
      word_count:         wc,
      quality_score:      score,
      quality_details:    details,
      rewrite_count:      rewriteCount,
      status,
      updated_at:         new Date().toISOString(),
    }, { onConflict: "slug" });

    if (upsertError) {
      throw new Error(`DB upsert failed: ${upsertError.message}`);
    }

    // ------------------------------------------------------------------
    // STEP 9 — Update keyword queue (only for rows with a real id)
    // ------------------------------------------------------------------
    if (keywordRow.id) {
      await supabase
        .from("seo_keyword_queue")
        .update({ status: "assigned", post_id: null })
        .eq("id", keywordRow.id);
    }

    // ------------------------------------------------------------------
    // STEP 10 — Notify
    // ------------------------------------------------------------------
    if (status === "approved") {
      await sendTelegram(`✍️ Post written: "${title}" (score: ${score}/7) — ready to publish`);
    } else {
      await sendTelegram(`⚠️ Post needs review: "${title}" (score: ${score}/7) — check /roofing/seo`);
    }

    console.log(`seo-content-writer: done — "${title}" | slug: ${slug} | score: ${score}/7 | status: ${status} | words: ${wc}`);

    return Response.json(
      { ok: true, title, slug, quality_score: score, status, word_count: wc },
      { headers: CORS },
    );

  } catch (err) {
    console.error("seo-content-writer error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

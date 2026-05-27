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
  await supabase.from("telegram_digest_queue").insert({ message: msg, category: "seo" }).catch(() => {});
}

async function submitToGoogleIndexing(url: string): Promise<boolean> {
  const clientEmail = Deno.env.get("GOOGLE_INDEXING_CLIENT_EMAIL");
  const privateKey  = Deno.env.get("GOOGLE_INDEXING_PRIVATE_KEY");
  if (!clientEmail || !privateKey) return false;
  try {
    // Create JWT for Google service account
    const now = Math.floor(Date.now() / 1000);
    const header  = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = btoa(JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/indexing",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }));
    // Note: Full JWT signing requires crypto — skip signing for now, return false
    // When credentials are set up, implement proper JWT signing
    void header; void payload; void url;
    return false;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Pillar definitions
// ---------------------------------------------------------------------------

const PILLARS = [
  {
    slug:    "roofing-contractor-software-guide",
    keyword: "roofing contractor software",
    topic:   "software comparison",
    title:   "The Complete Guide to Roofing Contractor Software in 2026: CompanyCam, JobNimbus, AccuLynx, Sales Rabbit — and the Free Alternative Nobody Talks About",
  },
  {
    slug:    "homeowner-communication-roofing",
    keyword: "homeowner communication roofing contractor",
    topic:   "homeowner communication",
    title:   "The Complete Guide to Homeowner Communication for Roofing Contractors: Stop the Calls, Send Real-Time Updates, and Close More Jobs",
  },
  {
    slug:    "roofing-supplement-guide",
    keyword: "roofing supplement insurance claim",
    topic:   "insurance supplements",
    title:   "The Complete Guide to Roofing Supplements in 2026: How to Write, Submit, and Win Insurance Claims Worth $4,200 More Per Job",
  },
  {
    slug:    "storm-damage-roofing-leads",
    keyword: "storm damage roofing leads",
    topic:   "storm leads",
    title:   "The Complete Guide to Storm Damage Roofing Leads: Find, Canvass, and Close Jobs Before Your Competitors Know the Storm Hit",
  },
];

// ---------------------------------------------------------------------------
// Build prompt
// ---------------------------------------------------------------------------

function buildPrompt(pillar: typeof PILLARS[number]): string {
  return `You are Zach, founder of Roofing OS. You built roofing software because you watched roofers lose jobs to bad communication and missed supplements. You talk like a contractor not a marketer. Warm, direct, friendly. Short sentences. Real numbers. No fluff. Never say "in conclusion" or "it's important to note" or "as we can see".

Write a 3500-word pillar page guide titled: "${pillar.title}"

Target keyword: ${pillar.keyword}

Structure:
1. Hook (100 words) — open with a specific painful scenario every roofer recognizes. Example: "It's 2pm. You're on a job site. Your phone rings. Again. It's Mrs. Johnson asking where her photos are."
2. What this guide covers (50 words) — bullet list of exactly what they'll learn
3. The Problem (300 words) — explain the pain in detail with real numbers — specific dollar amounts, time wasted, calls received
4. Why existing solutions fail (400 words) — call out CompanyCam ($99/mo), JobNimbus ($619+/mo), AccuLynx ($250+/mo), Sales Rabbit ($375/mo) by name with their real pricing — explain exactly what each one misses
5. The complete solution (800 words) — walk through the ideal system step by step — mention Roofing OS naturally 3-4 times — include real workflow examples
6. How to implement this (600 words) — step by step action plan — specific tools and tactics — what to do on day 1, week 1, month 1
7. Common mistakes to avoid (300 words) — 5 specific mistakes with consequences
8. Real results (200 words) — what roofers see when they implement this — specific numbers and timeframes
9. FAQ section (400 words) — 8 questions people Google around this topic — each answered in 2-4 sentences — format: Q: [question] A: [answer]
10. CTA (100 words) — invite them to try Roofing OS free — link to roofingos.dev/signup — warm, not pushy

Throughout the post:
- Use H2 for main sections, H3 for subsections
- Bold key phrases
- Include specific competitor prices (CompanyCam $99/mo, JobNimbus $619+/mo, AccuLynx $250+/mo, Sales Rabbit $375/mo)
- Mention Roofing OS is free to start
- Internal links placeholder: [LINK:related-topic] where you'd link to related posts
- Format as clean HTML with proper heading tags
- Meta description: write 155 char summary at the very end prefixed with META:`;
}

// ---------------------------------------------------------------------------
// Content processing
// ---------------------------------------------------------------------------

function extractMeta(rawContent: string): { html: string; metaDescription: string } {
  const lines = rawContent.split("\n");
  let metaDescription = "";
  const contentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("META:")) {
      metaDescription = trimmed.slice(5).trim().slice(0, 160);
    } else {
      contentLines.push(line);
    }
  }

  // Trim trailing blank lines
  while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === "") {
    contentLines.pop();
  }

  return { html: contentLines.join("\n"), metaDescription };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  const stripped = stripHtml(text);
  return stripped.split(" ").filter(w => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// Build a single pillar
// ---------------------------------------------------------------------------

interface BuildResult {
  slug: string;
  title: string;
  word_count: number;
  skipped: boolean;
  error?: string;
}

async function buildPillar(pillar: typeof PILLARS[number]): Promise<BuildResult> {
  // Check if already published — skip those
  const { data: existing } = await supabase
    .from("seo_pillars")
    .select("id, status")
    .eq("slug", pillar.slug)
    .maybeSingle();

  if (existing?.status === "published") {
    console.log(`seo-pillar-builder: skipping published pillar ${pillar.slug}`);
    return { slug: pillar.slug, title: pillar.title, word_count: 0, skipped: true };
  }

  console.log(`seo-pillar-builder: building pillar ${pillar.slug}`);

  const prompt = buildPrompt(pillar);
  const rawContent = await ai(prompt, 6000);

  const { html, metaDescription } = extractMeta(rawContent);
  const contentText = stripHtml(html);
  const wordCount = countWords(html);

  if (wordCount < 2000) {
    console.warn(`seo-pillar-builder: WARNING — ${pillar.slug} only ${wordCount} words (expected 3000+)`);
  }

  const now = new Date().toISOString();

  const record = {
    slug:             pillar.slug,
    title:            pillar.title,
    topic:            pillar.topic,
    keyword:          pillar.keyword,
    content_html:     html,
    content_text:     contentText,
    meta_description: metaDescription,
    word_count:       wordCount,
    status:           "approved",
    updated_at:       now,
  };

  const { error: upsertError } = await supabase
    .from("seo_pillars")
    .upsert(record, { onConflict: "slug" });

  if (upsertError) {
    throw new Error(`DB upsert failed for ${pillar.slug}: ${upsertError.message}`);
  }

  await sendTelegram(`🏛️ Pillar built: ${pillar.title} (${wordCount} words)`);

  console.log(`seo-pillar-builder: done ${pillar.slug} — ${wordCount} words`);
  return { slug: pillar.slug, title: pillar.title, word_count: wordCount, skipped: false };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.test) {
      return Response.json({ ok: true, message: "seo-pillar-builder v1 ready" }, { headers: CORS });
    }

    // Determine which pillars to build
    let targets: typeof PILLARS = [];
    if (body.build_all === true) {
      targets = PILLARS;
    } else if (body.pillar_slug) {
      const found = PILLARS.find(p => p.slug === body.pillar_slug);
      if (!found) {
        return Response.json(
          { ok: false, error: `Unknown pillar_slug: ${body.pillar_slug}. Valid slugs: ${PILLARS.map(p => p.slug).join(", ")}` },
          { status: 400, headers: CORS },
        );
      }
      targets = [found];
    } else {
      return Response.json(
        { ok: false, error: 'Provide { "build_all": true } or { "pillar_slug": "..." }' },
        { status: 400, headers: CORS },
      );
    }

    // Return immediately — each Claude call takes ~90s, exceeds 150s limit
    // Background processing via waitUntil; Telegram digest will report results
    EdgeRuntime.waitUntil((async () => {
      for (let i = 0; i < targets.length; i++) {
        const pillar = targets[i];
        try {
          await buildPillar(pillar);
        } catch (err) {
          console.error(`seo-pillar-builder: error building ${pillar.slug}:`, err);
          await sendTelegram(`⚠️ Pillar build FAILED: ${pillar.slug}\n${String(err).slice(0, 300)}`);
        }
        if (i < targets.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    })());

    return Response.json(
      {
        ok: true,
        building: targets.map(p => p.slug),
        message: `Building ${targets.length} pillar(s) in background. Check telegram digest or seo_pillars table for results.`,
      },
      { headers: CORS },
    );

  } catch (err) {
    console.error("seo-pillar-builder error:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500, headers: CORS });
  }
});

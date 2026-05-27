#!/usr/bin/env node
/**
 * Roofing OS SEO Pillar Builder
 * Runs on VPS at /opt/roofing/seo/build-pillars.js
 *
 * Calls Anthropic API directly — no edge function timeout.
 * Each pillar takes 90-150s; 4 pillars = 6-10 minutes total.
 *
 * Usage:
 *   node /opt/roofing/seo/build-pillars.js             # build all pending pillars
 *   node /opt/roofing/seo/build-pillars.js <slug>      # build one specific pillar
 *
 * Run once manually to seed the table, then never again unless adding new pillars.
 */

const https = require('https');
const { execSync } = require('child_process');

require('dotenv').config({ path: '/opt/roofing/.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

// ── Pillar definitions (mirror of edge function) ──────────────────────────────

const PILLARS = [
  {
    slug:    'roofing-contractor-software-guide',
    keyword: 'roofing contractor software',
    topic:   'software comparison',
    title:   'The Complete Guide to Roofing Contractor Software in 2026: CompanyCam, JobNimbus, AccuLynx, Sales Rabbit — and the Free Alternative Nobody Talks About',
  },
  {
    slug:    'homeowner-communication-roofing',
    keyword: 'homeowner communication roofing contractor',
    topic:   'homeowner communication',
    title:   'The Complete Guide to Homeowner Communication for Roofing Contractors: Stop the Calls, Send Real-Time Updates, and Close More Jobs',
  },
  {
    slug:    'roofing-supplement-guide',
    keyword: 'roofing supplement insurance claim',
    topic:   'insurance supplements',
    title:   'The Complete Guide to Roofing Supplements in 2026: How to Write, Submit, and Win Insurance Claims Worth $4,200 More Per Job',
  },
  {
    slug:    'storm-damage-roofing-leads',
    keyword: 'storm damage roofing leads',
    topic:   'storm leads',
    title:   'The Complete Guide to Storm Damage Roofing Leads: Find, Canvass, and Close Jobs Before Your Competitors Know the Storm Hit',
  },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function supabaseHeaders() {
  return {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
}

async function supabaseGet(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const parsed = new URL(url);
  const { status, body } = await request(
    url,
    { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET', headers: supabaseHeaders() },
    null,
  );
  if (status >= 400) throw new Error(`Supabase GET ${path} → ${status}: ${body}`);
  return JSON.parse(body);
}

async function supabaseUpsert(table, record) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const parsed = new URL(url);
  const headers = {
    ...supabaseHeaders(),
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };
  const { status, body } = await request(
    url,
    { hostname: parsed.hostname, path: parsed.pathname, method: 'POST', headers },
    JSON.stringify(record),
  );
  if (status >= 400) throw new Error(`Supabase upsert ${table} → ${status}: ${body}`);
}

async function queueTelegram(message) {
  const url = `${SUPABASE_URL}/rest/v1/telegram_digest_queue`;
  const parsed = new URL(url);
  const { status, body } = await request(
    url,
    { hostname: parsed.hostname, path: parsed.pathname, method: 'POST', headers: supabaseHeaders() },
    JSON.stringify({ message, category: 'seo' }),
  );
  if (status >= 400) console.warn('Telegram queue failed:', body);
}

// ── Anthropic call ────────────────────────────────────────────────────────────

async function callClaude(prompt, maxTokens = 6000) {
  const url = 'https://api.anthropic.com/v1/messages';
  const parsed = new URL(url);

  const BASE_DELAYS = [15_000, 30_000, 60_000];
  let lastStatus = 0;
  let lastBody = '';

  for (let attempt = 0; attempt <= BASE_DELAYS.length; attempt++) {
    const { status, body } = await request(
      url,
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 300_000, // 5 min per call
      },
      JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    );

    lastStatus = status;
    lastBody = body;

    if (status !== 429) break;
    if (attempt === BASE_DELAYS.length) throw new Error('Rate limit exhausted');

    let wait = BASE_DELAYS[attempt];
    try {
      const errJson = JSON.parse(body);
      const retryAfter = errJson?.error?.retry_after;
      if (retryAfter) wait = Math.max(wait, retryAfter * 1000);
    } catch {}

    console.log(`  Rate limited — waiting ${wait / 1000}s before retry ${attempt + 1}...`);
    await sleep(wait);
  }

  if (lastStatus >= 400) throw new Error(`Anthropic ${lastStatus}: ${lastBody}`);

  const data = JSON.parse(lastBody);
  return data.content[0].text;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPrompt(pillar) {
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

// ── Content processing ────────────────────────────────────────────────────────

function extractMeta(rawContent) {
  const lines = rawContent.split('\n');
  let metaDescription = '';
  const contentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('META:')) {
      metaDescription = trimmed.slice(5).trim().slice(0, 160);
    } else {
      contentLines.push(line);
    }
  }

  while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === '') {
    contentLines.pop();
  }

  return { html: contentLines.join('\n'), metaDescription };
}

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(html) {
  return stripHtml(html).split(' ').filter(w => w.length > 0).length;
}

// ── Build one pillar ──────────────────────────────────────────────────────────

async function buildPillar(pillar) {
  // Skip if already published
  const existing = await supabaseGet(
    `seo_pillars?slug=eq.${encodeURIComponent(pillar.slug)}&select=id,status`,
  ).catch(() => []);

  if (existing.length > 0 && existing[0].status === 'published') {
    console.log(`  SKIP — already published`);
    return { skipped: true };
  }

  console.log(`  Calling Claude (this takes 90-150s)...`);
  const prompt = buildPrompt(pillar);
  const rawContent = await callClaude(prompt, 6000);

  const { html, metaDescription } = extractMeta(rawContent);
  const wordCount = countWords(html);
  const contentText = stripHtml(html);

  if (wordCount < 2000) {
    console.warn(`  WARNING — only ${wordCount} words (expected 3500+)`);
  } else {
    console.log(`  Generated ${wordCount} words`);
  }

  const now = new Date().toISOString();

  await supabaseUpsert('seo_pillars', {
    slug:             pillar.slug,
    title:            pillar.title,
    topic:            pillar.topic,
    keyword:          pillar.keyword,
    content_html:     html,
    content_text:     contentText,
    meta_description: metaDescription,
    word_count:       wordCount,
    status:           'approved',
    updated_at:       now,
  });

  console.log(`  Saved to DB ✓`);
  await queueTelegram(`🏛️ Pillar built: ${pillar.title} (${wordCount} words)`);
  return { skipped: false, wordCount };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const targetSlug = process.argv[2];

  let targets = PILLARS;
  if (targetSlug) {
    const found = PILLARS.find(p => p.slug === targetSlug);
    if (!found) {
      console.error(`Unknown slug: ${targetSlug}`);
      console.error(`Valid slugs: ${PILLARS.map(p => p.slug).join(', ')}`);
      process.exit(1);
    }
    targets = [found];
  }

  console.log(`\nRoofing OS Pillar Builder`);
  console.log(`Building ${targets.length} pillar(s)...\n`);

  let built = 0;
  let skipped = 0;
  let failed = 0;

  for (const pillar of targets) {
    console.log(`[${pillar.slug}]`);
    try {
      const result = await buildPillar(pillar);
      if (result.skipped) {
        skipped++;
      } else {
        built++;
        console.log(`  Done — ${result.wordCount} words\n`);
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${err.message}\n`);
      await queueTelegram(`⚠️ Pillar build FAILED: ${pillar.slug}\n${String(err).slice(0, 300)}`);
    }

    // Brief pause between pillars to avoid rate limits
    if (targets.indexOf(pillar) < targets.length - 1) {
      await sleep(3000);
    }
  }

  console.log(`\nDone. built=${built} skipped=${skipped} failed=${failed}`);

  if (built > 0) {
    await queueTelegram(`✅ Pillar build complete: ${built} built, ${skipped} skipped, ${failed} failed`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

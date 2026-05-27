#!/usr/bin/env node
/**
 * Roofing OS 100X SEO Content Generator
 * VPS path: /opt/roofing/seo/content-generator.js
 * pm2 name: content-generator
 * Schedule: 0 5 * * * (11pm MT = 05:00 UTC)
 *
 * Nightly build tasks:
 *   - 5 location pages (Haiku — templated, cheap)
 *   - 1 VS comparison page (Sonnet — high value)
 *   - 3 question posts via existing seo-content-writer
 *   - 1 free tool HTML (weekly, Sundays)
 *   - 5 homeowner posts (weekly, Sundays)
 *   - Update sitemap with all new pages
 *   - Git commit + push
 *   - Telegram digest
 */

'use strict';

require('dotenv').config({ path: '/opt/roofing/.env' });

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

// ── Config ─────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const REPO_PATH     = process.env.SEO_REPO_PATH || '/opt/roofing/repo/roofingos-landing';
const TG_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT       = process.env.TELEGRAM_CHAT_ID;

const HAIKU       = 'claude-haiku-4-5-20251001';
const SONNET      = 'claude-sonnet-4-6';
const GEMINI_KEY  = process.env.GEMINI_API_KEY;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── Supabase helpers ────────────────────────────────────────────────────────

function dbGet(resource) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
    const mod = url.protocol === 'https:' ? https : http;
    mod.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve([]); } });
    }).on('error', reject);
  });
}

function dbPatch(table, filter, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}?${filter}`);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      method: 'PATCH',
      path: url.pathname + url.search,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function dbPost(table, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      method: 'POST',
      path: url.pathname,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function tgDigest(msg) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: 'Markdown' });
    if (!TG_TOKEN || !TG_CHAT) return resolve();
    const url = new URL(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
    const req = https.request({
      hostname: url.hostname,
      method: 'POST',
      path: url.pathname,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

// ── AI helpers ──────────────────────────────────────────────────────────────

// Gemini Flash — free tier, used for location pages (saves ~$8/day)
// Falls back to Haiku if GEMINI_API_KEY not set
async function generateWithGemini(prompt) {
  if (!GEMINI_KEY) return askHaiku(prompt);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) throw new Error('Empty Gemini response');
    return text;
  } catch (err) {
    console.warn('  Gemini failed, falling back to Haiku:', err.message);
    return askHaiku(prompt);
  }
}

async function askHaiku(prompt) {
  const msg = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content[0].text;
}

async function askSonnet(prompt) {
  const msg = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });
  return msg.content[0].text;
}

// ── HTML page wrapper ────────────────────────────────────────────────────────

function wrapPage(title, meta, bodyHtml, canonical) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} | Roofing OS</title>
<meta name="description" content="${meta}">
<link rel="canonical" href="https://roofingos.dev${canonical}">
<meta property="og:title" content="${title} | Roofing OS">
<meta property="og:description" content="${meta}">
<meta property="og:url" content="https://roofingos.dev${canonical}">
<meta property="og:site_name" content="Roofing OS">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#0a0f1a;color:#f1f5f9;line-height:1.7}
a{color:#3b82f6;text-decoration:none}
a:hover{text-decoration:underline}
nav{position:sticky;top:0;z-index:100;background:rgba(10,15,26,.95);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.06);padding:0 24px}
.nav-inner{max-width:1100px;margin:0 auto;height:60px;display:flex;align-items:center;justify-content:space-between}
.nav-logo{font-size:17px;font-weight:800;color:#fff;letter-spacing:-.5px}
.nav-logo span{color:#3b82f6}
.nav-links{display:flex;align-items:center;gap:24px}
.nav-links a{font-size:14px;color:#94a3b8}
.nav-cta{background:#3b82f6;color:#fff !important;padding:8px 18px;border-radius:8px;font-weight:600;font-size:14px}
.nav-cta:hover{background:#2563eb;text-decoration:none !important}
.container{max-width:860px;margin:0 auto;padding:48px 24px}
h1{font-size:clamp(28px,5vw,42px);font-weight:800;line-height:1.15;color:#fff;margin-bottom:16px;letter-spacing:-.5px}
h2{font-size:24px;font-weight:700;color:#fff;margin:40px 0 16px}
h3{font-size:18px;font-weight:600;color:#e2e8f0;margin:28px 0 10px}
p{color:#94a3b8;margin-bottom:18px;font-size:16px}
ul,ol{margin:0 0 18px 24px;color:#94a3b8}
li{margin-bottom:8px;font-size:16px}
.hero-meta{font-size:13px;color:#64748b;margin-bottom:32px}
.cta-box{background:linear-gradient(135deg,rgba(59,130,246,.12),rgba(99,102,241,.12));border:1px solid rgba(59,130,246,.25);border-radius:16px;padding:36px;margin:48px 0;text-align:center}
.cta-box h2{margin:0 0 12px;font-size:22px}
.cta-box p{margin:0 0 24px;font-size:15px}
.btn{display:inline-block;background:#3b82f6;color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;font-size:16px;transition:background .2s}
.btn:hover{background:#2563eb;text-decoration:none}
.btn-ghost{background:transparent;border:1px solid rgba(255,255,255,.15);color:#94a3b8;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:500}
table{width:100%;border-collapse:collapse;margin:24px 0;font-size:14px}
th{text-align:left;padding:10px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid rgba(255,255,255,.08)}
td{padding:12px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,.05)}
td:first-child{color:#e2e8f0;font-weight:500}
.badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.badge-high{background:rgba(34,197,94,.15);color:#22c55e}
.badge-med{background:rgba(245,158,11,.15);color:#f59e0b}
.badge-low{background:rgba(100,116,139,.15);color:#64748b}
footer{margin-top:80px;border-top:1px solid rgba(255,255,255,.06);padding:32px 24px;text-align:center;font-size:13px;color:#475569}
footer a{color:#64748b;margin:0 12px}
</style>
</head>
<body>
<nav>
  <div class="nav-inner">
    <a href="/" class="nav-logo">Roofing<span>OS</span></a>
    <div class="nav-links">
      <a href="/">Home</a>
      <a href="/blog">Blog</a>
      <a href="/roofing/login">Sign in</a>
      <a href="https://app.nexuszc.com/roofing/signup" class="nav-cta">Start free →</a>
    </div>
  </div>
</nav>
${bodyHtml}
<footer>
  <p style="margin-bottom:12px">© 2026 Roofing OS · 1700 Lincoln St, Denver CO 80203</p>
  <a href="/plans">Plans</a>
  <a href="/blog">Blog</a>
  <a href="/roofing/login">Login</a>
  <a href="/privacy">Privacy</a>
  <a href="/terms">Terms</a>
</footer>
</body>
</html>`;
}

// ── TASK 1: Location pages ───────────────────────────────────────────────────

async function buildLocationPages(count = 5) {
  const rows = await dbGet(`seo_location_pages?status=eq.pending&order=population.desc&limit=${count}`);
  if (!rows || rows.length === 0) { console.log('Location pages: none pending'); return 0; }

  let built = 0;
  const dir = path.join(REPO_PATH, 'locations');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  for (const page of rows) {
    try {
      console.log(`  Building location page: ${page.city}, ${page.state_code}`);

      const prompt = `Write a 650-word page for roofing contractors in ${page.city}, ${page.state}.

Title: "Best Roofing Contractor Software in ${page.city}, ${page.state} (Free to Start)"

Write as clean HTML body content only (no <html>/<head>/<body> tags). Use: <h1>, <h2>, <h3>, <p>, <ul>/<li>.

Structure:
1. <h1> with the title above
2. Intro: roofing market in ${page.city} — hail frequency${page.hail_risk === 'high' ? ' (HIGH hail risk market)', insurance claim volume,' : ','} typical job values, local market size
3. <h2>Why ${page.city} Roofers Need Better Software</h2> — 3-4 pain points specific to this market
4. <h2>How Roofing OS Helps ${page.city} Contractors</h2> — homeowner portal, AI supplements, Aria voice, instant job docs
5. <h2>Features Most ${page.city} Contractors Use First</h2> — <ul> with 5 bullets
6. <h2>Get Started Free in ${page.city}</h2> — short close, mention free plan, link naturally to https://app.nexuszc.com/roofing/signup
7. <h2>FAQ</h2> with 3 questions specific to ${page.city}/${page.state} roofing

Population: ${page.population?.toLocaleString()}. Hail risk: ${page.hail_risk}.
Do NOT mention competitors by name. Do NOT include placeholder text.
End with: META_DESC: [155-character meta description]`;

      // PATCH 3: Gemini Flash for location pages (free tier, falls back to Haiku)
      const raw = await generateWithGemini(prompt);

      // Extract meta description
      const metaMatch = raw.match(/META_DESC:\s*(.+?)(\n|$)/);
      const metaDesc = metaMatch ? metaMatch[1].trim() : `Free roofing contractor software for ${page.city}, ${page.state}. Homeowner portal, AI supplements, Aria voice. Start free today.`;
      const bodyContent = raw.replace(/META_DESC:.+?(\n|$)/, '').trim();

      // PATCH 4: Geographic internal linking — find nearby cities (same state, published)
      let geoLinks = '';
      try {
        const nearby = await dbGet(
          `seo_location_pages?state_code=eq.${page.state_code}&status=eq.published&slug=neq.${page.slug}&select=city,state_code,slug&limit=3`,
        );
        if (nearby && nearby.length > 0) {
          const links = nearby.map(n =>
            `<a href="/locations/${n.slug}">${n.city}</a>`,
          ).join(' | ');
          geoLinks = `<div style="margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,.07);font-size:14px;color:#64748b">
  Also serving roofing contractors in: ${links}
</div>`;
        }
      } catch { /* skip geo links if query fails */ }

      const canonical = `/locations/${page.slug}`;
      const fullHtml = wrapPage(
        `Best Roofing Contractor Software in ${page.city}, ${page.state}`,
        metaDesc,
        `<div class="container">${bodyContent}<div class="cta-box"><h2>Start Free in ${page.city} Today</h2><p>Join roofing contractors across ${page.state} using Roofing OS. No credit card required.</p><a href="https://app.nexuszc.com/roofing/signup" class="btn">Start free →</a></div>${geoLinks}</div>`,
        canonical,
      );

      const filePath = path.join(dir, `${page.slug}.html`);
      fs.writeFileSync(filePath, fullHtml, 'utf8');

      await dbPatch('seo_location_pages', `slug=eq.${page.slug}`, {
        status: 'published',
        content_html: bodyContent,
        meta_description: metaDesc,
        published_at: new Date().toISOString(),
      });

      built++;
      console.log(`    ✓ ${page.slug}.html`);
    } catch (err) {
      console.error(`  Location page failed ${page.slug}:`, err.message);
    }
  }
  return built;
}

// ── TASK 2: VS comparison pages ─────────────────────────────────────────────

const VS_PRICING = {
  companycam: '$99/mo photos only',
  jobnimbus:  '$550/mo CRM',
  acculynx:   '$350/mo',
  salesrabbit: '$375/mo canvassing',
  eagleview:  '$150/report measurements',
  hover:      '$50/report',
};

async function buildVsPage() {
  const rows = await dbGet('seo_vs_pages?status=eq.pending&order=created_at.asc&limit=1');
  if (!rows || rows.length === 0) { console.log('VS pages: none pending'); return 0; }

  const page = rows[0];
  const competitorDisplay = page.competitor.charAt(0).toUpperCase() + page.competitor.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2');
  const pricing = VS_PRICING[page.competitor] || 'See website for pricing';

  try {
    console.log(`  Building VS page: ${page.slug}`);

    const prompt = `Write a detailed comparison page: "Roofing OS vs ${competitorDisplay}: Which Is Better for Roofing Contractors in 2026?"

You are Zach, founder of Roofing OS. Warm, direct, honest. Don't trash competitors unfairly.

Write as clean HTML only (no <html>/<head>/<body> tags). Use <h1>, <h2>, <p>, <ul>, <table>.

Structure (900 words):
1. <h1>Roofing OS vs ${competitorDisplay}: Which Is Better for Roofing Contractors?</h1>
2. Quick answer (50 words) — honest direct answer, who wins and for whom
3. <h2>${competitorDisplay}: What It Does and Who It's For</h2> — real overview, real pricing: ${pricing}
4. <h2>Roofing OS: What It Does and Who It's For</h2> — free to start, $149/mo Starter, $499/mo Pro
5. <h2>Feature Comparison</h2> — HTML table with 8-10 rows:
   <table><thead><tr><th>Feature</th><th>${competitorDisplay}</th><th>Roofing OS</th></tr></thead>
   Rows for: Price, Homeowner Portal, AI Supplement Help, Job Management, Team/Crew App, Insurance Claims, Canvassing Tools, Free Plan, Setup Time
6. <h2>When to Choose ${competitorDisplay}</h2> (be honest — 2-3 situations where they win)
7. <h2>When to Choose Roofing OS</h2>
8. <h2>Bottom Line</h2>
9. CTA paragraph linking to https://app.nexuszc.com/roofing/signup

${competitorDisplay} real pricing: ${pricing}
Roofing OS: Free to start, $149/mo Starter, $499/mo Pro

End with: META_DESC: [155-character meta description]`;

    const raw = await askSonnet(prompt);

    const metaMatch = raw.match(/META_DESC:\s*(.+?)(\n|$)/);
    const metaDesc = metaMatch ? metaMatch[1].trim() : `Roofing OS vs ${competitorDisplay} — honest comparison for roofing contractors. See features, pricing, and which tool fits your business.`;
    const bodyContent = raw.replace(/META_DESC:.+?(\n|$)/, '').trim();

    const dir = path.join(REPO_PATH, 'vs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const canonical = `/vs/${page.slug}`;
    const fullHtml = wrapPage(
      `Roofing OS vs ${competitorDisplay}`,
      metaDesc,
      `<div class="container">${bodyContent}<div class="cta-box"><h2>Try Roofing OS Free</h2><p>No credit card. Set up in 4 minutes. See why contractors switch.</p><a href="https://app.nexuszc.com/roofing/signup" class="btn">Start free →</a></div></div>`,
      canonical,
    );

    fs.writeFileSync(path.join(dir, `${page.slug}.html`), fullHtml, 'utf8');

    await dbPatch('seo_vs_pages', `slug=eq.${page.slug}`, {
      status: 'published',
      content_html: bodyContent,
      meta_description: metaDesc,
      published_at: new Date().toISOString(),
    });

    console.log(`    ✓ ${page.slug}.html`);
    return 1;
  } catch (err) {
    console.error(`  VS page failed ${page.slug}:`, err.message);
    return 0;
  }
}

// ── TASK 3: Question posts via Google Autocomplete ──────────────────────────

const QUESTION_SEEDS = [
  'roofing software', 'roofing contractor app', 'roof insurance claim',
  'supplement roofing', 'hail damage roof', 'roofing crm', 'homeowner portal roofing',
];

async function fetchQuestionsFromAutocomplete(seed) {
  const questions = [];
  const prefixes = ['how', 'what', 'why', 'when', 'does', 'can', 'is', 'should'];

  for (const prefix of prefixes.slice(0, 4)) {
    try {
      const query = encodeURIComponent(`${seed} ${prefix}`);
      const res = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${query}`,
        { signal: AbortSignal.timeout(5_000), headers: { 'User-Agent': 'Mozilla/5.0' } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      const suggestions = data[1] || [];
      for (const s of suggestions) {
        if (s.includes('?') || s.split(' ').length >= 4) questions.push(s);
      }
    } catch { /* skip */ }
  }
  return [...new Set(questions)];
}

function scoreQuestion(q) {
  let score = 0;
  const lower = q.toLowerCase();
  if (/\b(how|what|why|when|does|can|is)\b/.test(lower)) score += 4;
  if (/\b(roof|contractor|insurance|supplement|hail|claim|software|app)\b/.test(lower)) score += 5;
  if (/\b(best|free|cost|price|worth|good)\b/.test(lower)) score += 3;
  if (q.split(' ').length >= 5) score += 2;
  return score;
}

async function buildQuestionPosts(count = 3) {
  let queued = 0;

  // Try to fetch new questions
  const seed = QUESTION_SEEDS[Math.floor(Math.random() * QUESTION_SEEDS.length)];
  const rawQuestions = await fetchQuestionsFromAutocomplete(seed);

  const scored = rawQuestions
    .map(q => ({ question: q, score: scoreQuestion(q) }))
    .filter(q => q.score >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, count * 2);

  for (const { question, score } of scored) {
    try {
      await dbPost('seo_questions', {
        question,
        seed_keyword: seed,
        source: 'google_autocomplete',
        intent_score: score,
        audience: 'roofer',
        status: 'pending',
      });
      queued++;
    } catch { /* duplicate — skip */ }
    if (queued >= count) break;
  }

  // Queue top questions to keyword writer
  if (queued > 0) {
    for (const { question } of scored.slice(0, count)) {
      await dbPost('seo_keyword_queue', {
        keyword: question,
        source: 'alsoasked',
        intent_score: 14,
        status: 'pending',
      }).catch(() => {});
    }
  }

  console.log(`  Questions: ${queued} queued from seed "${seed}"`);
  return queued;
}

// ── TASK 4: Free tool — Supplement Checklist ─────────────────────────────────

const SUPPLEMENT_ITEMS = [
  { item: 'Drip edge (eave and rake)', value: 280 },
  { item: 'Ice & water shield (first 3 feet)', value: 420 },
  { item: 'Ice & water shield (valleys)', value: 340 },
  { item: 'Synthetic underlayment', value: 380 },
  { item: 'Ridge cap shingles', value: 290 },
  { item: 'High-nail starter strip', value: 180 },
  { item: 'Pipe jack flashings', value: 120 },
  { item: 'Step flashing (per chimney)', value: 340 },
  { item: 'Counter flashing', value: 280 },
  { item: 'Chimney cricket', value: 450 },
  { item: 'Ventilation: ridge vent', value: 310 },
  { item: 'Ventilation: off-ridge vents', value: 240 },
  { item: 'Gutters: removal & reset', value: 680 },
  { item: 'Gutter guards replacement', value: 420 },
  { item: 'Satellite dish: removal & reset', value: 180 },
  { item: 'Skylight flashing', value: 320 },
  { item: 'Caulking/sealant (all penetrations)', value: 160 },
  { item: 'O&P (overhead & profit) 20%', value: 0 },
  { item: 'Permit fees', value: 350 },
  { item: 'Dumpster/haul-away', value: 480 },
  { item: 'Decking: replace rotted sheathing (per sheet)', value: 120 },
  { item: 'Additional layers: tear-off 2nd layer', value: 580 },
  { item: 'Hip cap shingles', value: 220 },
  { item: 'Valley metal/open valley', value: 380 },
  { item: 'Steep slope labor (7/12+ pitch)', value: 640 },
  { item: 'Detach & reset solar panels', value: 1200 },
  { item: 'Detach & reset HVAC equipment', value: 280 },
  { item: 'Mansard or flat section', value: 820 },
  { item: 'Snow guard removal & reset', value: 240 },
  { item: 'Fascia board replacement (per LF)', value: 14 },
  { item: 'Soffit replacement (per SF)', value: 12 },
  { item: 'Lead flashing (where required)', value: 280 },
  { item: 'Code upgrade: egress window flashing', value: 380 },
  { item: 'Power washing (post-install)', value: 220 },
  { item: 'Landscaping protection/cleanup', value: 180 },
  { item: 'Nails through decking (extra fasteners)', value: 140 },
  { item: 'Peel & stick underlayment (full)', value: 680 },
  { item: 'High-wind fastener pattern (per code)', value: 320 },
  { item: 'Heat cable removal & reset', value: 460 },
  { item: 'Final inspection fee', value: 150 },
];

async function buildSupplementChecklist() {
  const dir = path.join(REPO_PATH, 'tools');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const itemsJs = JSON.stringify(SUPPLEMENT_ITEMS);
  const totalValue = SUPPLEMENT_ITEMS.filter(i => i.value > 0).reduce((s, i) => s + i.value, 0);

  const toolHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Roofing Supplement Checklist — Free Tool | Roofing OS</title>
<meta name="description" content="Complete checklist of 40 Xactimate line items adjusters miss. Check off what you found. See your potential recovery total. Free tool by Roofing OS.">
<link rel="canonical" href="https://roofingos.dev/tools/supplement-checklist">
<meta property="og:title" content="Free Roofing Supplement Checklist — 40 Items Adjusters Miss">
<meta property="og:description" content="Check off what you found on the job. Calculate your potential recovery total. Free tool by Roofing OS.">
<meta property="og:url" content="https://roofingos.dev/tools/supplement-checklist">
<meta property="og:site_name" content="Roofing OS">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;background:#0a0f1a;color:#f1f5f9;line-height:1.6}
nav{position:sticky;top:0;z-index:100;background:rgba(10,15,26,.95);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.06);padding:0 24px}
.nav-inner{max-width:1100px;margin:0 auto;height:60px;display:flex;align-items:center;justify-content:space-between}
.nav-logo{font-size:17px;font-weight:800;color:#fff;letter-spacing:-.5px}
.nav-logo span{color:#3b82f6}
.nav-cta{background:#3b82f6;color:#fff;padding:8px 18px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none}
.nav-cta:hover{background:#2563eb}
.container{max-width:760px;margin:0 auto;padding:48px 24px}
h1{font-size:clamp(26px,5vw,38px);font-weight:800;color:#fff;margin-bottom:12px;letter-spacing:-.5px}
.subtitle{font-size:17px;color:#94a3b8;margin-bottom:32px}
.progress-bar{background:#111827;border-radius:12px;height:8px;margin-bottom:8px;overflow:hidden}
.progress-fill{background:linear-gradient(90deg,#3b82f6,#22c55e);height:100%;border-radius:12px;transition:width .3s}
.progress-label{font-size:13px;color:#64748b;margin-bottom:32px}
.total-box{background:linear-gradient(135deg,rgba(59,130,246,.12),rgba(99,102,241,.12));border:1px solid rgba(59,130,246,.25);border-radius:16px;padding:28px 32px;margin-bottom:32px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
.total-label{font-size:14px;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}
.total-value{font-size:40px;font-weight:800;color:#22c55e;letter-spacing:-1px}
.total-note{font-size:12px;color:#64748b;margin-top:4px}
.items-list{display:flex;flex-direction:column;gap:8px;margin-bottom:40px}
.item{background:#111827;border:1px solid #1e293b;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;cursor:pointer;transition:border-color .15s}
.item:hover{border-color:#374151}
.item.checked{border-color:rgba(34,197,94,.4);background:rgba(34,197,94,.05)}
.item input[type=checkbox]{width:18px;height:18px;accent-color:#22c55e;cursor:pointer;flex-shrink:0}
.item-label{flex:1;font-size:15px;color:#d1d5db}
.item.checked .item-label{color:#f1f5f9}
.item-value{font-size:14px;font-weight:600;color:#64748b}
.item.checked .item-value{color:#22c55e}
.item-value.pct{color:#f59e0b;font-size:12px}
.actions{display:flex;gap:12px;margin-bottom:40px;flex-wrap:wrap}
.btn{display:inline-block;padding:12px 24px;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer;border:none;transition:background .2s}
.btn-primary{background:#3b82f6;color:#fff}
.btn-primary:hover{background:#2563eb}
.btn-ghost{background:transparent;border:1px solid rgba(255,255,255,.15);color:#94a3b8}
.btn-ghost:hover{border-color:#4b5563;color:#d1d5db}
.cta-box{background:linear-gradient(135deg,rgba(59,130,246,.1),rgba(99,102,241,.1));border:1px solid rgba(59,130,246,.2);border-radius:16px;padding:36px;text-align:center;margin-bottom:40px}
.cta-box h2{font-size:22px;font-weight:700;color:#fff;margin-bottom:10px}
.cta-box p{color:#94a3b8;margin-bottom:24px;font-size:15px}
.cta-btn{display:inline-block;background:#3b82f6;color:#fff;padding:14px 32px;border-radius:10px;font-weight:700;font-size:16px;text-decoration:none}
.cta-btn:hover{background:#2563eb}
footer{margin-top:40px;border-top:1px solid rgba(255,255,255,.06);padding:24px;text-align:center;font-size:13px;color:#475569}
footer a{color:#64748b;margin:0 10px}
.gate-overlay{position:fixed;inset:0;z-index:1000;background:rgba(10,15,26,.88);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px}
.gate-card{background:#111827;border:1px solid rgba(59,130,246,.3);border-radius:20px;padding:40px;max-width:420px;width:100%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.6)}
.gate-card h2{font-size:22px;font-weight:800;color:#fff;margin-bottom:10px}
.gate-card p{color:#94a3b8;font-size:15px;margin-bottom:24px}
.gate-input{width:100%;background:#0a0f1a;border:1px solid #1e293b;border-radius:10px;padding:14px 16px;font-size:15px;color:#f1f5f9;outline:none;margin-bottom:12px;font-family:inherit;box-sizing:border-box}
.gate-input:focus{border-color:#3b82f6}
.gate-submit{width:100%;background:#3b82f6;color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;transition:background .2s}
.gate-submit:hover{background:#2563eb}
.gate-submit:disabled{opacity:.6;cursor:not-allowed}
.gate-meta{font-size:12px;color:#475569;margin-top:12px}
</style>
</head>
<body>
<nav>
  <div class="nav-inner">
    <a href="/" class="nav-logo" style="text-decoration:none">Roofing<span>OS</span></a>
    <a href="https://app.nexuszc.com/roofing/signup" class="nav-cta">Start free →</a>
  </div>
</nav>
<div id="gateOverlay" class="gate-overlay">
  <div class="gate-card">
    <div style="font-size:36px;margin-bottom:16px">🛠️</div>
    <h2>Get the complete 40-item checklist</h2>
    <p>40 Xactimate line items adjusters routinely miss. Enter your email to unlock the full tool — free forever.</p>
    <form id="gateForm" onsubmit="unlockChecklist(event)">
      <input id="gateEmail" class="gate-input" type="email" placeholder="your@email.com" required autocomplete="email">
      <button class="gate-submit" type="submit" id="gateBtn">Get free checklist →</button>
    </form>
    <p class="gate-meta">No spam. Just roofing tools. <a href="/privacy" style="color:#475569">Privacy policy</a></p>
  </div>
</div>
<div class="container">
  <h1>Roofing Supplement Checklist</h1>
  <p class="subtitle">40 line items adjusters routinely miss. Check what you found. See your potential recovery total.</p>

  <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
  <p class="progress-label" id="progressLabel">0 of 40 items checked</p>

  <div class="total-box">
    <div>
      <div class="total-label">Potential Recovery</div>
      <div class="total-value" id="totalValue">$0</div>
      <div class="total-note">Based on typical Xactimate values · Your actual amounts may vary</div>
    </div>
    <div style="text-align:right">
      <div class="total-label">Items Found</div>
      <div style="font-size:32px;font-weight:800;color:#3b82f6" id="itemCount">0</div>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-ghost" onclick="checkAll()">Check all</button>
    <button class="btn btn-ghost" onclick="clearAll()">Clear all</button>
    <button class="btn btn-ghost" onclick="printList()">Print / save PDF</button>
  </div>

  <div class="items-list" id="itemsList"></div>

  <div class="cta-box">
    <h2>Track every supplement automatically.</h2>
    <p>Roofing OS logs every line item, flags adjuster denials, and generates rebuttal letters with AI. Free to start.</p>
    <a href="https://app.nexuszc.com/roofing/signup" class="cta-btn">Start free with Roofing OS →</a>
    <p style="font-size:12px;color:#475569;margin-top:12px">Generated by Roofing OS · roofingos.dev</p>
  </div>
</div>
<footer>
  <p style="margin-bottom:10px">© 2026 Roofing OS · Free tools for roofing contractors</p>
  <a href="/">Home</a>
  <a href="/tools">All Tools</a>
  <a href="/blog">Blog</a>
  <a href="/privacy">Privacy</a>
</footer>
<script>
const GATE_KEY = 'supplement_unlocked';
const LEAD_URL = 'https://koqpbnxkhgbsnbdjwldx.supabase.co/functions/v1/tool-lead-capture';

function initGate() {
  const overlay = document.getElementById('gateOverlay');
  if (!overlay) return;
  if (localStorage.getItem(GATE_KEY)) { overlay.remove(); return; }
  setTimeout(() => document.getElementById('gateEmail')?.focus(), 100);
}

async function unlockChecklist(e) {
  e.preventDefault();
  const email = (document.getElementById('gateEmail')?.value || '').trim();
  if (!email) return;
  const btn = document.getElementById('gateBtn');
  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  try {
    await fetch(LEAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tool_name: 'supplement-checklist' }),
    });
  } catch { /* fire and forget */ }
  localStorage.setItem(GATE_KEY, '1');
  document.getElementById('gateOverlay').remove();
}

initGate();

const ITEMS = ${itemsJs};
const STORAGE_KEY = 'supplement-checklist-v1';

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function render() {
  const state = loadState();
  const list = document.getElementById('itemsList');
  list.innerHTML = '';

  let total = 0, count = 0;
  ITEMS.forEach((item, i) => {
    const checked = !!state[i];
    if (checked) { count++; if (item.value > 0) total += item.value; }

    const div = document.createElement('div');
    div.className = 'item' + (checked ? ' checked' : '');
    div.onclick = () => toggle(i);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.onclick = e => { e.stopPropagation(); toggle(i); };

    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = item.item;

    const val = document.createElement('span');
    if (item.value === 0) {
      val.className = 'item-value pct';
      val.textContent = '20% O&P';
    } else {
      val.className = 'item-value';
      val.textContent = '\$' + item.value.toLocaleString();
    }

    div.appendChild(cb);
    div.appendChild(label);
    div.appendChild(val);
    list.appendChild(div);
  });

  document.getElementById('totalValue').textContent = '\$' + total.toLocaleString();
  document.getElementById('itemCount').textContent = count;
  document.getElementById('progressLabel').textContent = count + ' of ' + ITEMS.length + ' items checked';
  document.getElementById('progressFill').style.width = Math.round(count / ITEMS.length * 100) + '%';
}

function toggle(i) {
  const state = loadState();
  state[i] = !state[i];
  saveState(state);
  render();
}

function checkAll() {
  const state = {};
  ITEMS.forEach((_, i) => state[i] = true);
  saveState(state);
  render();
}

function clearAll() {
  if (!confirm('Clear all checkboxes?')) return;
  saveState({});
  render();
}

function printList() { window.print(); }

render();
</script>
</body>
</html>`;

  fs.writeFileSync(path.join(dir, 'supplement-checklist.html'), toolHtml, 'utf8');

  await dbPatch('seo_tools', 'slug=eq.supplement-checklist', {
    status: 'published',
    content_html: toolHtml,
  });

  console.log('    ✓ supplement-checklist.html');
  return 1;
}

// ── TASK 5: Homeowner education posts ───────────────────────────────────────

const HOMEOWNER_SEEDS = [
  { keyword: 'what to expect during roof replacement', audience: 'homeowner' },
  { keyword: 'how long does roof replacement take', audience: 'homeowner' },
  { keyword: 'questions to ask roofing contractor', audience: 'homeowner' },
  { keyword: 'roof insurance claim process step by step', audience: 'homeowner' },
  { keyword: 'how to read a roofing estimate', audience: 'homeowner' },
  { keyword: 'hail damage roof signs', audience: 'homeowner' },
  { keyword: 'roof replacement cost homeowner guide', audience: 'homeowner' },
  { keyword: 'what is roof supplement insurance', audience: 'homeowner' },
  { keyword: 'how to choose roofing contractor', audience: 'homeowner' },
  { keyword: 'roof warranty what does it cover', audience: 'homeowner' },
];

async function buildHomeownerPosts(count = 5) {
  const dir = path.join(REPO_PATH, 'homeowners');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let built = 0;
  // Pick seeds that haven't been written yet
  const existing = await dbGet('seo_posts?keyword=ilike.%homeowner%&select=keyword&limit=50').catch(() => []);
  const existingKeywords = new Set((existing || []).map(p => p.keyword?.toLowerCase()));

  const seeds = HOMEOWNER_SEEDS.filter(s => !existingKeywords.has(s.keyword.toLowerCase())).slice(0, count);
  if (seeds.length === 0) { console.log('Homeowner posts: none needed'); return 0; }

  for (const seed of seeds) {
    try {
      console.log(`  Building homeowner post: ${seed.keyword}`);

      const slug = seed.keyword.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

      const prompt = `Write a 700-word homeowner-focused article about: "${seed.keyword}"

The reader is a homeowner — not a roofer. Write clearly, simply, helpfully.
You work at Roofing OS (roofingos.dev) — mention it naturally at the end as the software their contractor uses.

Write as clean HTML only (no <html>/<head>/<body> tags). Use <h1>, <h2>, <p>, <ul>/<li>.

Structure:
1. <h1> — compelling title based on the keyword
2. Quick 2-sentence intro that acknowledges the homeowner's situation
3. 4-5 <h2> sections covering the topic thoroughly
4. Practical tips in <ul> lists where relevant
5. Closing <p> mentioning that Roofing OS helps your contractor keep you informed throughout — link to https://roofingos.dev

End with: META_DESC: [155-character meta description]`;

      const raw = await askHaiku(prompt);
      const metaMatch = raw.match(/META_DESC:\s*(.+?)(\n|$)/);
      const metaDesc = metaMatch ? metaMatch[1].trim() : `Homeowner guide: ${seed.keyword}. Everything you need to know before, during, and after your roof replacement.`;
      const bodyContent = raw.replace(/META_DESC:.+?(\n|$)/, '').trim();

      const canonical = `/homeowners/${slug}`;
      const fullHtml = wrapPage(
        seed.keyword.charAt(0).toUpperCase() + seed.keyword.slice(1),
        metaDesc,
        `<div class="container">${bodyContent}<div class="cta-box"><h2>Is your contractor using Roofing OS?</h2><p>Roofing OS keeps homeowners informed with real-time updates, photo documentation, and direct messaging — throughout your entire project.</p><a href="https://roofingos.dev" class="btn">Learn more →</a></div></div>`,
        canonical,
      );

      fs.writeFileSync(path.join(dir, `${slug}.html`), fullHtml, 'utf8');

      // Log to seo_posts
      await dbPost('seo_posts', {
        title: bodyContent.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1] || seed.keyword,
        slug,
        keyword: seed.keyword,
        content_html: bodyContent,
        meta_description: metaDesc,
        status: 'published',
        published_at: new Date().toISOString(),
        word_count: bodyContent.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
      }).catch(() => {});

      built++;
      console.log(`    ✓ homeowners/${slug}.html`);
    } catch (err) {
      console.error(`  Homeowner post failed ${seed.keyword}:`, err.message);
    }
  }
  return built;
}

// ── Sitemap update ───────────────────────────────────────────────────────────

function updateSitemap() {
  const today = new Date().toISOString().split('T')[0];
  const base = 'https://roofingos.dev';
  const urls = [];

  function walkDir(dir, basePath) {
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walkDir(full, basePath + '/' + file);
      } else if (file.endsWith('.html') && !file.startsWith('_')) {
        const rel = basePath + '/' + file;
        const slug = rel.replace('/index.html', '/').replace('.html', '');

        let priority = '0.6';
        if (slug === '/') priority = '1.0';
        else if (slug.startsWith('/vs/')) priority = '0.9';
        else if (slug.startsWith('/locations/') && slug !== '/locations/') priority = '0.8';
        else if (slug.startsWith('/plans/')) priority = '0.8';
        else if (slug.startsWith('/tools/') && slug !== '/tools/') priority = '0.8';
        else if (slug.startsWith('/blog/')) priority = '0.7';
        else if (slug.startsWith('/homeowners/') && slug !== '/homeowners/') priority = '0.7';

        urls.push({ slug, priority });
      }
    }
  }

  walkDir(REPO_PATH, '');

  urls.sort((a, b) => parseFloat(b.priority) - parseFloat(a.priority));

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const { slug, priority } of urls) {
    xml += `  <url>\n    <loc>${base}${slug}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n  </url>\n`;
  }
  xml += '</urlset>';

  fs.writeFileSync(path.join(REPO_PATH, 'sitemap.xml'), xml, 'utf8');
  console.log(`  Sitemap: ${urls.length} URLs`);
  return urls.length;
}

// ── Git commit + push ────────────────────────────────────────────────────────

function gitCommit(summary) {
  try {
    execSync('git config user.email "vps@roofingos.dev"', { cwd: REPO_PATH, stdio: 'ignore' });
    execSync('git config user.name "Roofing OS SEO Bot"', { cwd: REPO_PATH, stdio: 'ignore' });
    execSync('git add -A', { cwd: REPO_PATH });
    const diff = execSync('git diff --cached --name-only', { cwd: REPO_PATH }).toString().trim();
    if (!diff) { console.log('  Git: no changes to commit'); return false; }
    execSync(`git commit -m "${summary}"`, { cwd: REPO_PATH });
    execSync('git push origin main', { cwd: REPO_PATH });
    console.log('  Git: committed and pushed');
    return true;
  } catch (err) {
    console.error('  Git error:', err.message);
    return false;
  }
}

// ── Main nightly run ─────────────────────────────────────────────────────────

async function run() {
  const start = Date.now();
  const dayOfWeek = new Date().getDay(); // 0=Sun
  console.log(`\n=== Content Generator starting — ${new Date().toISOString()} ===`);

  const results = { location_pages: 0, vs_pages: 0, questions: 0, tools: 0, homeowner_posts: 0 };

  // Task 1: Location pages (5/night)
  console.log('\n[Task 1] Location pages:');
  results.location_pages = await buildLocationPages(5);

  // Task 2: VS page (1/night)
  console.log('\n[Task 2] VS comparison page:');
  results.vs_pages = await buildVsPage();

  // Task 3: Question posts (3/night)
  console.log('\n[Task 3] Question posts:');
  results.questions = await buildQuestionPosts(3);

  // Weekly tasks (Sunday only)
  if (dayOfWeek === 0) {
    console.log('\n[Task 4] Free tool (weekly):');
    results.tools = await buildSupplementChecklist();

    console.log('\n[Task 5] Homeowner posts (weekly):');
    results.homeowner_posts = await buildHomeownerPosts(5);
  }

  // Update sitemap
  console.log('\n[Sitemap]');
  const sitemapUrls = updateSitemap();

  // Git
  const summary = [
    `SEO nightly build ${new Date().toISOString().split('T')[0]}:`,
    `${results.location_pages} locations, ${results.vs_pages} VS pages, ${results.questions} questions`,
    results.tools ? `${results.tools} tools, ${results.homeowner_posts} homeowner posts,` : '',
    `${sitemapUrls} sitemap URLs`,
  ].filter(Boolean).join(' ');

  gitCommit(summary);

  const elapsed = Math.round((Date.now() - start) / 1000);
  const msg = [
    `🏗️ *SEO Nightly Build Complete* (${elapsed}s)`,
    `Location pages: ${results.location_pages}/5`,
    `VS pages: ${results.vs_pages}/1`,
    `Questions queued: ${results.questions}`,
    dayOfWeek === 0 ? `Free tool: ${results.tools ? '✓' : '—'} · Homeowner posts: ${results.homeowner_posts}` : null,
    `Sitemap: ${sitemapUrls} URLs indexed`,
  ].filter(Boolean).join('\n');

  await tgDigest(msg);
  console.log(`\n=== Done in ${elapsed}s ===`);
  console.log(msg);
}

run().catch(err => {
  console.error('Content generator fatal error:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Roofing OS SEO Publisher
 * Runs on VPS at /opt/roofing/seo/publisher.js
 * pm2 name: seo-publisher
 * Schedule: 0 14 * * * (2pm UTC = 8am MT, after content-writer cron at 12pm UTC)
 *
 * Pulls approved posts from DB → writes HTML files → git commit + push
 * Cloudflare Pages auto-deploys from GitHub main branch
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: '/opt/roofing/.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPO_PATH = process.env.SEO_REPO_PATH || '/opt/roofing/roofingos-landing';
const BLOG_DIR = path.join(REPO_PATH, 'blog');
const TEMPLATE_PATH = path.join(BLOG_DIR, '_template.html');

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function supabaseGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve([]); }
      });
    });
    req.on('error', reject);
  });
}

function supabasePatch(table, id, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`);
    const payload = JSON.stringify(body);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      method: 'PATCH',
      path: url.pathname + url.search,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
        'Content-Length': Buffer.byteLength(payload),
      }
    }, res => {
      res.resume();
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendTelegram(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return Promise.resolve();
  const payload = JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4000), parse_mode: 'Markdown' });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.telegram.org',
      method: 'POST',
      path: `/bot${token}/sendMessage`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(payload);
    req.end();
  });
}

// ── Template rendering ────────────────────────────────────────────────────────

function categoryFromKeyword(keyword) {
  const kw = keyword.toLowerCase();
  if (kw.includes('supplement') || kw.includes('insurance') || kw.includes('adjuster')) return 'Supplement AI';
  if (kw.includes('homeowner') || kw.includes('portal') || kw.includes('communication')) return 'Homeowner Portal';
  if (kw.includes('lead') || kw.includes('storm') || kw.includes('canvass')) return 'Lead Generation';
  if (kw.includes('software') || kw.includes('crm') || kw.includes('alternative')) return 'Roofing Software';
  return 'Roofing Business';
}

function estimateReadTime(wordCount) {
  return Math.max(3, Math.round(wordCount / 225));
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function buildSchemaJson(post, publishedDate) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.meta_description,
    author: { '@type': 'Person', name: 'Zach Curtis', url: 'https://roofingos.dev' },
    publisher: {
      '@type': 'Organization',
      name: 'Roofing OS',
      logo: { '@type': 'ImageObject', url: 'https://roofingos.dev/og-image.png' }
    },
    datePublished: publishedDate,
    dateModified: post.updated_at || publishedDate,
    mainEntityOfPage: { '@type': 'WebPage', '@id': `https://roofingos.dev/blog/${post.slug}` },
    wordCount: post.word_count,
    articleSection: categoryFromKeyword(post.keyword || ''),
  });
}

function buildRelatedHtml(relatedPosts) {
  if (!relatedPosts || relatedPosts.length === 0) return '';
  const cards = relatedPosts.map(p => `
      <a href="/blog/${p.slug}" class="related-card">
        <div class="related-card-title">${escapeHtml(p.title)}</div>
        <div class="related-card-meta">Roofing OS</div>
      </a>`).join('');
  return `
    <div class="related-posts">
      <h3>Related Articles</h3>
      <div class="related-grid">${cards}
      </div>
    </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPost(template, post, relatedPosts) {
  const publishedDate = post.published_at || new Date().toISOString();
  const readTime = estimateReadTime(post.word_count || 800);
  const category = categoryFromKeyword(post.keyword || '');

  return template
    .replace(/\{\{TITLE\}\}/g, escapeHtml(post.title))
    .replace(/\{\{META_DESCRIPTION\}\}/g, escapeHtml(post.meta_description || ''))
    .replace(/\{\{SLUG\}\}/g, post.slug)
    .replace(/\{\{KEYWORD\}\}/g, escapeHtml(post.keyword || ''))
    .replace(/\{\{CONTENT_HTML\}\}/g, post.content_html || '')
    .replace(/\{\{PUBLISHED_DATE\}\}/g, formatDate(publishedDate))
    .replace(/\{\{READ_TIME\}\}/g, String(readTime))
    .replace(/\{\{CATEGORY_LABEL\}\}/g, category)
    .replace(/\{\{SCHEMA_JSON\}\}/g, buildSchemaJson(post, publishedDate))
    .replace(/\{\{RELATED_POSTS_HTML\}\}/g, buildRelatedHtml(relatedPosts));
}

// ── Pillar rendering ──────────────────────────────────────────────────────────

function renderPillar(template, pillar) {
  const publishedDate = pillar.published_at || new Date().toISOString();
  const readTime = estimateReadTime(pillar.word_count || 3500);

  return template
    .replace(/\{\{TITLE\}\}/g, escapeHtml(pillar.title))
    .replace(/\{\{META_DESCRIPTION\}\}/g, escapeHtml(pillar.meta_description || ''))
    .replace(/\{\{SLUG\}\}/g, pillar.slug)
    .replace(/\{\{KEYWORD\}\}/g, escapeHtml(pillar.keyword || ''))
    .replace(/\{\{CONTENT_HTML\}\}/g, pillar.content_html || '')
    .replace(/\{\{PUBLISHED_DATE\}\}/g, formatDate(publishedDate))
    .replace(/\{\{READ_TIME\}\}/g, String(readTime))
    .replace(/\{\{CATEGORY_LABEL\}\}/g, 'Complete Guide')
    .replace(/\{\{SCHEMA_JSON\}\}/g, buildSchemaJson(pillar, publishedDate))
    .replace(/\{\{RELATED_POSTS_HTML\}\}/g, '');
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function git(cmd) {
  return execSync(cmd, { cwd: REPO_PATH, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function gitSetup() {
  try {
    git('git config user.email "zach@roofingos.dev"');
    git('git config user.name "Roofing OS SEO Publisher"');
  } catch { /* already set */ }
}

function gitPullLatest() {
  try {
    git('git pull origin main --rebase --autostash');
  } catch (e) {
    console.warn('git pull warning:', e.message);
  }
}

// ── Sitemap update ────────────────────────────────────────────────────────────

async function updateSitemap(newSlugs) {
  const sitemapPath = path.join(REPO_PATH, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) return;

  let xml = fs.readFileSync(sitemapPath, 'utf8');
  const today = new Date().toISOString().split('T')[0];

  for (const slug of newSlugs) {
    const url = `https://roofingos.dev/blog/${slug}`;
    if (xml.includes(url)) continue;
    const entry = `  <url>\n    <loc>${url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    xml = xml.replace('</urlset>', `${entry}\n</urlset>`);
  }

  fs.writeFileSync(sitemapPath, xml);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[seo-publisher] Starting — ${new Date().toISOString()}`);

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error('[seo-publisher] Template not found:', TEMPLATE_PATH);
    process.exit(1);
  }
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  if (!fs.existsSync(BLOG_DIR)) {
    fs.mkdirSync(BLOG_DIR, { recursive: true });
  }

  // Pull approved posts not yet published
  const posts = await supabaseGet(
    `seo_posts?status=eq.approved&google_indexed=is.false&order=created_at.asc&limit=20&select=*`
  );

  // Pull approved pillars not yet published
  const pillars = await supabaseGet(
    `seo_pillars?status=eq.approved&published_at=is.null&order=created_at.asc&limit=5&select=*`
  );

  const total = (Array.isArray(posts) ? posts.length : 0) + (Array.isArray(pillars) ? pillars.length : 0);
  if (total === 0) {
    console.log('[seo-publisher] Nothing to publish.');
    return;
  }

  gitSetup();
  gitPullLatest();

  const published = [];
  const failed = [];
  const newSlugs = [];

  // Publish posts
  if (Array.isArray(posts)) {
    for (const post of posts) {
      try {
        // Fetch a few related posts for the sidebar
        const related = await supabaseGet(
          `seo_posts?status=eq.published&slug=neq.${post.slug}&limit=3&select=slug,title`
        );

        const html = renderPost(template, post, Array.isArray(related) ? related : []);
        const filePath = path.join(BLOG_DIR, `${post.slug}.html`);
        fs.writeFileSync(filePath, html, 'utf8');

        const now = new Date().toISOString();
        await supabasePatch('seo_posts', post.id, {
          status: 'published',
          published_at: now,
          updated_at: now,
        });

        newSlugs.push(post.slug);
        published.push(post.title);
        console.log(`[seo-publisher] Published post: ${post.slug}`);
      } catch (e) {
        failed.push(`${post.slug}: ${e.message}`);
        console.error(`[seo-publisher] Failed post ${post.slug}:`, e.message);
      }
    }
  }

  // Publish pillars (go in /blog/ same as posts)
  if (Array.isArray(pillars)) {
    for (const pillar of pillars) {
      try {
        const html = renderPillar(template, pillar);
        const filePath = path.join(BLOG_DIR, `${pillar.slug}.html`);
        fs.writeFileSync(filePath, html, 'utf8');

        const now = new Date().toISOString();
        await supabasePatch('seo_pillars', pillar.id, {
          status: 'published',
          published_at: now,
        });

        newSlugs.push(pillar.slug);
        published.push(`[PILLAR] ${pillar.title}`);
        console.log(`[seo-publisher] Published pillar: ${pillar.slug}`);
      } catch (e) {
        failed.push(`pillar/${pillar.slug}: ${e.message}`);
        console.error(`[seo-publisher] Failed pillar ${pillar.slug}:`, e.message);
      }
    }
  }

  if (newSlugs.length === 0) {
    console.log('[seo-publisher] All posts failed. Nothing to commit.');
    return;
  }

  // Update sitemap
  await updateSitemap(newSlugs);

  // Git commit + push
  try {
    git('git add blog/ sitemap.xml');
    const msg = `seo: publish ${newSlugs.length} post${newSlugs.length > 1 ? 's' : ''} [${newSlugs.slice(0,3).join(', ')}${newSlugs.length > 3 ? '...' : ''}]`;
    git(`git commit -m "${msg}"`);
    git('git push origin main');
    console.log(`[seo-publisher] Pushed ${newSlugs.length} files to GitHub.`);
  } catch (e) {
    console.error('[seo-publisher] Git push failed:', e.message);
    failed.push(`git: ${e.message}`);
  }

  // Telegram summary
  const lines = [
    `📝 *SEO Publisher — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}*`,
    `Published: ${published.length}`,
    ...published.map(t => `  ✓ ${t.slice(0, 60)}`),
  ];
  if (failed.length > 0) {
    lines.push(`\nFailed: ${failed.length}`);
    lines.push(...failed.map(f => `  ✗ ${f.slice(0, 60)}`));
  }
  lines.push(`\nSite updates live in ~2min via Cloudflare Pages.`);
  await sendTelegram(lines.join('\n'));

  console.log(`[seo-publisher] Done. Published: ${published.length}, Failed: ${failed.length}`);
}

main().catch(e => {
  console.error('[seo-publisher] Fatal:', e);
  process.exit(1);
});

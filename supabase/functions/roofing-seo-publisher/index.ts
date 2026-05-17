// roofing-seo-publisher
// Publishes approved blog posts to roofingos.dev/blog via GitHub commit
// Triggered when content is approved (approve content [id] command)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const GITHUB_REPO = "nexuszc/nexus-zc";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(.+)$/gm, (m) => m.startsWith("<") ? m : m);
}

function generateBlogHtml(title: string, body: string, slug: string, publishedAt: string): string {
  const bodyHtml = markdownToHtml(body);
  const dateStr = new Date(publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Roofing OS Blog</title>
  <meta name="description" content="${title}. Expert roofing contractor insights from Roofing OS.">
  <meta property="og:title" content="${title}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://roofingos.dev/blog/${slug}">
  <meta property="og:site_name" content="Roofing OS">
  <link rel="canonical" href="https://roofingos.dev/blog/${slug}">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1e293b; background: #fff; line-height: 1.7; }
    .header { background: #0f172a; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
    .header a { color: #fff; text-decoration: none; font-weight: 700; font-size: 18px; }
    .header .cta { background: #3b82f6; color: #fff; padding: 8px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; }
    .hero { background: #0f172a; color: #fff; padding: 60px 24px 40px; text-align: center; }
    .hero h1 { font-size: clamp(24px, 4vw, 40px); font-weight: 800; letter-spacing: -0.02em; max-width: 800px; margin: 0 auto 16px; }
    .hero .meta { color: #94a3b8; font-size: 14px; }
    .content { max-width: 740px; margin: 0 auto; padding: 48px 24px 80px; }
    .content h1, .content h2 { font-size: 1.5em; font-weight: 700; margin: 2em 0 0.75em; color: #0f172a; }
    .content h3 { font-size: 1.2em; font-weight: 600; margin: 1.5em 0 0.5em; }
    .content p { margin-bottom: 1.2em; }
    .content strong { color: #0f172a; }
    .cta-block { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 32px; text-align: center; margin: 40px 0; }
    .cta-block h3 { color: #1d4ed8; margin-bottom: 8px; font-size: 1.3em; }
    .cta-block p { color: #374151; margin-bottom: 20px; }
    .cta-block a { background: #2563eb; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; display: inline-block; }
    .footer { background: #0f172a; color: #64748b; text-align: center; padding: 24px; font-size: 13px; }
    .footer a { color: #94a3b8; }
  </style>
</head>
<body>
  <header class="header">
    <a href="/">Roofing OS</a>
    <a href="/#signup" class="cta">Try Free →</a>
  </header>
  <div class="hero">
    <h1>${title}</h1>
    <div class="meta">Published ${dateStr} · Roofing OS Blog</div>
  </div>
  <main class="content">
    <p>${bodyHtml}</p>
    <div class="cta-block">
      <h3>Ready to Recover More Supplement Revenue?</h3>
      <p>Roofing OS automatically documents damage, generates supplement packages, and sends your homeowners a live portal — all in one click.</p>
      <a href="https://roofingos.dev/#signup">Start Free 14-Day Trial →</a>
    </div>
  </main>
  <footer class="footer">
    © ${new Date().getFullYear()} Roofing OS · <a href="https://roofingos.dev">roofingos.dev</a>
  </footer>
</body>
</html>`;
}

async function getExistingFile(path: string): Promise<{ sha: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=main`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { sha: data.sha };
  } catch {
    return null;
  }
}

async function commitToGitHub(path: string, content: string, message: string): Promise<string> {
  const existing = await getExistingFile(path);
  const encoded = btoa(unescape(encodeURIComponent(content)));

  const payload: any = {
    message,
    content: encoded,
    branch: "main"
  };
  if (existing) payload.sha = existing.sha;

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub commit failed: ${res.status} — ${err}`);
  }

  return `https://roofingos.dev/blog/${path.split("/").pop()?.replace(".html", "")}`;
}

async function updateBlogIndex(newEntries: Array<{ title: string; slug: string; date: string }>) {
  // Read existing index or create fresh
  let existingEntries: Array<{ title: string; slug: string; date: string }> = [];

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/roofingos-landing/blog/index.json?ref=main`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" }
    });
    if (res.ok) {
      const data = await res.json();
      const decoded = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
      existingEntries = JSON.parse(decoded);
    }
  } catch { /* no existing index */ }

  const merged = [...newEntries, ...existingEntries]
    .filter((e, i, arr) => arr.findIndex(x => x.slug === e.slug) === i)
    .slice(0, 100);

  await commitToGitHub(
    "roofingos-landing/blog/index.json",
    JSON.stringify(merged, null, 2),
    "Blog: update index"
  );
}

async function submitToSearchConsole(url: string) {
  const GSC_KEY = Deno.env.get("GOOGLE_SEARCH_CONSOLE_KEY");
  if (!GSC_KEY) return;

  try {
    await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent("https://roofingos.dev")}/sitemaps/${encodeURIComponent(url)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${GSC_KEY}` }
    });
  } catch { /* GSC optional */ }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-seo-publisher ready" });

  const { content_id } = body;

  if (!content_id) {
    return Response.json({ error: "content_id required" }, { status: 400 });
  }

  const startMs = Date.now();

  try {
    const { data: content } = await supabase
      .from("roofing_content")
      .select("*")
      .eq("id", content_id)
      .eq("type", "blog")
      .single();

    if (!content) {
      return Response.json({ error: "Blog content not found" }, { status: 404 });
    }

    if (content.status === "published") {
      return Response.json({ ok: true, message: "Already published", url: content.published_url });
    }

    const publishedAt = new Date().toISOString();
    const slug = slugify(content.title || "roofing-guide");
    const html = generateBlogHtml(content.title || "Roofing Guide", content.body, slug, publishedAt);
    const path = `roofingos-landing/blog/${slug}.html`;

    const publishedUrl = await commitToGitHub(
      path,
      html,
      `Blog: "${content.title?.slice(0, 60)}"`
    );

    // Update blog index
    await updateBlogIndex([{
      title: content.title || "Roofing Guide",
      slug,
      date: publishedAt.split("T")[0]
    }]);

    // Mark as published
    await supabase.from("roofing_content")
      .update({ status: "published", published_at: publishedAt, published_url: publishedUrl })
      .eq("id", content_id);

    // Submit to Google Search Console
    await submitToSearchConsole(publishedUrl);

    const duration = Date.now() - startMs;

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-seo-publisher",
      status: "ok",
      response_ms: duration,
      checked_at: new Date().toISOString()
    }).catch(() => {});

    // MOVED_TO_DASHBOARD [date: 2026-05-17]: published blog posts visible in Content tab (roofing_content.published_url set)
    // await tg(`🚀 *Blog Post Published*\n*${content.title}*\n🔗 ${publishedUrl}\n_Deployed to roofingos.dev/blog — Google indexing submitted_`);

    return Response.json({ ok: true, published_url: publishedUrl, slug, duration_ms: duration });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-seo-publisher",
      status: "error",
      error_message: msg,
      checked_at: new Date().toISOString()
    }).catch(() => {});
    await tg(`❌ *SEO Publisher Error*\n${msg}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

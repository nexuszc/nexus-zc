// roofing-youtube-publisher v1
// Approved youtube_scripts → ElevenLabs voiceover → Supabase Storage → Blog post → Telegram delivery

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
// Set ELEVENLABS_VOICE_ID in Supabase secrets to override.
// Default: Adam (pNInz6obpgDQGcFmaJgB) — deep, professional narration voice.
// Browse voices at elevenlabs.io/voice-library and swap anytime.
const ELEVENLABS_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") || "pNInz6obpgDQGcFmaJgB";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
const GITHUB_REPO = "nexuszc/nexus-zc";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── HELPERS ────────────────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

// Strip markdown and section labels for clean TTS input.
// Preserves natural sentence flow.
function cleanForTTS(script: string, maxChars = 4800): string {
  return script
    .replace(/\[(HOOK|PROBLEM|EDUCATION|BRIDGE|CTA|INTRO|OUTRO)\]/gi, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

// Build approximate YouTube chapter timestamps from script sections.
// Assumes ~130 words/minute speaking rate.
function buildChapters(script: string): string {
  const sections: Array<{ label: string; charPos: number }> = [];
  const markers = [
    { tag: /\[HOOK\]/i, label: "Intro" },
    { tag: /\[PROBLEM\]/i, label: "The Problem" },
    { tag: /\[EDUCATION\]/i, label: "What You Need to Know" },
    { tag: /\[BRIDGE\]/i, label: "How Contractors Are Solving This" },
    { tag: /\[CTA\]/i, label: "Next Step" },
  ];

  for (const { tag, label } of markers) {
    const match = script.search(tag);
    if (match !== -1) sections.push({ label, charPos: match });
  }

  if (!sections.length) return "";

  const wordsPerChar = 0.167; // ~6 chars/word average
  const wordsPerMinute = 130;

  return sections
    .map(({ label, charPos }) => {
      const words = charPos * wordsPerChar;
      const totalSeconds = Math.round((words / wordsPerMinute) * 60);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")} ${label}`;
    })
    .join("\n");
}

function buildYouTubeDescription(content: {
  title: string;
  body: string;
  hook?: string;
  target_keyword?: string;
  market?: string;
  tags?: string[];
  blog_url?: string | null;
  mp3_url?: string;
}): string {
  const chapters = buildChapters(content.body || "");
  const keyword = content.target_keyword || "roofing contractor";
  const market = content.market || "Colorado";
  const tags = (content.tags || []).join(", ");
  const blogLink = content.blog_url ? `\n📖 Full script + resources: ${content.blog_url}` : "";
  const audioLink = content.mp3_url ? `\n🎧 Audio version: ${content.mp3_url}` : "";

  return [
    content.hook || content.title,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "🏗️ FREE TOOLS FOR ROOFING CONTRACTORS",
    "• Homeowner portal (track jobs, supplements, photos)",
    "• AI supplement request generator",
    "• Carrier intelligence reports",
    "→ roofingos.dev",
    "━━━━━━━━━━━━━━━━━━━━",
    chapters ? `CHAPTERS:\n${chapters}\n` : "",
    `${keyword} | ${market} roofing | roofing business tips`,
    blogLink,
    audioLink,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    `TAGS: ${tags || "roofing contractor, roofing business, supplement tracking, hail damage, insurance claim, roofing software"}`,
  ]
    .filter(l => l !== null)
    .join("\n")
    .slice(0, 4900);
}

// ── ELEVENLABS ─────────────────────────────────────────────────────────────────

async function generateVoiceover(text: string): Promise<{ buffer: ArrayBuffer; chars: number } | null> {
  if (!ELEVENLABS_API_KEY) return null;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    throw new Error(`ElevenLabs error ${res.status}: ${err.slice(0, 200)}`);
  }

  const buffer = await res.arrayBuffer();
  return { buffer, chars: text.length };
}

// ── GITHUB ─────────────────────────────────────────────────────────────────────

async function getFileSha(path: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=main`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

async function writeGitHub(path: string, content: string, message: string): Promise<string | null> {
  const sha = await getFileSha(path);
  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: "main",
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  return data.commit?.sha?.slice(0, 8) || null;
}

// ── BLOG POST ──────────────────────────────────────────────────────────────────

function buildBlogHtml(content: {
  title: string;
  body: string;
  hook?: string;
  market?: string;
  tags?: string[];
  mp3_url?: string;
  seo_description?: string;
  target_keyword?: string;
}, slug: string): string {
  const desc = content.seo_description || content.hook || content.title;
  const keyword = content.target_keyword || "roofing contractor";
  const market = content.market || "";
  const tags = (content.tags || []).join(", ");

  // Convert script body to HTML paragraphs, preserve section headers
  const htmlBody = (content.body || "")
    .replace(/\[(HOOK|PROBLEM|EDUCATION|BRIDGE|CTA|INTRO|OUTRO)\]/gi,
      (_, s) => `<h2 class="section-label">${s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ")}</h2>`)
    .replace(/#{2,3}\s+(.+)/g, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => p.startsWith("<h") ? p : `<p>${p.replace(/\n/g, " ").trim()}</p>`)
    .join("\n");

  const audioSection = content.mp3_url
    ? `<div class="audio-section">
        <h3>🎧 Listen to This Episode</h3>
        <audio controls style="width:100%">
          <source src="${content.mp3_url}" type="audio/mpeg">
        </audio>
        <p class="audio-note">Download: <a href="${content.mp3_url}">MP3 file</a></p>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.title} | Roofing OS</title>
  <meta name="description" content="${desc.slice(0, 160).replace(/"/g, "&quot;")}">
  <meta name="keywords" content="${keyword}, ${market}, roofing contractor tips, ${tags}">
  <meta property="og:title" content="${content.title}">
  <meta property="og:description" content="${desc.slice(0, 200).replace(/"/g, "&quot;")}">
  <meta property="og:type" content="article">
  <link rel="canonical" href="https://roofingos.dev/blog/${slug}">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 780px; margin: 0 auto; padding: 2rem 1.5rem; color: #1a1a1a; line-height: 1.7; }
    h1 { font-size: 2rem; line-height: 1.25; margin-bottom: 0.5rem; }
    h2.section-label { background: #f5f5f5; padding: 0.5rem 1rem; border-left: 4px solid #e85d26; margin: 2rem 0 1rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
    h3 { font-size: 1.2rem; margin: 1.5rem 0 0.5rem; }
    p { margin: 0 0 1rem; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 2rem; }
    .audio-section { background: #f9f7f5; border: 1px solid #e0d8d0; border-radius: 8px; padding: 1.5rem; margin: 2rem 0; }
    .audio-note { font-size: 0.85rem; color: #888; margin-top: 0.5rem; }
    .cta-box { background: #e85d26; color: white; border-radius: 8px; padding: 2rem; margin: 3rem 0; text-align: center; }
    .cta-box h3 { color: white; margin: 0 0 0.5rem; }
    .cta-box p { color: rgba(255,255,255,0.9); margin: 0 0 1rem; }
    .cta-box a { display: inline-block; background: white; color: #e85d26; font-weight: 700; padding: 0.75rem 2rem; border-radius: 6px; text-decoration: none; }
    nav { margin-bottom: 2rem; }
    nav a { color: #e85d26; text-decoration: none; font-size: 0.9rem; }
  </style>
</head>
<body>
  <nav><a href="/blog">← Blog</a> | <a href="/">Roofing OS</a></nav>
  <h1>${content.title}</h1>
  <p class="meta">Roofing OS &middot; ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
  ${audioSection}
  <div class="script-content">
    ${htmlBody}
  </div>
  <div class="cta-box">
    <h3>Stop leaving supplement money on the table.</h3>
    <p>Roofing OS generates your supplement requests automatically — with the exact Xactimate codes your carrier approves.</p>
    <a href="https://roofingos.dev">See How It Works →</a>
  </div>
</body>
</html>`;
}

// ── TELEGRAM ───────────────────────────────────────────────────────────────────

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function tgAudio(mp3Url: string, caption: string, title: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAudio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      audio: mp3Url,
      caption: caption.slice(0, 1000),
      title,
      performer: "Roofing OS",
      parse_mode: "Markdown",
    }),
  }).catch(() => {});
}

// ── PROCESS ONE SCRIPT ─────────────────────────────────────────────────────────

async function processScript(content: {
  id: string;
  title: string;
  body: string;
  hook?: string;
  thumbnail_text?: string;
  tags?: string[];
  market?: string;
  target_keyword?: string;
  seo_description?: string;
  scheduled_topic?: string;
}): Promise<{ mp3_url: string | null; blog_url: string | null; description: string }> {
  const slug = slugify(content.title);
  let mp3Url: string | null = null;
  let blogUrl: string | null = null;
  let voiceoverChars = 0;
  let truncated = false;

  // 1. Generate voiceover
  try {
    const ttsText = cleanForTTS(content.body || "", 4800);
    truncated = (content.body || "").replace(/\s+/g, " ").length > 4800;
    const voiceover = await generateVoiceover(ttsText);

    if (voiceover) {
      voiceoverChars = voiceover.chars;
      const filename = `${content.id}.mp3`;

      const { error: uploadError } = await supabase.storage
        .from("voiceovers")
        .upload(filename, voiceover.buffer, {
          contentType: "audio/mpeg",
          upsert: true,
        });

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from("voiceovers")
          .getPublicUrl(filename);
        mp3Url = urlData.publicUrl;
      } else {
        console.error("Storage upload error:", uploadError.message);
      }
    }
  } catch (err) {
    console.error("Voiceover error:", err);
    await tg(`⚠️ Voiceover failed for "${content.title.slice(0, 60)}": ${String(err).slice(0, 200)}`);
  }

  // 2. Publish blog post to GitHub
  try {
    const blogHtml = buildBlogHtml({ ...content, mp3_url: mp3Url || undefined }, slug);
    const path = `roofingos-landing/blog/${slug}.html`;
    const commitSha = await writeGitHub(
      path,
      blogHtml,
      `[blog] ${content.title.slice(0, 72)}`
    );

    if (commitSha) {
      blogUrl = `https://roofingos.dev/blog/${slug}`;

      // Update blog index.json
      try {
        const indexPath = "roofingos-landing/blog/index.json";
        const indexSha = await getFileSha(indexPath);
        const existingRes = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${indexPath}?ref=main`,
          { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
        );
        let index: Array<Record<string, string>> = [];
        if (existingRes.ok) {
          const d = await existingRes.json();
          try { index = JSON.parse(atob(d.content.replace(/\n/g, ""))); } catch { index = []; }
        }
        // Prepend new entry, dedup by slug
        index = [
          { slug, title: content.title, date: new Date().toISOString().slice(0, 10), type: "youtube_companion" },
          ...index.filter((e: Record<string, string>) => e.slug !== slug),
        ].slice(0, 100);

        await writeGitHub(indexPath, JSON.stringify(index, null, 2), `[blog] update index — ${slug}`);
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.error("Blog publish error:", err);
  }

  // 3. Build YouTube description
  const description = buildYouTubeDescription({
    title: content.title,
    body: content.body,
    hook: content.hook,
    target_keyword: content.target_keyword,
    market: content.market,
    tags: content.tags,
    blog_url: blogUrl,
    mp3_url: mp3Url || undefined,
  });

  // 4. Update DB record
  await supabase.from("roofing_content").update({
    status: "published",
    published_at: new Date().toISOString(),
    mp3_url: mp3Url,
    voiceover_chars: voiceoverChars || null,
    blog_url: blogUrl,
    published_url: blogUrl,
    youtube_description: description,
    youtube_upload_ready: true,
  }).eq("id", content.id);

  // 5. Send Telegram delivery package
  const thumbnailText = content.thumbnail_text || content.title.toUpperCase().slice(0, 60);

  const summaryMsg =
    `🎬 *YouTube Package Ready*\n\n` +
    `*${content.title}*\n\n` +
    `📌 *Thumbnail text:*\n\`${thumbnailText}\`\n\n` +
    (blogUrl ? `📖 *Blog post:* ${blogUrl}\n\n` : "") +
    (mp3Url ? `🎙️ *Voiceover:* ${voiceoverChars} chars${truncated ? " (truncated to 4800)" : ""}\n\n` : "⚠️ Voiceover failed — upload script manually\n\n") +
    `*YouTube upload steps (2 min):*\n` +
    `1. Download MP3 from Telegram below\n` +
    `2. Go to YouTube Studio → Create → Upload\n` +
    `3. Upload MP3 as audio file\n` +
    `4. Title: \`${content.title}\`\n` +
    `5. Paste description (next message)\n` +
    `6. Add thumbnail from Canva using text above\n` +
    `7. Set to Public → Upload`;

  await tg(summaryMsg);

  // Send the YouTube description as a separate message
  await tg(`📋 *YouTube Description — paste into Studio:*\n\n\`\`\`\n${description.slice(0, 3800)}\n\`\`\``);

  // Send audio file via Telegram (shows inline audio player)
  if (mp3Url) {
    await tgAudio(
      mp3Url,
      `🎙️ ${content.title}\n\nDownload → upload to YouTube Studio`,
      content.title
    );
  }

  return { mp3_url: mp3Url, blog_url: blogUrl, description };
}

// ── MAIN ───────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-publisher ready" });

  const startMs = Date.now();

  // Process a specific content ID
  if (body.content_id) {
    const { data: content } = await supabase
      .from("roofing_content")
      .select("*")
      .eq("id", body.content_id)
      .maybeSingle();

    if (!content) return Response.json({ error: "content not found" }, { status: 404 });

    const result = await processScript(content);
    return Response.json({ ok: true, content_id: body.content_id, ...result, duration_ms: Date.now() - startMs });
  }

  // Process all approved youtube_scripts (batch mode, up to 5 at a time)
  const { data: approvedScripts } = await supabase
    .from("roofing_content")
    .select("*")
    .eq("type", "youtube_script")
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .limit(5);

  if (!approvedScripts?.length) {
    return Response.json({ ok: true, processed: 0, message: "no approved scripts pending" });
  }

  const results: Array<{ id: string; title: string; mp3_url: string | null; blog_url: string | null }> = [];

  for (const script of approvedScripts) {
    try {
      const { mp3_url, blog_url } = await processScript(script);
      results.push({ id: script.id, title: script.title, mp3_url, blog_url });
      // Stagger to avoid Telegram rate limits
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await tg(`❌ Publisher error for "${(script.title || "").slice(0, 50)}": ${msg.slice(0, 200)}`);
      results.push({ id: script.id, title: script.title, mp3_url: null, blog_url: null });
    }
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "roofing-youtube-publisher",
    status: "ok",
    response_ms: Date.now() - startMs,
    checked_at: new Date().toISOString(),
  }).catch(() => {});

  return Response.json({ ok: true, processed: results.length, results, duration_ms: Date.now() - startMs });
});

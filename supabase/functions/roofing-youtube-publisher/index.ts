// roofing-youtube-publisher v3
// Voice: OpenAI TTS (tts-1-hd, onyx) primary; ElevenLabs Adam fallback; youtube_long uses ElevenLabs primary.
// Description: full Phase 6 optimized template with chapters, CTA, hashtags.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY         = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY      = Deno.env.get("OPENAI_API_KEY") || "";
const ELEVENLABS_API_KEY  = Deno.env.get("ELEVENLABS_API_KEY") || "";
// Default: Adam — authoritative, trusted, contractor-audience voice.
const ELEVENLABS_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") || "pNInz6obpgDQGcFmaJgB";
const TELEGRAM_BOT_TOKEN  = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID    = Deno.env.get("TELEGRAM_CHAT_ID")!;
const GITHUB_TOKEN        = Deno.env.get("GITHUB_TOKEN")!;
const GITHUB_REPO         = "nexuszc/nexus-zc";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function cleanForTTS(script: string, maxChars = 4800): string {
  return script
    .replace(/\[(HOOK|PROBLEM|SOLUTION|CTA|INTRO|OUTRO|SECTION \d+[^)]*)\]/gi, "")
    .replace(/^(HOOK|PROBLEM|SOLUTION|CTA|INTRO|OUTRO):\s*/gim, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/https?:\/\/\S+/g, "roofingos.dev")
    .replace(/`[^`]+`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

function buildYouTubeDescription(content: {
  title: string;
  hook?: string;
  hook_text?: string;
  target_keywords?: string[] | null;
  topic_category?: string | null;
  market?: string | null;
  tags?: string[] | null;
  blog_url?: string | null;
  type?: string;
}): string {
  const hook = (content.hook_text || content.hook || content.title).slice(0, 200);
  const isLong = (content.type || "").includes("long");

  const chapters = isLong
    ? [
        "=== CHAPTERS ===",
        "0:00 The Problem",
        "1:00 Why It Keeps Happening",
        "3:00 The Solution (Roofing OS)",
        "6:00 Real Results",
        "8:00 Get Started Free",
        "",
      ]
    : [
        "=== CHAPTERS ===",
        "0:00 The Problem",
        "0:08 Why It Keeps Happening",
        "0:15 The Fix",
        "0:25 Get Started Free",
        "",
      ];

  const blogLine = content.blog_url ? `📖 Full breakdown: ${content.blog_url}\n` : "";

  const extraKeywords = (content.target_keywords || []).slice(0, 5).join(", ");
  const market = content.market ? `${content.market} roofing | ` : "";

  return [
    hook,
    "",
    "🏠 Try Roofing OS FREE → roofingos.dev",
    "",
    "✅ Free forever — no credit card ever",
    "✅ Homeowner portal in 4 minutes",
    "✅ AI supplement tool",
    "✅ Replace CompanyCam at $0",
    "✅ Storm leads for your market",
    "",
    "📞 Questions? Call us: (720) 500-6668",
    "",
    blogLine,
    ...chapters,
    "=== ABOUT ROOFING OS ===",
    "Roofing OS is a free homeowner portal and AI supplement tool for roofing contractors. Cancel CompanyCam. Keep everything. Pay nothing. Ever.",
    "",
    `${market}${extraKeywords ? extraKeywords + " | " : ""}roofing contractor tips 2026`,
    "",
    "#roofing #roofingcontractor #roofer #supplement #stormrestoration #roofingOS #freeroofingsoftware #homeowner #insuranceclaim #hail #companycamp #contractortips",
  ]
    .join("\n")
    .slice(0, 5000);
}

// ── TTS engines ───────────────────────────────────────────────────────────────

async function ttsOpenAI(text: string): Promise<ArrayBuffer> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1-hd", input: text.slice(0, 4090), voice: "onyx", speed: 0.95 }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    throw new Error(`OpenAI TTS error ${res.status}: ${err.slice(0, 200)}`);
  }
  return await res.arrayBuffer();
}

async function ttsElevenLabs(text: string): Promise<ArrayBuffer> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability: 0.35, similarity_boost: 0.85, style: 0.6, use_speaker_boost: true },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    throw new Error(`ElevenLabs error ${res.status}: ${err.slice(0, 200)}`);
  }
  return await res.arrayBuffer();
}

async function generateVoiceover(
  text: string,
  contentType: string,
): Promise<{ buffer: ArrayBuffer; chars: number; engine: string } | null> {
  const isLongForm = contentType === "youtube_long";
  const [primary, secondary, primaryName, secondaryName] = isLongForm
    ? [ttsElevenLabs, ttsOpenAI, "elevenlabs", "openai"] as const
    : [ttsOpenAI, ttsElevenLabs, "openai", "elevenlabs"] as const;

  try {
    const buffer = await primary(text);
    return { buffer, chars: text.length, engine: primaryName };
  } catch (e1) {
    console.error(`${primaryName} TTS failed:`, e1);
    try {
      const buffer = await secondary(text);
      return { buffer, chars: text.length, engine: secondaryName };
    } catch (e2) {
      console.error(`${secondaryName} TTS also failed:`, e2);
      return null;
    }
  }
}

// ── GitHub blog post ──────────────────────────────────────────────────────────

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

function buildBlogHtml(content: {
  title: string;
  body: string;
  hook?: string;
  hook_text?: string;
  market?: string;
  tags?: string[];
  mp3_url?: string;
  target_keywords?: string[];
}, slug: string): string {
  const desc = (content.hook_text || content.hook || content.title).slice(0, 160);
  const keyword = (content.target_keywords || [])[0] || "roofing contractor";
  const tags = (content.tags || []).join(", ");

  const htmlBody = (content.body || "")
    .replace(/\[(HOOK|PROBLEM|SOLUTION|CTA|INTRO|OUTRO|SECTION \d+[^)]*)\]/gi,
      (_: string, s: string) => `<h2 class="section-label">${s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ")}</h2>`)
    .replace(/^(HOOK|PROBLEM|SOLUTION|CTA|INTRO|OUTRO):\s*/gim, "")
    .replace(/#{2,3}\s+(.+)/g, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split(/\n\n+/)
    .filter((p: string) => p.trim())
    .map((p: string) => p.startsWith("<h") ? p : `<p>${p.replace(/\n/g, " ").trim()}</p>`)
    .join("\n");

  const audioSection = content.mp3_url
    ? `<div class="audio-section"><h3>🎧 Listen</h3><audio controls style="width:100%"><source src="${content.mp3_url}" type="audio/mpeg"></audio></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${content.title} | Roofing OS</title>
  <meta name="description" content="${desc.replace(/"/g, "&quot;")}">
  <meta name="keywords" content="${keyword}, ${content.market || ""}, roofing contractor, ${tags}">
  <meta property="og:title" content="${content.title}">
  <meta property="og:description" content="${desc.replace(/"/g, "&quot;")}">
  <link rel="canonical" href="https://roofingos.dev/blog/${slug}">
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:780px;margin:0 auto;padding:2rem 1.5rem;color:#1a1a1a;line-height:1.7}
    h1{font-size:2rem;line-height:1.25;margin-bottom:.5rem}
    h2.section-label{background:#f5f5f5;padding:.5rem 1rem;border-left:4px solid #e85d26;margin:2rem 0 1rem;font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:#666}
    h3{font-size:1.2rem;margin:1.5rem 0 .5rem}p{margin:0 0 1rem}
    .meta{color:#888;font-size:.9rem;margin-bottom:2rem}
    .audio-section{background:#f9f7f5;border:1px solid #e0d8d0;border-radius:8px;padding:1.5rem;margin:2rem 0}
    .cta-box{background:#e85d26;color:#fff;border-radius:8px;padding:2rem;margin:3rem 0;text-align:center}
    .cta-box h3{color:#fff;margin:0 0 .5rem}.cta-box p{color:rgba(255,255,255,.9);margin:0 0 1rem}
    .cta-box a{display:inline-block;background:#fff;color:#e85d26;font-weight:700;padding:.75rem 2rem;border-radius:6px;text-decoration:none}
    nav{margin-bottom:2rem}nav a{color:#e85d26;text-decoration:none;font-size:.9rem}
  </style>
</head>
<body>
  <nav><a href="/blog">← Blog</a> | <a href="/">Roofing OS</a></nav>
  <h1>${content.title}</h1>
  <p class="meta">Roofing OS · ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</p>
  ${audioSection}
  <div class="script-content">${htmlBody}</div>
  <div class="cta-box">
    <h3>Stop leaving money on the table.</h3>
    <p>Roofing OS is free forever. No credit card. Takes 4 minutes to set up.</p>
    <a href="https://roofingos.dev">Get Started Free →</a>
  </div>
</body>
</html>`;
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

// ── Process one script ────────────────────────────────────────────────────────

async function processScript(content: Record<string, unknown>): Promise<{ mp3_url: string | null; blog_url: string | null }> {
  const slug = slugify(String(content.title || ""));
  let mp3Url: string | null = null;
  let blogUrl: string | null = null;
  let voiceoverChars = 0;

  // 1. Voiceover
  try {
    const ttsText = cleanForTTS(String(content.body || ""), 4800);
    const voiceover = await generateVoiceover(ttsText, String(content.type || ""));
    if (voiceover) {
      voiceoverChars = voiceover.chars;
      const filename = `${content.id}.mp3`;
      const { error: uploadError } = await supabase.storage
        .from("voiceovers")
        .upload(filename, voiceover.buffer, { contentType: "audio/mpeg", upsert: true });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("voiceovers").getPublicUrl(filename);
        mp3Url = urlData.publicUrl;
      }
    }
  } catch (err) {
    console.error("Voiceover error:", err);
    await tg(`⚠️ Voiceover failed for "${String(content.title || "").slice(0, 60)}": ${String(err).slice(0, 200)}`);
  }

  // 2. Blog post
  try {
    const blogHtml = buildBlogHtml({
      title: String(content.title || ""),
      body:  String(content.body || ""),
      hook:  String(content.hook || ""),
      hook_text: String(content.hook_text || ""),
      market: content.market as string | undefined,
      tags: content.tags as string[] | undefined,
      mp3_url: mp3Url || undefined,
      target_keywords: content.target_keywords as string[] | undefined,
    }, slug);

    const commitSha = await writeGitHub(
      `roofingos-landing/blog/${slug}.html`,
      blogHtml,
      `[blog] ${String(content.title || "").slice(0, 72)}`
    );
    if (commitSha) {
      blogUrl = `https://roofingos.dev/blog/${slug}`;
      try {
        const indexPath = "roofingos-landing/blog/index.json";
        const existingRes = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contents/${indexPath}?ref=main`,
          { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
        );
        let index: Array<Record<string, string>> = [];
        if (existingRes.ok) {
          const d = await existingRes.json();
          try { index = JSON.parse(atob(d.content.replace(/\n/g, ""))); } catch { index = []; }
        }
        index = [
          { slug, title: String(content.title || ""), date: new Date().toISOString().slice(0, 10), type: "youtube_companion" },
          ...index.filter((e: Record<string, string>) => e.slug !== slug),
        ].slice(0, 100);
        await writeGitHub(indexPath, JSON.stringify(index, null, 2), `[blog] update index — ${slug}`);
      } catch { /* non-fatal */ }
    }
  } catch (err) {
    console.error("Blog error:", err);
  }

  // 3. Build description
  const description = buildYouTubeDescription({
    title:           String(content.title || ""),
    hook:            String(content.hook || ""),
    hook_text:       String(content.hook_text || ""),
    target_keywords: content.target_keywords as string[] | undefined,
    topic_category:  content.topic_category as string | undefined,
    market:          content.market as string | undefined,
    tags:            content.tags as string[] | undefined,
    blog_url:        blogUrl,
    type:            String(content.type || ""),
  });

  // 4. Update DB
  try {
    await supabase.from("roofing_content").update({
      status:               "published",
      published_at:         new Date().toISOString(),
      mp3_url:              mp3Url,
      voiceover_chars:      voiceoverChars || null,
      blog_url:             blogUrl,
      published_url:        blogUrl,
      youtube_description:  description,
      youtube_upload_ready: true,
    }).eq("id", content.id);
  } catch (dbErr) {
    console.error("DB update failed:", dbErr);
  }

  // 5. Kick off uploader (fire-and-forget)
  fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-uploader`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_id: content.id }),
  }).catch(() => {});

  return { mp3_url: mp3Url, blog_url: blogUrl };
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-publisher v3 ready", openai_tts: !!OPENAI_API_KEY, elevenlabs: !!ELEVENLABS_API_KEY });

  const startMs = Date.now();

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

  // Batch: pick approved youtube_short or youtube_long with no voiceover yet
  const limit = Math.min(body.limit || 5, 10);
  const { data: pending } = await supabase
    .from("roofing_content")
    .select("*")
    .in("type", ["youtube_short", "youtube_long"])
    .eq("status", "approved")
    .eq("youtube_upload_ready", false)
    .is("mp3_url", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!pending?.length) {
    return Response.json({ ok: true, processed: 0, message: "no pending scripts" });
  }

  const results: Array<{ id: string; title: string; mp3_url: string | null; blog_url: string | null }> = [];
  for (const script of pending) {
    try {
      const { mp3_url, blog_url } = await processScript(script);
      results.push({ id: script.id, title: script.title, mp3_url, blog_url });
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await tg(`❌ Publisher error for "${(script.title || "").slice(0, 50)}": ${msg.slice(0, 200)}`);
      results.push({ id: script.id, title: script.title, mp3_url: null, blog_url: null });
    }
  }

  try {
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-youtube-publisher",
      status: "ok",
      response_ms: Date.now() - startMs,
      checked_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  return Response.json({ ok: true, processed: results.length, results, duration_ms: Date.now() - startMs });
});

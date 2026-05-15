// roofing-voiceover-engine v1
// Approved youtube_scripts → ElevenLabs TTS → Supabase Storage → Telegram upload checklist

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const ELEVENLABS_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") || "pNInz6obpgDQGcFmaJgB";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── TEXT CLEANING ───────────────────────────────────────────────────────────────

function buildSpokenText(content: {
  hook?: string | null;
  body?: string | null;
  portal_mention?: string | null;
  call_to_action?: string | null;
}): string {
  const raw = [
    content.hook,
    content.body,
    content.portal_mention,
    content.call_to_action,
  ].filter(Boolean).join("\n\n");

  return raw
    // URLs → spoken form (before any other processing)
    .replace(/https?:\/\/\S+/g, "visit Roofing OS dot dev")
    // Section labels like [HOOK], [PROBLEM], [EDUCATION], etc.
    .replace(/\[(HOOK|PROBLEM|EDUCATION|BRIDGE|CTA|INTRO|OUTRO)\]/gi, "")
    // Markdown headers
    .replace(/#{1,6}\s+/g, "")
    // Bold and italic markers — preserve the text
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
    // Markdown links → text only
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remaining brackets
    .replace(/[\[\]]/g, "")
    // Bullet points and numbered list markers
    .replace(/^[\s]*[-*•]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    // Backticks
    .replace(/`+([^`]*)`+/g, "$1")
    // Double newlines → sentence break with pause
    .replace(/\n{2,}/g, ". ")
    // Single newlines → natural comma pause
    .replace(/\n/g, ", ")
    // Fix punctuation artifacts
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .replace(/,{2,}/g, ",")
    // Collapse whitespace
    .replace(/\s{2,}/g, " ")
    .trim()
    // ElevenLabs turbo_v2 cap: ~5000 chars
    .slice(0, 4900);
}

function estimateMinutes(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 130));
}

// ── ELEVENLABS ──────────────────────────────────────────────────────────────────

async function generateVoiceover(text: string): Promise<ArrayBuffer> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");

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
        model_id: "eleven_turbo_v2",
        voice_settings: {
          stability: 0.75,
          similarity_boost: 0.85,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.arrayBuffer();
}

// ── TELEGRAM ────────────────────────────────────────────────────────────────────

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text.slice(0, 4096),
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

// ── CORE PROCESSOR ─────────────────────────────────────────────────────────────

async function processOne(content: {
  id: string;
  title: string;
  hook?: string | null;
  body?: string | null;
  portal_mention?: string | null;
  call_to_action?: string | null;
  seo_description?: string | null;
  tags?: string[] | null;
  thumbnail_text?: string | null;
}): Promise<string> {
  const spokenText = buildSpokenText(content);
  const estimatedMins = estimateMinutes(spokenText);

  // 1. Generate voiceover via ElevenLabs
  const audioBuffer = await generateVoiceover(spokenText);

  // 2. Upload to Supabase Storage bucket 'roofing-content'
  const filename = `youtube/${content.id}.mp3`;
  const { error: uploadError } = await supabase.storage
    .from("roofing-content")
    .upload(filename, audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);

  const { data: urlData } = supabase.storage
    .from("roofing-content")
    .getPublicUrl(filename);
  const mp3Url = urlData.publicUrl;

  // 3. Send Telegram checklist
  const tags = (content.tags || []).join(", ") || "roofing contractor, roofing software, supplement tracking";
  const seoDesc = (content.seo_description || content.title).slice(0, 400);
  const thumbnail = (content.thumbnail_text || content.title.toUpperCase()).slice(0, 60);

  const msg =
    `🎙️ *Voiceover Ready*\n\n` +
    `*${content.title}*\n\n` +
    `⏱ ~${estimatedMins} minutes\n` +
    `🎤 Aria voice\n\n` +
    `[Download MP3](${mp3Url})\n\n` +
    `*YouTube upload checklist:*\n` +
    `1. studio.youtube.com → Upload\n` +
    `2. Select the MP3 file\n` +
    `3. Title: ${content.title}\n` +
    `4. Description:\n${seoDesc}\n\nroofingos.dev — starts at $49/month\n\n` +
    `5. Tags: ${tags}\n` +
    `6. Thumbnail: ${thumbnail}\n` +
    `7. Click Publish ✓\n\n` +
    `Reply with:\n\`uploaded ${content.id}\`\nwhen done — I'll mark it published.`;

  await tg(msg);

  // 4. Update roofing_content
  await supabase.from("roofing_content").update({
    status: "voiceover_ready",
    mp3_url: mp3Url,
    voiceover_chars: spokenText.length,
  }).eq("id", content.id);

  // 5. Log heartbeat
  try {
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-voiceover-engine",
      status: "ok",
      response_ms: 0,
      checked_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  return mp3Url;
}

// ── MAIN ────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-voiceover-engine ready" });

  const startMs = Date.now();

  // Single content ID mode
  if (body.content_id) {
    try {
      const { data: content, error } = await supabase
        .from("roofing_content")
        .select("id, title, hook, body, portal_mention, call_to_action, seo_description, tags, thumbnail_text")
        .eq("id", body.content_id)
        .maybeSingle();

      if (error) throw error;
      if (!content) return Response.json({ error: "content not found" }, { status: 404 });

      const mp3Url = await processOne(content);
      return Response.json({ ok: true, content_id: content.id, mp3_url: mp3Url, duration_ms: Date.now() - startMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await tg(`❌ Voiceover failed for \`${body.content_id}\`: ${msg.slice(0, 200)}`);
      return Response.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // Batch mode: all approved youtube_scripts without voiceover (mp3_url is null)
  try {
    const { data: pending, error } = await supabase
      .from("roofing_content")
      .select("id, title, hook, body, portal_mention, call_to_action, seo_description, tags, thumbnail_text")
      .eq("type", "youtube_script")
      .eq("status", "approved")
      .is("mp3_url", null)
      .order("approved_at", { ascending: true })
      .limit(5);

    if (error) throw error;

    if (!pending?.length) {
      return Response.json({ ok: true, processed: 0, message: "no approved scripts pending voiceover" });
    }

    let processed = 0;
    let errors = 0;

    for (const content of pending) {
      try {
        await processOne(content);
        processed++;
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        await tg(`❌ Voiceover error for "${(content.title || "").slice(0, 50)}": ${msg.slice(0, 200)}`);
      }
    }

    return Response.json({ ok: true, processed, errors, duration_ms: Date.now() - startMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

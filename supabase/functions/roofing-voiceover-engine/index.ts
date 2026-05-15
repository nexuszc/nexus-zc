// roofing-voiceover-engine v3
// Approved youtube_scripts → ElevenLabs TTS → Supabase Storage
// → Telegram sendAudio (inline player, no caption)
// → Telegram sendDocument (raw .mp3 with full YouTube checklist)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
const ELEVENLABS_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") || "pNInz6obpgDQGcFmaJgB";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Resolve Telegram chat_id: env var first, then DB lookup.
async function getChatId(): Promise<string> {
  const envId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (envId) return envId;
  const { data } = await supabase
    .from("channel_conversations")
    .select("external_id")
    .eq("channel", "telegram")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.external_id) throw new Error("TELEGRAM_CHAT_ID not set and not found in DB");
  return data.external_id;
}

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
    .replace(/https?:\/\/\S+/g, "visit Roofing OS dot dev")
    .replace(/\[(HOOK|PROBLEM|EDUCATION|BRIDGE|CTA|INTRO|OUTRO)\]/gi, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[\[\]]/g, "")
    .replace(/^[\s]*[-*•]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ")
    .replace(/\.\s*\./g, ".")
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .replace(/,{2,}/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 4900);
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
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

async function tg(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

// Message 1: inline audio player, no caption
async function tgSendAudio(
  chatId: string,
  audioBuffer: ArrayBuffer,
  filename: string,
  title: string,
): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("audio", new Blob([audioBuffer], { type: "audio/mpeg" }), filename);
    form.append("title", title.slice(0, 64));
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAudio`,
      { method: "POST", body: form }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Message 2: raw .mp3 file with full YouTube checklist — iPhone saves directly to Files
// Must use application/octet-stream — audio/mpeg causes Telegram to auto-promote to audio player
async function tgSendDocument(
  chatId: string,
  audioBuffer: ArrayBuffer,
  filename: string,
  caption: string,
): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", new Blob([audioBuffer], { type: "application/octet-stream" }), filename);
    form.append("caption", caption.slice(0, 1024));
    form.append("parse_mode", "Markdown");
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
      { method: "POST", body: form }
    );
    return res.ok;
  } catch {
    return false;
  }
}

function buildCaption(content: {
  id: string;
  title: string;
  seo_description?: string | null;
  tags?: string[] | null;
  thumbnail_text?: string | null;
}): string {
  const tags = (content.tags || []).join(", ") || "roofing contractor, roofing software, supplement tracking";
  const desc = (content.seo_description || content.title).slice(0, 300);
  const thumbnail = (content.thumbnail_text || content.title.toUpperCase()).slice(0, 60);

  return (
    `📋 *TITLE:*\n${content.title}\n\n` +
    `📝 *DESCRIPTION:*\n${desc}\n\nroofingos.dev — starts at $49/month\n\n` +
    `🏷️ *TAGS:*\n${tags}\n\n` +
    `🖼️ *THUMBNAIL TEXT:*\n${thumbnail}\n\n` +
    `studio.youtube.com → Create → Upload → set Public → Publish\n\n` +
    `When done reply:\n\`uploaded ${content.id}\``
  );
}

// ── TELEGRAM DELIVERY (audio + document) ────────────────────────────────────────

async function deliverToTelegram(
  chatId: string,
  audioBuffer: ArrayBuffer,
  content: { id: string; title: string; seo_description?: string | null; tags?: string[] | null; thumbnail_text?: string | null },
  mp3Url: string,
): Promise<void> {
  const filename = `roofing-os-${slugify(content.title)}.mp3`;
  const caption = buildCaption(content);

  if (audioBuffer.byteLength <= TELEGRAM_MAX_BYTES) {
    // Message 1: inline audio player (no caption — keeps it clean)
    await tgSendAudio(chatId, audioBuffer, filename, content.title);
    // Message 2: raw file download with full checklist
    await tgSendDocument(chatId, audioBuffer, filename, caption);
  } else {
    // File too large — fallback to text with download link
    await tg(chatId, `🎙️ *Voiceover Ready*\n\n${caption}\n\n[Download MP3](${mp3Url})`);
  }
}

// ── CORE PROCESSOR ─────────────────────────────────────────────────────────────

async function processOne(
  chatId: string,
  content: {
    id: string;
    title: string;
    hook?: string | null;
    body?: string | null;
    portal_mention?: string | null;
    call_to_action?: string | null;
    seo_description?: string | null;
    tags?: string[] | null;
    thumbnail_text?: string | null;
  }
): Promise<string> {
  const spokenText = buildSpokenText(content);

  // 1. Generate voiceover
  const audioBuffer = await generateVoiceover(spokenText);

  // 2. Upload to Supabase Storage
  const storageFilename = `youtube/${content.id}.mp3`;
  const { error: uploadError } = await supabase.storage
    .from("roofing-content")
    .upload(storageFilename, audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);

  const { data: urlData } = supabase.storage
    .from("roofing-content")
    .getPublicUrl(storageFilename);
  const mp3Url = urlData.publicUrl;

  // 3. Send audio + document to Telegram
  await deliverToTelegram(chatId, audioBuffer, content, mp3Url);

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
      metadata: {},
      recorded_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  return mp3Url;
}

// ── MAIN ────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-voiceover-engine ready" });

  const startMs = Date.now();
  const chatId = await getChatId();

  // Single content ID mode
  if (body.content_id) {
    try {
      const { data: content, error } = await supabase
        .from("roofing_content")
        .select("id, title, hook, body, portal_mention, call_to_action, seo_description, tags, thumbnail_text, mp3_url")
        .eq("id", body.content_id)
        .maybeSingle();

      if (error) throw error;
      if (!content) return Response.json({ error: "content not found" }, { status: 404 });

      // resend_only: download existing MP3 from storage, send both formats — no ElevenLabs call
      if (body.resend_only && (content as any).mp3_url) {
        const mp3Url = (content as any).mp3_url as string;
        const storagePath = `youtube/${content.id}.mp3`;
        const { data: blob, error: dlErr } = await supabase.storage
          .from("roofing-content")
          .download(storagePath);
        if (dlErr || !blob) throw new Error(`Storage download failed: ${dlErr?.message || "no data"}`);
        const audioBuffer = await blob.arrayBuffer();
        await deliverToTelegram(chatId, audioBuffer, content, mp3Url);
        return Response.json({ ok: true, resent: true, content_id: content.id, mp3_url: mp3Url, duration_ms: Date.now() - startMs });
      }

      const mp3Url = await processOne(chatId, content);
      return Response.json({ ok: true, content_id: content.id, mp3_url: mp3Url, duration_ms: Date.now() - startMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await tg(chatId, `❌ Voiceover failed for \`${body.content_id}\`: ${msg.slice(0, 200)}`);
      return Response.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // Batch mode: all approved youtube_scripts without voiceover
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
        await processOne(chatId, content);
        processed++;
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        await tg(chatId, `❌ Voiceover error for "${(content.title || "").slice(0, 50)}": ${msg.slice(0, 200)}`);
      }
    }

    return Response.json({ ok: true, processed, errors, duration_ms: Date.now() - startMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

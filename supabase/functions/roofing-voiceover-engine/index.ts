// roofing-voiceover-engine v4
// OpenAI TTS (tts-1-hd, onyx) as primary for all short-form content.
// ElevenLabs as primary for youtube_long (better quality for 10-min scripts).
// Fallback chain: primary fails → secondary → log, skip, never block pipeline.
//
// Batch mode: {"batch": true, "limit": N}
//   → picks up all youtube_short / youtube_long / youtube_script
//     with status=approved and no mp3_url

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY          = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY       = Deno.env.get("OPENAI_API_KEY") || "";
const ELEVENLABS_API_KEY   = Deno.env.get("ELEVENLABS_API_KEY") || "";
const ELEVENLABS_VOICE_ID  = Deno.env.get("ELEVENLABS_VOICE_ID") || "pNInz6obpgDQGcFmaJgB";
const TELEGRAM_BOT_TOKEN   = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const TELEGRAM_MAX_BYTES = 50 * 1024 * 1024;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

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

// ── Text cleaning ─────────────────────────────────────────────────────────────

function buildSpokenText(content: {
  hook?: string | null;
  hook_text?: string | null;
  body?: string | null;
  portal_mention?: string | null;
  call_to_action?: string | null;
}): string {
  const raw = [
    content.hook_text || content.hook,
    content.body,
    content.portal_mention,
    content.call_to_action,
  ].filter(Boolean).join("\n\n");

  return raw
    .replace(/https?:\/\/\S+/g, "visit Roofing OS dot dev")
    .replace(/\[(HOOK|PROBLEM|SOLUTION|CTA|INTRO|OUTRO|EDUCATION|BRIDGE|SECTION \d+[^)]*)\]/gi, "")
    .replace(/^(HOOK|PROBLEM|SOLUTION|CTA|INTRO|OUTRO):\s*/gim, "")
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
    .slice(0, 4090); // OpenAI TTS hard limit is 4096
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60);
}

// ── TTS engines ───────────────────────────────────────────────────────────────

async function ttsOpenAI(text: string): Promise<ArrayBuffer> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1-hd",
      voice: "onyx",
      input: text,
      speed: 0.95,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    throw new Error(`OpenAI TTS ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}

async function ttsElevenLabs(text: string): Promise<ArrayBuffer> {
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
        voice_settings: { stability: 0.35, similarity_boost: 0.85, style: 0.6, use_speaker_boost: true },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    throw new Error(`ElevenLabs ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}

// Route by content type. Never throws — returns null if both fail.
async function generateVoiceover(
  text: string,
  contentType: string,
): Promise<{ buffer: ArrayBuffer; engine: string } | null> {
  const isLongForm = contentType === "youtube_long";

  const [primary, secondary, primaryName, secondaryName] = isLongForm
    ? [ttsElevenLabs, ttsOpenAI, "elevenlabs", "openai"]
    : [ttsOpenAI, ttsElevenLabs, "openai", "elevenlabs"];

  try {
    const buffer = await primary(text);
    return { buffer, engine: primaryName };
  } catch (e1) {
    console.error(`${primaryName} TTS failed:`, e1);
    try {
      const buffer = await secondary(text);
      console.log(`Fell back to ${secondaryName}`);
      return { buffer, engine: secondaryName };
    } catch (e2) {
      console.error(`${secondaryName} TTS also failed:`, e2);
      return null;
    }
  }
}

// ── Telegram delivery ─────────────────────────────────────────────────────────

async function tg(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), parse_mode: "Markdown", disable_web_page_preview: true }),
  }).catch(() => {});
}

async function tgSendAudio(chatId: string, buf: ArrayBuffer, filename: string, title: string): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("audio", new Blob([buf], { type: "audio/mpeg" }), filename);
    form.append("title", title.slice(0, 64));
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAudio`, { method: "POST", body: form });
    return res.ok;
  } catch { return false; }
}

async function tgSendDocument(chatId: string, buf: ArrayBuffer, filename: string, caption: string): Promise<boolean> {
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", new Blob([buf], { type: "application/octet-stream" }), filename);
    form.append("caption", caption.slice(0, 1024));
    form.append("parse_mode", "Markdown");
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
    return res.ok;
  } catch { return false; }
}

function buildCaption(content: {
  id: string; title: string; seo_description?: string | null;
  tags?: string[] | null; thumbnail_text?: string | null;
}, engine: string): string {
  const tags = (content.tags || []).join(", ") || "roofing contractor, roofing software";
  const desc = (content.seo_description || content.title).slice(0, 300);
  const thumbnail = (content.thumbnail_text || content.title.toUpperCase()).slice(0, 60);
  const engineBadge = engine === "openai" ? "🤖 OpenAI TTS" : "🎙 ElevenLabs";
  return (
    `📋 *TITLE:*\n${content.title}\n\n` +
    `📝 *DESCRIPTION:*\n${desc}\n\nfree at roofingos.dev/dashboard\n\n` +
    `🏷️ *TAGS:*\n${tags}\n\n` +
    `🖼️ *THUMBNAIL TEXT:*\n${thumbnail}\n\n` +
    `${engineBadge}\n\n` +
    `studio.youtube.com → Create → Upload → set Public → Publish\n\n` +
    `When done reply:\n\`uploaded ${content.id}\``
  );
}

async function deliverToTelegram(
  chatId: string,
  buf: ArrayBuffer,
  content: { id: string; title: string; seo_description?: string | null; tags?: string[] | null; thumbnail_text?: string | null },
  mp3Url: string,
  engine: string,
): Promise<void> {
  const filename = `roofing-os-${slugify(content.title)}.mp3`;
  const caption = buildCaption(content, engine);
  if (buf.byteLength <= TELEGRAM_MAX_BYTES) {
    await tgSendAudio(chatId, buf, filename, content.title);
    await tgSendDocument(chatId, buf, filename, caption);
  } else {
    await tg(chatId, `🎙️ *Voiceover Ready*\n\n${caption}\n\n[Download MP3](${mp3Url})`);
  }
}

// ── Core processor ────────────────────────────────────────────────────────────

async function processOne(
  chatId: string,
  content: {
    id: string; title: string; type?: string | null;
    hook?: string | null; hook_text?: string | null;
    body?: string | null; portal_mention?: string | null; call_to_action?: string | null;
    seo_description?: string | null; tags?: string[] | null; thumbnail_text?: string | null;
  },
  sendTelegram = true,
): Promise<{ mp3_url: string; engine: string } | null> {
  const spokenText = buildSpokenText(content);
  const contentType = content.type || "youtube_short";

  const result = await generateVoiceover(spokenText, contentType);
  if (!result) {
    console.error(`Both TTS engines failed for ${content.id} — skipping`);
    return null;
  }

  const { buffer, engine } = result;

  // Upload to storage
  const storageFile = `youtube/${content.id}.mp3`;
  const { error: uploadError } = await supabase.storage
    .from("roofing-content")
    .upload(storageFile, buffer, { contentType: "audio/mpeg", upsert: true });

  if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from("roofing-content").getPublicUrl(storageFile);
  const mp3Url = urlData.publicUrl;

  // Also mirror to voiceovers bucket (for publisher compatibility)
  await supabase.storage
    .from("voiceovers")
    .upload(`${content.id}.mp3`, buffer, { contentType: "audio/mpeg", upsert: true })
    .catch(() => {});

  // Telegram delivery (skip for automated batch to avoid spam)
  if (sendTelegram) {
    await deliverToTelegram(chatId, buffer, content, mp3Url, engine);
  }

  // Update DB
  try {
    await supabase.from("roofing_content").update({
      status:               "voiceover_ready",
      mp3_url:              mp3Url,
      voiceover_chars:      spokenText.length,
      youtube_upload_ready: true,
    }).eq("id", content.id);
  } catch (dbErr) {
    console.error("DB update failed:", dbErr);
  }

  // Kick off uploader (fire-and-forget)
  fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-uploader`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_id: content.id }),
  }).catch(() => {});

  try {
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-voiceover-engine",
      status: "ok",
      response_ms: 0,
      metadata: { engine, chars: spokenText.length, content_type: contentType },
      recorded_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  return { mp3_url: mp3Url, engine };
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({
      ok: true,
      message: "roofing-voiceover-engine v4 ready",
      openai: !!OPENAI_API_KEY,
      elevenlabs: !!ELEVENLABS_API_KEY,
      routing: "shorts→OpenAI(onyx)+ELevenLabs fallback | long→ElevenLabs+OpenAI fallback",
    });
  }

  const startMs = Date.now();
  const chatId = await getChatId();

  // Single content_id mode
  if (body.content_id) {
    try {
      const { data: content, error } = await supabase
        .from("roofing_content")
        .select("id, title, type, hook, hook_text, body, portal_mention, call_to_action, seo_description, tags, thumbnail_text, mp3_url")
        .eq("id", body.content_id)
        .maybeSingle();

      if (error) throw error;
      if (!content) return Response.json({ error: "content not found" }, { status: 404 });

      // resend_only: re-deliver existing MP3 to Telegram without regenerating
      if (body.resend_only && content.mp3_url) {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("roofing-content")
          .download(`youtube/${content.id}.mp3`);
        if (dlErr || !blob) throw new Error(`Storage download failed: ${dlErr?.message || "no data"}`);
        const buf = await blob.arrayBuffer();
        await deliverToTelegram(chatId, buf, content, content.mp3_url, "cached");
        return Response.json({ ok: true, resent: true, content_id: content.id, mp3_url: content.mp3_url, duration_ms: Date.now() - startMs });
      }

      const result = await processOne(chatId, content, true);
      if (!result) return Response.json({ ok: false, error: "Both TTS engines failed" }, { status: 500 });
      return Response.json({ ok: true, content_id: content.id, ...result, duration_ms: Date.now() - startMs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await tg(chatId, `❌ Voiceover failed for \`${body.content_id}\`: ${msg.slice(0, 200)}`);
      return Response.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // Batch mode: {"batch": true, "limit": N}
  if (body.batch) {
    const limit = Math.min(body.limit || 10, 30);

    const { data: pending, error } = await supabase
      .from("roofing_content")
      .select("id, title, type, hook, hook_text, body, portal_mention, call_to_action, seo_description, tags, thumbnail_text")
      .in("type", ["youtube_short", "youtube_long", "youtube_script"])
      .eq("status", "approved")
      .is("mp3_url", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

    if (!pending?.length) {
      return Response.json({ ok: true, processed: 0, message: "no approved content pending voiceover" });
    }

    let processed = 0;
    let skipped = 0;
    const results: Array<{ id: string; title: string; engine: string | null }> = [];

    for (const content of pending) {
      try {
        // Don't send to Telegram in batch — too noisy
        const result = await processOne(chatId, content, false);
        if (result) {
          processed++;
          results.push({ id: content.id, title: content.title, engine: result.engine });
        } else {
          skipped++;
          results.push({ id: content.id, title: content.title, engine: null });
        }
      } catch (err) {
        skipped++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Batch voiceover error for ${content.id}:`, msg);
        results.push({ id: content.id, title: content.title, engine: null });
      }
      await new Promise(r => setTimeout(r, 500));
    }

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-voiceover-engine",
      status: skipped > 0 ? "error" : "ok",
      response_ms: Date.now() - startMs,
      error_message: skipped > 0 ? `${skipped} items skipped (TTS failed)` : null,
      metadata: { processed, skipped, total: pending.length },
      recorded_at: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({
      ok: true,
      processed,
      skipped,
      total: pending.length,
      results,
      duration_ms: Date.now() - startMs,
    });
  }

  // Legacy batch mode (no explicit batch:true — old youtube_script flow)
  try {
    const { data: pending, error } = await supabase
      .from("roofing_content")
      .select("id, title, type, hook, hook_text, body, portal_mention, call_to_action, seo_description, tags, thumbnail_text")
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
      const result = await processOne(chatId, content, true);
      if (result) processed++;
      else errors++;
      await new Promise(r => setTimeout(r, 1500));
    }

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-voiceover-engine",
      status: errors > 0 ? "error" : "ok",
      response_ms: Date.now() - startMs,
      metadata: { processed, errors },
      recorded_at: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({ ok: true, processed, errors, duration_ms: Date.now() - startMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

// =========================================
// NEXUS telegram — v1.2 — immediate 200, background processing via waitUntil
// =========================================

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sendTelegramMessage(chatId: number, text: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  if (!res.ok) {
    console.error("Telegram send failed:", await res.text());
  }
}

async function sendTyping(chatId: number) {
  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    },
  );
}

// Fire-and-forget: chat function sends the Telegram reply directly.
// sendTelegramMessage here is only a fallback on hard failure.
async function processMessage(text: string, chatId: number) {
  try {
    await sendTyping(chatId);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        message: text,
        channel: "telegram",
        external_id: String(chatId),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("chat function error:", err);
      await sendTelegramMessage(chatId, "Something went wrong. Try again.");
    }
  } catch (err) {
    console.error("processMessage error:", err);
    await sendTelegramMessage(chatId, "Something went wrong. Try again.");
  }
}

async function processVoiceMemo(message: any) {
  const chatId = message.chat.id;
  const voice = message.voice;
  const fileId = voice.file_id;
  const duration = voice.duration;

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    await sendTelegramMessage(chatId, "❌ Voice memo transcription not available (OPENAI_API_KEY not configured).");
    return;
  }

  await sendTelegramMessage(chatId, `🎙️ Voice memo received (${duration}s). Transcribing...`);

  // Get file path from Telegram
  const fileRes = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const fileData = await fileRes.json();
  const filePath = fileData.result?.file_path;
  if (!filePath) {
    await sendTelegramMessage(chatId, "❌ Couldn't retrieve voice file. Try again.");
    return;
  }

  // Download the voice file
  const audioRes = await fetch(
    `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
  );
  const audioBuffer = await audioRes.arrayBuffer();

  // Transcribe via Whisper
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: "audio/ogg" });
  formData.append("file", blob, "voice.ogg");
  formData.append("model", "whisper-1");
  formData.append("language", "en");

  const transcribeRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });
  const transcribeData = await transcribeRes.json();
  const transcript = transcribeData.text;

  if (!transcript) {
    await sendTelegramMessage(chatId, "❌ Couldn't transcribe that voice memo. Try again.");
    return;
  }

  // Confirm receipt
  await sendTelegramMessage(chatId, `🎙️ *Voice memo (${duration}s)*\n\n_Transcript:_ "${transcript}"\n\n_Classifying and saving..._`);

  // Forward to chat function for classification + storage
  await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      message: transcript,
      channel: "telegram",
      external_id: String(chatId),
      source: "voice_memo",
      voice_file_id: fileId,
      duration_seconds: duration,
    }),
  });
}

Deno.serve(async (req) => {
  try {
    const update = await req.json();
    const message = update.message;
    if (!message) return new Response("ok");

    const chatId = message.chat.id;

    // Handle voice memos
    if (message.voice) {
      EdgeRuntime.waitUntil(processVoiceMemo(message));
      return new Response("ok");
    }

    if (!message.text) return new Response("ok");

    const text = message.text.trim();

    if (text === "/start") {
      EdgeRuntime.waitUntil(
        sendTelegramMessage(chatId, "Nexus online. Throw ideas, thoughts, anything at me — I'll remember."),
      );
      return new Response("ok");
    }

    // Return 200 immediately so Telegram never retries.
    // All processing (typing → chat → reply) happens in the background.
    EdgeRuntime.waitUntil(processMessage(text, chatId));
    return new Response("ok");
  } catch (err) {
    console.error("Telegram handler error:", err);
    return new Response("ok");
  }
});

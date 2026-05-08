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

Deno.serve(async (req) => {
  try {
    const update = await req.json();
    const message = update.message;
    if (!message || !message.text) return new Response("ok");

    const chatId = message.chat.id;
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

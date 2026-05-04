// =========================================
// NEXUS telegram — v1.1 — forwards to /chat with persistent chat mapping
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

async function callChatFunction(message: string, telegramChatId: number) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      message,
      channel: "telegram",
      external_id: String(telegramChatId), // persistent mapping key
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "chat function failed");
  return data;
}

Deno.serve(async (req) => {
  try {
    const update = await req.json();
    const message = update.message;
    if (!message || !message.text) return new Response("ok");

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text === "/start") {
      await sendTelegramMessage(
        chatId,
        "Nexus online. Throw ideas, thoughts, anything at me — I'll remember.",
      );
      return new Response("ok");
    }

    await sendTyping(chatId);
    const result = await callChatFunction(text, chatId);
    await sendTelegramMessage(chatId, result.reply);

    return new Response("ok");
  } catch (err) {
    console.error("Telegram handler error:", err);
    return new Response("ok");
  }
});
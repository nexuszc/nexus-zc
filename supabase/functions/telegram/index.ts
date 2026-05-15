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

    // ── Roofing OS Marketing Commands ──────────────────────────────────────

    // approve content [id]
    const approveContentMatch = text.match(/^approve content ([a-f0-9-]{36})$/i);
    if (approveContentMatch) {
      EdgeRuntime.waitUntil((async () => {
        const contentId = approveContentMatch[1];
        try {
          const { data: content } = await fetch(`${SUPABASE_URL}/functions/v1/roofing-seo-publisher`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content_id: contentId })
          }).then(r => r.json()).catch(() => ({ data: null }));

          // Also mark non-blog content as approved
          const supRes = await fetch(`${SUPABASE_URL}/rest/v1/roofing_content?id=eq.${contentId}&select=type,status`, {
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY }
          });
          const rows = await supRes.json().catch(() => []);
          const row = rows[0];

          if (row && row.type !== "blog") {
            await fetch(`${SUPABASE_URL}/rest/v1/roofing_content?id=eq.${contentId}`, {
              method: "PATCH",
              headers: {
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ status: "approved", approved_at: new Date().toISOString() })
            });
            await sendTelegramMessage(chatId, `✅ Content approved.`);

            // Auto-fire voiceover for youtube scripts
            if (row.type === "youtube_script") {
              fetch(`${SUPABASE_URL}/functions/v1/roofing-voiceover-engine`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ content_id: contentId })
              }).catch(() => {});
            }
          }
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Approve content failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // approve storm [bundle_id]
    const approveStormMatch = text.match(/^approve storm ([a-f0-9-]{36})$/i);
    if (approveStormMatch) {
      EdgeRuntime.waitUntil((async () => {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-storm-marketing`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "fire", bundle_id: approveStormMatch[1] })
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Storm approve failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // approve community [id]
    const approveCommunityMatch = text.match(/^approve community ([a-f0-9-]{36})$/i);
    if (approveCommunityMatch) {
      EdgeRuntime.waitUntil((async () => {
        try {
          const postId = approveCommunityMatch[1];
          await fetch(`${SUPABASE_URL}/rest/v1/roofing_community_posts?id=eq.${postId}`, {
            method: "PATCH",
            headers: {
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "apikey": SUPABASE_SERVICE_ROLE_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ status: "approved", approved_at: new Date().toISOString() })
          });

          const postRes = await fetch(`${SUPABASE_URL}/rest/v1/roofing_community_posts?id=eq.${postId}&select=our_response,thread_url`, {
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY }
          });
          const posts = await postRes.json().catch(() => []);
          const post = posts[0];

          if (post) {
            await sendTelegramMessage(chatId,
              `✅ Community response approved.\n\n*Copy this response:*\n\n${post.our_response}\n\n🔗 Post: ${post.thread_url}`
            );
          }
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Community approve failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // marketing report
    if (/^marketing report$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        await sendTelegramMessage(chatId, "📊 Generating marketing report...");
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-weekly-marketing-report`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({})
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Report failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // content queue
    if (/^content queue$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/roofing_content?status=eq.pending&select=id,type,title,created_at&order=created_at.desc&limit=15`, {
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY }
          });
          const items = await res.json().catch(() => []);
          if (!items.length) {
            await sendTelegramMessage(chatId, "✅ No pending content in queue.");
            return;
          }
          const lines = items.map((item: any) =>
            `• [${item.type}] ${(item.title || "Untitled").slice(0, 50)}\n  \`approve content ${item.id}\``
          ).join("\n\n");
          await sendTelegramMessage(chatId, `📋 *Content Queue (${items.length} pending)*\n\n${lines}`);
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Queue fetch failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // storm marketing: [city]
    const stormCityMatch = text.match(/^storm marketing:\s*(.+)$/i);
    if (stormCityMatch) {
      EdgeRuntime.waitUntil((async () => {
        const city = stormCityMatch[1].trim();
        await sendTelegramMessage(chatId, `⛈️ Generating storm marketing bundle for: ${city}...`);
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-storm-marketing`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ city, zip_codes: [], hail_size: 1.5 })
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Storm marketing failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // ── Content Machine Commands ────────────────────────────────────────────

    // youtube now
    if (/^youtube now$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        await sendTelegramMessage(chatId, `🎬 Generating all 8 YouTube scripts now... (will take 3-5 min)`);
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-engine`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({})
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ YouTube engine failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // email stats
    if (/^email stats$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-email-nurture`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "stats" })
          });
          const data = await res.json().catch(() => ({}));
          await sendTelegramMessage(chatId,
            `✉️ *Email Nurture Stats*\n\n` +
            `Active sequences: ${data.active || 0}\n` +
            `Completed: ${data.completed || 0}\n` +
            `Unsubscribed: ${data.unsubscribed || 0}\n` +
            `Sent last 7 days: ${data.sent_last_7d || 0}`
          );
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Email stats failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // enroll prospects
    if (/^enroll prospects$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        await sendTelegramMessage(chatId, `📧 Enrolling new prospects into email nurture...`);
        try {
          // Get all prospects with email not yet enrolled
          const prospectsRes = await fetch(`${SUPABASE_URL}/rest/v1/roofing_prospects?select=id&not.email=is.null&order=created_at.desc&limit=100`, {
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY }
          });
          const prospects = await prospectsRes.json().catch(() => []);
          if (!prospects.length) {
            await sendTelegramMessage(chatId, `ℹ️ No prospects with email found.`);
            return;
          }
          const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-email-nurture`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "enroll", prospects })
          });
          const data = await res.json().catch(() => ({}));
          await sendTelegramMessage(chatId, `✅ Enrolled ${data.enrolled || 0} prospects into email nurture.`);
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Enroll failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // community [run]
    if (/^community(\s+run)?$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        await sendTelegramMessage(chatId, `🗣️ Scanning community posts...`);
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-community-monitor`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({})
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Community scan failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // uploaded [content_id] — mark script as published after YouTube Studio upload
    const uploadedMatch = text.match(/^uploaded ([a-f0-9-]{36})$/i);
    if (uploadedMatch) {
      EdgeRuntime.waitUntil((async () => {
        const contentId = uploadedMatch[1];
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/roofing_content?id=eq.${contentId}`, {
            method: "PATCH",
            headers: {
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              "apikey": SUPABASE_SERVICE_ROLE_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ status: "published", published_at: new Date().toISOString() })
          });
          await sendTelegramMessage(chatId, `✅ Marked as published.\nGreat content live on YouTube.`);
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Failed to mark published: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // publish youtube [id] OR publish youtube (batch — all approved)
    const publishYouTubeMatch = text.match(/^publish youtube(?:\s+([a-f0-9-]{36}))?$/i);
    if (publishYouTubeMatch) {
      EdgeRuntime.waitUntil((async () => {
        const contentId = publishYouTubeMatch[1];
        if (contentId) {
          await sendTelegramMessage(chatId, `🎬 Publishing YouTube script ${contentId}... (voiceover + blog + Telegram delivery)`);
        } else {
          await sendTelegramMessage(chatId, `🎬 Publishing all approved YouTube scripts... (may take a few minutes)`);
        }
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-publisher`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(contentId ? { content_id: contentId } : {})
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ YouTube publisher failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // ── End Roofing OS Commands ─────────────────────────────────────────────

    // Return 200 immediately so Telegram never retries.
    // All processing (typing → chat → reply) happens in the background.
    EdgeRuntime.waitUntil(processMessage(text, chatId));
    return new Response("ok");
  } catch (err) {
    console.error("Telegram handler error:", err);
    return new Response("ok");
  }
});

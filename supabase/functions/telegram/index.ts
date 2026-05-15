// =========================================
// NEXUS telegram — v2.0 — inline buttons, callback_query handling
// =========================================

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sendTelegramMessage(chatId: number, text: string, parse_mode = "Markdown") {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode,
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

async function sendWithButtons(
  chatId: number,
  text: string,
  buttons: Array<Array<{ text: string; callback_data: string }>>,
) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons },
    }),
  }).catch(() => {});
}

async function answerCallback(queryId: string, text?: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: queryId, text: text || "", show_alert: false }),
  }).catch(() => {});
}

async function editMessage(chatId: number, messageId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, 4096),
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

async function sendTyping(chatId: number) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

async function processMessage(text: string, chatId: number) {
  try {
    await sendTyping(chatId);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ message: text, channel: "telegram", external_id: String(chatId) }),
    });
    if (!res.ok) {
      await sendTelegramMessage(chatId, "Something went wrong. Try again.");
    }
  } catch {
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
    await sendTelegramMessage(chatId, "❌ Voice memo transcription not available.");
    return;
  }

  await sendTelegramMessage(chatId, `🎙️ Voice memo received (${duration}s). Transcribing...`);

  const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const filePath = fileData.result?.file_path;
  if (!filePath) {
    await sendTelegramMessage(chatId, "❌ Couldn't retrieve voice file. Try again.");
    return;
  }

  const audioRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
  const audioBuffer = await audioRes.arrayBuffer();

  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "voice.ogg");
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
    await sendTelegramMessage(chatId, "❌ Couldn't transcribe. Try again.");
    return;
  }

  await sendTelegramMessage(chatId, `🎙️ *Voice memo (${duration}s)*\n\n_"${transcript}"_\n\nClassifying and saving...`);

  await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({
      message: transcript, channel: "telegram", external_id: String(chatId),
      source: "voice_memo", voice_file_id: fileId, duration_seconds: duration,
    }),
  });
}

// ── CALLBACK QUERY HANDLER ─────────────────────────────────────────────────────
// Handles all inline button taps

async function handleCallbackQuery(callbackQuery: any) {
  const chatId: number = callbackQuery.from.id;
  const messageId: number = callbackQuery.message.message_id;
  const queryId: string = callbackQuery.id;
  const data: string = callbackQuery.data || "";

  const colonIdx = data.indexOf(":");
  const action = colonIdx !== -1 ? data.slice(0, colonIdx) : data;
  const id = colonIdx !== -1 ? data.slice(colonIdx + 1) : "";

  const headers = {
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };

  // ── YOUTUBE SCRIPT ──────────────────────────────────────────────────────────
  if (action === "yt_approve") {
    await answerCallback(queryId, "Approved — generating voiceover...");
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/roofing_content?id=eq.${id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ status: "approved", approved_at: new Date().toISOString() }),
      });
      fetch(`${SUPABASE_URL}/functions/v1/roofing-voiceover-engine`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content_id: id }),
      }).catch(() => {});
      await editMessage(chatId, messageId, `✅ *Approved* — voiceover generating...\nMP3 and upload checklist arriving shortly.`);
    } catch (e) {
      await editMessage(chatId, messageId, `❌ Approval failed: ${e}`);
    }
  }

  else if (action === "yt_skip") {
    await answerCallback(queryId, "Skipped");
    await fetch(`${SUPABASE_URL}/rest/v1/roofing_content?id=eq.${id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ status: "skipped" }),
    }).catch(() => {});
    await editMessage(chatId, messageId, `❌ *Skipped*`);
  }

  // ── COMMUNITY POST ──────────────────────────────────────────────────────────
  else if (action === "comm_approve") {
    await answerCallback(queryId, "Approved!");
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/roofing_community_posts?id=eq.${id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ status: "approved", approved_at: new Date().toISOString() }),
      });
      const postRes = await fetch(
        `${SUPABASE_URL}/rest/v1/roofing_community_posts?id=eq.${id}&select=our_response,thread_url`,
        { headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY } }
      );
      const posts = await postRes.json().catch(() => []);
      const post = posts[0];
      if (post?.our_response) {
        await editMessage(chatId, messageId,
          `✅ *Approved — post this response:*\n\n${post.our_response.slice(0, 3500)}\n\n🔗 ${post.thread_url || ""}`
        );
      } else {
        await editMessage(chatId, messageId, `✅ *Community post approved*`);
      }
    } catch (e) {
      await editMessage(chatId, messageId, `❌ Failed: ${e}`);
    }
  }

  else if (action === "comm_skip") {
    await answerCallback(queryId, "Skipped");
    await fetch(`${SUPABASE_URL}/rest/v1/roofing_community_posts?id=eq.${id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ status: "skipped" }),
    }).catch(() => {});
    await editMessage(chatId, messageId, `❌ *Skipped*`);
  }

  // ── STORM BUNDLE ────────────────────────────────────────────────────────────
  else if (action === "storm_fire") {
    await answerCallback(queryId, "Firing storm bundle...");
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/roofing-storm-marketing`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fire", bundle_id: id }),
      });
      await editMessage(chatId, messageId, `⛈️ *Storm bundle fired!*\nEmails + SMS sending now to affected contractors.`);
    } catch (e) {
      await editMessage(chatId, messageId, `❌ Storm fire failed: ${e}`);
    }
  }

  else if (action === "storm_skip") {
    await answerCallback(queryId, "Skipped");
    await editMessage(chatId, messageId, `❌ *Storm bundle skipped*`);
  }

  // ── IMPROVEMENT PROPOSAL ────────────────────────────────────────────────────
  else if (action === "improve_build") {
    await answerCallback(queryId, "Queuing build...");
    try {
      const impRes = await fetch(
        `${SUPABASE_URL}/rest/v1/roofing_improvements?id=eq.${id}&select=*`,
        { headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY } }
      );
      const improvements = await impRes.json().catch(() => []);
      const improvement = improvements?.[0];

      await fetch(`${SUPABASE_URL}/rest/v1/roofing_improvements?id=eq.${id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ status: "approved", approved_at: new Date().toISOString() }),
      });

      if (improvement) {
        fetch(`${SUPABASE_URL}/functions/v1/nexus-build`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            improvement_id: improvement.id,
            title: improvement.title,
            problem: improvement.problem,
            solution: improvement.proposed_solution,
            implementation_plan: improvement.implementation_plan,
            source: "roofing_improvement",
          }),
        }).catch(() => {});
      }

      await editMessage(chatId, messageId, `🔨 *Building: ${improvement?.title || id.slice(0, 8)}*\nI'll notify you when it's ready to test.`);
    } catch (e) {
      await editMessage(chatId, messageId, `❌ Build failed: ${e}`);
    }
  }

  else if (action === "improve_skip") {
    await answerCallback(queryId, "Skipped");
    await fetch(`${SUPABASE_URL}/rest/v1/roofing_improvements?id=eq.${id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ status: "skipped" }),
    }).catch(() => {});
    await editMessage(chatId, messageId, `❌ *Improvement skipped*`);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const update = await req.json();

    // ── INLINE BUTTON PRESS ────────────────────────────────────────────────────
    if (update.callback_query) {
      EdgeRuntime.waitUntil(handleCallbackQuery(update.callback_query));
      return new Response("ok");
    }

    const message = update.message;
    if (!message) return new Response("ok");

    const chatId = message.chat.id;

    if (message.voice) {
      EdgeRuntime.waitUntil(processVoiceMemo(message));
      return new Response("ok");
    }

    if (!message.text) return new Response("ok");

    const text = message.text.trim();

    if (text === "/start") {
      EdgeRuntime.waitUntil(sendTelegramMessage(chatId, "Nexus online. Throw ideas, thoughts, anything at me — I'll remember."));
      return new Response("ok");
    }

    // ── CONTENT APPROVALS (text fallback — inline buttons are the primary path) ──

    const approveContentMatch = text.match(/^approve content ([a-f0-9-]{36})$/i);
    if (approveContentMatch) {
      EdgeRuntime.waitUntil((async () => {
        const contentId = approveContentMatch[1];
        try {
          const supRes = await fetch(
            `${SUPABASE_URL}/rest/v1/roofing_content?id=eq.${contentId}&select=type,status`,
            { headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY } }
          );
          const rows = await supRes.json().catch(() => []);
          const row = rows[0];

          if (row && row.type !== "blog") {
            await fetch(`${SUPABASE_URL}/rest/v1/roofing_content?id=eq.${contentId}`, {
              method: "PATCH",
              headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" },
              body: JSON.stringify({ status: "approved", approved_at: new Date().toISOString() }),
            });
            if (row.type === "youtube_script") {
              fetch(`${SUPABASE_URL}/functions/v1/roofing-voiceover-engine`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ content_id: contentId }),
              }).catch(() => {});
              await sendTelegramMessage(chatId, `✅ Approved — voiceover generating...`);
            } else {
              await sendTelegramMessage(chatId, `✅ Content approved.`);
            }
          }

          // Blog: publish via SEO publisher
          if (row?.type === "blog") {
            await fetch(`${SUPABASE_URL}/functions/v1/roofing-seo-publisher`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ content_id: contentId }),
            });
          }
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Approve failed: ${e}`);
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
            body: JSON.stringify({ action: "fire", bundle_id: approveStormMatch[1] }),
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
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ status: "approved", approved_at: new Date().toISOString() }),
          });
          const postRes = await fetch(
            `${SUPABASE_URL}/rest/v1/roofing_community_posts?id=eq.${postId}&select=our_response,thread_url`,
            { headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY } }
          );
          const posts = await postRes.json().catch(() => []);
          const post = posts[0];
          if (post) {
            await sendTelegramMessage(chatId, `✅ *Copy this response:*\n\n${post.our_response}\n\n🔗 ${post.thread_url}`);
          }
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Community approve failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // uploaded [content_id]
    const uploadedMatch = text.match(/^uploaded ([a-f0-9-]{36})$/i);
    if (uploadedMatch) {
      EdgeRuntime.waitUntil((async () => {
        const contentId = uploadedMatch[1];
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/roofing_content?id=eq.${contentId}`, {
            method: "PATCH",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ status: "published", published_at: new Date().toISOString() }),
          });
          await sendTelegramMessage(chatId, `✅ Published. Great content live on YouTube.`);
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Failed to mark published: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // content queue — show pending items with inline approve/skip buttons
    if (/^content queue$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        try {
          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/roofing_content?status=eq.pending&select=id,type,title&order=created_at.desc&limit=8`,
            { headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY } }
          );
          const items = await res.json().catch(() => []);
          if (!items.length) {
            await sendTelegramMessage(chatId, "✅ No pending content in queue.");
            return;
          }
          for (const item of items.slice(0, 5)) {
            const isYt = item.type === "youtube_script";
            const approveAction = isYt ? `yt_approve:${item.id}` : `comm_approve:${item.id}`;
            const skipAction = isYt ? `yt_skip:${item.id}` : `comm_skip:${item.id}`;
            const approveLabel = isYt ? "✅ Approve & Generate Voiceover" : "✅ Approve & Post";
            await sendWithButtons(
              chatId,
              `*[${item.type}]* ${(item.title || "Untitled").slice(0, 200)}`,
              [[
                { text: approveLabel, callback_data: approveAction },
                { text: "❌ Skip", callback_data: skipAction },
              ]]
            );
          }
          if (items.length > 5) {
            await sendTelegramMessage(chatId, `_Showing 5 of ${items.length} pending items._`);
          }
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Queue fetch failed: ${e}`);
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
            body: JSON.stringify({}),
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Report failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // youtube now
    if (/^youtube now$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        await sendTelegramMessage(chatId, `🎬 Generating 8 YouTube scripts... (3-5 min)`);
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-engine`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ YouTube engine failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // enroll prospects
    if (/^enroll prospects$/i.test(text)) {
      EdgeRuntime.waitUntil((async () => {
        await sendTelegramMessage(chatId, `📧 Enrolling prospects into email nurture...`);
        try {
          const prospectsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/roofing_prospects?select=id&not.email=is.null&order=created_at.desc&limit=100`,
            { headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "apikey": SUPABASE_SERVICE_ROLE_KEY } }
          );
          const prospects = await prospectsRes.json().catch(() => []);
          if (!prospects.length) {
            await sendTelegramMessage(chatId, `ℹ️ No prospects with email found.`);
            return;
          }
          const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-email-nurture`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "enroll", prospects }),
          });
          const data = await res.json().catch(() => ({}));
          await sendTelegramMessage(chatId, `✅ Enrolled ${data.enrolled || 0} prospects.`);
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Enroll failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // storm marketing: [city]
    const stormCityMatch = text.match(/^storm marketing:\s*(.+)$/i);
    if (stormCityMatch) {
      EdgeRuntime.waitUntil((async () => {
        const city = stormCityMatch[1].trim();
        await sendTelegramMessage(chatId, `⛈️ Generating storm bundle for: ${city}...`);
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-storm-marketing`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ city, zip_codes: [], hail_size: 1.5 }),
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Storm marketing failed: ${e}`);
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
            body: JSON.stringify({ action: "stats" }),
          });
          const data = await res.json().catch(() => ({}));
          await sendTelegramMessage(chatId,
            `✉️ *Email Nurture*\n\nActive: ${data.active || 0}\nCompleted: ${data.completed || 0}\nUnsubscribed: ${data.unsubscribed || 0}\nSent last 7d: ${data.sent_last_7d || 0}`
          );
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Email stats failed: ${e}`);
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
            body: JSON.stringify({}),
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ Community scan failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // publish youtube [id] OR batch
    const publishYouTubeMatch = text.match(/^publish youtube(?:\s+([a-f0-9-]{36}))?$/i);
    if (publishYouTubeMatch) {
      EdgeRuntime.waitUntil((async () => {
        const contentId = publishYouTubeMatch[1];
        await sendTelegramMessage(chatId, contentId
          ? `🎬 Publishing YouTube script ${contentId.slice(0, 8)}...`
          : `🎬 Publishing all approved YouTube scripts...`
        );
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-publisher`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(contentId ? { content_id: contentId } : {}),
          });
        } catch (e) {
          await sendTelegramMessage(chatId, `❌ YouTube publisher failed: ${e}`);
        }
      })());
      return new Response("ok");
    }

    // All other text → chat function
    EdgeRuntime.waitUntil(processMessage(text, chatId));
    return new Response("ok");
  } catch (err) {
    console.error("Telegram handler error:", err);
    return new Response("ok");
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

async function sendTelegram(token: string, chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { message, channel = "web", external_id = null } = body;
    if (!message) return new Response(JSON.stringify({ error: "message required" }), { status: 400 });

    const msgLower = message.toLowerCase().trim();
    const tgChatId = channel === "telegram" && external_id ? Number(external_id) : null;

    const earlyReturn = async (reply: string) => {
      const LIMIT = 4000;
      const tgMessage = reply.length > LIMIT
        ? reply.slice(0, LIMIT) + '... (truncated — full version saved to Nexus memory)'
        : reply;
      if (tgChatId && TELEGRAM_BOT_TOKEN) await sendTelegram(TELEGRAM_BOT_TOKEN, tgChatId, tgMessage);
      return new Response(JSON.stringify({ reply }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    // ================================================================
    // CLIENT COMMAND SHORTCUTS
    // ================================================================

    if (msgLower.startsWith("new client:") || msgLower.startsWith("add client:")) {
      const clientName = message.split(":").slice(1).join(":").trim();
      const { data: newClient, error } = await supabase
        .from("clients").insert({ name: clientName, status: "active" }).select().single();
      if (error) return earlyReturn(`❌ Failed to create client: ${error.message}`);
      return earlyReturn(`✅ Client brain created for ${clientName} (ID: ${newClient.id})\n\nSet up their context:\n• "client context: ${clientName} | deal: rev_share | offer: [their offer] | goals: [their goals]"\n• "assign va: ${clientName} | va: [VA name]"`);
    }

    if (msgLower.startsWith("client context:")) {
      const parts = message.slice(15).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const contextFields: any = {};
      const clientFields: any = {};
      for (const part of parts.slice(1)) {
        const colonIdx = part.indexOf(":");
        if (colonIdx === -1) continue;
        const k = part.slice(0, colonIdx).trim().toLowerCase();
        const v = part.slice(colonIdx + 1).trim();
        if (k === "deal") clientFields.deal_type = v;
        if (k === "fee") clientFields.monthly_fee = parseFloat(v);
        if (k === "revshare") clientFields.rev_share_pct = parseFloat(v);
        if (k === "offer") contextFields.core_offer = v;
        if (k === "goals") contextFields.goals = v;
        if (k === "audience") contextFields.target_audience = v;
        if (k === "voice") contextFields.brand_voice = v;
        if (k === "script") contextFields.script = v;
        if (k === "pain") contextFields.pain_points = v;
        if (k === "notes") contextFields.additional_context = v;
      }
      const { data: client } = await supabase
        .from("clients").select("id").ilike("name", `%${clientName}%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!client) return earlyReturn(`❌ Client "${clientName}" not found. Create them first with "new client: ${clientName}"`);
      if (Object.keys(clientFields).length) await supabase.from("clients").update(clientFields).eq("id", client.id);
      if (Object.keys(contextFields).length) {
        await supabase.from("client_context").upsert({
          client_id: client.id, ...contextFields, updated_at: new Date().toISOString(),
        });
      }
      return earlyReturn(`✅ Context updated for ${clientName}.`);
    }

    if (msgLower.startsWith("assign va:")) {
      const parts = message.slice(10).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const vaName = parts.find((p: string) => p.toLowerCase().startsWith("va:"))?.split(":").slice(1).join(":").trim();
      const vaContact = parts.find((p: string) => p.toLowerCase().startsWith("contact:"))?.split(":").slice(1).join(":").trim();
      const { data: client } = await supabase
        .from("clients").select("id").ilike("name", `%${clientName}%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!client) return earlyReturn(`❌ Client "${clientName}" not found.`);
      if (!vaName) return earlyReturn(`❌ VA name required. Format: "assign va: ${clientName} | va: [name]"`);
      await supabase.from("va_assignments").insert({ client_id: client.id, va_name: vaName, va_contact: vaContact || null });
      return earlyReturn(`✅ ${vaName} assigned to ${clientName}.`);
    }

    // ================================================================
    // PROVISION CLIENT COMMAND
    // ================================================================
    if (msgLower.startsWith("provision:")) {
      const parts = message.slice(10).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const dealType = parts.find((p: string) => p.toLowerCase().startsWith("type:"))?.slice(5).trim();
      const about = parts.find((p: string) => p.toLowerCase().startsWith("about:"))?.slice(6).trim();

      let { data: client } = await supabase
        .from("clients")
        .select("id, name, provision_status, slug")
        .ilike("name", `%${clientName}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!client) {
        const { data: newClient } = await supabase
          .from("clients")
          .insert({ name: clientName, status: "active", deal_type: dealType || null })
          .select().single();
        client = newClient;
      }

      if (client.provision_status === "live") {
        return earlyReturn(`✅ ${clientName} is already provisioned at https://${client.slug}.nexuszc.com`);
      }

      if (about && client) {
        await supabase.from("client_context").upsert({
          client_id: client.id,
          core_offer: about,
          updated_at: new Date().toISOString(),
        });
      }

      // Fire and forget — provision function sends its own Telegram updates
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/provision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          client_id: client.id,
          telegram_chat_id: external_id,
        }),
      });

      return earlyReturn(`⚙️ Provisioning ${clientName}...\n\nI'll message you when the site is live. This takes about 60 seconds.`);
    }

    // ================================================================
    // TASK COMPLETION
    // ================================================================
    if (msgLower === "done all") {
      await supabase.from("entries").update({ task_status: "done" }).eq("task_status", "open");
    } else if (msgLower.startsWith("done:")) {
      const taskDesc = message.slice(5).trim();
      await supabase.from("entries").update({ task_status: "done" }).eq("task_status", "open").ilike("content", `%${taskDesc}%`);
    }

    // ================================================================
    // RESOLVE CONVERSATION (moved up so abilities can save entries)
    // ================================================================
    let conversationId: string | null = null;
    if (channel && external_id) {
      const { data: existing } = await supabase
        .from("channel_conversations")
        .select("conversation_id")
        .eq("channel", channel).eq("external_id", String(external_id)).maybeSingle();
      if (existing) conversationId = existing.conversation_id;
      else {
        const { data: newConv } = await supabase
          .from("conversations").insert({ channel, title: `${channel}:${external_id}` }).select().single();
        conversationId = newConv!.id;
        await supabase.from("channel_conversations").insert({
          channel, external_id: String(external_id), conversation_id: conversationId,
        });
      }
    } else {
      const { data: newConv } = await supabase
        .from("conversations").insert({ channel: channel || "web", title: "ad-hoc" }).select().single();
      conversationId = newConv!.id;
    }

    // ================================================================
    // ABILITY 1: WEB SEARCH
    // ================================================================
    if (msgLower.startsWith("search:")) {
      const query = message.slice(7).trim();
      const results = await webSearch(query);
      const summary = await summarizeSearchResults(query, results);
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "assistant",
        content: `SEARCH: ${query}\n\n${summary}`,
        entry_type: "note", importance: 6, tags: ["search", "research"],
        classification_status: "skip",
      });
      return earlyReturn(`🔍 Search: ${query}\n\n${summary}`);
    }

    // ================================================================
    // ABILITY 2: URL SUMMARIZATION
    // ================================================================
    if (msgLower.startsWith("summarize:")) {
      const url = message.slice(10).trim();
      const summary = await summarizeUrl(url);
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "assistant",
        content: `URL SUMMARY: ${url}\n\n${summary}`,
        entry_type: "note", importance: 6, tags: ["research", "url"],
        classification_status: "skip",
      });
      return earlyReturn(`🔗 Summary of ${url}\n\n${summary}`);
    }

    // ================================================================
    // ABILITY 3: EMAIL DRAFTING + SENDING
    // ================================================================
    if (msgLower.startsWith("draft email:")) {
      const parts = message.slice(12).split("|").map((p: string) => p.trim());
      const to = parts[0];
      const subject = parts.find((p: string) => p.toLowerCase().startsWith("subject:"))?.slice(8).trim() || "Follow-up";
      const about = parts.find((p: string) => p.toLowerCase().startsWith("about:"))?.slice(6).trim() || parts.slice(1).join(" ");
      const draft = await draftEmail(to, subject, about);
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "assistant",
        content: `EMAIL DRAFT to ${to}\nSubject: ${subject}\n\n${draft}`,
        entry_type: "note", importance: 7, tags: ["email", "draft"],
        classification_status: "skip",
      });
      return earlyReturn(`📧 Email draft to ${to}\nSubject: ${subject}\n\n${draft}\n\n---\nTo send: "send email: ${to} | subject: ${subject} | body: [paste or edit above]"`);
    }

    if (msgLower.startsWith("send email:")) {
      const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID");
      if (!GMAIL_CLIENT_ID) {
        return earlyReturn("⚠️ Gmail not configured yet. Email draft saved to memory. Set up Gmail API keys to enable sending.");
      }
      const parts = message.slice(11).split("|").map((p: string) => p.trim());
      const to = parts[0];
      const subject = parts.find((p: string) => p.toLowerCase().startsWith("subject:"))?.slice(8).trim() || "Follow-up";
      const emailBody = parts.find((p: string) => p.toLowerCase().startsWith("body:"))?.slice(5).trim() || "";
      const result = await sendGmail(to, subject, emailBody);
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "assistant",
        content: `EMAIL SENT to ${to}\nSubject: ${subject}\n\n${emailBody}`,
        entry_type: "note", importance: 8, tags: ["email", "sent"],
        classification_status: "skip",
      });
      return earlyReturn(result ? `✅ Email sent to ${to}` : `❌ Failed to send email. Check logs.`);
    }

    // ================================================================
    // ABILITY 4: DOCUMENT GENERATION
    // ================================================================
    const docTypes = ["generate proposal:", "generate script:", "generate report:", "generate onepager:"];
    const matchedDoc = docTypes.find(d => msgLower.startsWith(d));
    if (matchedDoc) {
      const docType = matchedDoc.replace("generate ", "").replace(":", "").trim();
      const rest = message.slice(matchedDoc.length).trim();
      const parts = rest.split("|").map((p: string) => p.trim());
      const subject = parts[0];
      const details = parts.slice(1).join(" | ");
      const { data: clientData } = await supabase
        .from("clients").select("*, client_context(*)")
        .ilike("name", `%${subject}%`)
        .limit(1).maybeSingle();
      const doc = await generateDocument(docType, subject, details, clientData);
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "assistant",
        content: `${docType.toUpperCase()}: ${subject}\n\n${doc}`,
        entry_type: "note", importance: 8, tags: ["document", docType],
        client_id: clientData?.id || null,
        classification_status: "skip",
      });
      return earlyReturn(`📄 ${docType.charAt(0).toUpperCase() + docType.slice(1)}: ${subject}\n\n${doc}`);
    }

    // ================================================================
    // ABILITY 5: TELEGRAM REMINDERS
    // ================================================================
    if (msgLower.startsWith("remind me:")) {
      const parts = message.slice(10).split("|").map((p: string) => p.trim());
      const reminderText = parts[0];
      const timePart = parts.find((p: string) => p.toLowerCase().startsWith("in:") || p.toLowerCase().startsWith("at:")) || "";
      const fireAt = parseReminderTime(timePart);
      if (!fireAt) return earlyReturn(`❌ Couldn't parse time. Try: "remind me: [what] | in: 2 hours" or "in: 3 days"`);
      const chatId = external_id || "";
      await supabase.from("reminders").insert({
        chat_id: chatId,
        message: `⏰ Reminder: ${reminderText}`,
        fire_at: fireAt.toISOString(),
      });
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "user",
        content: `REMINDER SET: ${reminderText} at ${fireAt.toISOString()}`,
        entry_type: "task", importance: 7, tags: ["reminder"],
        classification_status: "skip",
      });
      return earlyReturn(`⏰ Reminder set: "${reminderText}"\nFires: ${fireAt.toLocaleString("en-US", { timeZone: "America/Denver" })} MT`);
    }

    // ================================================================
    // ABILITY 6: RESEARCH MODE
    // ================================================================
    if (msgLower.startsWith("research:")) {
      const target = message.slice(9).trim();
      const [generalResults, newsResults] = await Promise.all([
        webSearch(target),
        webSearch(`${target} news 2025 2026`),
      ]);
      const allResults = [...generalResults, ...newsResults];
      const research = await synthesizeResearch(target, allResults);
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "assistant",
        content: `RESEARCH: ${target}\n\n${research}`,
        entry_type: "note", importance: 8, tags: ["research", "intelligence"],
        classification_status: "skip",
      });
      return earlyReturn(`🧠 Research: ${target}\n\n${research}`);
    }

    // ================================================================
    // ABILITY 7: COMPETITIVE RESEARCH
    // ================================================================
    if (msgLower.startsWith("competitors:")) {
      const market = message.slice(12).trim();
      const results = await webSearch(`${market} competitors alternatives 2025`);
      const analysis = await competitiveAnalysis(market, results);
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "assistant",
        content: `COMPETITIVE ANALYSIS: ${market}\n\n${analysis}`,
        entry_type: "note", importance: 7, tags: ["research", "competitive"],
        classification_status: "skip",
      });
      return earlyReturn(`⚔️ Competitive Analysis: ${market}\n\n${analysis}`);
    }

    // ================================================================
    // ABILITY 8: CLIENT REPORT
    // ================================================================
    if (msgLower.startsWith("report:")) {
      const clientName = message.slice(7).trim();
      const { data: client } = await supabase
        .from("clients")
        .select("*, client_context(*), va_assignments(*)")
        .ilike("name", `%${clientName}%`)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (!client) return earlyReturn(`❌ Client "${clientName}" not found.`);
      const [{ data: recentEntries }, { data: openTasks }] = await Promise.all([
        supabase.from("entries").select("content, entry_type, created_at, role")
          .eq("client_id", client.id).order("created_at", { ascending: false }).limit(30),
        supabase.from("entries").select("content, created_at")
          .eq("client_id", client.id).eq("task_status", "open"),
      ]);
      const report = await generateClientReport(client, recentEntries || [], openTasks || []);
      await supabase.from("entries").insert({
        conversation_id: conversationId, source: channel, role: "assistant",
        content: `CLIENT REPORT: ${client.name}\n\n${report}`,
        entry_type: "note", importance: 8, tags: ["report", "client"],
        client_id: client.id,
        classification_status: "skip",
      });
      return earlyReturn(`📊 Client Report: ${client.name}\n\n${report}`);
    }

    // ================================================================
    // FETCH CONTEXT + CLASSIFY
    // ================================================================
    const { data: projectsList } = await supabase
      .from("projects").select("name, category").neq("category", "archived");
    const { data: peopleList } = await supabase.from("people").select("name");

    const establishedNames = (projectsList || []).filter((p: any) => p.category !== "idea").map((p: any) => p.name);
    const ideaNames = (projectsList || []).filter((p: any) => p.category === "idea").map((p: any) => p.name);
    const allProjectNames = [...establishedNames, ...ideaNames];
    const peopleNames = (peopleList || []).map((p: any) => p.name);

    const classification = await classifyEntry(message, establishedNames, ideaNames, peopleNames);

    for (const name of classification.projects || []) {
      const exists = allProjectNames.some((p: string) => p.toLowerCase() === name.toLowerCase());
      if (!exists) await supabase.from("projects").insert({ name, category: "idea" }).select();
    }
    for (const name of classification.people || []) {
      const exists = peopleNames.some((p: string) => p.toLowerCase() === name.toLowerCase());
      if (!exists) await supabase.from("people").insert({ name }).select();
    }

    // ================================================================
    // LAYERED RETRIEVAL
    // ================================================================
    const [recentEntries, projectEntries, peopleEntries, semanticEntries] = await Promise.all([
      supabase.from("entries").select("role, content, created_at")
        .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20),
      classification.projects?.length
        ? supabase.from("entries").select("role, content, created_at, entry_type, importance, project_names")
            .overlaps("project_names", classification.projects)
            .order("created_at", { ascending: false }).limit(15)
        : Promise.resolve({ data: [] }),
      classification.people?.length
        ? supabase.from("entries").select("role, content, created_at, entry_type, people_names")
            .overlaps("people_names", classification.people)
            .order("created_at", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] }),
      semanticSearch(supabase, message, 8),
    ]);

    const contextBlock = buildContext({
      recent: recentEntries.data || [],
      projects: projectEntries.data || [],
      people: peopleEntries.data || [],
      semantic: semanticEntries || [],
    });

    // ================================================================
    // GENERATE RESPONSE + SAVE
    // ================================================================
    const reply = await callClaude(message, contextBlock, establishedNames, ideaNames);
    const taskStatus = classification.type === "task" ? "open" : null;

    const { data: userEntry } = await supabase.from("entries").insert({
      conversation_id: conversationId, source: channel, role: "user", content: message,
      entry_type: classification.type, importance: classification.importance,
      tags: classification.tags || [], project_names: classification.projects || [],
      people_names: classification.people || [], classification_status: "complete",
      task_status: taskStatus,
    }).select().single();

    if (userEntry) await embedEntry(supabase, userEntry.id, message);

    const { data: assistantEntry } = await supabase.from("entries").insert({
      conversation_id: conversationId, source: channel, role: "assistant", content: reply,
      classification_status: "skip",
    }).select().single();

    if (assistantEntry) await embedEntry(supabase, assistantEntry.id, reply);

    if (tgChatId && TELEGRAM_BOT_TOKEN) await sendTelegram(TELEGRAM_BOT_TOKEN, tgChatId, reply);

    return new Response(JSON.stringify({ reply, classification }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Chat error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

// ================================================================
// ABILITY HELPERS
// ================================================================

async function webSearch(query: string): Promise<any[]> {
  const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY");
  if (!SERPER_API_KEY) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    const data = await res.json();
    return data.organic || [];
  } catch (err) {
    console.error("Search error:", err);
    return [];
  }
}

async function summarizeSearchResults(query: string, results: any[]): Promise<string> {
  if (!results.length) return "No results found. (SERPER_API_KEY not configured — add it to Supabase secrets to enable web search)";
  const context = results.map((r: any, i: number) =>
    `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`
  ).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 800,
      messages: [{ role: "user", content: `Summarize these search results for the query "${query}". Be direct and extract the most useful information. Format clearly.\n\n${context}` }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not summarize results.";
}

async function summarizeUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Nexus/1.0)" } });
    const html = await res.text();
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 8000);
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5", max_tokens: 600,
        messages: [{ role: "user", content: `Summarize this webpage content. Extract: what they do, who they serve, key offerings, anything notable. Be concise.\n\n${text}` }],
      }),
    });
    const data = await claudeRes.json();
    return data?.content?.[0]?.text || "Could not summarize page.";
  } catch (err) {
    return `Could not fetch URL: ${(err as Error).message}`;
  }
}

async function draftEmail(to: string, subject: string, about: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 600,
      messages: [{ role: "user", content: `Draft a professional email from Zach Curtis (zach@nexuszc.com) to ${to}.\nSubject: ${subject}\nAbout: ${about}\n\nWrite only the email body. No subject line. Keep it concise, direct, and warm. Sound like a real person, not a template.` }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not draft email.";
}

async function sendGmail(to: string, subject: string, emailBody: string): Promise<boolean> {
  try {
    const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
    const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
    const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN")!;
    const GMAIL_FROM = Deno.env.get("GMAIL_FROM_EMAIL") || "zach@nexuszc.com";
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN, grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) return false;
    const email = [`From: Zach Curtis <${GMAIL_FROM}>`, `To: ${to}`, `Subject: ${subject}`, "", emailBody].join("\n");
    const encoded = btoa(unescape(encodeURIComponent(email))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded }),
    });
    return sendRes.ok;
  } catch (err) {
    console.error("Gmail send error:", err);
    return false;
  }
}

async function generateDocument(type: string, subject: string, details: string, clientData: any): Promise<string> {
  const clientContext = clientData?.client_context?.[0];
  const contextStr = clientContext
    ? `Client: ${clientData.name}\nOffer: ${clientContext.core_offer || "not set"}\nGoals: ${clientContext.goals || "not set"}\nAudience: ${clientContext.target_audience || "not set"}`
    : `Subject: ${subject}`;
  const prompts: Record<string, string> = {
    proposal: `Write a professional business proposal for ${subject}. ${details}\n\nContext:\n${contextStr}\n\nInclude: executive summary, problem, solution, deliverables, timeline, investment. Keep it tight and compelling.`,
    script: `Write a call script for ${subject}. ${details}\n\nContext:\n${contextStr}\n\nInclude: opener, value prop, qualifying questions, objection handlers, close. Make it conversational not robotic.`,
    report: `Generate a status report for ${subject}. ${details}\n\nContext:\n${contextStr}\n\nInclude: current status, what's been done, what's next, blockers, recommendations.`,
    onepager: `Write a one-pager about ${subject}. ${details}\n\nContext:\n${contextStr}\n\nInclude: headline, problem, solution, how it works, why us, call to action. Make it punchy.`,
  };
  const prompt = prompts[type] || `Generate a ${type} document about ${subject}. ${details}\n\n${contextStr}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not generate document.";
}

function parseReminderTime(timePart: string): Date | null {
  const now = new Date();
  const lower = timePart.toLowerCase();
  if (lower.startsWith("in:")) {
    const spec = lower.slice(3).trim();
    const match = spec.match(/(\d+)\s*(minute|hour|day|week)s?/);
    if (!match) return null;
    const n = parseInt(match[1]);
    const unit = match[2] as "minute" | "hour" | "day" | "week";
    const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[unit] || 0;
    return new Date(now.getTime() + n * ms);
  }
  if (lower.startsWith("at:")) {
    const spec = lower.slice(3).trim();
    if (spec.includes("tomorrow")) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      const timeMatch = spec.match(/(\d+)(am|pm)/);
      if (timeMatch) {
        let h = parseInt(timeMatch[1]);
        if (timeMatch[2] === "pm" && h !== 12) h += 12;
        d.setHours(h, 0, 0, 0);
      }
      return d;
    }
  }
  return null;
}

async function synthesizeResearch(target: string, results: any[]): Promise<string> {
  if (!results.length) return "No results found. (SERPER_API_KEY not configured — add it to Supabase secrets to enable web search)";
  const context = results.slice(0, 8).map((r: any, i: number) =>
    `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`
  ).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 1000,
      messages: [{ role: "user", content: `You are researching "${target}" for Zach Curtis, a business operator evaluating opportunities.\n\nSearch results:\n${context}\n\nProvide a structured intelligence brief:\n- Who/what they are\n- Key facts and numbers\n- Recent activity or news\n- Opportunities or risks\n- Recommended next step for Zach\n\nBe direct and specific. Flag anything notable.` }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not synthesize research.";
}

async function competitiveAnalysis(market: string, results: any[]): Promise<string> {
  const context = results.slice(0, 6).map((r: any) => `${r.title}: ${r.snippet}`).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 800,
      messages: [{ role: "user", content: `Analyze the competitive landscape for "${market}".\n\nSearch data:\n${context || "(no search data — SERPER_API_KEY not configured)"}\n\nProvide:\n- Top 5 competitors with one-line description\n- Market positioning gaps (opportunities)\n- What differentiates the best players\n- Where a new entrant could win\n\nBe specific and actionable.` }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not analyze competition.";
}

async function generateClientReport(client: any, entries: any[], openTasks: any[]): Promise<string> {
  const ctx = client.client_context?.[0];
  const va = client.va_assignments?.find((v: any) => v.status === "active");
  const entrySummary = entries.slice(0, 10).map((e: any) => `[${e.role}] ${e.content.slice(0, 150)}`).join("\n");
  const taskList = openTasks.map((t: any) => `- ${t.content.slice(0, 100)}`).join("\n") || "None";
  const prompt = `Generate a client status report for ${client.name}.

CLIENT INFO:
- Deal type: ${client.deal_type || "not set"}
- Monthly fee: ${client.monthly_fee ? `$${client.monthly_fee}` : "N/A"}
- Rev share: ${client.rev_share_pct ? `${client.rev_share_pct}%` : "N/A"}
- Assigned VA: ${va?.va_name || "none"}
- Core offer: ${ctx?.core_offer || "not set"}
- Goals: ${ctx?.goals || "not set"}

RECENT ACTIVITY:
${entrySummary || "No activity yet"}

OPEN TASKS:
${taskList}

Write a concise report covering: current status, what's been done, what's next, blockers or risks, recommended action this week.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not generate report.";
}

// ================================================================
// CORE HELPERS (classification, Claude, embeddings, retrieval)
// ================================================================

async function classifyEntry(message: string, ventures: string[], ideas: string[], people: string[]) {
  const establishedList = ventures.length ? ventures.join(", ") : "(none yet)";
  const ideasList = ideas.length ? ideas.join(", ") : "(none yet)";
  const peopleList = people.length ? people.join(", ") : "(none yet)";
  const classifyPrompt = `You are a classifier for Zach's personal brain system. Analyze this entry and return ONLY valid JSON.

ESTABLISHED PROJECTS (platform, vertical, personal, external): ${establishedList}
LOOSE IDEAS (not yet committed): ${ideasList}
KNOWN PEOPLE: ${peopleList}

ENTRY: """${message}"""

CRITICAL RULES:
1. **Use exact existing names.** Match any reference to an existing project/person to the exact name in the lists above.
2. **Catch naming events.** "let's call this X", "new idea X", "create a project called X" → extract as NEW project name.
3. **Multi-tag when multiple ventures/ideas appear.** Tag ALL of them.
4. **People are first-class.** Extract every named person, even if just mentioned in passing.
5. **Don't create projects from generic nouns.** A project needs a name or a clear venture/initiative.
6. **Task prefix detection.** If the message starts with "task:" or "TODO:" — always classify type as "task".

Return JSON:
{
  "type": "idea" | "task" | "note" | "decision" | "question" | "observation" | "meta" | "other",
  "importance": 1-10,
  "tags": ["short", "lowercase", "tags"],
  "people": ["Name1", "Name2"],
  "projects": ["Project Name 1", "Project Name 2"]
}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: classifyPrompt }] }),
  });
  const data = await res.json();
  const text = data?.content?.[0]?.text || "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try { return jsonMatch ? JSON.parse(jsonMatch[0]) : {}; }
  catch { return { type: "other", importance: 5, tags: [], people: [], projects: [] }; }
}

async function callClaude(message: string, context: string, ventures: string[], ideas: string[]) {
  const systemPrompt = `You are Nexus, Zach's personal Chief of Staff and AI operator.

CURRENT VENTURES: ${ventures.join(", ") || "(none)"}
CURRENT IDEAS: ${ideas.join(", ") || "(none)"}

${context}

ABILITIES YOU HAVE (suggest these when relevant):
- search: [query] — search the web
- summarize: [url] — summarize any webpage
- research: [name] — deep research on a person or company
- competitors: [market] — competitive analysis
- draft email: [to] | subject: [x] | about: [x] — draft an email
- send email: [to] | subject: [x] | body: [x] — send an email
- generate proposal: [client] | for: [details]
- generate script: [client] | objective: [x]
- generate report: [client] | for: [details]
- generate onepager: [topic]
- remind me: [what] | in: [2 hours / 3 days]
- task: [what] — track a task
- report: [client] — full client status report

Behavioral rules:
- If memory contains the answer, ANSWER IT directly.
- Be concise. Fast, useful responses only.
- When Zach asks for something an ability can handle, suggest the exact command.
- Reference specific past entries when relevant.
- Match Zach's energy. If he's grinding, get sharp.

Task rules:
- task: or TODO: prefix → respond ONLY with: "✅ Task logged: [task]. I'll track this until you mark it done."
- done: prefix → respond ONLY with: "✅ Done: [what was marked complete]."
- done all → respond ONLY with: "✅ All tasks cleared."`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "(no reply)";
}

async function semanticSearch(supabase: any, query: string, limit = 8) {
  try {
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
    });
    const embedData = await embedRes.json();
    const queryEmbedding = embedData?.data?.[0]?.embedding;
    if (!queryEmbedding) return [];
    const { data } = await supabase.rpc("match_entries", { query_embedding: queryEmbedding, match_threshold: 0.3, match_count: limit });
    return data || [];
  } catch (err) {
    console.error("Semantic search error:", err);
    return [];
  }
}

async function embedEntry(supabase: any, entryId: string, content: string) {
  try {
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: content }),
    });
    const embedData = await embedRes.json();
    const embedding = embedData?.data?.[0]?.embedding;
    if (embedding) await supabase.from("embeddings").insert({ entry_id: entryId, embedding });
  } catch (err) {
    console.error("Embed error:", err);
  }
}

function buildContext(sources: any) {
  const parts: string[] = [];
  if (sources.recent.length > 0) {
    parts.push("RECENT CONVERSATION:\n" + sources.recent.reverse().slice(-10)
      .map((e: any) => `[${e.role}] ${e.content.slice(0, 300)}`).join("\n"));
  }
  if (sources.projects.length > 0) {
    parts.push("PROJECT MEMORY:\n" + sources.projects.slice(0, 8)
      .map((e: any) => `[${e.entry_type || 'note'}, ${(e.project_names || []).join(',')}] ${e.content.slice(0, 250)}`).join("\n"));
  }
  if (sources.people.length > 0) {
    parts.push("PEOPLE MEMORY:\n" + sources.people.slice(0, 5)
      .map((e: any) => `[${(e.people_names || []).join(',')}] ${e.content.slice(0, 200)}`).join("\n"));
  }
  if (sources.semantic.length > 0) {
    parts.push("SEMANTIC MATCHES:\n" + sources.semantic.slice(0, 5)
      .map((e: any) => `${e.content.slice(0, 250)}`).join("\n"));
  }
  return parts.length ? "MEMORY CONTEXT:\n\n" + parts.join("\n\n") : "";
}

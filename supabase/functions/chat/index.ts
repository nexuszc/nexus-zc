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

    // Helper: send reply and return early
    const earlyReturn = async (reply: string) => {
      if (tgChatId && TELEGRAM_BOT_TOKEN) await sendTelegram(TELEGRAM_BOT_TOKEN, tgChatId, reply);
      return new Response(JSON.stringify({ reply }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    // ================================================================
    // CLIENT COMMAND SHORTCUTS (before classification)
    // ================================================================

    // "new client: [name]" or "add client: [name]"
    if (msgLower.startsWith("new client:") || msgLower.startsWith("add client:")) {
      const clientName = message.split(":").slice(1).join(":").trim();
      const { data: newClient, error } = await supabase
        .from("clients").insert({ name: clientName, status: "active" }).select().single();
      if (error) return earlyReturn(`❌ Failed to create client: ${error.message}`);
      const reply = `✅ Client brain created for ${clientName} (ID: ${newClient.id})\n\nSet up their context:\n• "client context: ${clientName} | deal: rev_share | offer: [their offer] | goals: [their goals]"\n• "assign va: ${clientName} | va: [VA name]"`;
      return earlyReturn(reply);
    }

    // "client context: [name] | deal: x | offer: x | goals: x | ..."
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
      if (Object.keys(clientFields).length) {
        await supabase.from("clients").update(clientFields).eq("id", client.id);
      }
      if (Object.keys(contextFields).length) {
        await supabase.from("client_context").upsert({
          client_id: client.id, ...contextFields, updated_at: new Date().toISOString(),
        });
      }
      return earlyReturn(`✅ Context updated for ${clientName}.`);
    }

    // "assign va: [client name] | va: [VA name] | contact: [optional]"
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
      await supabase.from("va_assignments").insert({
        client_id: client.id, va_name: vaName, va_contact: vaContact || null,
      });
      return earlyReturn(`✅ ${vaName} assigned to ${clientName}.`);
    }

    // ================================================================
    // TASK COMPLETION (before classification)
    // ================================================================
    if (msgLower === "done all") {
      await supabase.from("entries").update({ task_status: "done" }).eq("task_status", "open");
    } else if (msgLower.startsWith("done:")) {
      const taskDesc = message.slice(5).trim();
      await supabase.from("entries")
        .update({ task_status: "done" })
        .eq("task_status", "open")
        .ilike("content", `%${taskDesc}%`);
    }

    // ================================================================
    // RESOLVE CONVERSATION
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
    // FETCH CONTEXT + CLASSIFY
    // ================================================================
    const { data: projectsList } = await supabase
      .from("projects").select("name, category").neq("category", "archived");
    const { data: peopleList } = await supabase.from("people").select("name");

    const establishedNames = (projectsList || []).filter(p => p.category !== "idea").map(p => p.name);
    const ideaNames = (projectsList || []).filter(p => p.category === "idea").map(p => p.name);
    const allProjectNames = [...establishedNames, ...ideaNames];
    const peopleNames = (peopleList || []).map(p => p.name);

    const classification = await classifyEntry(message, establishedNames, ideaNames, peopleNames);

    // Auto-create new projects/people
    for (const name of classification.projects || []) {
      const exists = allProjectNames.some(p => p.toLowerCase() === name.toLowerCase());
      if (!exists) await supabase.from("projects").insert({ name, category: "idea" }).select();
    }
    for (const name of classification.people || []) {
      const exists = peopleNames.some(p => p.toLowerCase() === name.toLowerCase());
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
      // client_id is null here — personal brain entries (NULL = Zach's brain)
    }).select().single();

    if (userEntry) await embedEntry(supabase, userEntry.id, message);

    const { data: assistantEntry } = await supabase.from("entries").insert({
      conversation_id: conversationId, source: channel, role: "assistant", content: reply,
      classification_status: "skip",
    }).select().single();

    if (assistantEntry) await embedEntry(supabase, assistantEntry.id, reply);

    // Send Telegram reply
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

// ========== HELPERS ==========

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

1. **Use exact existing names.** If the entry mentions any existing venture or idea — even with different wording, capitalization, or partial reference — use the EXACT name from the list above. Examples:
   - Entry mentions "BORA" → use "Bora" (the existing one)
   - Entry mentions "the BeanRoute pricing" → tag as "BeanRoute"
   - Entry mentions "Mike from beans" → person is "Mike", project is "BeanRoute"

2. **Catch naming events.** If the entry contains phrases like "let's call this X", "new idea X", "I want to start X", "the folder for X", "create a project called X" — extract that as a NEW project name, even if the rest of the entry is about something else.

3. **Multi-tag when multiple ventures/ideas appear.** One entry can reference multiple projects. Tag ALL of them.

4. **People are first-class.** Extract every named person, even if just mentioned in passing.

5. **Don't create projects from generic nouns.** A project needs a name or a clear venture/initiative.

6. **Task prefix detection.** If the message starts with "task:" or "TODO:" — always classify type as "task" regardless of content.

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
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: classifyPrompt }],
    }),
  });
  const data = await res.json();
  const text = data?.content?.[0]?.text || "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try {
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    return { type: "other", importance: 5, tags: [], people: [], projects: [] };
  }
}

async function callClaude(message: string, context: string, ventures: string[], ideas: string[]) {
  const systemPrompt = `You are Nexus, Zach's personal AI brain. You have persistent memory of his thoughts, ventures, and people across all conversations.

CURRENT VENTURES: ${ventures.join(", ") || "(none)"}
CURRENT IDEAS: ${ideas.join(", ") || "(none)"}

${context}

Behavioral rules:
- If memory contains the answer to Zach's question, ANSWER IT directly. Don't pivot to generic options.
- Be concise. Zach dumps thoughts fast and wants fast, useful responses — not essays.
- When relevant, reference specific past entries: "You mentioned last week that..."
- When Zach is brainstorming, push back constructively. Don't just agree.
- Match Zach's energy. If he's casual, be casual. If he's grinding, get sharp.

Task rules:
- If the message starts with "task:" or "TODO:", respond ONLY with: "✅ Task logged: [extracted task description]. I'll track this until you mark it done."
- If the message starts with "done:" respond ONLY with: "✅ Done: [what was marked complete]."
- If the message is exactly "done all", respond ONLY with: "✅ All tasks cleared."`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
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
    const { data } = await supabase.rpc("match_entries", {
      query_embedding: queryEmbedding, match_threshold: 0.3, match_count: limit,
    });
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
    parts.push("RECENT CONVERSATION:\n" + sources.recent
      .reverse().slice(-10)
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

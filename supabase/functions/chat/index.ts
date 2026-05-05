import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { message, channel = "web", external_id = null } = body;
    if (!message) return new Response(JSON.stringify({ error: "message required" }), { status: 400 });

    // ----- 1. Resolve conversation -----
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

    // ----- 2. Fetch existing projects + people for classifier context -----
    const { data: projectsList } = await supabase
      .from("projects").select("name, category").neq("category", "archived");
    const { data: peopleList } = await supabase
      .from("people").select("name");

    const establishedNames = (projectsList || []).filter(p => p.category !== "idea").map(p => p.name);
    const ideaNames = (projectsList || []).filter(p => p.category === "idea").map(p => p.name);
    const allProjectNames = [...establishedNames, ...ideaNames];
    const peopleNames = (peopleList || []).map(p => p.name);

    // ----- 3. Pre-classify the incoming message (for retrieval) -----
    const classification = await classifyEntry(message, establishedNames, ideaNames, peopleNames);

    // ----- 4. Auto-create new projects/people -----
    for (const name of classification.projects || []) {
      const exists = allProjectNames.some(p => p.toLowerCase() === name.toLowerCase());
      if (!exists) {
        await supabase.from("projects").insert({ name, category: "idea" }).select();
      }
    }
    for (const name of classification.people || []) {
      const exists = peopleNames.some(p => p.toLowerCase() === name.toLowerCase());
      if (!exists) {
        await supabase.from("people").insert({ name }).select();
      }
    }

    // ----- 5. Layered retrieval -----
    const [recentEntries, projectEntries, peopleEntries, semanticEntries] = await Promise.all([
      // Recent: last 20 in this conversation
      supabase.from("entries").select("role, content, created_at")
        .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20),
      // Project memory
      classification.projects?.length
        ? supabase.from("entries").select("role, content, created_at, entry_type, importance, project_names")
            .overlaps("project_names", classification.projects)
            .order("created_at", { ascending: false }).limit(15)
        : Promise.resolve({ data: [] }),
      // People memory
      classification.people?.length
        ? supabase.from("entries").select("role, content, created_at, entry_type, people_names")
            .overlaps("people_names", classification.people)
            .order("created_at", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] }),
      // Semantic memory
      semanticSearch(supabase, message, 8),
    ]);

    // ----- 6. Build context -----
    const contextBlock = buildContext({
      recent: recentEntries.data || [],
      projects: projectEntries.data || [],
      people: peopleEntries.data || [],
      semantic: semanticEntries || [],
    });

    // ----- 7. Generate response -----
    const reply = await callClaude(message, contextBlock, establishedNames, ideaNames);

    // ----- 8. Save user message + reply -----
    const { data: userEntry } = await supabase.from("entries").insert({
      conversation_id: conversationId, source: channel, role: "user", content: message,
      entry_type: classification.type, importance: classification.importance,
      tags: classification.tags || [], project_names: classification.projects || [],
      people_names: classification.people || [], classification_status: "complete",
    }).select().single();

    if (userEntry) await embedEntry(supabase, userEntry.id, message);

    const { data: assistantEntry } = await supabase.from("entries").insert({
      conversation_id: conversationId, source: channel, role: "assistant", content: reply,
      classification_status: "skip",
    }).select().single();

    if (assistantEntry) await embedEntry(supabase, assistantEntry.id, reply);

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

3. **Multi-tag when multiple ventures/ideas appear.** One entry can reference multiple projects. Tag ALL of them. Example: "Coming back to Bora — also new idea, let's call the folder Cash Out Refinances" → projects: ["Bora", "Cash Out Refinances"]

4. **People are first-class.** Extract every named person, even if just mentioned in passing.

5. **Don't create projects from generic nouns.** "I should call my mom" is not a project. "I'm thinking about real estate" is too vague. A project needs a name or a clear venture/initiative.

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
  // Extract JSON (Claude sometimes wraps in markdown)
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
- Match Zach's energy. If he's casual, be casual. If he's grinding, get sharp.`;

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
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
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
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: content }),
    });
    const embedData = await embedRes.json();
    const embedding = embedData?.data?.[0]?.embedding;
    if (embedding) {
      await supabase.from("embeddings").insert({ entry_id: entryId, embedding });
    }
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
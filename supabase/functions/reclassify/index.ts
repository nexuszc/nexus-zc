// =========================================
// NEXUS reclassify — backfill classification on pending entries
// =========================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CLASSIFICATION_PROMPT = `You are a classifier for Zach's personal AI brain. Given a single message, return ONLY a JSON object with this exact shape:

{
  "type": "idea" | "task" | "note" | "decision" | "question" | "observation" | "meta" | "other",
  "importance": <integer 1-10>,
  "tags": [<lowercase short topic strings, max 5>],
  "people": [<proper names mentioned, exact casing>],
  "projects": [<business or project names mentioned, exact casing>]
}

Definitions:
- idea: a new concept, product, feature, or possibility
- task: something that needs to be done
- note: factual information to remember
- decision: a choice made or being made
- question: an open question being raised
- observation: a reflection, pattern noticed, or insight
- meta: feedback about Nexus itself (bugs, feature requests, comments on AI behavior)
- other: anything that doesn't fit

Importance:
- 1-3: trivial passing thought
- 4-6: useful but not urgent
- 7-8: important, return to this
- 9-10: critical, life/business changing

Only extract people if a real person's name is clearly mentioned. Don't infer.
Only extract projects if a clear business/venture/initiative name is mentioned. Don't infer.

Return ONLY the JSON. No prose, no markdown, no explanation.`;

async function classifyOne(content: string) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 400,
        system: CLASSIFICATION_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Classification API error:", data);
      return null;
    }
    const text = data.content[0].text.trim();
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Classification parse error:", err);
    return null;
  }
}

async function upsertProjectsAndPeople(projects: string[], people: string[]) {
  for (const name of projects) {
    if (!name?.trim()) continue;
    await supabase.from("projects").upsert({ name: name.trim() }, { onConflict: "name" });
  }
  for (const name of people) {
    if (!name?.trim()) continue;
    await supabase.from("people").upsert({ name: name.trim() }, { onConflict: "name" });
  }
}

async function applyClassification(entryId: string, classification: any) {
  if (!classification) {
    await supabase
      .from("entries")
      .update({ classification_status: "failed" })
      .eq("id", entryId);
    return false;
  }

  const projects: string[] = Array.isArray(classification.projects) ? classification.projects : [];
  const people: string[] = Array.isArray(classification.people) ? classification.people : [];
  const tags: string[] = Array.isArray(classification.tags) ? classification.tags : [];

  await upsertProjectsAndPeople(projects, people);

  await supabase
    .from("entries")
    .update({
      entry_type: classification.type || "other",
      importance: typeof classification.importance === "number" ? classification.importance : 5,
      tags,
      project_names: projects,
      people_names: people,
      classification_status: "classified",
    })
    .eq("id", entryId);

  return true;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "200");
    const onlyUserEntries = url.searchParams.get("only_user") !== "false";

    let query = supabase
      .from("entries")
      .select("id, content, role")
      .eq("classification_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (onlyUserEntries) {
      query = query.eq("role", "user");
    }

    const { data: entries, error } = await query;
    if (error) throw error;

    if (!entries || entries.length === 0) {
      return new Response(
        JSON.stringify({ done: true, message: "No pending entries.", processed: 0 }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    let success = 0;
    let failed = 0;

    for (const entry of entries) {
      const classification = await classifyOne(entry.content);
      const ok = await applyClassification(entry.id, classification);
      if (ok) success++;
      else failed++;
      await new Promise((r) => setTimeout(r, 250));
    }

    return new Response(
      JSON.stringify({
        done: false,
        processed: entries.length,
        success,
        failed,
        message: `Processed ${entries.length} entries. Run again if more remain.`,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Reclassify error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Reclassify failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
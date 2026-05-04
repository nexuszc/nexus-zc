import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-brain-password",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const password = req.headers.get("x-brain-password");
  const expectedPassword = Deno.env.get("BRAIN_PASSWORD");
  if (!password || password !== expectedPassword) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { project_name, mode = "single" } = body;

    if (mode === "single") {
      if (!project_name) return bad("project_name required");
      const result = await assessProject(supabase, project_name);
      return ok(result);
    }

    if (mode === "all") {
      const { data: projects } = await supabase
        .from("projects").select("name, status").neq("status", "archived");
      const results = [];
      for (const p of projects || []) {
        try {
          const r = await assessProject(supabase, p.name);
          results.push({ project: p.name, status: "ok" });
        } catch (err) {
          results.push({ project: p.name, status: "error", error: err.message });
        }
      }
      return ok({ assessed: results.length, results });
    }

    return bad("mode must be 'single' or 'all'");
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function assessProject(supabase: any, projectName: string) {
  const { data: project } = await supabase
    .from("projects").select("name, status").eq("name", projectName).maybeSingle();
  if (!project) throw new Error(`Project "${projectName}" not found`);

  const { data: entries } = await supabase
    .from("entries")
    .select("content, entry_type, importance, created_at")
    .contains("project_names", [projectName])
    .eq("role", "user")
    .order("created_at", { ascending: false });

  const entryCount = entries?.length || 0;
  const lastEntryAt = entries?.[0]?.created_at || null;
  const daysSinceLastEntry = lastEntryAt
    ? Math.floor((Date.now() - new Date(lastEntryAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  if (entryCount === 0) {
    const { data } = await supabase.from("project_states").upsert({
      project_name: projectName,
      current_state: "No entries yet.",
      next_step: "Capture initial thoughts about this project.",
      blockers: null,
      attention_call: "needs more focus",
      entry_count: 0,
      strategic_summary: "Empty project. Start by dumping context.",
      last_assessed_at: new Date().toISOString(),
    }, { onConflict: "project_name" }).select().single();
    return data;
  }

  const assessment = await generateAssessment(projectName, project.status, entries || []);

  const { data, error } = await supabase.from("project_states").upsert({
    project_name: projectName,
    current_state: assessment.current_state,
    next_step: assessment.next_step,
    blockers: assessment.blockers,
    attention_call: assessment.attention_call,
    entry_count: entryCount,
    last_entry_at: lastEntryAt,
    days_since_last_entry: daysSinceLastEntry,
    strategic_summary: assessment.strategic_summary,
    last_assessed_at: new Date().toISOString(),
  }, { onConflict: "project_name" }).select().single();

  if (error) throw error;
  return data;
}

async function generateAssessment(projectName: string, status: string, entries: any[]) {
  const entryDigest = entries.slice(0, 30).map((e: any) => {
    const date = new Date(e.created_at).toISOString().split("T")[0];
    const type = e.entry_type || "note";
    const imp = e.importance ? `[${e.importance}/10]` : "";
    return `${date} ${type} ${imp}: ${e.content.slice(0, 600)}`;
  }).join("\n\n");

  const lastEntryAt = entries[0]?.created_at;
  const daysSince = lastEntryAt
    ? Math.floor((Date.now() - new Date(lastEntryAt).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  const prompt = `You are Zach's Chief of Staff. Analyze this project and give a strategic assessment.

PROJECT: ${projectName}
STATUS: ${status}
TOTAL ENTRIES: ${entries.length}
DAYS SINCE LAST ENTRY: ${daysSince}

ENTRIES (most recent first):
${entryDigest}

Be CONCRETE. Be HONEST. If a project is dying, say so.

Return ONLY valid JSON:
{
  "current_state": "1-2 sentences on where this stands",
  "next_step": "One concrete action",
  "blockers": "What's in the way (or null)",
  "attention_call": "needs more focus | appropriate | overinvested | decision needed | consider archiving",
  "strategic_summary": "2-4 sentences with your real take"
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
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const text = data?.content?.[0]?.text || "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  try {
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    return {
      current_state: parsed.current_state || "Assessment unavailable.",
      next_step: parsed.next_step || "Review recent entries.",
      blockers: parsed.blockers || null,
      attention_call: parsed.attention_call || "appropriate",
      strategic_summary: parsed.strategic_summary || "No summary generated.",
    };
  } catch {
    return {
      current_state: "Failed to parse.",
      next_step: "Re-run assessment.",
      blockers: null,
      attention_call: "appropriate",
      strategic_summary: text.slice(0, 500),
    };
  }
}

function ok(data: any) {
  return new Response(JSON.stringify({ data }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bad(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
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
    // 1. Pull all project_states (excluding archived projects)
    const { data: states, error: statesErr } = await supabase
      .from("project_states")
      .select(`
        project_name,
        current_state,
        next_step,
        blockers,
        attention_call,
        strategic_summary,
        entry_count,
        days_since_last_entry,
        last_assessed_at
      `);

    if (statesErr) throw statesErr;
    if (!states || states.length === 0) {
      return bad("No project states found. Run assess-project first.");
    }

    // 2. Pull project metadata to know venture vs idea status
    const { data: projects } = await supabase
      .from("projects")
      .select("name, status")
      .neq("status", "archived");

    const statusByName = new Map((projects || []).map(p => [p.name, p.status]));

    // 3. Filter out archived projects from states
    const activeStates = states.filter(s => statusByName.has(s.project_name));

    const ventures = activeStates.filter(s => statusByName.get(s.project_name) === "venture");
    const ideas = activeStates.filter(s => statusByName.get(s.project_name) === "idea");
    const decisionsNeededList = activeStates.filter(s => s.attention_call === "decision needed");

    // 4. Generate synthesis with Claude
    const synthesis = await generateSynthesis(activeStates, ventures, ideas, statusByName);

    // 5. Store the brief
    const { data: stored, error: storeErr } = await supabase
      .from("portfolio_briefs")
      .insert({
        headline: synthesis.headline,
        pattern: synthesis.pattern,
        highest_leverage_move: synthesis.highest_leverage_move,
        attention_diagnosis: synthesis.attention_diagnosis,
        decisions_needed: synthesis.decisions_needed || [],
        going_quiet: synthesis.going_quiet || [],
        full_brief: synthesis.full_brief,
        projects_assessed: activeStates.length,
        ventures_count: ventures.length,
        ideas_count: ideas.length,
        decisions_needed_count: decisionsNeededList.length,
      })
      .select()
      .single();

    if (storeErr) throw storeErr;
    return ok(stored);
  } catch (err) {
    console.error("Synthesize error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function generateSynthesis(
  states: any[],
  ventures: any[],
  ideas: any[],
  statusByName: Map<string, string>
) {
  const formatProject = (s: any) => {
    const status = statusByName.get(s.project_name) || "unknown";
    return `--- ${s.project_name} (${status}, ${s.entry_count} entries, ${s.days_since_last_entry ?? "?"}d since last entry) ---
ATTENTION: ${s.attention_call}
STATE: ${s.current_state}
NEXT STEP: ${s.next_step}
BLOCKERS: ${s.blockers || "none"}
SUMMARY: ${s.strategic_summary}`;
  };

  const venturesBlock = ventures.length
    ? "VENTURES:\n\n" + ventures.map(formatProject).join("\n\n")
    : "VENTURES: (none)";
  
  const ideasBlock = ideas.length
    ? "\n\nIDEAS:\n\n" + ideas.map(formatProject).join("\n\n")
    : "";

  const prompt = `You are Zach's Chief of Staff. You've just reviewed every project in his portfolio individually. Now you're zooming out to give him the cross-portfolio view.

This is the conversation you'd have if you sat across a desk from him with a coffee and a printed report. Be honest, be sharp, be useful. He runs multiple businesses (~$1M/year) and is overwhelmed by his own idea generation.

Don't sugarcoat. Don't hedge. The point of this brief is to make him better, not comfortable.

PORTFOLIO STATE:
- ${ventures.length} ventures
- ${ideas.length} ideas
- ${states.filter(s => s.attention_call === "decision needed").length} marked "decision needed"

${venturesBlock}${ideasBlock}

Your job: generate a portfolio-level synthesis. Look ACROSS projects for patterns Zach can't see when he's heads-down on any single one.

Things to look for:
- Recurring patterns (e.g., "every project has unresolved business model questions")
- Energy distribution (where is attention going vs where should it be going)
- Compound risks (e.g., multiple things stalling for the same reason)
- Hidden leverage (one decision that would unblock several projects)
- The honest call (what would a smart outside operator tell him to do this week)

Return ONLY valid JSON, no markdown:
{
  "headline": "ONE sentence — the state of the portfolio in plain language",
  "pattern": "The single biggest pattern across projects (1-2 sentences)",
  "highest_leverage_move": "The ONE most important thing for Zach to do this week, with reasoning",
  "attention_diagnosis": "Where his attention is going vs where it should be going (2-3 sentences)",
  "decisions_needed": ["Project: specific decision pending", "Project: specific decision pending"],
  "going_quiet": ["Project that's at risk of being forgotten or should be archived"],
  "full_brief": "3-5 paragraphs. The conversation you'd have with him over coffee. Open with the headline, walk through the pattern, name the leverage point, give him the call. Plain talk."
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
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const text = data?.content?.[0]?.text || "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  try {
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    return {
      headline: parsed.headline || "Synthesis unavailable.",
      pattern: parsed.pattern || "No pattern detected.",
      highest_leverage_move: parsed.highest_leverage_move || "Review project states.",
      attention_diagnosis: parsed.attention_diagnosis || "No diagnosis available.",
      decisions_needed: Array.isArray(parsed.decisions_needed) ? parsed.decisions_needed : [],
      going_quiet: Array.isArray(parsed.going_quiet) ? parsed.going_quiet : [],
      full_brief: parsed.full_brief || text.slice(0, 1500),
    };
  } catch {
    return {
      headline: "Failed to parse synthesis.",
      pattern: "",
      highest_leverage_move: "",
      attention_diagnosis: "",
      decisions_needed: [],
      going_quiet: [],
      full_brief: text.slice(0, 1500),
    };
  }
}

function ok(data: any) {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bad(message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
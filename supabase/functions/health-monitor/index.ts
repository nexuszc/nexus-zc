import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const functions = ["chat", "briefing", "reminders", "provision"];
  const healthResults = [];

  for (const fn of functions) {
    const health = await checkFunctionHealth(supabase, fn);
    healthResults.push(health);
    await supabase.from("nexus_health").insert({
      function_name: fn,
      error_count: health.errors,
      success_count: health.successes,
      avg_response_ms: health.avgMs,
      last_error: health.lastError,
      status: health.errors > health.successes ? "degraded" : "healthy",
    });
  }

  const usagePatterns = await analyzeUsage(supabase);
  const improvements = await identifyImprovements(healthResults, usagePatterns);

  for (const improvement of improvements) {
    const { data: existing } = await supabase
      .from("nexus_improvements")
      .select("id")
      .ilike("title", `%${improvement.title}%`)
      .eq("status", "pending")
      .maybeSingle();

    if (!existing) {
      await supabase.from("nexus_improvements").insert(improvement);
    }
  }

  return new Response(JSON.stringify({ ok: true, health: healthResults }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function checkFunctionHealth(supabase: any, fnName: string) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: usage } = await supabase
    .from("nexus_usage")
    .select("success, response_ms, logged_at")
    .eq("ability", fnName)
    .gt("logged_at", oneHourAgo);

  const entries = usage || [];
  const errors = entries.filter((e: any) => !e.success).length;
  const successes = entries.filter((e: any) => e.success).length;
  const avgMs = entries.length
    ? Math.round(entries.reduce((a: number, e: any) => a + (e.response_ms || 0), 0) / entries.length)
    : 0;

  const { data: recentErrors } = await supabase
    .from("platform_insights")
    .select("insight")
    .ilike("insight", `%error%`)
    .gt("created_at", oneHourAgo)
    .limit(1);

  return {
    name: fnName,
    errors,
    successes,
    avgMs,
    lastError: recentErrors?.[0]?.insight || null,
  };
}

async function analyzeUsage(supabase: any) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: usage } = await supabase
    .from("nexus_usage")
    .select("ability, success")
    .gt("logged_at", sevenDaysAgo);

  const counts: Record<string, { total: number; failures: number }> = {};
  for (const u of (usage || [])) {
    if (!counts[u.ability]) counts[u.ability] = { total: 0, failures: 0 };
    counts[u.ability].total++;
    if (!u.success) counts[u.ability].failures++;
  }

  const allAbilities = [
    "search", "research", "summarize", "draft email", "send email",
    "generate proposal", "generate script", "generate report", "generate onepager",
    "remind me", "provision", "report", "competitors",
  ];
  const unused = allAbilities.filter(a => !counts[a] || counts[a].total === 0);

  return { counts, unused };
}

async function identifyImprovements(health: any[], usage: any): Promise<any[]> {
  const healthSummary = health.map(h =>
    `${h.name}: ${h.successes} successes, ${h.errors} errors, avg ${h.avgMs}ms${h.lastError ? `, last error: ${h.lastError}` : ""}`
  ).join("\n");

  const usageSummary = Object.entries(usage.counts)
    .map(([k, v]: any) => `${k}: ${v.total} uses, ${v.failures} failures`)
    .join("\n") || "No usage data yet";

  const unusedSummary = usage.unused.length
    ? `Unused abilities: ${usage.unused.join(", ")}`
    : "All abilities have been used";

  const prompt = `You are analyzing the health of Nexus, an AI operating system.

FUNCTION HEALTH (last hour):
${healthSummary}

ABILITY USAGE (last 7 days):
${usageSummary}

${unusedSummary}

Identify the top 3 most important improvements Nexus should make to itself.
Focus on: reliability issues, unused features that need better UX, missing capabilities that would add real value.

Return ONLY a JSON array with this exact structure:
[
  {
    "title": "Short title",
    "problem": "What's wrong or missing",
    "recommended_fix": "Specific technical fix or improvement",
    "affected_function": "which edge function needs changing",
    "priority": 1,
    "estimated_minutes": 30
  }
]

Return only the JSON array. No explanation. No markdown.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const text = data?.content?.[0]?.text || "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);

  try {
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    return [];
  }
}

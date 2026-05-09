// NEXUS nexus-research — self-directed research loop, runs every 6 hours
// Scans web, identifies gaps, saves everything to Supabase permanently

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getTelegramChatId(): Promise<string | null> {
  const { data } = await supabase
    .from("channel_conversations")
    .select("external_id")
    .eq("channel", "telegram")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.external_id || null;
}

async function webSearch(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  const data = await res.json();
  return (data.organic || []).map((r: { title: string; link: string; snippet: string }) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

async function claudeAnalyze(prompt: string, maxTokens = 1000): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content[0].text;
}

async function sendTelegram(chatId: string, text: string) {
  const truncated = text.length > 4000 ? text.slice(0, 3900) + "..." : text;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: truncated, parse_mode: "Markdown" }),
  });
}

async function auditLog(actionType: string, detail: string, data?: Record<string, unknown>) {
  await supabase.from("nexus_audit_log").insert({
    engine: "nexus-research",
    action_type: actionType,
    action_detail: detail,
    risk_level: "low",
    autonomous: true,
    outcome: "success",
    data: data || null,
  });
}

// ── RESEARCH TOPICS ───────────────────────────────────────────────────────────

async function determineResearchTopics(): Promise<Array<{ query: string; type: string; topic: string }>> {
  const { data: recentResearch } = await supabase
    .from("nexus_research_findings")
    .select("topic, query_used, created_at")
    .gt("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());

  const recentTopics = new Set(recentResearch?.map((r: { topic: string }) => r.topic) || []);

  const { data: abilityGaps } = await supabase
    .from("nexus_ability_proposals")
    .select("ability_name, description")
    .eq("status", "proposed")
    .limit(3);

  const { data: projects } = await supabase
    .from("projects")
    .select("name, category")
    .eq("momentum_status", "active")
    .limit(5);

  const prompt = `You are Nexus, an AI business operating system. Determine the most valuable research topics for this cycle.

Context:
- Active projects: ${JSON.stringify(projects)}
- Ability gaps to research solutions for: ${JSON.stringify(abilityGaps)}
- Recently researched (avoid repeating): ${JSON.stringify([...recentTopics])}

Primary business focus: Building Nexus as an autonomous AI business operating system.
Secondary focus: Roofing OS as a vertical SaaS product.

Generate 5 research queries that would most benefit Nexus right now.
Mix of: AI/tech capabilities, market intel, business strategies, tool discoveries, industry patterns.

Respond with JSON only (no backticks):
[
  {"query": "search query string", "type": "new_tool|market_intel|competitor|industry|ability_gap", "topic": "short topic name"}
]`;

  const response = await claudeAnalyze(prompt, 800);

  try {
    const parsed = JSON.parse(response.replace(/```json|```/g, "").trim());
    return parsed.filter((t: { topic: string }) => !recentTopics.has(t.topic));
  } catch {
    return [
      { query: "latest AI agent frameworks 2026", type: "new_tool", topic: "ai_agent_frameworks" },
      { query: "autonomous AI business systems small business", type: "market_intel", topic: "ai_bos_market" },
      { query: "roofing contractor software trends 2026", type: "industry", topic: "roofing_software" },
      { query: "Supabase edge functions best practices 2026", type: "new_tool", topic: "supabase_patterns" },
      { query: "AI self-improving systems architecture", type: "ability_gap", topic: "self_improvement_arch" },
    ];
  }
}

// ── RESEARCH CYCLE ────────────────────────────────────────────────────────────

async function runResearchCycle() {
  const topics = await determineResearchTopics();
  const findings: Array<{ topic: string; type: string; finding: string; relevance: number; source: string }> = [];

  for (const topic of topics) {
    try {
      const results = await webSearch(topic.query);
      if (!results.length) continue;

      const analyzePrompt = `You are Nexus researching: "${topic.query}"

Search results:
${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   URL: ${r.url}`).join("\n\n")}

Extract the most valuable insight from these results for an AI business operating system.
Focus on: actionable information, specific tools/techniques, market opportunities, threats.

Respond with JSON only (no backticks):
{
  "finding": "the key insight in 2-3 sentences",
  "relevance_score": 0.0,
  "action_recommendation": "what Nexus should do with this information",
  "source_url": "most relevant URL",
  "source_title": "title of most relevant source"
}`;

      const analysis = await claudeAnalyze(analyzePrompt, 500);
      const parsed = JSON.parse(analysis.replace(/```json|```/g, "").trim());

      await supabase.from("nexus_research_findings").insert({
        research_type: topic.type,
        topic: topic.topic,
        query_used: topic.query,
        source_url: parsed.source_url,
        source_title: parsed.source_title,
        finding: parsed.finding,
        relevance_score: parsed.relevance_score,
        action_taken: parsed.action_recommendation,
      });

      if (parsed.relevance_score >= 0.7) {
        await supabase.from("knowledge_base").insert({
          topic: topic.topic,
          content: `[${topic.type.toUpperCase()}] ${parsed.finding}\n\nSource: ${parsed.source_url}\n\nRecommendation: ${parsed.action_recommendation}`,
          source: parsed.source_url || null,
          auto_generated: true,
          relevance_score: parsed.relevance_score,
        });
      }

      findings.push({
        topic: topic.topic,
        type: topic.type,
        finding: parsed.finding,
        relevance: parsed.relevance_score,
        source: parsed.source_title,
      });

      await auditLog("research_completed", `Researched: ${topic.topic}`, {
        query: topic.query,
        relevance: parsed.relevance_score,
      });
    } catch (err) {
      await auditLog("research_error", `Failed research on: ${topic.topic}`, {
        error: String(err),
      });
    }
  }

  return findings;
}

// ── IDENTIFY ABILITY GAPS ─────────────────────────────────────────────────────

async function identifyAbilityGaps() {
  const { data: recentEntries } = await supabase
    .from("entries")
    .select("content, entry_type, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: existingAbilities } = await supabase
    .from("nexus_ability_proposals")
    .select("ability_name, trigger_command, status")
    .in("status", ["proposed", "approved", "live"]);

  const { data: usageData } = await supabase
    .from("nexus_usage")
    .select("ability, success, logged_at")
    .order("logged_at", { ascending: false })
    .limit(200);

  const gapPrompt = `You are Nexus analyzing your own capabilities for gaps.

Recent user messages/entries: ${JSON.stringify(recentEntries?.slice(0, 20))}
Current ability proposals: ${JSON.stringify(existingAbilities)}
Recent usage patterns: ${JSON.stringify(usageData?.slice(0, 50))}

Identify 1-3 ability gaps — things Zach tried to do that Nexus couldn't do well,
or capabilities that would be obviously valuable based on the usage patterns.

Only propose abilities that:
1. Have clear evidence of need from the data
2. Are technically feasible on the current stack
3. Don't already exist or aren't already proposed

Respond with JSON only (no backticks):
[
  {
    "ability_name": "name",
    "trigger_command": "example trigger",
    "description": "what it does",
    "value_reasoning": "why it's needed",
    "evidence": "specific evidence from the data",
    "estimated_complexity": "simple|medium|complex",
    "implementation_approach": "brief technical approach"
  }
]`;

  const response = await claudeAnalyze(gapPrompt, 1000);

  try {
    const gaps = JSON.parse(response.replace(/```json|```/g, "").trim());

    for (const gap of gaps) {
      const { data: existing } = await supabase
        .from("nexus_ability_proposals")
        .select("id")
        .ilike("ability_name", `%${gap.ability_name}%`)
        .in("status", ["proposed", "approved", "building", "live"])
        .maybeSingle();

      if (existing) continue;

      await supabase.from("nexus_ability_proposals").insert({
        ability_name: gap.ability_name,
        trigger_command: gap.trigger_command,
        description: gap.description,
        value_reasoning: gap.value_reasoning,
        evidence: gap.evidence,
        implementation_plan: gap.implementation_approach,
        estimated_complexity: gap.estimated_complexity,
        status: "proposed",
      });

      await auditLog("ability_gap_identified", `New gap: ${gap.ability_name}`, {
        trigger: gap.trigger_command,
        complexity: gap.estimated_complexity,
      });
    }

    return gaps;
  } catch {
    return [];
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  await auditLog("research_cycle_start", "Starting research cycle");

  const chatId = await getTelegramChatId();

  try {
    const findings = await runResearchCycle();
    const gaps = await identifyAbilityGaps();

    const highValueFindings = findings.filter((f) => f.relevance >= 0.75);

    if ((highValueFindings.length > 0 || gaps.length > 0) && chatId) {
      const msg =
        `🔬 *Nexus Research Cycle Complete*\n\n` +
        (highValueFindings.length > 0
          ? `*High-value findings (${highValueFindings.length}):*\n` +
            highValueFindings.map((f) => `• *${f.topic}*: ${f.finding.slice(0, 120)}...`).join("\n") + "\n\n"
          : "") +
        (gaps.length > 0
          ? `*New ability gaps identified (${gaps.length}):*\n` +
            gaps.map((g: { ability_name: string; trigger_command: string }) =>
              `• *${g.ability_name}* (\`${g.trigger_command}\`)`
            ).join("\n")
          : "") +
        `\n\n_All findings saved to knowledge base._`;

      await sendTelegram(chatId, msg);
    }

    await auditLog("research_cycle_complete", `Completed: ${findings.length} findings, ${gaps.length} gaps`, {
      findings_count: findings.length,
      gaps_count: gaps.length,
      high_value: highValueFindings.length,
    });

    return Response.json({
      ok: true,
      findings: findings.length,
      high_value_findings: highValueFindings.length,
      ability_gaps: gaps.length,
    });
  } catch (err) {
    await auditLog("research_cycle_error", `Research cycle failed: ${String(err)}`, {
      error: String(err),
    });
    return Response.json({ error: String(err) }, { status: 500 });
  }
});

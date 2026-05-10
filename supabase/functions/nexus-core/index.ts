import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
const GITHUB_REPO = "nexuszc/nexus-zc";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── UTILITIES ─────────────────────────────────────────────────────────────────

async function ai(prompt: string, maxTokens = 1500): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text.slice(0, 4000),
      parse_mode: "Markdown"
    })
  });
}

async function log(type: string, detail: string, outcome = "success", data?: Record<string, unknown>) {
  await supabase.from("nexus_audit_log").insert({
    engine: "nexus-core",
    action_type: type,
    action_detail: detail,
    autonomous: true,
    outcome,
    data: data || null
  });
}

async function readGitHub(path: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=main`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  const data = await res.json();
  if (!data.content) throw new Error(`Cannot read: ${path}`);
  return atob(data.content.replace(/\n/g, ""));
}

async function search(query: string): Promise<string> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 5 })
    });
    const data = await res.json();
    return (data.organic || [])
      .map((r: { title: string; snippet: string; link: string }) =>
        `${r.title}: ${r.snippet} (${r.link})`
      ).join("\n");
  } catch {
    return "";
  }
}

// ── OBSERVE ───────────────────────────────────────────────────────────────────

async function observe() {
  const ago = {
    day: new Date(Date.now() - 86400000).toISOString(),
    week: new Date(Date.now() - 604800000).toISOString(),
    hour: new Date(Date.now() - 3600000).toISOString()
  };

  const [
    { data: tasks },
    { data: clients },
    { data: errors },
    { data: improvements },
    { data: liveAbilities },
    { data: directives },
    { data: recentBuilds },
    { data: reflections },
    { data: pendingApprovals }
  ] = await Promise.all([
    supabase.from("entries").select("content, created_at, importance")
      .eq("task_status", "open").order("importance", { ascending: false }).limit(10),
    supabase.from("clients").select("name, status, health_score, last_activity_at")
      .eq("status", "active"),
    supabase.from("nexus_audit_log").select("action_type, action_detail")
      .eq("outcome", "failure").gt("created_at", ago.day).limit(10),
    supabase.from("nexus_self_improvements").select("title, problem, complexity, directive_priority")
      .eq("status", "proposed").order("directive_priority").limit(5),
    supabase.from("nexus_ability_proposals").select("ability_name, trigger_command, usage_count")
      .eq("status", "live").order("usage_count", { ascending: false }).limit(30),
    supabase.from("nexus_directives").select("priority, title, description")
      .eq("active", true).order("priority").limit(5),
    supabase.from("nexus_build_manifests").select("goal, status, tests_passed, tests_failed, created_at")
      .gt("created_at", ago.week).limit(5),
    supabase.from("nexus_reflections").select("observation, learned")
      .order("created_at", { ascending: false }).limit(5),
    supabase.from("nexus_action_queue").select("action_summary, priority")
      .eq("status", "pending").order("priority", { ascending: false }).limit(5)
  ]);

  // Read self — know what's currently built
  let chatHandlerCount = 0;
  let chatLines = 0;
  try {
    const chatContent = await readGitHub("supabase/functions/chat/index.ts");
    chatLines = chatContent.split("\n").length;
    chatHandlerCount = (chatContent.match(/if \((?:lowerMessage|msgLower)/g) || []).length;
  } catch { /* ok */ }

  return {
    tasks: tasks || [],
    clients: clients || [],
    errors: errors || [],
    improvements: improvements || [],
    liveAbilities: liveAbilities || [],
    directives: directives || [],
    recentBuilds: recentBuilds || [],
    reflections: reflections || [],
    pendingApprovals: pendingApprovals || [],
    self: { chatLines, chatHandlerCount, healthy: chatLines > 2000 }
  };
}

// ── THINK ─────────────────────────────────────────────────────────────────────

async function think(state: Awaited<ReturnType<typeof observe>>) {
  const prompt = `You are Nexus Core v3 — an autonomous AI business operating system.
You have one job: continuously improve yourself and build value for Zach.

STRATEGIC DIRECTIVES (every decision must serve these):
${state.directives.map(d => `${d.priority}. ${d.title}: ${d.description}`).join("\n")}

CURRENT STATE:
- Open tasks: ${state.tasks.length}
- Active clients: ${state.clients.length}
- Errors in last 24h: ${state.errors.length}
- Pending self-improvements: ${state.improvements.length}
- Live abilities: ${state.liveAbilities.length}
- Recent failed builds: ${state.recentBuilds.filter((b: {status: string}) => b.status === 'failed').length}
- Pending approvals: ${state.pendingApprovals.length}
- Chat function: ${state.self.chatLines} lines, ${state.self.chatHandlerCount} handlers

ERRORS TO FIX:
${state.errors.slice(0, 3).map((e: {action_type: string; action_detail: string}) => `- ${e.action_type}: ${e.action_detail?.slice(0, 100)}`).join("\n") || "None"}

PENDING IMPROVEMENTS:
${state.improvements.map((i: {title: string; complexity: string; directive_priority: number}) => `- ${i.title} (${i.complexity}, directive ${i.directive_priority})`).join("\n") || "None"}

RECENT LEARNINGS:
${state.reflections.map((r: {observation: string; learned: string}) => `- ${r.learned || r.observation}`).join("\n") || "None yet"}

RULES:
1. Fix errors before building new things
2. Only 1 build action per cycle
3. Every action must serve a directive
4. Research before building complex systems
5. Simple improvements > complex ones at this stage

AVAILABLE ACTIONS:
- research: search web for specific topic, save insight
- fix_error: identify and queue a fix for a known error
- identify_improvement: analyze codebase and identify one self-improvement
- save_insight: save an observation to knowledge base
- update_health: update client health scores
- trigger_build: trigger nexus-build with a specific instruction (1 per cycle max)
- send_alert: send Zach an important alert

Choose 2-3 actions max. Only 1 trigger_build allowed.

Respond with JSON only (no markdown, no backticks):
{
  "observations": ["what you notice about current state"],
  "actions": [
    {
      "type": "action_type",
      "priority": 1,
      "instruction": "specific instruction",
      "reasoning": "which directive this serves",
      "data": {}
    }
  ],
  "reflection": "one sentence: what you learned this cycle",
  "summary": "one sentence: what you observed and what you are doing"
}`;

  try {
    const response = await ai(prompt, 1500);
    return JSON.parse(response.replace(/```json|```/g, "").trim());
  } catch {
    return {
      observations: ["Think parse error"],
      actions: [{ type: "save_insight", priority: 1, instruction: "Log parse error", reasoning: "System health", data: {} }],
      reflection: "Parse error this cycle",
      summary: "Cycle completed with parse error"
    };
  }
}

// ── ACT ───────────────────────────────────────────────────────────────────────

async function act(decisions: Awaited<ReturnType<typeof think>>, state: Awaited<ReturnType<typeof observe>>) {
  const actions = [...(decisions.actions || [])].sort((a, b) => a.priority - b.priority);
  let buildTriggered = false;
  let actionsExecuted = 0;

  for (const action of actions) {
    try {
      if (action.type === "research") {
        const results = await search(action.instruction);
        if (results) {
          const insight = await ai(
            `Summarize the key actionable insight from this research in 2-3 sentences:\n\nTopic: ${action.instruction}\n\nResults:\n${results}`,
            400
          );
          await supabase.from("knowledge_base").insert({
            topic: action.instruction.slice(0, 100),
            content: insight,
            auto_generated: true,
            relevance_score: 0.75
          });
          await log("research_complete", `Researched: ${action.instruction}`);
          actionsExecuted++;
        }
      }

      else if (action.type === "identify_improvement") {
        const improvPrompt = `You are analyzing the Nexus AI system to identify one high-value self-improvement.

Current state:
- ${state.self.chatHandlerCount} chat handlers, ${state.self.chatLines} lines
- ${state.liveAbilities.length} live abilities
- ${state.errors.length} recent errors
- Errors: ${state.errors.slice(0, 3).map((e: {action_type: string}) => e.action_type).join(", ")}

Strategic directives: ${state.directives.map((d: {priority: number; title: string}) => `${d.priority}. ${d.title}`).join(", ")}

Identify ONE specific self-improvement. Be concrete and buildable.
Prefer: fixing errors > improving existing abilities > adding new abilities > adding new systems

Respond with JSON only (no backticks):
{
  "title": "short title",
  "problem": "what problem this solves",
  "proposed_solution": "exactly how to fix it",
  "improvement_type": "ability|fix|refactor|new_system|performance",
  "complexity": "simple|medium|complex|system",
  "directive_priority": 1-5,
  "evidence": "why this is needed"
}`;

        const result = await ai(improvPrompt, 600);
        const improvement = JSON.parse(result.replace(/```json|```/g, "").trim());

        // Check not already proposed
        const { data: existing } = await supabase
          .from("nexus_self_improvements")
          .select("id")
          .ilike("title", `%${improvement.title.slice(0, 20)}%`)
          .eq("status", "proposed")
          .single();

        if (!existing) {
          await supabase.from("nexus_self_improvements").insert(improvement);
          await log("improvement_identified", `Identified: ${improvement.title}`);
          actionsExecuted++;
        }
      }

      else if (action.type === "save_insight") {
        await supabase.from("knowledge_base").insert({
          topic: action.instruction.slice(0, 100),
          content: action.data?.content as string || action.instruction,
          auto_generated: true,
          relevance_score: 0.6
        });
        await log("insight_saved", action.instruction);
        actionsExecuted++;
      }

      else if (action.type === "update_health") {
        const { data: clientList } = await supabase
          .from("clients").select("id, name").eq("status", "active");

        for (const client of clientList || []) {
          const { data: entries } = await supabase.from("entries")
            .select("id").eq("client_id", client.id)
            .gt("created_at", new Date(Date.now() - 30 * 86400000).toISOString());

          const score = Math.min(100, 50 + (entries?.length || 0) * 5);
          await supabase.from("clients").update({
            health_score: score,
            health_updated_at: new Date().toISOString()
          }).eq("id", client.id);
        }
        await log("health_updated", `Updated ${clientList?.length || 0} client health scores`);
        actionsExecuted++;
      }

      else if (action.type === "trigger_build" && !buildTriggered) {
        buildTriggered = true;

        // Trigger nexus-build (fire and forget)
        fetch(`${SUPABASE_URL}/functions/v1/nexus-build`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            instruction: action.instruction,
            source: "nexus-core",
            directive_priority: action.data?.directive_priority || 3
          })
        }).catch(() => {});

        await log("build_triggered", `Triggered build: ${action.instruction}`);
        actionsExecuted++;
      }

      else if (action.type === "send_alert") {
        await tg(`*Nexus Alert*\n\n${action.instruction}`);
        await log("alert_sent", action.instruction);
        actionsExecuted++;
      }

    } catch (err) {
      await log("action_error", `${action.type} failed: ${String(err)}`, "failure");
    }
  }

  return actionsExecuted;
}

// ── REFLECT ───────────────────────────────────────────────────────────────────

async function reflect(decisions: Awaited<ReturnType<typeof think>>, cycleNumber: number, actionsExecuted: number) {
  await supabase.from("nexus_reflections").insert({
    cycle_number: cycleNumber,
    observation: decisions.observations?.[0] || "No observation",
    insight: decisions.summary,
    action_taken: `${actionsExecuted} actions executed`,
    learned: decisions.reflection
  });

  await supabase.from("nexus_agent_cycles").insert({
    cycle_number: cycleNumber,
    engine: "nexus-core",
    actions_taken: actionsExecuted,
    summary: decisions.summary,
    reflection: decisions.reflection
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const startTime = Date.now();

  const { count } = await supabase
    .from("nexus_agent_cycles")
    .select("*", { count: "exact", head: true });
  const cycleNumber = (count || 0) + 1;

  await log("cycle_start", `Nexus Core cycle ${cycleNumber}`);

  try {
    const state = await observe();
    const decisions = await think(state);
    const actionsExecuted = await act(decisions, state);
    await reflect(decisions, cycleNumber, actionsExecuted);

    const duration = Date.now() - startTime;

    if (actionsExecuted > 0 || state.errors.length > 3) {
      await tg(
        `*Nexus Core — Cycle ${cycleNumber}*\n\n` +
        `${decisions.summary}\n\n` +
        (actionsExecuted > 0 ? `Actions taken: ${actionsExecuted}\n` : "") +
        (state.pendingApprovals.length > 0 ? `Pending your approval: ${state.pendingApprovals.length}\n` : "") +
        `_${duration}ms_`
      );
    }

    return Response.json({ ok: true, cycle: cycleNumber, actions: actionsExecuted, summary: decisions.summary });

  } catch (err) {
    await log("cycle_error", String(err), "failure");
    return Response.json({ error: String(err) }, { status: 500 });
  }
});

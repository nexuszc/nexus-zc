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

async function logHeartbeat(fnName: string, status: "ok" | "error", ms: number, errorMsg?: string) {
  try {
    await supabase.from("system_heartbeats").insert({
      function_name: fnName,
      status,
      response_ms: ms,
      error_message: errorMsg || null,
      metadata: {},
      recorded_at: new Date().toISOString()
    });
  } catch { /* ignore */ }
}

async function readGitHub(path: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=main`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  const data = await res.json();
  if (res.status === 404) throw new Error(`File not found (404): ${path}`);
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${path}`);
  if (!data.content) throw new Error(`No content returned: ${path}`);
  return decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
}

async function readGitHubFile(path: string): Promise<{ content: string; sha: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=main`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  const data = await res.json();
  if (res.status === 404) throw new Error(`File not found (404): ${path}`);
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${path}`);
  if (!data.content) throw new Error(`No content returned: ${path}`);
  return { content: decodeURIComponent(escape(atob(data.content.replace(/\n/g, "")))), sha: data.sha };
}

async function writeGitHubMain(path: string, content: string, sha: string, message: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        sha,
        branch: "main"
      })
    }
  );
  const data = await res.json();
  return data.commit?.sha?.slice(0, 8) || "";
}

// Replace the body of a ## Section in a markdown doc, leaving the header and trailing --- intact
function spliceMdSection(doc: string, headerKeyword: string, newBody: string): string {
  const escaped = headerKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(## ${escaped}[^\n]*\n)([\\s\\S]*?)(\n---)`, "m");
  if (!pattern.test(doc)) return doc;
  return doc.replace(pattern, `$1\n${newBody.trim()}\n$3`);
}

async function listGitHubTree(branch = "main"): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/git/trees/${branch}?recursive=1`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.tree as Array<{ type: string; path: string }> || [])
    .filter(item => item.type === "blob")
    .map(item => item.path);
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

// ── BUILD SELF MODEL (Phase 2B) ───────────────────────────────────────────────

async function buildSelfModel(cycleNumber: number): Promise<Record<string, unknown>> {
  // Get real function inventory from GitHub tree
  const tree = await listGitHubTree("main").catch(() => [] as string[]);
  const functionDirs = [...new Set(
    tree
      .filter(p => p.startsWith("supabase/functions/") && p.split("/").length > 2)
      .map(p => p.split("/")[2])
  )].filter(Boolean).sort();

  // Cron jobs hardcoded — cron schema is not accessible via PostgREST
  const cronJobs = [
    { id: 1, schedule: "0 13 * * *", jobname: "daily-briefing", function: "briefing" },
    { id: 2, schedule: "*/5 * * * *", jobname: "reminders", function: "reminders" },
    { id: 3, schedule: "0 * * * *", jobname: "health-monitor", function: "health-monitor" },
    { id: 6, schedule: "*/30 * * * *", jobname: "nexus-core", function: "nexus-core" }
  ];

  const dayAgo = new Date(Date.now() - 86400000).toISOString();

  const [
    { data: activeAbilities },
    { data: approvedJudgments },
    { data: rejectedJudgments },
    { data: priorities },
    { data: gaps },
    { data: problems },
    { data: previousModel }
  ] = await Promise.all([
    supabase.from("nexus_ability_proposals").select("ability_name").eq("status", "live"),
    supabase.from("nexus_judgment_log").select("proposal_name, decision_reason")
      .eq("decision", "approved").order("created_at", { ascending: false }).limit(20),
    supabase.from("nexus_judgment_log").select("proposal_name, decision_reason")
      .eq("decision", "rejected").order("created_at", { ascending: false }).limit(20),
    supabase.from("nexus_directives").select("priority, title, description")
      .eq("active", true).order("priority").limit(5),
    supabase.from("nexus_self_improvements").select("title, complexity, directive_priority")
      .eq("status", "proposed").limit(10),
    supabase.from("nexus_audit_log").select("action_type, action_detail, created_at")
      .eq("outcome", "failure")
      .gt("created_at", new Date(Date.now() - 3600000).toISOString())
      .not("action_type", "in", '("size_guard_triggered","path_verify_failed","claude_md_sync_aborted","build_aborted","modify_error")')
      .limit(20),
    supabase.from("nexus_self_model").select("consecutive_clean_cycles")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);

  const totalJudgments = (approvedJudgments?.length || 0) + (rejectedJudgments?.length || 0);
  const approvalRate = totalJudgments > 0
    ? Math.round(((approvedJudgments?.length || 0) / totalJudgments) * 100)
    : 0;

  const GUARD_TYPES = new Set([
    "size_guard_triggered", "path_verify_failed", "claude_md_sync_aborted",
    "build_aborted", "modify_error", "github_read_debug"
  ]);
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const filteredProblems = (problems || []).filter(
    (p: { action_type: string; created_at: string }) =>
      p.created_at > oneHourAgo && !GUARD_TYPES.has(p.action_type)
  );

  const hasErrors = filteredProblems.length > 0;
  const consecutiveCleanCycles = hasErrors
    ? 0
    : ((previousModel?.consecutive_clean_cycles || 0) + 1);

  const model: Record<string, unknown> = {
    cycle_number: cycleNumber,
    function_inventory: functionDirs,
    cron_jobs: cronJobs,
    active_abilities: (activeAbilities || []).map((a: { ability_name: string }) => a.ability_name),
    approval_rate: approvalRate,
    approved_patterns: (approvedJudgments || []).slice(0, 10).map((j: { proposal_name: string; decision_reason: string }) =>
      ({ name: j.proposal_name, reason: j.decision_reason })
    ),
    rejected_patterns: (rejectedJudgments || []).slice(0, 10).map((j: { proposal_name: string; decision_reason: string }) =>
      ({ name: j.proposal_name, reason: j.decision_reason })
    ),
    current_priorities: priorities || [],
    known_gaps: (gaps || []).map((g: { title: string; complexity: string }) =>
      ({ title: g.title, complexity: g.complexity })
    ),
    known_problems: filteredProblems.map((p: { action_type: string; action_detail: string }) =>
      ({ type: p.action_type, detail: p.action_detail?.slice(0, 100) })
    ),
    last_heartbeat: new Date().toISOString(),
    consecutive_clean_cycles: consecutiveCleanCycles,
    last_updated_at: new Date().toISOString()
  };

  await supabase.from("nexus_self_model").insert(model);

  return model;
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
    { data: pendingApprovals },
    { data: recentProposals }
  ] = await Promise.all([
    supabase.from("entries").select("content, created_at, importance")
      .eq("task_status", "open").order("importance", { ascending: false }).limit(10),
    supabase.from("clients").select("name, status, health_score, last_activity_at")
      .eq("status", "active"),
    supabase.from("nexus_audit_log").select("action_type, action_detail, created_at")
      .eq("outcome", "failure")
      .gt("created_at", new Date(Date.now() - 7200000).toISOString())
      .not("action_type", "in", '("size_guard_triggered","path_verify_failed")')
      .limit(10),
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
      .eq("status", "pending").order("priority", { ascending: false }).limit(5),
    supabase.from("nexus_ability_proposals").select("ability_name")
      .in("status", ["proposed", "live", "rejected"])
      .gt("created_at", ago.week).limit(50)
  ]);

  const GUARD_TYPES = new Set([
    "size_guard_triggered", "path_verify_failed", "claude_md_sync_aborted",
    "build_aborted", "modify_error", "github_read_debug"
  ]);
  const filteredErrors = (errors || []).filter(
    (e: { action_type: string }) => !GUARD_TYPES.has(e.action_type)
  );

  let chatHandlerCount = 0;
  let chatLines = 0;
  try {
    const ghPath = "supabase/functions/chat/index.ts";
    const ghUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${ghPath}?ref=main`;
    const ghRes = await fetch(ghUrl, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" }
    });
    const ghBody = await ghRes.text();
    if (!ghRes.ok) {
      await supabase.from("nexus_audit_log").insert({
        engine: "nexus-core",
        action_type: "github_read_debug",
        action_detail: `GET ${ghUrl}`,
        autonomous: true,
        outcome: "failure",
        data: {
          status: ghRes.status,
          statusText: ghRes.statusText,
          headers: Object.fromEntries(ghRes.headers.entries()),
          body: ghBody.slice(0, 2000),
        }
      });
    } else {
      const ghData = JSON.parse(ghBody);
      if (!ghData.content) {
        await supabase.from("nexus_audit_log").insert({
          engine: "nexus-core",
          action_type: "github_read_debug",
          action_detail: `GET ${ghUrl} — ok but no content field`,
          autonomous: true,
          outcome: "failure",
          data: {
            status: ghRes.status,
            headers: Object.fromEntries(ghRes.headers.entries()),
            body: ghBody.slice(0, 2000),
          }
        });
      } else {
        // Use the API-reported size (reliable) rather than decoding base64
        // which truncates for large files in Deno's edge runtime
        chatLines = Math.round((ghData.size || 0) / 52);
        chatHandlerCount = 0; // handler count not available without content decode
      }
    }
  } catch (err) {
    await supabase.from("nexus_audit_log").insert({
      engine: "nexus-core",
      action_type: "github_read_debug",
      action_detail: `fetch threw: ${String(err)}`,
      autonomous: true,
      outcome: "failure",
      data: { thrown: String(err) }
    });
  }

  return {
    tasks: tasks || [],
    clients: clients || [],
    errors: filteredErrors,
    improvements: improvements || [],
    liveAbilities: liveAbilities || [],
    directives: directives || [],
    recentBuilds: recentBuilds || [],
    reflections: reflections || [],
    pendingApprovals: pendingApprovals || [],
    recentProposals: (recentProposals || []).map((p: { ability_name: string }) => p.ability_name),
    self: { chatLines, chatHandlerCount, healthy: chatLines > 2000 }
  };
}

// ── THINK (Phase 3: judgment filter) ─────────────────────────────────────────

async function think(
  state: Awaited<ReturnType<typeof observe>>,
  selfModel: Record<string, unknown>,
  cycleNumber: number
) {
  const approvedPatterns = (selfModel.approved_patterns as Array<{ name: string; reason: string }> || [])
    .map(p => `- ${p.name}: ${p.reason}`).join("\n") || "None yet";
  const rejectedPatterns = (selfModel.rejected_patterns as Array<{ name: string; reason: string }> || [])
    .map(p => `- ${p.name}: ${p.reason}`).join("\n") || "None yet";
  const knownProblems = (selfModel.known_problems as Array<{ type: string; detail: string }> || [])
    .map(p => `- ${p.type}: ${p.detail}`).join("\n") || "None";

  const prompt = `You are Nexus Core v3 — an autonomous AI business operating system.
You have one job: continuously improve yourself and build value for Zach.

SELF MODEL (cycle ${cycleNumber}):
- Functions deployed: ${(selfModel.function_inventory as string[] || []).length}
- Active abilities: ${(selfModel.active_abilities as string[] || []).length}
- Approval rate: ${selfModel.approval_rate}% (${selfModel.consecutive_clean_cycles} consecutive clean cycles)

JUDGMENT HISTORY — learn from this:
Previously APPROVED (do more of this):
${approvedPatterns}

Previously REJECTED (avoid these):
${rejectedPatterns}

KNOWN PROBLEMS RIGHT NOW:
${knownProblems}

STRATEGIC DIRECTIVES (every decision must serve these):
${state.directives.map(d => `${d.priority}. ${d.title}: ${d.description}`).join("\n")}

CURRENT STATE:
- Open tasks: ${state.tasks.length}
- Active clients: ${state.clients.length}
- Errors in last 24h: ${state.errors.length}
- Pending improvements: ${state.improvements.length}
- Live abilities: ${state.liveAbilities.length}
- Recent failed builds: ${state.recentBuilds.filter((b: { status: string }) => b.status === "failed").length}
- Pending approvals: ${state.pendingApprovals.length}
- Chat function: ${state.self.chatLines} lines (healthy: ${state.self.healthy})

ERRORS TO FIX (fix before building new things):
${state.errors.slice(0, 3).map((e: { action_type: string; action_detail: string }) =>
  `- ${e.action_type}: ${e.action_detail?.slice(0, 100)}`).join("\n") || "None"}

PENDING IMPROVEMENTS:
${state.improvements.map((i: { title: string; complexity: string; directive_priority: number }) =>
  `- ${i.title} (${i.complexity}, directive ${i.directive_priority})`).join("\n") || "None"}

RECENT LEARNINGS:
${state.reflections.map((r: { observation: string; learned: string }) =>
  `- ${r.learned || r.observation}`).join("\n") || "None yet"}

ABILITIES ALREADY PROPOSED/LIVE/REJECTED IN LAST 7 DAYS (do not re-propose these):
${state.recentProposals.join(", ") || "None"}

JUDGMENT FILTER — apply this strictly before proposing any trigger_build action:
Q1: Would Zach immediately notice value if this didn't exist? (if no → skip it)
Q2: Is this the single highest-value action right now? (fix errors → serve clients → core improvements → new features)
Q3: Can this be built reliably without hallucinating file paths or breaking existing code?

All three must be YES to justify a trigger_build.

RULES:
1. Fix errors before building new things
2. Only 1 trigger_build per cycle
3. Every action must serve a directive
4. Research before building complex systems
5. Simple improvements > complex ones
6. Never repeat what's already in rejected patterns
7. Before proposing any ability, check if a similar one (by name or description) already exists in the last 7 days in nexus_ability_proposals — if so, skip it entirely. Do not propose duplicates.

AVAILABLE ACTIONS:
- research: search web for specific topic, save insight
- identify_improvement: analyze state and identify one self-improvement
- save_insight: save an observation to knowledge base
- update_health: update client health scores
- trigger_build: trigger nexus-build with a specific instruction (1 per cycle, judgment filter required)
- send_alert: send Zach an important alert

Choose 2-3 actions max. Only 1 trigger_build allowed. Include your judgment reasoning.

Respond with JSON only (no markdown, no backticks):
{
  "observations": ["what you notice about current state"],
  "judgment": "your Q1/Q2/Q3 reasoning for any trigger_build, or 'no build this cycle' if skipping",
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
    const response = await ai(prompt, 1800);
    return JSON.parse(response.replace(/```json|```/g, "").trim());
  } catch {
    return {
      observations: ["Think parse error"],
      judgment: "Parse error — defaulting to safe action",
      actions: [{ type: "save_insight", priority: 1, instruction: "Log parse error in think()", reasoning: "System health", data: {} }],
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

  // Off-hours: 22:00–07:00 MT = 04:00–13:00 UTC. Skip heavy AI operations during this window.
  const utcHour = new Date().getUTCHours();
  const isOffHours = utcHour >= 4 && utcHour < 13;
  const HEAVY_ACTIONS = new Set(["research", "identify_improvement"]);

  for (const action of actions) {
    if (isOffHours && HEAVY_ACTIONS.has(action.type)) continue;

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
- Chat function: ${state.self.chatLines} lines (healthy: ${state.self.healthy})
- ${state.liveAbilities.length} live abilities
- ${state.errors.length} recent errors
- Errors: ${state.errors.slice(0, 3).map((e: { action_type: string }) => e.action_type).join(", ")}

Strategic directives: ${state.directives.map((d: { priority: number; title: string }) => `${d.priority}. ${d.title}`).join(", ")}

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

// ── CHECK RESILIENCE (Phase 5) ────────────────────────────────────────────────

async function checkResilience(): Promise<void> {
  const checks: Array<{ check_type: string; status: "ok" | "degraded" | "failed"; detail: string }> = [];

  // Check GitHub token
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (res.ok) {
      checks.push({ check_type: "github_token", status: "ok", detail: "GitHub API accessible" });
    } else {
      checks.push({ check_type: "github_token", status: "failed", detail: `HTTP ${res.status}` });
    }
  } catch (err) {
    checks.push({ check_type: "github_token", status: "failed", detail: String(err) });
  }

  // Check Anthropic API
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }]
      })
    });
    if (res.ok) {
      checks.push({ check_type: "anthropic_api", status: "ok", detail: "Anthropic API reachable" });
    } else {
      const data = await res.json().catch(() => ({}));
      checks.push({
        check_type: "anthropic_api",
        status: "failed",
        detail: `HTTP ${res.status}: ${(data as { error?: { message?: string } }).error?.message || ""}`
      });
    }
  } catch (err) {
    checks.push({ check_type: "anthropic_api", status: "failed", detail: String(err) });
  }

  // Check Supabase — already connected if we're running, but verify DB query works
  const { error: dbErr } = await supabase.from("nexus_audit_log").select("id").limit(1);
  checks.push({
    check_type: "supabase_db",
    status: dbErr ? "failed" : "ok",
    detail: dbErr ? String(dbErr.message) : "Database reachable"
  });

  await supabase.from("nexus_resilience_log").insert(checks);

  const failures = checks.filter(c => c.status === "failed");
  if (failures.length > 0) {
    const msg = `*Nexus Resilience Alert*\n\n` +
      failures.map(f => `X ${f.check_type}: ${f.detail}`).join("\n");
    await tg(msg);
    await log("resilience_check", `${failures.length} check(s) failed`, "failure", { failures });
  } else {
    await log("resilience_check", `All ${checks.length} checks passed`);
  }
}

// ── SYNC CLAUDE.MD ────────────────────────────────────────────────────────────

// Active function descriptions — deprecated functions removed (Phase 7)
const FUNC_DESCRIPTIONS: Record<string, { purpose: string; trigger: string }> = {
  "assess-project":        { purpose: "Run AI assessment on a project", trigger: "On demand" },
  "auto-fix":              { purpose: "Read code from GitHub → Claude writes fix → commit to dev → notify", trigger: "Called by health-monitor" },
  "brain-api":             { purpose: "REST API for brain browser access", trigger: "GET/POST from nexus-brain.html" },
  "briefing":              { purpose: "Morning brief at 7am MT (13:00 UTC) via pg_cron", trigger: "Daily cron (job ID 1)" },
  "chat":                  { purpose: "Core brain: classify → retrieve → Claude → respond", trigger: "POST from Telegram webhook or web" },
  "contractor-auth":       { purpose: "Contractor magic link invite + session lookup", trigger: "Internal" },
  "email-webhook":         { purpose: "Inbound email handling", trigger: "Resend webhook" },
  "generate-queue":        { purpose: "Generate lead call queue", trigger: "On demand" },
  "generate-va-tasks":     { purpose: "Generate daily VA task lists", trigger: "Cron / on demand" },
  "get-dashboard-stats":   { purpose: "Aggregate stats for React dashboard", trigger: "API call from frontend" },
  "health-monitor":        { purpose: "Hourly health check, identify improvements, trigger auto-fix", trigger: "Every hour cron (job ID 3)" },
  "import-leads":          { purpose: "Bulk import leads from CSV or external source", trigger: "On demand" },
  "log-call":              { purpose: "VA logs call outcome + auto-enrolls lead sequences", trigger: "VA web form" },
  "nexus-build":           { purpose: "Consolidated builder: manifest → build → test → stage → notify", trigger: "On demand (telegram, nexus-core, VPS)" },
  "nexus-core":            { purpose: "Consolidated brain: observe, think, act, reflect — every 30 min", trigger: "Cron (every 30 min) + VPS + manual" },
  "nexus-coo":             { purpose: "COO intelligence: focus, stale_check, momentum_check, health_score", trigger: "Called by chat + health-monitor" },
  "process-email-queue":   { purpose: "Batch process email queue", trigger: "Cron" },
  "provision":             { purpose: "Spin up client subdomain + Claude-generated site", trigger: "chat provision: command or web UI" },
  "reclassify":            { purpose: "Re-run classification on existing entries", trigger: "On demand" },
  "refresh-assessments":   { purpose: "Refresh project assessment scores", trigger: "On demand" },
  "roofing-ai":            { purpose: "Roofing AI actions: estimate, contract, invoice, timeline, supplement_request", trigger: "Internal" },
  "roofing-notify":        { purpose: "SMS (Twilio) + email (Resend) dispatcher for all roofing events", trigger: "Internal" },
  "roofing-payments":      { purpose: "Stripe payment intent creation + payment confirmation", trigger: "Internal" },
  "send-email":            { purpose: "Send email via Resend", trigger: "Internal" },
  "synthesize-portfolio":  { purpose: "Generate portfolio-level synthesis and insights", trigger: "On demand" },
  "telegram":              { purpose: "Webhook: immediate 200 ACK, processes in waitUntil", trigger: "Telegram push" },
};

async function syncClaudeMd(state: Awaited<ReturnType<typeof observe>>, cycleNumber: number): Promise<boolean> {
  try {
    // Throttle: skip if synced in last 2 hours AND no new deployed builds
    const [{ data: lastSync }, { data: recentDeploys }] = await Promise.all([
      supabase.from("nexus_audit_log")
        .select("created_at")
        .eq("action_type", "claude_md_synced")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("nexus_build_manifests")
        .select("id")
        .eq("status", "deployed")
        .gt("created_at", new Date(Date.now() - 2 * 3600000).toISOString())
        .limit(1)
    ]);

    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    if (lastSync?.created_at > twoHoursAgo && !recentDeploys?.length) {
      return false;
    }

    const { content: currentContent, sha } = await readGitHubFile("CLAUDE.md");

    // List deployed function directories from GitHub
    const funcDirRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/supabase/functions?ref=main`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
    );
    const funcDirData = await funcDirRes.json();
    const functionNames: string[] = Array.isArray(funcDirData)
      ? funcDirData.filter((f: { type: string }) => f.type === "dir").map((f: { name: string }) => f.name).sort()
      : [];

    const { data: deployedBuilds } = await supabase
      .from("nexus_build_manifests")
      .select("goal, deployed_at")
      .eq("status", "deployed")
      .order("deployed_at", { ascending: false })
      .limit(20);

    // ── UPDATE 1: Edge Functions table ───────────────────────────────────────

    const tableRows = functionNames.map(name => {
      const desc = FUNC_DESCRIPTIONS[name] || { purpose: "See function source for details", trigger: "Internal" };
      return `| \`${name}\` | ${desc.purpose} | ${desc.trigger} |`;
    }).join("\n");

    const newFuncTable = `| Function | Purpose | Trigger |
|----------|---------|---------|
${tableRows}`;

    let updated = spliceMdSection(currentContent, "EDGE FUNCTIONS", newFuncTable);

    // ── UPDATE 2: Build Priorities section ───────────────────────────────────

    const existingDoneLines = (currentContent.match(/^- .+/gm) || [])
      .filter(l => l.includes("DONE") || l.startsWith("- (nothing"));
    const existingDoneSet = new Set(existingDoneLines.map(l => l.slice(0, 60)));

    const newDoneLines = (deployedBuilds || [])
      .filter((b: { goal: string }) => {
        const candidate = `- ${(b.goal || "").slice(0, 55)}`;
        return ![...existingDoneSet].some(existing => existing.includes((b.goal || "").slice(0, 30)));
      })
      .map((b: { goal: string }) => `- ${b.goal}`);

    const nextPrompt = `Generate a prioritized NEXT list for the Nexus build priorities section.
Return ONLY a numbered list (1-8 items). No headers, no extra text.

PENDING SELF-IMPROVEMENTS (highest priority):
${state.improvements.map((i: { title: string; complexity: string; directive_priority: number }) =>
  `${i.directive_priority}. ${i.title} (${i.complexity})`).join("\n") || "None"}

OPEN TASKS:
${state.tasks.slice(0, 4).map((t: { content: string }) => `- ${(t.content || "").slice(0, 80)}`).join("\n") || "None"}

ACTIVE CLIENTS (${state.clients.length} total):
${state.clients.slice(0, 3).map((c: { name: string; health_score: number }) => `- ${c.name} (health: ${c.health_score || "?"})`).join("\n") || "None"}`;

    const nextList = await ai(nextPrompt, 500);

    const allDoneText = newDoneLines.length > 0
      ? `\n${newDoneLines.join("\n")}`
      : "";

    const newPrioritiesBody = `**DONE this session:**
- (nothing yet this session)${allDoneText}

**NEXT:**
${nextList.trim()}`;

    updated = spliceMdSection(updated, "CURRENT BUILD PRIORITIES", newPrioritiesBody);

    // ── UPDATE 3: Date header ─────────────────────────────────────────────────

    const today = new Date().toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver"
    });
    updated = updated.replace(/# Last updated: [^\n]+/, `# Last updated: ${today} — v8`);

    // ── GUARDS ────────────────────────────────────────────────────────────────

    if (updated.length < currentContent.length * 0.85) {
      await log("claude_md_sync_aborted",
        `Size guard: ${updated.length} chars < 85% of ${currentContent.length}`, "failure");
      return false;
    }

    if (updated.trim() === currentContent.trim()) {
      await log("claude_md_sync_skipped", "No changes detected");
      return false;
    }

    // ── COMMIT TO MAIN ────────────────────────────────────────────────────────

    const commitSha = await writeGitHubMain(
      "CLAUDE.md",
      updated,
      sha,
      `[auto] Sync CLAUDE.md — cycle ${cycleNumber}`
    );

    await log("claude_md_synced",
      `CLAUDE.md updated on main — commit ${commitSha}`,
      "success",
      { commit: commitSha, cycle: cycleNumber, functions: functionNames.length, new_done: newDoneLines.length }
    );

    return true;

  } catch (err) {
    await log("claude_md_sync_error", String(err), "failure");
    return false;
  }
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
    // Build self model first — before observe/think/act (Phase 2B)
    const selfModel = await buildSelfModel(cycleNumber);

    let _t: number;

    _t = Date.now();
    const state = await observe().then(r => { logHeartbeat("nexus-core:observe", "ok", Date.now() - _t); return r; })
      .catch(e => { logHeartbeat("nexus-core:observe", "error", Date.now() - _t, String(e)); throw e; });

    _t = Date.now();
    const decisions = await think(state, selfModel, cycleNumber).then(r => { logHeartbeat("nexus-core:think", "ok", Date.now() - _t); return r; })
      .catch(e => { logHeartbeat("nexus-core:think", "error", Date.now() - _t, String(e)); throw e; });

    _t = Date.now();
    const actionsExecuted = await act(decisions, state).then(r => { logHeartbeat("nexus-core:act", "ok", Date.now() - _t); return r; })
      .catch(e => { logHeartbeat("nexus-core:act", "error", Date.now() - _t, String(e)); throw e; });

    _t = Date.now();
    await reflect(decisions, cycleNumber, actionsExecuted).then(() => logHeartbeat("nexus-core:reflect", "ok", Date.now() - _t))
      .catch(e => logHeartbeat("nexus-core:reflect", "error", Date.now() - _t, String(e)));

    // Resilience check every 5 cycles (Phase 5)
    if (cycleNumber % 5 === 0) {
      _t = Date.now();
      await checkResilience().then(() => logHeartbeat("nexus-core:resilience", "ok", Date.now() - _t))
        .catch(e => logHeartbeat("nexus-core:resilience", "error", Date.now() - _t, String(e)));
    }

    // Every 12th cycle (~6 hours at 30-min intervals), run roofing product monitor
    if (cycleNumber % 12 === 0) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-product-monitor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`
        },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // Every cycle: advance nexus follow-up sequences
    fetch(`${SUPABASE_URL}/functions/v1/nexus-follow-up`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({})
    }).catch(() => {});

    // Every 8th cycle (~4 hours): proactive prospecting scan
    if (cycleNumber % 8 === 0) {
      (async () => {
        const serperKey = Deno.env.get("SERPER_API_KEY");
        if (!serperKey) return;
        const queries = [
          "small business owner Denver Colorado struggling with operations",
          "Denver small business needs help with systems and processes",
          "roofing contractor Denver growing business"
        ];
        const query = queries[Math.floor(cycleNumber / 8) % queries.length];
        const res = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: query, num: 5 })
        });
        const data = await res.json();
        for (const result of data.organic || []) {
          if (!result.link || !result.link.startsWith("http")) continue;
          fetch(`${SUPABASE_URL}/functions/v1/nexus-quick-scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ url: result.link, business_name: result.title?.slice(0, 80) })
          }).catch(() => {});
        }
        await log("proactive_prospecting", `Scanned results for: ${query}`);
      })().catch(() => {});
    }

    // Every 8th cycle: hail storm detection
    if (cycleNumber % 8 === 0) {
      (async () => {
        const serperKey = Deno.env.get("SERPER_API_KEY");
        if (!serperKey) return;
        const res = await fetch("https://google.serper.dev/news", {
          method: "POST",
          headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
          body: JSON.stringify({ q: "hail storm damage Colorado Denver 2026", num: 5 })
        });
        const data = await res.json();
        const articles = data.news || [];
        const newHail = articles.filter((a: { title?: string }) =>
          a.title?.toLowerCase().includes("hail") && a.title?.toLowerCase().includes("colorado")
        );
        for (const article of newHail.slice(0, 3)) {
          const { data: existing } = await supabase
            .from("hail_events")
            .select("id")
            .eq("source_url", article.link)
            .maybeSingle();
          if (existing) continue;
          await supabase.from("hail_events").insert({
            location: "Colorado",
            event_date: new Date().toISOString().slice(0, 10),
            source_url: article.link,
            headline: article.title?.slice(0, 200),
            detected_at: new Date().toISOString()
          });
          await tg(`⛈️ *Hail Event Detected*\n\n${article.title}\n${article.link}\n\n_Roofing OS prospecting can target affected areas._`);
        }
      })().catch(() => {});
    }

    // Every 48th cycle (~24 hours): vertical opportunity detection
    if (cycleNumber % 48 === 0) {
      fetch(`${SUPABASE_URL}/functions/v1/nexus-self-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // VOICE CALL SEQUENCER — every cycle, advance Starter tier lead call schedule
    {
      const { data: voicePref } = await supabase
        .from("nexus_preferences")
        .select("value")
        .eq("key", "voice_paused")
        .maybeSingle();
      const voicePaused = voicePref?.value === "true";

      if (!voicePaused) {
        const { data: starterLeads } = await supabase
          .from("nexus_diagnostics")
          .select("id, business_name, owner_phone, voice_calls(*)")
          .eq("recommended_model", "custom_starter")
          .in("status", ["report_sent", "follow_up", "report_ready", "hot"])
          .not("owner_phone", "is", null);

        for (const lead of starterLeads || []) {
          const calls = (lead as { voice_calls?: unknown[] }).voice_calls || [];
          if (calls.length >= 4) continue;

          const lastCall = (calls as { created_at: string }[])
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
          const daysSinceLastCall = lastCall
            ? (Date.now() - new Date(lastCall.created_at).getTime()) / (1000 * 60 * 60 * 24)
            : 999;

          // Call schedule: Day 1, 3, 7, 10
          const callSchedule = [1, 3, 7, 10];
          const nextCallDay = callSchedule[calls.length];

          if (nextCallDay && daysSinceLastCall >= nextCallDay) {
            fetch(`${SUPABASE_URL}/functions/v1/nexus-voice-engine`, {
              method: "POST",
              headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({ diagnostic_id: (lead as { id: string }).id, call_number: calls.length + 1 })
            }).catch(() => {});
          }
        }
      }
    }

    // VOICE LEARNING — every 336 cycles (~7 days at 30-min intervals)
    if (cycleNumber % 336 === 0) {
      fetch(`${SUPABASE_URL}/functions/v1/nexus-voice-learning`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // ROOFING ARIA — STORM DETECTION every 16 cycles (~8 hours)
    if (cycleNumber % 16 === 4) {
      try {
        const serperKey = Deno.env.get("SERPER_API_KEY");
        if (serperKey) {
          const searchRes = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q: `hail storm Colorado ${new Date().toLocaleDateString()} 2026`, num: 3 })
          });
          const searchData = await searchRes.json();
          const results = searchData.organic || [];
          for (const result of results.slice(0, 3)) {
            const snippet = (result.snippet || "").toLowerCase();
            if (snippet.includes("hail") && (snippet.includes("inch") || snippet.includes('"'))) {
              const sizeMatch = snippet.match(/(\d+\.?\d*)["\s]*inch/i);
              const hailSize = sizeMatch ? parseFloat(sizeMatch[1]) : 1.0;
              if (hailSize >= 1.0) {
                const zipMatch = snippet.match(/\b8\d{4}\b/g);
                const zipCodes = zipMatch || ["80202"];
                fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-storm-trigger`, {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ zip_codes: zipCodes, hail_size: hailSize, storm_date: new Date().toISOString() })
                }).catch(() => {});
                await tg(`⛈️ *Storm detected by Nexus*\nHail: ${hailSize}"\nArea: ${zipCodes.join(", ")}\nStorm alerts firing to previous customers.`);
                break;
              }
            }
          }
        }
      } catch {}
    }

    // ROOFING ARIA — LEAD FOLLOWUP SEQUENCE every cycle
    try {
      const { data: pendingLeads } = await supabase
        .from("roofing_prospects")
        .select("id, phone, owner_name, company_name, address")
        .eq("status", "researched")
        .not("phone", "is", null)
        .limit(5);

      for (const lead of pendingLeads || []) {
        const { data: calls } = await supabase
          .from("roofing_aria_calls")
          .select("created_at, outcome")
          .eq("contact_phone", lead.phone)
          .eq("call_type", "lead_followup")
          .order("created_at", { ascending: false });

        const callCount = (calls || []).length;
        const lastCall = calls?.[0];
        const daysSince = lastCall
          ? (Date.now() - new Date(lastCall.created_at).getTime()) / (1000 * 60 * 60 * 24)
          : 999;
        const schedule = [1, 3, 7];
        const nextDay = schedule[callCount];

        if (nextDay && daysSince >= nextDay && callCount < 3) {
          fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              call_type: "lead_followup",
              contact_phone: lead.phone,
              contact_name: lead.owner_name || lead.company_name,
              contact_type: "new_lead",
              metadata: {
                property_address: lead.address || "your location",
                rep_name: "our team",
                days_ago: `${Math.round(daysSince)} days ago`,
                contractor_name: "Colorado Roofing Pros"
              }
            })
          }).catch(() => {});
        }
      }
    } catch {}

    // ROOFING ARIA LEARNING — weekly (offset from voice learning)
    if (cycleNumber % 336 === 168) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-learning`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // DEPRECIATION SCAN — every 48 cycles (~24 hours)
    if (cycleNumber % 48 === 0) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-depreciation-tracker`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" })
      }).catch(() => {});
    }

    // SUPPLEMENT FOLLOW-UP — check for unanswered submissions (every cycle)
    try {
      const { data: pendingSupplements } = await supabase
        .from("supplement_packages")
        .select("id, carrier_name, adjuster_name, supplement_requested_amount, submitted_to_adjuster_at")
        .eq("status", "submitted")
        .lt("submitted_to_adjuster_at", new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString());
      for (const pkg of pendingSupplements || []) {
        const daysPending = Math.round(
          (Date.now() - new Date(pkg.submitted_to_adjuster_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysPending > 5 && daysPending % 5 === 0) {
          await tg(
            `⏰ *Supplement Follow-up Needed*\n` +
            `Carrier: ${pkg.carrier_name}\n` +
            `Submitted ${daysPending} days ago.\n` +
            `Amount: $${((pkg.supplement_requested_amount || 0) / 100).toLocaleString()}\n` +
            `Adjuster: ${pkg.adjuster_name || "Unknown"}\n` +
            `Reply \`follow up supplement: ${pkg.id?.slice(0, 8)}\``
          );
        }
      }
    } catch {}

    // PERMIT SCAN + WEATHER CHECK — every 48 cycles (~24 hours)
    if (cycleNumber % 48 === 0) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-permit-tracker`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan_pending" })
      }).catch(() => {});
      fetch(`${SUPABASE_URL}/functions/v1/roofing-crew-manager`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "weather_check" })
      }).catch(() => {});
    }

    // FINANCIAL DASHBOARD — weekly Monday morning (cycle 336 offset 0)
    if (cycleNumber % 336 === 0) {
      (async () => {
        const finRes = await fetch(`${SUPABASE_URL}/functions/v1/roofing-financial`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dashboard" })
        });
        const finData = await finRes.json();
        await tg(
          `💰 *Weekly Roofing Financial Summary*\n\n` +
          `Revenue (30d): $${((finData.revenue || 0) / 100).toLocaleString()}\n` +
          `Profit (30d): $${((finData.profit || 0) / 100).toLocaleString()}\n` +
          `Avg margin: ${finData.avg_margin || 0}%\n` +
          `Supplement revenue: $${((finData.supplement_revenue || 0) / 100).toLocaleString()}\n` +
          `Outstanding: $${((finData.outstanding || 0) / 100).toLocaleString()}\n` +
          `Pipeline: $${((finData.pipeline || 0) / 100).toLocaleString()}`
        );
      })().catch(() => {});
    }

    // INTELLIGENCE LAYER — WEEKLY REPORT (Monday 7am MT = 14:00 UTC)
    const _intelNow = new Date();
    if (_intelNow.getUTCDay() === 1 && _intelNow.getUTCHours() === 14 && cycleNumber % 2 === 0) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-weekly-report`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // SELF-IMPROVE — weekly (offset 252 cycles from financial)
    if (cycleNumber % 336 === 252) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-self-improve`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // ARIA MODEL GUARD — every 12 cycles (~6 hours): ensure model hasn't reverted to GPT
    if (cycleNumber % 12 === 3) {
      (async () => {
        try {
          const retellKey = Deno.env.get("RETELL_API_KEY");
          if (!retellKey) return;
          const res = await fetch("https://api.retellai.com/get-retell-llm/llm_e54f939d8b72817b006519d65c91", {
            headers: { "Authorization": `Bearer ${retellKey}` }
          });
          const llm = await res.json().catch(() => ({}));
          const currentModel = llm?.model || "";
          if (!currentModel.startsWith("claude")) {
            // Reverted — force it back
            await fetch("https://api.retellai.com/update-retell-llm/llm_e54f939d8b72817b006519d65c91", {
              method: "PATCH",
              headers: { "Authorization": `Bearer ${retellKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: "claude-4.5-haiku" })
            });
            await tg(`⚠️ *Aria model reverted — fixed automatically*\nWas: \`${currentModel}\` → restored: \`claude-4.5-haiku\``);
            await log("aria_model_guard", `Reverted model ${currentModel} → claude-4.5-haiku`, "failure");
          }
        } catch { /* non-fatal */ }
      })().catch(() => {});
    }

    // QA BOT — every 6 hours (offset from product-monitor at === 0)
    if (cycleNumber % 12 === 6) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-qa-bot`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // REP ANALYTICS — daily (offset 24 from depreciation)
    if (cycleNumber % 48 === 24) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-analytics`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rep_performance" })
      }).catch(() => {});
    }

    // MARKET PENETRATION — weekly (offset 84 cycles)
    if (cycleNumber % 336 === 84) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-analytics`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "market_penetration" })
      }).catch(() => {});
    }

    // VERTICAL ROUTER — every cycle
    fetch(`${SUPABASE_URL}/functions/v1/nexus-vertical-router`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cycle_number: cycleNumber })
    }).catch(() => {});

    // SUPPLEMENT AUDIT LEAD FOLLOWUP — every 2 cycles
    if (cycleNumber % 2 === 1) {
      const cutoffOld = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const cutoffNew = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const { data: auditLeads } = await supabase
        .from("supplement_audit_leads")
        .select("id, name, phone, company_name, score")
        .eq("aria_call_queued", false)
        .gte("score", 40)
        .not("phone", "is", null)
        .gte("created_at", cutoffOld)
        .lte("created_at", cutoffNew);
      for (const lead of auditLeads || []) {
        fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            call_type: "supplement_audit_followup",
            contact_phone: lead.phone,
            contact_name: lead.name,
            contact_type: "audit_lead",
            metadata: { company_name: lead.company_name, score: lead.score, contractor_name: "Roofing OS" }
          })
        }).catch(() => {});
        await supabase.from("supplement_audit_leads").update({ aria_call_queued: true }).eq("id", lead.id);
      }
    }

    // CONTRACTOR TRIAL EXPIRY ALERT — daily
    if (cycleNumber % 48 === 0) {
      const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const { data: expiringTrials } = await supabase
        .from("contractor_accounts")
        .select("company_name, owner_name, owner_email, owner_phone, trial_ends_at")
        .eq("subscription_status", "trialing")
        .lte("trial_ends_at", in3Days)
        .is("stripe_subscription_id", null);
      for (const c of expiringTrials || []) {
        const daysLeft = Math.max(0, Math.round(
          (new Date(c.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        ));
        await tg(
          `⏰ *Trial Expiring Soon*\n` +
          `${c.company_name} — ${c.owner_name}\n` +
          `Email: ${c.owner_email}\n` +
          `Phone: ${c.owner_phone || "none"}\n` +
          `Trial ends in: ${daysLeft} day(s)\n` +
          `Action: Call to convert to paid`
        );
      }
    }

    // ARIA QUEUE PROCESSOR — fire queued calls whose window has arrived
    {
      const queueNow = new Date().toISOString();
      const { data: readyToFire } = await supabase
        .from("aria_call_queue")
        .select("*")
        .eq("status", "queued")
        .lte("fire_at", queueNow)
        .lt("attempt_count", 3)
        .order("fire_at", { ascending: true })
        .limit(5);

      let queueFired = 0;
      for (const queuedCall of readyToFire || []) {
        const gateRes = await fetch(`${SUPABASE_URL}/functions/v1/aria-call-gate`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ contact_phone: queuedCall.contact_phone, call_type: queuedCall.call_type })
        });
        const gate = await gateRes.json().catch(() => ({ allowed: true }));

        if (!gate.allowed) {
          await supabase.from("aria_call_queue")
            .update({
              fire_at: gate.next_allowed_at || new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
              attempt_count: (queuedCall.attempt_count || 0) + 1
            })
            .eq("id", queuedCall.id);
          continue;
        }

        await fetch(`${SUPABASE_URL}/functions/v1/roofing-aria-engine`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            call_type: queuedCall.call_type,
            contact_phone: queuedCall.contact_phone,
            contact_name: queuedCall.contact_name,
            contact_type: queuedCall.contact_type,
            job_id: queuedCall.job_id,
            language: queuedCall.language || "en",
            metadata: queuedCall.metadata || {}
          })
        }).catch(() => null);

        await supabase.from("aria_call_queue")
          .update({ status: "fired", fired_at: new Date().toISOString(), attempt_count: (queuedCall.attempt_count || 0) + 1 })
          .eq("id", queuedCall.id);

        queueFired++;
      }

      if ((readyToFire || []).length > 0) {
        await logHeartbeat("nexus-core:aria-queue", "ok", 0);
        await log("aria_queue_processed", `Fired ${queueFired}/${(readyToFire || []).length} queued calls`);
      }
    }

    // MORNING DIGEST — daily 6:30am MT (12:30-13:00 UTC)
    const _utcNow = new Date();
    const _utcH = _utcNow.getUTCHours();
    const _utcM = _utcNow.getUTCMinutes();
    if (_utcH === 12 && _utcM >= 30) {
      fetch(`${SUPABASE_URL}/functions/v1/morning-digest`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // MONTHLY TRUTH — 1st of month, 8am MT (14:00-14:30 UTC)
    if (_utcNow.getUTCDate() === 1 && _utcH === 14 && _utcM < 30) {
      fetch(`${SUPABASE_URL}/functions/v1/monthly-truth`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // 90-DAY CONTRACTOR ANNIVERSARY — scan once per day at 14:00-14:30 UTC
    if (_utcH === 14 && _utcM < 30) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-referral-engine`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "scan_anniversaries" })
      }).catch(() => {});
    }

    // CONTENT MACHINE — YouTube: Monday 8am MT (14:00 UTC)
    if (_utcNow.getUTCDay() === 1 && _utcH === 14 && _utcM < 30) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-engine`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // CONTENT MACHINE — Email nurture: every cycle (send due sequences)
    fetch(`${SUPABASE_URL}/functions/v1/roofing-email-nurture`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send" })
    }).catch(() => {});

    // CONTENT MACHINE — Community monitor: every 4 cycles (~2 hours, matches pg_cron backup)
    if (cycleNumber % 4 === 0) {
      fetch(`${SUPABASE_URL}/functions/v1/roofing-community-monitor`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }).catch(() => {});
    }

    // CONTENT MACHINE — Voiceover: belt-and-suspenders catch for any approved scripts missing MP3
    {
      const { data: pendingVoiceovers } = await supabase
        .from("roofing_content")
        .select("id")
        .eq("type", "youtube_script")
        .eq("status", "approved")
        .is("mp3_url", null)
        .limit(1);
      if (pendingVoiceovers?.length) {
        fetch(`${SUPABASE_URL}/functions/v1/roofing-voiceover-engine`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({})
        }).catch(() => {});
      }
    }

    // Auto-sync CLAUDE.md at the end of every cycle
    const claudeMdUpdated = await syncClaudeMd(state, cycleNumber);

    const duration = Date.now() - startTime;

    // Only notify for errors, pending approvals, or money events — not routine success
    const hasCriticalErrors = state.errors.length > 3;
    const hasPendingApprovals = state.pendingApprovals.length > 0;
    if (hasCriticalErrors || hasPendingApprovals) {
      await tg(
        `*Nexus Core — Cycle ${cycleNumber}*\n\n` +
        (hasCriticalErrors ? `⚠️ ${state.errors.length} errors need attention\n` : "") +
        (hasPendingApprovals ? `📋 ${state.pendingApprovals.length} item(s) pending approval\n` : "") +
        `\n${decisions.summary}\n_${duration}ms_`
      );
    }

    await logHeartbeat("nexus-core", "ok", duration);

    return Response.json({
      ok: true,
      cycle: cycleNumber,
      actions: actionsExecuted,
      self_model: {
        functions: (selfModel.function_inventory as string[] || []).length,
        approval_rate: selfModel.approval_rate,
        consecutive_clean: selfModel.consecutive_clean_cycles
      },
      claude_md_updated: claudeMdUpdated,
      summary: decisions.summary
    });

  } catch (err) {
    await log("cycle_error", String(err), "failure");
    await logHeartbeat("nexus-core", "error", Date.now() - startTime, String(err).slice(0, 200));
    return Response.json({ error: String(err) }, { status: 500 });
  }
});

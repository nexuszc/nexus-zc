// NEXUS nexus-agent — autonomous 15-minute operator loop
// Observe → Think → Act → Report

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── UTILITIES ─────────────────────────────────────────────────────────────────

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

async function claudeThink(prompt: string, maxTokens = 1500): Promise<string> {
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

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const truncated = text.length > 4000 ? text.slice(0, 3900) + "..." : text;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: truncated, parse_mode: "Markdown" }),
  });
}

async function auditLog(
  actionType: string,
  actionDetail: string,
  options: {
    riskLevel?: string;
    autonomous?: boolean;
    approvalRequired?: boolean;
    outcome?: string;
    outcomeDetail?: string;
    data?: Record<string, unknown>;
  } = {}
) {
  await supabase.from("nexus_audit_log").insert({
    engine: "nexus-agent",
    action_type: actionType,
    action_detail: actionDetail,
    risk_level: options.riskLevel || "low",
    autonomous: options.autonomous ?? true,
    approval_required: options.approvalRequired || false,
    outcome: options.outcome || "success",
    outcome_detail: options.outcomeDetail || null,
    data: options.data || null,
  });
}

async function logDecision(
  decisionType: string,
  context: string,
  reasoning: string,
  actionTaken: string,
  confidence: number
) {
  const { data } = await supabase.from("nexus_decisions").insert({
    decision_type: decisionType,
    context,
    reasoning,
    action_taken: actionTaken,
    confidence,
  }).select("id").single();
  return data?.id;
}

async function queueAction(
  actionType: string,
  summary: string,
  detail: string,
  actionData: Record<string, unknown>,
  priority = 5
): Promise<string> {
  const { data } = await supabase.from("nexus_action_queue").insert({
    action_type: actionType,
    action_summary: summary,
    action_detail: detail,
    action_data: actionData,
    priority,
    status: "pending",
  }).select("id").single();

  await auditLog("action_queued", summary, {
    approvalRequired: true,
    outcome: "pending",
    data: { action_type: actionType, priority },
  });

  return data?.id || "";
}

// ── OBSERVE ───────────────────────────────────────────────────────────────────

async function observe() {
  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: openTasks },
    { data: overdueTasks },
    { data: activeClients },
    { data: staleClients },
    { data: activeProjects },
    { data: staleProjects },
    { data: recentEntries },
    { data: pendingImprovements },
    { data: pendingActions },
    { data: recentErrors },
    { data: abilityUsage },
    { data: proposedAbilities },
    { data: recentResearch },
  ] = await Promise.all([
    supabase.from("entries").select("id, content, created_at, project_names, importance, client_id")
      .eq("task_status", "open").order("importance", { ascending: false }).limit(20),
    supabase.from("entries").select("id, content, created_at, project_names")
      .eq("task_status", "open").lt("created_at", sevenDaysAgo).limit(10),
    supabase.from("clients").select("id, name, status, health_score, last_activity_at, churn_risk_score")
      .eq("status", "active"),
    supabase.from("clients").select("id, name, last_activity_at")
      .eq("status", "active")
      .or(`last_activity_at.lt.${fiveDaysAgo},last_activity_at.is.null`),
    supabase.from("projects").select("id, name, category, momentum_status, next_milestone, last_update_at")
      .neq("momentum_status", "archived").limit(15),
    supabase.from("projects").select("id, name, category, last_update_at")
      .eq("momentum_status", "active").lt("last_update_at", sevenDaysAgo),
    supabase.from("entries").select("id, content, created_at, entry_type, needs_followup")
      .order("created_at", { ascending: false }).limit(20),
    supabase.from("nexus_improvements").select("id, title, priority, status, source")
      .in("status", ["pending", "needs_manual_review"]).order("priority", { ascending: false }).limit(5),
    supabase.from("nexus_action_queue").select("id, action_type, action_summary, priority, created_at")
      .eq("status", "pending"),
    supabase.from("nexus_health").select("function_name, error_count, status, checked_at")
      .gt("checked_at", oneDayAgo).gt("error_count", 0),
    supabase.from("nexus_usage").select("ability, success, logged_at")
      .gt("logged_at", thirtyDaysAgo).order("logged_at", { ascending: false }).limit(100),
    supabase.from("nexus_ability_proposals").select("id, ability_name, status, created_at")
      .in("status", ["proposed", "approved", "building"]),
    supabase.from("nexus_research_findings").select("topic, finding, relevance_score, created_at")
      .gt("created_at", oneDayAgo).order("relevance_score", { ascending: false }).limit(10),
  ]);

  return {
    openTasks: openTasks || [],
    overdueTasks: overdueTasks || [],
    activeClients: activeClients || [],
    staleClients: staleClients || [],
    activeProjects: activeProjects || [],
    staleProjects: staleProjects || [],
    recentEntries: recentEntries || [],
    pendingImprovements: pendingImprovements || [],
    pendingActions: pendingActions || [],
    recentErrors: recentErrors || [],
    abilityUsage: abilityUsage || [],
    proposedAbilities: proposedAbilities || [],
    recentResearch: recentResearch || [],
    timestamp: now.toISOString(),
  };
}

// ── THINK ─────────────────────────────────────────────────────────────────────

async function think(signals: Awaited<ReturnType<typeof observe>>) {
  const prompt = `You are the Nexus autonomous agent. You just observed the current state of Zach's business system.
Analyze these signals and decide what actions to take right now.

CURRENT SIGNALS:
- Open tasks: ${signals.openTasks.length} (${signals.overdueTasks.length} overdue 7+ days)
- Active clients: ${signals.activeClients.length} (${signals.staleClients.length} stale 5+ days)
- Active projects: ${signals.activeProjects.length} (${signals.staleProjects.length} stale 7+ days)
- Pending improvements: ${signals.pendingImprovements.length}
- Pending approval actions: ${signals.pendingActions.length}
- System errors (24h): ${signals.recentErrors.length}
- Proposed abilities awaiting build: ${signals.proposedAbilities.filter((a: { status: string }) => a.status === "approved").length}

STALE CLIENTS: ${JSON.stringify(signals.staleClients.map((c: { name: string; last_activity_at: string | null }) => ({ name: c.name, last_active: c.last_activity_at })))}
STALE PROJECTS: ${JSON.stringify(signals.staleProjects.map((p: { name: string; category: string; last_update_at: string }) => ({ name: p.name, category: p.category, last_update: p.last_update_at })))}
OVERDUE TASKS: ${JSON.stringify(signals.overdueTasks.map((t: { content: string; created_at: string }) => ({ task: t.content?.slice(0, 100), age_days: Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000) })))}
RECENT ERRORS: ${JSON.stringify(signals.recentErrors)}
RECENT RESEARCH: ${JSON.stringify(signals.recentResearch.map((r: { topic: string; relevance_score: number }) => ({ topic: r.topic, relevance: r.relevance_score })))}

RISK THRESHOLDS (STRICT):
AUTO-ACT (do without asking):
- Update health scores and momentum status
- Flag stale clients and projects in DB
- Score and rank leads
- Save insights to knowledge_base
- Generate draft documents (save to DB only, never send)
- Log patterns and observations
- Queue ability gap proposals

REQUIRES 1-TAP APPROVAL (queue, do NOT execute):
- Send any communication (email, SMS, Telegram to clients)
- Deploy any code changes
- Create new client or lead records
- Call any paid external API beyond what's already budgeted
- Build new abilities
- Any action affecting real people

NEVER DO:
- Push to main branch
- Delete any data
- Financial transactions
- Send anything without approval

Respond with a JSON object (no markdown, no backticks):
{
  "observations": ["list of key observations about current state"],
  "auto_actions": [
    {
      "type": "update_health_scores|flag_stale|save_insight|score_leads|generate_draft|log_pattern",
      "description": "what to do",
      "data": {},
      "reasoning": "why this is needed"
    }
  ],
  "approval_actions": [
    {
      "type": "send_email|deploy_code|create_record|build_ability",
      "summary": "short description for Telegram button",
      "detail": "full description",
      "data": {},
      "priority": 5,
      "reasoning": "why this needs doing"
    }
  ],
  "ability_gaps": [
    {
      "ability_name": "name",
      "trigger": "command trigger",
      "description": "what it does",
      "evidence": "why it's needed",
      "complexity": "simple|medium|complex"
    }
  ],
  "summary": "1-2 sentence summary of what you observed and what you're doing"
}`;

  const response = await claudeThink(prompt, 2000);

  try {
    const cleaned = response.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    await auditLog("think_parse_error", "Failed to parse Claude think response", {
      outcome: "failure",
      outcomeDetail: response.slice(0, 500),
    });
    return {
      observations: ["Parse error in think phase"],
      auto_actions: [],
      approval_actions: [],
      ability_gaps: [],
      summary: "Agent cycle completed with parse error",
    };
  }
}

// ── ACT ───────────────────────────────────────────────────────────────────────

async function executeAutoActions(
  autoActions: Array<{ type: string; description: string; data: Record<string, unknown>; reasoning: string }>
) {
  let actionsExecuted = 0;

  for (const action of autoActions) {
    try {
      if (action.type === "update_health_scores") {
        await fetch(`${SUPABASE_URL}/functions/v1/nexus-coo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ action: "health_score" }),
        });
        await auditLog("auto_act", action.description, { data: { type: action.type } });
        actionsExecuted++;
      }

      if (action.type === "flag_stale") {
        if (action.data?.project_ids && Array.isArray(action.data.project_ids)) {
          await supabase.from("projects")
            .update({ momentum_status: "stale" })
            .in("id", action.data.project_ids as string[]);
        }
        await auditLog("auto_act", action.description, { data: action.data });
        actionsExecuted++;
      }

      if (action.type === "save_insight") {
        await supabase.from("knowledge_base").insert({
          topic: action.data?.topic || "nexus_insight",
          content: action.data?.content || action.description,
          source_url: null,
          auto_generated: true,
          relevance_score: action.data?.relevance || 0.7,
        });
        await auditLog("auto_act", `Saved insight: ${action.description}`, {
          data: { topic: action.data?.topic },
        });
        actionsExecuted++;
      }

      if (action.type === "log_pattern") {
        await supabase.from("nexus_decisions").insert({
          decision_type: "act",
          context: (action.data?.context as string) || "",
          reasoning: action.reasoning,
          action_taken: action.description,
          confidence: (action.data?.confidence as number) || 0.7,
        });
        await auditLog("auto_act", `Logged pattern: ${action.description}`, { data: action.data });
        actionsExecuted++;
      }

      if (action.type === "score_leads") {
        const { data: leads } = await supabase.from("leads")
          .select("id, name, status, notes, created_at")
          .is("score", null)
          .limit(20);

        if (leads && leads.length > 0) {
          for (const lead of leads) {
            const scorePrompt = `Score this lead 1-100 based on conversion likelihood.
Lead: ${JSON.stringify(lead)}
Consider: recency, notes quality, status, engagement signals.
Respond with JSON only: {"score": number, "reasoning": "brief reason"}`;

            const scoreRes = await claudeThink(scorePrompt, 200);
            try {
              const parsed = JSON.parse(scoreRes.replace(/```json|```/g, "").trim());
              await supabase.from("leads").update({ score: parsed.score }).eq("id", lead.id);
            } catch { /* skip */ }
          }

          await auditLog("auto_act", `Scored ${leads.length} leads`, {
            data: { leads_scored: leads.length },
          });
          actionsExecuted++;
        }
      }
    } catch (err) {
      await auditLog("auto_act_error", `Failed: ${action.description}`, {
        outcome: "failure",
        outcomeDetail: String(err),
      });
    }
  }

  return actionsExecuted;
}

async function queueApprovalActions(
  approvalActions: Array<{
    type: string;
    summary: string;
    detail: string;
    data: Record<string, unknown>;
    priority: number;
    reasoning: string;
  }>
) {
  let queued = 0;

  for (const action of approvalActions) {
    // Don't duplicate pending actions
    const { data: existing } = await supabase.from("nexus_action_queue")
      .select("id").eq("action_type", action.type)
      .eq("status", "pending")
      .ilike("action_summary", `%${action.summary.slice(0, 30)}%`)
      .maybeSingle();

    if (existing) continue;

    const actionId = await queueAction(
      action.type,
      action.summary,
      action.detail,
      { ...action.data, reasoning: action.reasoning },
      action.priority
    );

    await logDecision(
      "propose",
      action.reasoning,
      `Queued for approval: ${action.summary}`,
      `queued action ${actionId}`,
      0.8
    );

    queued++;
  }

  return queued;
}

async function processAbilityGaps(
  gaps: Array<{
    ability_name: string;
    trigger: string;
    description: string;
    evidence: string;
    complexity: string;
  }>
) {
  for (const gap of gaps) {
    const { data: existing } = await supabase.from("nexus_ability_proposals")
      .select("id").ilike("ability_name", `%${gap.ability_name}%`)
      .in("status", ["proposed", "approved", "building", "live"]).maybeSingle();

    if (existing) continue;

    await supabase.from("nexus_ability_proposals").insert({
      ability_name: gap.ability_name,
      trigger_command: gap.trigger,
      description: gap.description,
      value_reasoning: gap.evidence,
      evidence: gap.evidence,
      implementation_plan: "Auto-detected gap. Needs implementation spec from nexus-builder.",
      estimated_complexity: gap.complexity,
      status: "proposed",
    });

    await auditLog("ability_gap_detected", `Proposed: ${gap.ability_name}`, {
      data: { trigger: gap.trigger, complexity: gap.complexity },
    });
  }
}

// ── REPORT ────────────────────────────────────────────────────────────────────

async function reportCycle(
  cycleNumber: number,
  summary: string,
  actionsExecuted: number,
  actionsQueued: number,
  observations: string[],
  startTime: number,
  chatId: string | null
) {
  const duration = Date.now() - startTime;

  await supabase.from("nexus_agent_cycles").insert({
    cycle_number: cycleNumber,
    signals_observed: observations.length,
    actions_taken: actionsExecuted,
    proposals_queued: actionsQueued,
    duration_ms: duration,
    summary,
  });

  if ((actionsExecuted > 0 || actionsQueued > 0) && chatId) {
    const msg =
      `🤖 *Nexus Agent — Cycle ${cycleNumber}*\n\n` +
      `${summary}\n\n` +
      (actionsExecuted > 0 ? `✅ Auto-executed: ${actionsExecuted} actions\n` : "") +
      (actionsQueued > 0 ? `⏳ Queued for approval: ${actionsQueued} actions\nReply \`pending\` to review.\n` : "") +
      `\n_${new Date().toLocaleTimeString("en-US", { timeZone: "America/Denver" })} MT | ${duration}ms_`;

    await sendTelegram(chatId, msg);
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const startTime = Date.now();

  const { count } = await supabase.from("nexus_agent_cycles")
    .select("*", { count: "exact", head: true });
  const cycleNumber = (count || 0) + 1;

  const chatId = await getTelegramChatId();

  await auditLog("cycle_start", `Starting cycle ${cycleNumber}`, {
    data: { cycle: cycleNumber, timestamp: new Date().toISOString() },
  });

  try {
    const signals = await observe();
    const decisions = await think(signals);

    const actionsExecuted = await executeAutoActions(decisions.auto_actions || []);
    const actionsQueued = await queueApprovalActions(decisions.approval_actions || []);
    await processAbilityGaps(decisions.ability_gaps || []);

    await reportCycle(
      cycleNumber,
      decisions.summary || "Agent cycle complete",
      actionsExecuted,
      actionsQueued,
      decisions.observations || [],
      startTime,
      chatId
    );

    await auditLog("cycle_complete", `Cycle ${cycleNumber} complete`, {
      outcome: "success",
      data: {
        cycle: cycleNumber,
        actions_executed: actionsExecuted,
        actions_queued: actionsQueued,
        duration_ms: Date.now() - startTime,
      },
    });

    return Response.json({
      ok: true,
      cycle: cycleNumber,
      actions_executed: actionsExecuted,
      actions_queued: actionsQueued,
      summary: decisions.summary,
    });
  } catch (err) {
    await auditLog("cycle_error", `Cycle ${cycleNumber} failed: ${String(err)}`, {
      outcome: "failure",
      outcomeDetail: String(err),
    });

    return Response.json({ error: String(err) }, { status: 500 });
  }
});

// NEXUS briefing — proactive morning brief via Telegram
// Scheduled: 13:00 UTC daily (7:00 AM MT)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sendTelegramMessage(chatId: string, text: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  if (!res.ok) console.error("Telegram send failed:", await res.text());
}

async function bubbleInsights(supabase: any, clientSummaries: any[]) {
  const silentClients = clientSummaries.filter(c => c.hoursSilent !== null && c.hoursSilent > 48);
  if (silentClients.length > 0) {
    await supabase.from("platform_insights").insert({
      insight: `${silentClients.length} client(s) have gone silent >48h: ${silentClients.map((c: any) => c.name).join(", ")}`,
      source_client_ids: silentClients.map((c: any) => c.id).filter(Boolean),
      insight_type: "risk",
    });
  }

  const noVA = clientSummaries.filter(c => c.va === "no VA assigned");
  if (noVA.length > 0) {
    await supabase.from("platform_insights").insert({
      insight: `${noVA.length} client(s) have no VA assigned: ${noVA.map((c: any) => c.name).join(", ")}`,
      source_client_ids: [],
      insight_type: "risk",
    });
  }
}

// AUTO-FIX: Added ability recommendation analysis function
async function analyzeAbilityRecommendations(supabase: any, openTasks: any[], clientSummaries: any[], minus7d: string) {
  const recommendations: string[] = [];

  // Check for pending follow-ups (tasks older than 3 days)
  const oldTasks = (openTasks || []).filter((t: any) => {
    const ageMs = Date.now() - new Date(t.created_at).getTime();
    return ageMs > 3 * 24 * 60 * 60 * 1000;
  });
  if (oldTasks.length > 0) {
    recommendations.push(`💡 You have ${oldTasks.length} pending follow-up(s). Try: "follow up: [task]"`);
  }

  // Check for weekly digest availability
  const { data: last7dEntries } = await supabase
    .from("entries")
    .select("id")
    .gt("created_at", minus7d)
    .eq("role", "user")
    .is("client_id", null);
  
  if ((last7dEntries || []).length > 10) {
    recommendations.push(`💡 Weekly digest available for last 7 days (${last7dEntries.length} entries). Try: "weekly digest"`);
  }

  // Check for reminders opportunity (if tasks exist but no reminders set)
  if (openTasks.length > 0) {
    const { data: existingReminders } = await supabase
      .from("entries")
      .select("id")
      .eq("entry_type", "reminder")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    
    if (!existingReminders || existingReminders.length === 0) {
      recommendations.push(`💡 Set reminders for important tasks. Try: "remind me: [task] in [timeframe]"`);
    }
  }

  // Check for knowledge base opportunity
  const { data: recentKnowledge } = await supabase
    .from("knowledge_base")
    .select("id")
    .gte("created_at", minus7d);
  
  if (!recentKnowledge || recentKnowledge.length === 0) {
    recommendations.push(`💡 Capture learnings to knowledge base. Try: "save knowledge: [topic] - [insight]"`);
  }

  // Check for client context opportunities
  const clientsWithoutContext = clientSummaries.filter(c => c.goals === "not set");
  if (clientsWithoutContext.length > 0) {
    recommendations.push(`💡 ${clientsWithoutContext.length} client(s) missing context. Try: "client context: [client name]"`);
  }

  // Check for stale clients needing status updates
  const staleClients = clientSummaries.filter(c => c.hoursSilent !== null && c.hoursSilent > 120);
  if (staleClients.length > 0) {
    recommendations.push(`💡 ${staleClients.length} client(s) silent >5 days. Try: "status update: [client]"`);
  }

  return recommendations;
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ----- 1. Get Zach's Telegram chat ID dynamically -----
    const { data: channelRow } = await supabase
      .from("channel_conversations")
      .select("external_id")
      .eq("channel", "telegram")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!channelRow?.external_id) {
      console.error("No Telegram chat ID found in channel_conversations");
      return new Response("no chat id", { status: 200 });
    }
    const chatId = channelRow.external_id;

    // ----- 2. Pull personal brain context -----
    const minus48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const minus7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = Date.now();

    const [recent48, top7d, openTasks, projects, recentPeople, overdueTasks, staleClients, activeProjects] = await Promise.all([
      supabase.from("entries")
        .select("role, content, entry_type, importance, project_names, people_names, created_at")
        .gt("created_at", minus48h)
        .eq("role", "user")
        .is("client_id", null)
        .order("created_at", { ascending: false })
        .limit(30),

      supabase.from("entries")
        .select("content, entry_type, importance, project_names, people_names, created_at")
        .gt("created_at", minus7d)
        .eq("role", "user")
        .is("client_id", null)
        .order("importance", { ascending: false })
        .limit(10),

      supabase.from("entries")
        .select("content, project_names, people_names, created_at")
        .eq("task_status", "open")
        .eq("role", "user")
        .order("created_at", { ascending: true }),

      supabase.from("projects")
        .select("name, category")
        .neq("category", "archived"),

      supabase.from("entries")
        .select("content, people_names, project_names, created_at")
        .gt("created_at", minus7d)
        .eq("role", "user")
        .not("people_names", "eq", "{}")
        .order("created_at", { ascending: false })
        .limit(15),

      // overdueTasks: open tasks older than 3 days
      supabase.from("entries")
        .select("content, created_at, project_names")
        .eq("task_status", "open")
        .lt("created_at", new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: true })
        .limit(10),

      // staleClients: active clients with no activity in 5+ days
      supabase.from("clients")
        .select("name, status, last_activity_at")
        .eq("status", "active")
        .or(`last_activity_at.lt.${new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString()},last_activity_at.is.null`)
        .limit(10),

      // activeProjects: projects with active momentum
      supabase.from("projects")
        .select("name, category, momentum_status, next_milestone, last_update_at")
        .not("category", "eq", "archived")
        .order("last_update_at", { ascending: true })
        .limit(10),
    ]);

    // ----- 3. Pull client brains status -----
    const { data: activeClients } = await supabase
      .from("clients")
      .select(`
        id, name, deal_type, status, rev_share_pct, monthly_fee,
        client_context(core_offer, goals),
        va_assignments(va_name, status)
      `)
      .eq("status", "active");

    const clientSummaries = await Promise.all((activeClients || []).map(async (client: any) => {
      const { data: recentActivity } = await supabase
        .from("entries")
        .select("content, entry_type, created_at, role")
        .eq("client_id", client.id)
        .gt("created_at", minus48h)
        .order("created_at", { ascending: false })
        .limit(5);

      const activeVA = (client.va_assignments || []).find((v: any) => v.status === "active");
      const lastActivity = recentActivity?.[0]?.created_at;
      const hoursSilent = lastActivity
        ? Math.floor((now - new Date(lastActivity).getTime()) / (1000 * 60 * 60))
        : null;

      return {
        id: client.id,
        name: client.name,
        deal: client.deal_type || "unknown",
        va: activeVA?.va_name || "no VA assigned",
        recentActivity: recentActivity || [],
        hoursSilent,
        goals: client.client_context?.[0]?.goals || "not set",
      };
    }));

    // AUTO-FIX: Generate ability recommendations based on usage patterns
    const abilityRecommendations = await analyzeAbilityRecommendations(
      supabase,
      openTasks.data || [],
      clientSummaries,
      minus7d
    );

    // ----- 4. Pull Nexus health + improvements + knowledge base -----
    const { data: recentKnowledge } = await supabase
      .from("knowledge_base")
      .select("topic, content")
      .order("created_at", { ascending: false })
      .limit(5);

    const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Denver" });

    const [healthData, pendingImprovements] = await Promise.all([
      supabase.from("nexus_health")
        .select("function_name, status, error_count, success_count")
        .order("checked_at", { ascending: false })
        .limit(4),

      supabase.from("nexus_improvements")
        .select("title, problem, recommended_fix, estimated_minutes, priority")
        .eq("status", "pending")
        .order("priority", { ascending: true })
        .limit(3),
    ]);

    const healthSummary = (healthData.data || []).length
      ? "NEXUS HEALTH:\n" + (healthData.data || []).map((h: any) =>
          `- ${h.function_name}: ${h.status} (${h.success_count} ok, ${h.error_count} errors)`
        ).join("\n")
      : "";

    const improvementsSummary = (pendingImprovements.data || []).length
      ? "PENDING IMPROVEMENTS:\n" + (pendingImprovements.data || []).map((imp: any, i: number) =>
          `${i + 1}. [${imp.estimated_minutes}min] ${imp.title}: ${imp.problem}`
        ).join("\n")
      : "";

    // ----- 5. Build context blocks -----
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      timeZone: "America/Denver",
    });

    const fmt = (entries: any[], label: string) => {
      if (!entries?.length) return "";
      return `${label}:\n` + entries.map(e =>
        `- [${e.entry_type || "note"}, importance ${e.importance || "?"}] ${e.content?.slice(0, 200)}`
      ).join("\n");
    };

    const openTasksFormatted = (openTasks.data || []).length
      ? "OPEN TASKS (oldest first):\n" + (openTasks.data || []).map((t: any) => {
          const ageMs = now - new Date(t.created_at).getTime();
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          const ageLabel = ageDays === 0 ? "today" : ageDays === 1 ? "1 day old" : `${ageDays} days old`;
          const overdue = ageMs > 48 * 60 * 60 * 1000 ? " ⚠️ overdue" : "";
          return `- ${t.content?.slice(0, 200)} (${ageLabel}${overdue})`;
        }).join("\n")
      : "OPEN TASKS: none";

    const clientBriefContext = clientSummaries.length
      ? "CLIENT BRAINS STATUS:\n" + clientSummaries.map(c =>
          `- ${c.name} (${c.deal}) | VA: ${c.va} | ${c.hoursSilent !== null ? `silent ${c.hoursSilent}h` : "no activity yet"} | goals: ${c.goals}`
        ).join("\n")
      : "";

    const knowledgeContext = (recentKnowledge || []).length
      ? "KNOWLEDGE BASE (recent):\n" + (recentKnowledge || []).map((k: any) =>
          `• ${k.topic}: ${k.content.slice(0, 150)}`
        ).join("\n")
      : "";

    // Monday only: pull last week's self-improvement summary
    const isMonday = new Date().getDay() === 1;
    let weeklySummary = "";
    if (isMonday) {
      const { data: lastReport } = await supabase
        .from("weekly_reports")
        .select("fixes_attempted, fixes_successful, report_content")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastReport) {
        weeklySummary = `LAST WEEK SELF-IMPROVEMENT:\n• Fixes attempted: ${lastReport.fixes_attempted}\n• Fixes verified working: ${lastReport.fixes_successful}`;
      }
    }

    // AUTO-FIX: Add ability recommendations to context
    const abilityRecommendationsContext = abilityRecommendations.length
      ? "ABILITY RECOMMENDATIONS:\n" + abilityRecommendations.join("\n")
      : "";

    const contextBlock = [
      fmt(recent48.data || [], "LAST 48 HOURS (personal brain)"),
      fmt(top7d.data || [], "TOP ENTRIES THIS WEEK (by importance)"),
      openTasksFormatted,
      (projects.data || []).length
        ? "ACTIVE PROJECTS:\n" + (projects.data || []).map((p: any) => `- ${p.name} (${p.category})`).join("\n")
        : "",
      fmt(recentPeople.data || [], "RECENT PEOPLE MENTIONS"),
      clientBriefContext,
      healthSummary,
      improvementsSummary,
      knowledgeContext,
      weeklySummary,
      abilityRecommendationsContext,
    ].filter(Boolean).join("\n\n");

    // ----- 6. Generate briefing via Claude (with fallback) -----
    let briefing: string;
    try {
    const prompt = `You are Nexus, Zach's personal Chief of Staff. Generate his morning briefing for ${today}.

DATA:
Open tasks (${(openTasks.data || []).length}): ${JSON.stringify((openTasks.data || []).slice(0, 20))}
Overdue tasks: ${JSON.stringify(overdueTasks.data || [])}
Clients: ${JSON.stringify(clientSummaries)}
Recent entries (last 48hrs): ${JSON.stringify((recent48.data || []).slice(0, 15))}
Pending improvements: ${JSON.stringify((pendingImprovements.data || []).slice(0, 5))}
Active projects: ${JSON.stringify(activeProjects.data || [])}
Stale clients (no activity 5+ days): ${JSON.stringify(staleClients.data || [])}
Ability recommendations: ${JSON.stringify(abilityRecommendations)}
${weeklySummary ? `Last week: ${weeklySummary}` : ""}

Generate a briefing in this EXACT format:

🌅 *Good morning, Zach. Here's your ${dayOfWeek} briefing.*

*🎯 Focus today:*
[3 specific things he should accomplish today, ranked by importance. Be direct. No fluff.]

*⚠️ Needs attention:*
[List only real problems: overdue tasks, stale clients, blocked projects, pending approvals. Skip if nothing urgent.]

*📋 Open tasks (${(openTasks.data || []).length}):*
[Top 5 most important open tasks with context]

*🏢 Client pulse:*
[One line per active client: name, status, last activity, what's needed]

*🧠 System:*
[Pending auto-fix approvals, function health issues, improvements queued]

${abilityRecommendations.length > 0 ? '*💡 Underutilized abilities:*\n[Include the ability recommendations provided, formatted naturally]\n\n' : ''}*💡 Zach, one thing:*
[One strategic observation or nudge based on patterns you see. This is where you act like a real COO — notice what he's avoiding, what's slipping, what opportunity he should grab.]

Be direct. Be specific. No generic advice. Talk like a trusted advisor, not an assistant. Keep under 700 words.`;

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
    briefing = data?.content?.[0]?.text;

    if (!briefing) {
      console.error("No briefing generated:", JSON.stringify(data));
      return new Response("no briefing", { status: 200 });
    }
    } catch (err: any) {
      console.error("Briefing generation failed:", err);
      briefing =
        `🧠 NEXUS BRIEF — ${today}\n\n` +
        `⚠️ Full brief generation encountered an error: ${err.message}\n\n` +
        `Open tasks: ${(openTasks.data || []).length} pending\n` +
        `Active clients: check app.nexuszc.com\n\n` +
        `Send "nexus status" for system health.`;
      await supabase.from("nexus_alerts").insert({
        alert_type: "briefing_failed",
        message: err.message,
      }).catch(() => {});
    }

    // ----- 7. Truncate and send to Telegram -----
    const LIMIT = 4000;
    const tgMessage = briefing.length > LIMIT
      ? briefing.slice(0, LIMIT) + "... (truncated)"
      : briefing;
    await sendTelegramMessage(chatId, tgMessage);
    console.log("Morning briefing sent to chat", chatId);

    // ----- 8. Bubble platform insights -----
    await bubbleInsights(supabase, clientSummaries);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Briefing error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

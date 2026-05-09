// NEXUS health-monitor v2 — smarter error detection, known pattern matching
// Runs hourly via pg_cron

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FUNCTIONS = ["chat", "briefing", "reminders", "provision", "health-monitor", "auto-fix", "generate-va-tasks", "roofing-ai", "contractor-auth"];

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Get Telegram chat ID
  const { data: channelRow } = await supabase
    .from("channel_conversations")
    .select("external_id")
    .eq("channel", "telegram")
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  const telegramChatId = channelRow?.external_id;

  // 1. Check health of all functions
  const healthResults = await Promise.all(FUNCTIONS.map(fn => checkFunctionHealth(supabase, fn)));

  // 2. Store health snapshots
  await Promise.all(healthResults.map(h =>
    supabase.from("nexus_health").insert({
      function_name: h.name,
      error_count: h.errors,
      success_count: h.successes,
      avg_response_ms: h.avgMs,
      last_error: h.lastError,
      status: h.errors > 3 ? "degraded" : h.errors > 0 ? "warning" : "healthy",
    })
  ));

  // 3. Check known failure patterns against recent errors
  const { data: patterns } = await supabase.from("known_failure_patterns").select("*");

  const detectedPatterns: string[] = [];
  for (const h of healthResults) {
    if (h.lastError) {
      for (const pattern of (patterns || [])) {
        if (h.lastError.toLowerCase().includes(pattern.error_signature.toLowerCase())) {
          detectedPatterns.push(`${h.name}: ${pattern.pattern_name} — ${pattern.auto_fix_strategy}`);
          await supabase.from("known_failure_patterns")
            .update({ times_seen: pattern.times_seen + 1, last_seen: new Date().toISOString() })
            .eq("id", pattern.id);
        }
      }
    }
  }

  // 4. Send instant alerts for degraded functions
  const degraded = healthResults.filter(h => h.errors > 3);
  for (const h of degraded) {
    const { data: existingAlert } = await supabase
      .from("nexus_alerts")
      .select("id")
      .eq("alert_type", `degraded_${h.name}`)
      .eq("resolved", false)
      .gt("sent_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .maybeSingle();

    if (!existingAlert && telegramChatId) {
      const severity = h.errors > 10 ? "🔴 CRITICAL" : "🟡 WARNING";
      await sendTelegram(telegramChatId,
        `${severity}: ${h.name} function degraded\nErrors: ${h.errors} | Successes: ${h.successes}\n${h.lastError ? `Last error: ${h.lastError.slice(0, 200)}` : ""}\n\nInvestigating and attempting auto-fix...`
      );
      await supabase.from("nexus_alerts").insert({
        alert_type: `degraded_${h.name}`,
        message: `${h.name}: ${h.errors} errors in last hour. Last error: ${h.lastError?.slice(0, 200)}`,
      });
    }
  }

  // 5. COO daily checks — stale clients, project momentum, health scores
  // These have internal deduplication — safe to fire every health-monitor run
  const cooBase = `${SUPABASE_URL}/functions/v1/nexus-coo`;
  const cooHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
  fetch(cooBase, { method: "POST", headers: cooHeaders, body: JSON.stringify({ action: "stale_check" }) }).catch(() => {});
  fetch(cooBase, { method: "POST", headers: cooHeaders, body: JSON.stringify({ action: "momentum_check" }) }).catch(() => {});
  fetch(cooBase, { method: "POST", headers: cooHeaders, body: JSON.stringify({ action: "health_score" }) }).catch(() => {});

  // 6. Deal intelligence — alert on clients silent 48+ hours
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data: activeClients } = await supabase.from("clients").select("id, name").eq("status", "active");

  for (const client of (activeClients || [])) {
    const { data: recentActivity } = await supabase
      .from("entries").select("id")
      .eq("client_id", client.id).gt("created_at", twoDaysAgo).limit(1);

    if (!recentActivity?.length) {
      const { data: existingAlert } = await supabase
        .from("nexus_alerts").select("id")
        .eq("alert_type", `deal_cold_${client.id}`).eq("resolved", false)
        .gt("sent_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();

      if (!existingAlert && telegramChatId) {
        await sendTelegram(telegramChatId,
          `🌡️ DEAL GOING COLD\n\n${client.name} has had no activity in 48+ hours.\n\nSend "report: ${client.name}" to see full status.`
        );
        await supabase.from("nexus_alerts").insert({
          alert_type: `deal_cold_${client.id}`,
          message: `${client.name} has gone cold — no activity in 48h`,
        });
      }
    }
  }

  // 7. Verify recent fixes actually worked
  await verifyRecentFixes(supabase, healthResults, telegramChatId);

  // 8. Identify new improvements via Claude
  const usagePatterns = await analyzeUsage(supabase);
  const improvements = await identifyImprovements(healthResults, usagePatterns, detectedPatterns, patterns || []);

  for (const improvement of improvements) {
    const { data: existing } = await supabase
      .from("nexus_improvements")
      .select("id")
      .ilike("title", `%${improvement.title}%`)
      .in("status", ["pending", "in_dev"])
      .maybeSingle();

    if (!existing) {
      await supabase.from("nexus_improvements").insert(improvement);
    }
  }

  // 9. Trigger auto-fix for top pending improvement (max 1/hour, skip if one is in_dev)
  const { data: inDev } = await supabase
    .from("nexus_improvements").select("id").eq("status", "in_dev").maybeSingle();

  if (!inDev) {
    const { data: topFix } = await supabase
      .from("nexus_improvements").select("*")
      .eq("status", "pending").eq("auto_fix_attempted", false)
      .order("priority", { ascending: true }).limit(1).maybeSingle();

    const { data: recentFix } = await supabase
      .from("nexus_improvements").select("id")
      .eq("auto_fix_attempted", true)
      .gt("auto_fix_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .maybeSingle();

    if (topFix && !recentFix && telegramChatId) {
      await sendTelegram(telegramChatId,
        `🔧 Working on: "${topFix.title}"\nPriority: ${topFix.priority} | Est: ${topFix.estimated_minutes}min\n\nFix coming shortly...`
      );

      fetch(`${SUPABASE_URL}/functions/v1/auto-fix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          improvement_id: topFix.id,
          telegram_chat_id: telegramChatId,
          known_patterns: detectedPatterns,
        }),
      });
    }
  }

  // 10. Generate weekly report on Sundays at 13:00 UTC
  const now = new Date();
  if (now.getDay() === 0 && now.getHours() === 13) {
    await generateWeeklyReport(supabase, telegramChatId);
  }

  return new Response(JSON.stringify({
    ok: true,
    health: healthResults.map(h => ({ name: h.name, status: h.errors > 3 ? "degraded" : "healthy", errors: h.errors })),
    patterns_detected: detectedPatterns.length,
    improvements_added: improvements.length,
  }), { headers: { "Content-Type": "application/json" } });
});

// ================================================================
// HEALTH CHECK
// ================================================================
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

  // Pull last error from alerts
  const { data: lastAlert } = await supabase
    .from("nexus_alerts")
    .select("message")
    .ilike("alert_type", `%${fnName}%`)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { name: fnName, errors, successes, avgMs, lastError: lastAlert?.message || null };
}

// ================================================================
// VERIFY RECENT FIXES ACTUALLY WORKED
// ================================================================
async function verifyRecentFixes(supabase: any, healthResults: any[], telegramChatId: string | null) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: recentlyFixed } = await supabase
    .from("nexus_improvements")
    .select("*")
    .eq("status", "live")
    .eq("fix_verified", false)
    .gt("live_at", oneDayAgo);

  for (const fix of (recentlyFixed || [])) {
    const relatedHealth = healthResults.find((h: any) => h.name === fix.affected_function);

    if (relatedHealth) {
      const isWorking = relatedHealth.errors === 0 || relatedHealth.successes > relatedHealth.errors;

      await supabase.from("nexus_improvements").update({
        fix_verified: true,
        fix_verified_at: new Date().toISOString(),
        post_fix_error_count: relatedHealth.errors,
      }).eq("id", fix.id);

      if (relatedHealth.errors > 5 && telegramChatId) {
        await sendTelegram(telegramChatId,
          `⚠️ FIX REGRESSION DETECTED\n\n"${fix.title}" was approved but ${fix.affected_function} now shows ${relatedHealth.errors} errors.\n\nSend "reject" to rollback, or "nexus status" to investigate.`
        );
      } else if (isWorking && telegramChatId) {
        await sendTelegram(telegramChatId,
          `✅ FIX VERIFIED\n\n"${fix.title}" is working correctly in production.\n${fix.affected_function}: ${relatedHealth.successes} successes, ${relatedHealth.errors} errors.`
        );
      }
    }
  }
}

// ================================================================
// USAGE ANALYSIS
// ================================================================
async function analyzeUsage(supabase: any) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: usage } = await supabase
    .from("nexus_usage")
    .select("ability, success, response_ms")
    .gt("logged_at", sevenDaysAgo);

  const counts: Record<string, { total: number; failures: number; avgMs: number }> = {};
  for (const u of (usage || [])) {
    if (!counts[u.ability]) counts[u.ability] = { total: 0, failures: 0, avgMs: 0 };
    counts[u.ability].total++;
    if (!u.success) counts[u.ability].failures++;
    counts[u.ability].avgMs = ((counts[u.ability].avgMs * (counts[u.ability].total - 1)) + (u.response_ms || 0)) / counts[u.ability].total;
  }

  const allAbilities = [
    "search", "research", "summarize", "draft email", "send email",
    "generate proposal", "generate script", "generate report", "remind me",
    "provision", "report", "competitors", "client snapshot", "prioritize tasks",
    "generate invoice", "generate contract", "follow up", "weekly digest",
    "generate sop", "generate pitch", "generate case study", "calculate roi",
    "save knowledge", "recall knowledge", "learn from", "brain dump", "nexus audit",
    "status update", "sprint plan", "task estimate",
  ];
  const unused = allAbilities.filter(a => !counts[a] || counts[a].total === 0);
  const slow = Object.entries(counts).filter(([_, v]) => v.avgMs > 10000).map(([k]) => k);
  const failing = Object.entries(counts).filter(([_, v]) => v.failures / v.total > 0.3).map(([k]) => k);

  return { counts, unused, slow, failing };
}

// ================================================================
// IDENTIFY IMPROVEMENTS
// ================================================================
async function identifyImprovements(
  health: any[], usage: any, detectedPatterns: string[], knownPatterns: any[]
): Promise<any[]> {
  const healthSummary = health
    .filter(h => h.errors > 0 || h.successes > 0)
    .map(h => `${h.name}: ${h.successes} ok, ${h.errors} errors, avg ${h.avgMs}ms`)
    .join("\n") || "All functions healthy with no recent activity";

  const usageSummary = Object.entries(usage.counts)
    .map(([k, v]: any) => `${k}: ${v.total} uses, ${v.failures} failures, avg ${Math.round(v.avgMs)}ms`)
    .join("\n") || "No usage data";

  const prompt = `You are analyzing the Nexus AI operating system to identify the top 3 improvements.

FUNCTION HEALTH:
${healthSummary}

ABILITY USAGE (last 7 days):
${usageSummary}

UNUSED ABILITIES: ${usage.unused.join(", ") || "none"}
SLOW ABILITIES (>10s): ${usage.slow.join(", ") || "none"}
FAILING ABILITIES (>30% failure): ${usage.failing.join(", ") || "none"}

DETECTED ERROR PATTERNS:
${detectedPatterns.join("\n") || "none"}

KNOWN FIXABLE PATTERNS:
${knownPatterns.map((p: any) => `${p.pattern_name}: seen ${p.times_seen}x, fixed ${p.times_fixed}x`).join("\n")}

Identify the top 3 most impactful improvements. Focus on:
1. Any detected error patterns that match known fixes
2. Slow or failing abilities
3. Missing functionality that would add real value

Return ONLY a JSON array:
[
  {
    "title": "Short specific title",
    "problem": "Exact problem description with evidence from data above",
    "recommended_fix": "Specific code-level fix — be precise about what to change",
    "affected_function": "exact function name from: chat, briefing, reminders, provision, health-monitor, auto-fix, generate-va-tasks",
    "priority": 1,
    "estimated_minutes": 20,
    "fix_confidence": 85
  }
]

Return only the JSON array. No markdown.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  const text = data?.content?.[0]?.text || "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  try {
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch { return []; }
}

// ================================================================
// WEEKLY REPORT
// ================================================================
async function generateWeeklyReport(supabase: any, telegramChatId: string | null) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: fixes }, { data: usage }, { data: alerts }] = await Promise.all([
    supabase.from("nexus_improvements").select("title, status, fix_verified, fix_confidence").gt("identified_at", sevenDaysAgo),
    supabase.from("nexus_usage").select("ability, success").gt("logged_at", sevenDaysAgo),
    supabase.from("nexus_alerts").select("alert_type, message").gt("sent_at", sevenDaysAgo),
  ]);

  const attempted = (fixes || []).filter((f: any) => f.auto_fix_attempted).length;
  const successful = (fixes || []).filter((f: any) => f.fix_verified).length;
  const rejected = (fixes || []).filter((f: any) => f.status === "rejected").length;

  const abilityCounts = (usage || []).reduce((acc: any, u: any) => {
    acc[u.ability] = (acc[u.ability] || 0) + 1;
    return acc;
  }, {});

  const topAbilities = Object.entries(abilityCounts)
    .sort(([, a]: any, [, b]: any) => b - a)
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${v}x`);

  const report = `🧠 NEXUS WEEKLY SELF-REPORT\nWeek ending ${new Date().toLocaleDateString()}\n\n` +
    `SELF-IMPROVEMENT:\n• Fixes attempted: ${attempted}\n• Fixes verified working: ${successful}\n• Fixes rejected: ${rejected}\n\n` +
    `TOP ABILITIES USED:\n${topAbilities.map(a => `• ${a}`).join("\n") || "• No usage data"}\n\n` +
    `ALERTS THIS WEEK: ${(alerts || []).length}\n\n` +
    `HEALTH SCORE: ${attempted > 0 ? Math.round((successful / attempted) * 100) : 100}/100\n\n` +
    `Nexus ran ${(usage || []).length} ability executions this week and self-improved ${successful} times.`;

  await supabase.from("weekly_reports").insert({
    week_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    report_content: report,
    fixes_attempted: attempted,
    fixes_successful: successful,
    fixes_rejected: rejected,
    abilities_used: abilityCounts,
  });

  if (telegramChatId) await sendTelegram(telegramChatId, report);
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const truncated = text.length > 4000 ? text.slice(0, 3900) + "..." : text;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: truncated }),
  });
}

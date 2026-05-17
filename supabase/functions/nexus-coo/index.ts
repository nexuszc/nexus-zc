import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
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

async function claudeComplete(prompt: string, maxTokens = 1000): Promise<string> {
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
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

Deno.serve(async (req) => {
  const { action, entry_id, content } = await req.json();

  // ── FOCUS ────────────────────────────────────────────────────
  if (action === "focus") {
    const [{ data: tasks }, { data: clients }, { data: projects }, { data: recent }] = await Promise.all([
      supabase.from("entries").select("content, created_at, project_names, importance")
        .eq("task_status", "open").order("importance", { ascending: false }).limit(20),
      supabase.from("clients").select("name, status, health_score, last_activity_at").eq("status", "active"),
      supabase.from("projects").select("name, momentum_status, next_milestone, last_update_at")
        .not("category", "eq", "archived").limit(10),
      supabase.from("entries").select("content, created_at").order("created_at", { ascending: false }).limit(10),
    ]);

    const response = await claudeComplete(
      `You are Nexus, Zach's Chief of Staff. He's asking what to focus on RIGHT NOW.

Open tasks: ${JSON.stringify(tasks)}
Active clients: ${JSON.stringify(clients)}
Projects: ${JSON.stringify(projects)}
Recent activity: ${JSON.stringify(recent)}
Current time: ${new Date().toLocaleString("en-US", { timeZone: "America/Denver" })}

Give him his TOP 3 priorities for right now. Format:

*🎯 Focus right now:*

*1. [Most important thing]*
Why: [specific reason — not generic]
Time needed: [estimate]

*2. [Second most important]*
Why: [specific reason]
Time needed: [estimate]

*3. [Third]*
Why: [specific reason]
Time needed: [estimate]

*Skip everything else until these are done.*

Be ruthlessly specific. Name names. Reference actual tasks. No fluff.`,
      800
    );

    await supabase.from("focus_sessions").insert({
      top_priorities: response,
      context_snapshot: JSON.stringify({ tasks: tasks?.length, clients: clients?.length }),
    });

    return Response.json({ response });
  }

  // ── STALE CHECK ──────────────────────────────────────────────
  if (action === "stale_check") {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleClients } = await supabase
      .from("clients")
      .select("id, name, status, last_activity_at")
      .eq("status", "active")
      .or(`last_activity_at.lt.${fiveDaysAgo},last_activity_at.is.null`);

    if (!staleClients || staleClients.length === 0) {
      return Response.json({ ok: true, stale_count: 0 });
    }

    const { data: recentAlerts } = await supabase
      .from("stale_alerts")
      .select("client_id")
      .gt("alerted_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const recentAlertIds = new Set(recentAlerts?.map((a: any) => a.client_id) || []);
    const newStale = staleClients.filter((c: any) => !recentAlertIds.has(c.id));

    if (newStale.length === 0) return Response.json({ ok: true, stale_count: 0 });

    for (const client of newStale) {
      const daysInactive = client.last_activity_at
        ? Math.floor((Date.now() - new Date(client.last_activity_at).getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      await supabase.from("stale_alerts").insert({ client_id: client.id, days_inactive: daysInactive });
    }

    // MOVED_TO_DASHBOARD [date: 2026-05-17]: stale client alerts visible in Home action queue (stale_alerts table)
    // const chatId = await getTelegramChatId();
    // if (chatId) { await sendTelegram(chatId, msg); }

    return Response.json({ ok: true, stale_count: newStale.length });
  }

  // ── MOMENTUM CHECK ───────────────────────────────────────────
  if (action === "momentum_check") {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleProjects } = await supabase
      .from("projects")
      .select("id, name, category, last_update_at, next_milestone")
      .eq("momentum_status", "active")
      .lt("last_update_at", sevenDaysAgo);

    if (!staleProjects || staleProjects.length === 0) {
      return Response.json({ ok: true, stale_projects: 0 });
    }

    for (const project of staleProjects) {
      await supabase.from("projects").update({ momentum_status: "stale" }).eq("id", project.id);
    }

    // MOVED_TO_DASHBOARD [date: 2026-05-17]: stale projects visible in Brain tab (projects.momentum_status='stale')
    // const chatId = await getTelegramChatId();
    // if (chatId) { await sendTelegram(chatId, msg); }

    return Response.json({ ok: true, stale_projects: staleProjects.length });
  }

  // ── HEALTH SCORE ─────────────────────────────────────────────
  if (action === "health_score") {
    const { data: clients } = await supabase.from("clients").select("id, name, status").eq("status", "active");

    if (!clients || clients.length === 0) return Response.json({ ok: true, clients_scored: 0 });

    for (const client of clients) {
      const [{ data: recentEntries }, { data: callLogs }, { data: openTasks }] = await Promise.all([
        supabase.from("entries").select("id").eq("client_id", client.id)
          .gt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from("call_logs").select("id, outcome").eq("client_id", client.id)
          .gt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from("entries").select("id").eq("client_id", client.id).eq("task_status", "open"),
      ]);

      let score = 50;
      score += Math.min((recentEntries?.length || 0) * 5, 20);
      score += Math.min((callLogs?.length || 0) * 10, 20);
      const successfulCalls = (callLogs || []).filter((c: any) => c.outcome === "success").length;
      score += Math.min(successfulCalls * 5, 10);
      score -= Math.min((openTasks?.length || 0) * 3, 20);
      score = Math.max(0, Math.min(100, score));

      await supabase.from("clients").update({
        health_score: score,
        health_updated_at: new Date().toISOString(),
      }).eq("id", client.id);
    }

    return Response.json({ ok: true, clients_scored: clients.length });
  }

  // ── CONTRADICTION CHECK ──────────────────────────────────────
  if (action === "contradiction_check" && entry_id && content) {
    const keywords = content.split(" ").filter((w: string) => w.length > 4).slice(0, 5);
    if (keywords.length === 0) return Response.json({ contradiction: false });

    const { data: relatedEntries } = await supabase
      .from("entries")
      .select("id, content, created_at")
      .neq("id", entry_id)
      .or(keywords.map((k: string) => `content.ilike.%${k}%`).join(","))
      .order("created_at", { ascending: false })
      .limit(10);

    if (!relatedEntries || relatedEntries.length === 0) {
      return Response.json({ contradiction: false });
    }

    const checkPrompt = `You are checking if a new statement contradicts existing information.

New statement: "${content}"

Existing statements:
${relatedEntries.map((e: any, i: number) => `${i + 1}. [${new Date(e.created_at).toLocaleDateString()}] "${e.content}"`).join("\n")}

Does the new statement DIRECTLY contradict any existing statement about the same specific fact, person, or decision?
Only flag clear factual contradictions (e.g., "Kevin is a warm lead" vs "Kevin went cold"), not just different contexts.

Respond with JSON only:
{"contradiction": true/false, "existing_entry_id": "uuid or null", "topic": "what the contradiction is about", "existing_claim": "what was said before", "new_claim": "what is being said now"}`;

    const result = await claudeComplete(checkPrompt, 300);

    try {
      const parsed = JSON.parse(result.replace(/```json|```/g, "").trim());
      if (parsed.contradiction && parsed.existing_entry_id) {
        await supabase.from("contradiction_log").insert({
          entry_id_new: entry_id,
          entry_id_existing: parsed.existing_entry_id,
          topic: parsed.topic,
          new_claim: parsed.new_claim,
          existing_claim: parsed.existing_claim,
        });

        const chatId = await getTelegramChatId();
        if (chatId) {
          await sendTelegram(
            chatId,
            `🔄 *Contradiction detected*\n\n*Topic:* ${parsed.topic}\n*Before:* "${parsed.existing_claim}"\n*Now:* "${parsed.new_claim}"\n\nWhich is current? Reply to clarify.`
          );
        }

        return Response.json({ contradiction: true, topic: parsed.topic });
      }
    } catch {
      // Not a contradiction or parse failed — fine
    }

    return Response.json({ contradiction: false });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
});

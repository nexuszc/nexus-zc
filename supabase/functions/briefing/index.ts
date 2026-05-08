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
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    },
  );
  if (!res.ok) {
    console.error("Telegram send failed:", await res.text());
  }
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

    // ----- 2. Pull memory context -----
    const now = new Date().toISOString();
    const minus48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const minus7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [recent48, top7d, openTasks, projects, recentPeople] = await Promise.all([
      // Last 48 hours of entries
      supabase.from("entries")
        .select("role, content, entry_type, importance, project_names, people_names, created_at")
        .gt("created_at", minus48h)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(30),

      // Top 10 by importance from last 7 days
      supabase.from("entries")
        .select("content, entry_type, importance, project_names, people_names, created_at")
        .gt("created_at", minus7d)
        .eq("role", "user")
        .order("importance", { ascending: false })
        .limit(10),

      // Open tasks from last 7 days
      supabase.from("entries")
        .select("content, project_names, people_names, created_at")
        .eq("entry_type", "task")
        .gt("created_at", minus7d)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(10),

      // Active projects
      supabase.from("projects")
        .select("name, category")
        .neq("category", "archived"),

      // Entries mentioning people from last 7 days
      supabase.from("entries")
        .select("content, people_names, project_names, created_at")
        .gt("created_at", minus7d)
        .eq("role", "user")
        .not("people_names", "eq", "{}")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    // ----- 3. Build context block -----
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

    const contextBlock = [
      fmt(recent48.data || [], "LAST 48 HOURS"),
      fmt(top7d.data || [], "TOP ENTRIES THIS WEEK (by importance)"),
      fmt(openTasks.data || [], "OPEN TASKS"),
      (projects.data || []).length
        ? "ACTIVE PROJECTS:\n" + (projects.data || []).map(p => `- ${p.name} (${p.category})`).join("\n")
        : "",
      fmt(recentPeople.data || [], "RECENT PEOPLE MENTIONS"),
    ].filter(Boolean).join("\n\n");

    // ----- 4. Generate briefing via Claude -----
    const prompt = `You are Nexus, Zach's personal Chief of Staff. Generate his morning briefing based on the memory context below.

FORMAT:
🧠 NEXUS BRIEF — ${today}

🎯 FOCUS TODAY
[1-2 sentences on what deserves the most attention today based on recent entries and open deals]

🔄 OPEN LOOPS
[Bullet list of things mentioned but unresolved — max 4 items]

👥 DEAL STATUS
[Brief status on active people/deals — flag anything gone silent 48+ hrs]

⚡ FIRST MOVE
[One direct recommendation — what to do in the first 30 minutes of the day]

Be direct. Be specific. Reference actual entries by name. No generic advice. Keep total response under 400 words.

MEMORY CONTEXT:
${contextBlock || "(no recent entries found)"}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const briefing = data?.content?.[0]?.text;

    if (!briefing) {
      console.error("No briefing generated:", JSON.stringify(data));
      return new Response("no briefing", { status: 200 });
    }

    // ----- 5. Send to Telegram -----
    await sendTelegramMessage(chatId, briefing);
    console.log("Morning briefing sent to chat", chatId);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Briefing error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

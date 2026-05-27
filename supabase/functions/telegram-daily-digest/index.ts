import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function sendTelegramDirect(msg: string) {
  const token  = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg.slice(0, 4096), parse_mode: "Markdown" }),
  }).catch(() => {});
}

// Category → emoji + label mapping
const CATEGORY_META: Record<string, { emoji: string; label: string }> = {
  seo:           { emoji: "🔍", label: "SEO" },
  youtube:       { emoji: "🎬", label: "YouTube" },
  email:         { emoji: "📧", label: "Email" },
  health:        { emoji: "⚙️",  label: "System" },
  error:         { emoji: "⚠️",  label: "Errors" },
  contractor:    { emoji: "🏠", label: "Contractors" },
  content:       { emoji: "📋", label: "Content" },
  aria:          { emoji: "📞", label: "Aria" },
  lead:          { emoji: "🎯", label: "Leads" },
  nexus:         { emoji: "🧠", label: "Nexus" },
  general:       { emoji: "📌", label: "Other" },
};

function formatCategory(
  category: string,
  messages: string[],
  count: number,
): string {
  const meta = CATEGORY_META[category] ?? { emoji: "📌", label: category };

  // Build condensed summary — show first 2 items in full, rest as count
  const lines = [`${meta.emoji} *${meta.label}* (${count})`];

  const preview = messages.slice(0, 3);
  for (const m of preview) {
    // Strip markdown bold/italic for compact display, keep to 120 chars
    const clean = m.replace(/[*_`]/g, "").slice(0, 120);
    lines.push(`  • ${clean}`);
  }
  if (count > 3) {
    lines.push(`  _…and ${count - 3} more_`);
  }
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "telegram-daily-digest ready" }, { headers: CORS });

  // Pull all unsent messages from the last 24 hours, grouped by category
  const { data: rows, error } = await supabase
    .from("telegram_digest_queue")
    .select("id, message, category, created_at")
    .eq("sent", false)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: CORS });
  }

  if (!rows || rows.length === 0) {
    // Nothing to digest — send a brief "all quiet" only if scheduled run
    if (body.scheduled) {
      await sendTelegramDirect(`📊 *Daily Digest — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}*\n\n✅ All quiet — no queued notifications today.`);
    }
    return Response.json({ ok: true, sent: 0 }, { headers: CORS });
  }

  // Group by category
  const groups: Record<string, string[]> = {};
  const ids: string[] = [];

  for (const row of rows) {
    const cat = row.category ?? "general";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(row.message);
    ids.push(row.id);
  }

  // Sort categories by count descending
  const sortedCategories = Object.entries(groups).sort(([, a], [, b]) => b.length - a.length);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });

  const lines = [
    `📊 *Daily Digest — ${today}*`,
    `_${rows.length} notifications since yesterday_`,
    "",
  ];

  for (const [cat, msgs] of sortedCategories) {
    lines.push(formatCategory(cat, msgs, msgs.length));
    lines.push("");
  }

  lines.push("_Reply to this message for details on any item._");

  await sendTelegramDirect(lines.join("\n"));

  // Mark all as sent
  await supabase
    .from("telegram_digest_queue")
    .update({ sent: true })
    .in("id", ids);

  return Response.json({ ok: true, sent: rows.length, categories: Object.keys(groups) }, { headers: CORS });
});

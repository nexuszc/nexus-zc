import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function claude(prompt: string, maxTokens = 800): Promise<string> {
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

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true });

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: calls } = await supabase
    .from("voice_calls")
    .select("*")
    .gt("created_at", oneWeekAgo);

  if (!calls?.length) {
    return Response.json({ ok: true, message: "No calls to analyze this week" });
  }

  const answered = calls.filter((c: any) => c.answered);
  const converted = calls.filter((c: any) =>
    ["booked", "paid", "interested"].includes(c.outcome || "")
  );
  const revenue = calls.reduce((sum: number, c: any) => sum + (c.revenue_generated || 0), 0);

  // Opener performance
  const openerStats: Record<string, { used: number; converted: number }> = {};
  for (const call of calls) {
    if (!call.opener_used) continue;
    if (!openerStats[call.opener_used]) openerStats[call.opener_used] = { used: 0, converted: 0 };
    openerStats[call.opener_used].used++;
    if (["booked", "paid", "interested"].includes(call.outcome || "")) {
      openerStats[call.opener_used].converted++;
    }
  }

  let bestOpener = { name: "", rate: 0 };
  let worstOpener = { name: "", rate: 1 };

  for (const [name, stats] of Object.entries(openerStats)) {
    const rate = stats.used > 0 ? stats.converted / stats.used : 0;
    if (rate > bestOpener.rate) bestOpener = { name, rate };
    if (rate < worstOpener.rate && stats.used >= 5) worstOpener = { name, rate };

    await supabase.from("voice_scripts")
      .update({
        conversion_rate: rate,
        times_used: stats.used,
        times_converted: stats.converted
      })
      .eq("name", name)
      .eq("module_type", "opener");
  }

  // Retire worst opener if enough data and below 5% conversion
  if (worstOpener.name && worstOpener.rate < 0.05 &&
      (openerStats[worstOpener.name]?.used || 0) >= 10) {
    await supabase.from("voice_scripts")
      .update({ status: "retired" })
      .eq("name", worstOpener.name);
  }

  // Best call time
  const hourStats: Record<number, { calls: number; converts: number }> = {};
  for (const call of calls) {
    const hour = new Date(call.created_at).getHours();
    if (!hourStats[hour]) hourStats[hour] = { calls: 0, converts: 0 };
    hourStats[hour].calls++;
    if (["booked", "paid"].includes(call.outcome || "")) hourStats[hour].converts++;
  }
  let bestHour = { hour: 10, rate: 0 };
  for (const [hour, stats] of Object.entries(hourStats)) {
    const rate = stats.calls > 0 ? stats.converts / stats.calls : 0;
    if (rate > bestHour.rate) bestHour = { hour: parseInt(hour), rate };
  }

  // Top objections
  const objectionCounts: Record<string, number> = {};
  for (const call of calls) {
    for (const obj of (call.objections_encountered || [])) {
      objectionCounts[obj] = (objectionCounts[obj] || 0) + 1;
    }
  }

  const insightRaw = await claude(`
Week's voice call performance:
- Total calls: ${calls.length}
- Answer rate: ${Math.round(answered.length / calls.length * 100)}%
- Conversion rate: ${Math.round(converted.length / calls.length * 100)}%
- Revenue: $${revenue.toLocaleString()}
- Best opener: ${bestOpener.name} (${Math.round(bestOpener.rate * 100)}%)
- Top objections: ${JSON.stringify(objectionCounts)}
- Best call time: ${bestHour.hour}:00

Generate 3 specific improvements for next week.
JSON: {"improvements": ["...", "...", "..."], "script_changes": ["..."]}
`);

  let insights: { improvements: string[]; script_changes: string[] } = { improvements: [], script_changes: [] };
  try {
    insights = JSON.parse(insightRaw.replace(/```json|```/g, "").trim());
  } catch { /* use defaults */ }

  await supabase.from("voice_learning").insert({
    week_start: oneWeekAgo.split("T")[0],
    calls_made: calls.length,
    calls_answered: answered.length,
    answer_rate: answered.length / calls.length,
    booked: converted.filter((c: any) => c.outcome === "booked").length,
    paid: converted.filter((c: any) => c.outcome === "paid").length,
    interested: converted.filter((c: any) => c.outcome === "interested").length,
    not_interested: calls.filter((c: any) => c.outcome === "not_interested").length,
    revenue_generated: revenue,
    revenue_per_call: revenue / calls.length,
    best_opener: bestOpener.name,
    best_opener_conversion: bestOpener.rate,
    worst_opener: worstOpener.name,
    top_objections: objectionCounts,
    best_call_time: `${bestHour.hour}:00`,
    insights
  });

  await sendTelegram(
    `📞 *Voice Learning Report — Week of ${oneWeekAgo.split("T")[0]}*\n\n` +
    `*Calls:* ${calls.length} made | ${answered.length} answered\n` +
    `*Answer rate:* ${Math.round(answered.length / calls.length * 100)}%\n` +
    `*Conversions:* ${converted.length} (${Math.round(converted.length / calls.length * 100)}%)\n` +
    `*Revenue:* $${revenue.toLocaleString()}\n\n` +
    `*Best opener:* ${bestOpener.name} (${Math.round(bestOpener.rate * 100)}%)\n` +
    `*Best time:* ${bestHour.hour}:00\n\n` +
    `*This week's improvements:*\n` +
    (insights.improvements || []).map((i: string) => `• ${i}`).join("\n")
  );

  return Response.json({ ok: true, calls_analyzed: calls.length, revenue });
});

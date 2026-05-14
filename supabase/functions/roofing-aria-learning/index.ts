import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-aria-learning ready" });

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekStart = oneWeekAgo.split("T")[0];
  const callTypes = ["storm_alert", "lead_followup", "inbound_lead", "adjuster", "review_request"];
  const reports: Record<string, unknown>[] = [];

  for (const callType of callTypes) {
    const { data: calls } = await supabase
      .from("roofing_aria_calls")
      .select("*")
      .eq("call_type", callType)
      .gt("created_at", oneWeekAgo);

    if (!calls?.length) continue;

    const answered = calls.filter(c => c.answered);
    const converted = calls.filter(c => ["appointment_booked", "portal_sent", "interested"].includes(c.outcome));

    // Script performance
    const scriptPerf: Record<string, { used: number; converted: number }> = {};
    for (const call of calls) {
      const s = call.script_used || "unknown";
      if (!scriptPerf[s]) scriptPerf[s] = { used: 0, converted: 0 };
      scriptPerf[s].used++;
      if (["appointment_booked", "portal_sent"].includes(call.outcome)) scriptPerf[s].converted++;
    }

    let bestScript = { name: "", rate: 0 };
    let worstScript = { name: "", rate: 1 };

    for (const [name, stats] of Object.entries(scriptPerf)) {
      const rate = stats.used > 0 ? stats.converted / stats.used : 0;
      if (rate > bestScript.rate) bestScript = { name, rate };
      if (rate < worstScript.rate && stats.used >= 5) worstScript = { name, rate };

      await supabase.from("roofing_aria_scripts")
        .update({ conversion_rate: rate, times_used: stats.used, times_converted: stats.converted, is_champion: false })
        .eq("name", name)
        .eq("call_type", callType);
    }

    // Mark champion
    if (bestScript.name) {
      await supabase.from("roofing_aria_scripts")
        .update({ is_champion: true })
        .eq("name", bestScript.name)
        .eq("call_type", callType);
    }

    // Retire worst performer
    if (worstScript.name && worstScript.rate < 0.05 && worstScript.name !== bestScript.name) {
      await supabase.from("roofing_aria_scripts")
        .update({ status: "retired" })
        .eq("name", worstScript.name)
        .eq("call_type", callType);
    }

    const conversionRate = calls.length > 0 ? converted.length / calls.length : 0;

    reports.push({
      call_type: callType,
      calls_made: calls.length,
      answer_rate: calls.length > 0 ? answered.length / calls.length : 0,
      conversion_rate: conversionRate,
      best_script: bestScript.name,
      worst_script: worstScript.name
    });

    await supabase.from("roofing_aria_learning").insert({
      week_start: weekStart,
      call_type: callType,
      calls_made: calls.length,
      calls_answered: answered.length,
      conversions: converted.length,
      conversion_rate: conversionRate,
      best_script: bestScript.name,
      worst_script: worstScript.name
    });
  }

  if (reports.length > 0) {
    const reportText = reports.map(r =>
      `*${r.call_type}*: ${r.calls_made} calls, ${Math.round((r.conversion_rate as number) * 100)}% conversion`
    ).join("\n");

    await tg(
      `📞 *Roofing Aria Weekly Learning*\n\n` +
      `${reportText}\n\n` +
      `Scripts updated automatically.`
    );
  }

  return Response.json({ ok: true, reports });
});

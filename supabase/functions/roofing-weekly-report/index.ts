import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-weekly-report ready" });

  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const weekEnd = new Date().toISOString().split("T")[0];

  const [jobsRes, supplementsRes, stormsRes, ariaRes] = await Promise.all([
    supabase.from("roofing_jobs")
      .select("status, contract_amount, created_at")
      .gte("created_at", weekStart),
    supabase.from("supplement_packages")
      .select("status, supplement_requested_amount, supplement_approved_amount")
      .gte("created_at", weekStart),
    supabase.from("hail_events")
      .select("hail_size_inches, properties_scored")
      .gte("created_at", weekStart),
    supabase.from("roofing_aria_calls")
      .select("outcome, call_type")
      .gte("created_at", weekStart)
  ]);

  const jobs = jobsRes.data || [];
  const supplements = supplementsRes.data || [];
  const storms = stormsRes.data || [];
  const ariaCalls = ariaRes.data || [];

  const repCounts: Record<string, number> = {};
  for (const job of jobs) {
    if (job.status !== "lead" && (job as any).sales_rep_id) {
      repCounts[(job as any).sales_rep_id] = (repCounts[(job as any).sales_rep_id] || 0) + 1;
    }
  }
  const topRepEntry = Object.entries(repCounts).sort((a, b) => b[1] - a[1])[0];

  const weekRevenue = jobs
    .filter(j => ["complete", "paid"].includes(j.status))
    .reduce((sum, j) => sum + (j.contract_amount || 0), 0);

  const contractsSigned = jobs.filter(j => j.status !== "lead").length;
  const supplementsApproved = supplements.filter(s => s.status === "approved").length;
  const supplementRevenue = supplements
    .filter(s => s.status === "approved")
    .reduce((sum, s) => sum + (s.supplement_approved_amount || 0), 0);
  const ariaConversions = ariaCalls.filter(
    c => ["appointment_booked", "portal_sent"].includes(c.outcome)
  ).length;

  let intelligence = { insights: [] as string[], actions: [] as string[], next_week_forecast: 0 };

  try {
    const insightPrompt = `You are analyzing a roofing company's weekly performance.

DATA:
Revenue this week: $${weekRevenue.toLocaleString()}
Contracts signed: ${contractsSigned}
Supplements approved: ${supplementsApproved}
Supplement revenue: $${supplementRevenue.toLocaleString()}
Storms detected: ${storms.length}
AI calls made: ${ariaCalls.length}
AI call conversions: ${ariaConversions}

Generate:
1. 3 specific key insights from this data
2. 3 specific recommended actions for next week
3. Revenue forecast for next week based on pipeline

Be specific. Reference actual numbers. Be direct.

Respond ONLY with valid JSON, no markdown:
{"insights": ["...", "...", "..."], "actions": ["...", "...", "..."], "next_week_forecast": 0}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 800,
        messages: [{ role: "user", content: insightPrompt }]
      })
    });

    const aiData = await aiRes.json();
    const aiText = aiData.content?.[0]?.text || "{}";
    intelligence = JSON.parse(aiText.replace(/```json|```/g, "").trim());
  } catch { /* use defaults */ }

  const { data: report } = await supabase
    .from("weekly_intelligence_reports")
    .insert({
      week_start: weekStart,
      week_end: weekEnd,
      revenue_this_week: weekRevenue,
      jobs_completed: jobs.filter(j => j.status === "complete").length,
      contracts_signed: contractsSigned,
      supplements_filed: supplements.length,
      supplements_approved: supplementsApproved,
      supplement_revenue: supplementRevenue,
      storms_detected: storms.length,
      top_rep: topRepEntry ? topRepEntry[0].slice(0, 8) : null,
      top_rep_contracts: topRepEntry ? topRepEntry[1] : 0,
      key_insights: intelligence.insights,
      recommended_actions: intelligence.actions,
      next_week_forecast: intelligence.next_week_forecast
    })
    .select()
    .single();

  const insightsText = (intelligence.insights || [])
    .map((i, idx) => `${idx + 1}. ${i}`)
    .join("\n");

  const actionsText = (intelligence.actions || [])
    .map((a, idx) => `${idx + 1}. ${a}`)
    .join("\n");

  await sendTelegram(
    `📊 *Roofing OS Weekly Intelligence Report*\n` +
    `Week of ${weekStart}\n\n` +
    `*Revenue:* $${weekRevenue.toLocaleString()}\n` +
    `*Contracts signed:* ${contractsSigned}\n` +
    `*Supplements approved:* ${supplementsApproved}\n` +
    `*Supplement revenue:* $${supplementRevenue.toLocaleString()}\n` +
    `*Storms detected:* ${storms.length}\n` +
    `*AI call conversions:* ${ariaConversions}\n\n` +
    (insightsText ? `*Key Insights:*\n${insightsText}\n\n` : "") +
    (actionsText ? `*Next Week Actions:*\n${actionsText}\n\n` : "") +
    `*Next week forecast:* $${(intelligence.next_week_forecast || 0).toLocaleString()}`
  );

  return Response.json({
    ok: true,
    report_id: report?.id,
    revenue: weekRevenue,
    insights: intelligence.insights
  });
});

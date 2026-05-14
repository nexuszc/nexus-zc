import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

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
  if (body.test) return Response.json({ ok: true, message: "roofing-self-improve ready" });

  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const patterns: Record<string, unknown>[] = [];

  // Pattern 1 — Best time analysis from door_knock_log (may not exist yet)
  try {
    const { data: knocks } = await supabase
      .from("door_knock_log")
      .select("outcome, knocked_at")
      .gte("knocked_at", thirtyDaysAgo);

    const knocksByHour: Record<number, { knocks: number; conversions: number }> = {};

    for (const knock of knocks || []) {
      const hour = new Date(knock.knocked_at).getHours();
      if (!knocksByHour[hour]) knocksByHour[hour] = { knocks: 0, conversions: 0 };
      knocksByHour[hour].knocks++;
      if (["appointment_set", "signed"].includes(knock.outcome)) {
        knocksByHour[hour].conversions++;
      }
    }

    let bestHour = { hour: 10, rate: 0 };
    for (const [hour, stats] of Object.entries(knocksByHour)) {
      const rate = stats.knocks > 5 ? stats.conversions / stats.knocks : 0;
      if (rate > bestHour.rate) bestHour = { hour: parseInt(hour), rate };
    }

    if (bestHour.rate > 0.15) {
      patterns.push({
        pattern_type: "scheduling",
        pattern_description:
          `Door knocking converts at ${Math.round(bestHour.rate * 100)}% ` +
          `at ${bestHour.hour}:00. ` +
          `Higher than average by ${Math.round((bestHour.rate - 0.1) * 100)}%.`,
        recommendation:
          `Schedule door knockers to start in their territory ` +
          `no later than ${bestHour.hour}:00 local time.`,
        evidence_count: knocksByHour[bestHour.hour]?.knocks || 0,
        confidence_score: 0.8
      });
    }
  } catch { /* door_knock_log may not exist yet */ }

  // Pattern 2 — Supplement approval patterns
  try {
    const { data: packages } = await supabase
      .from("supplement_packages")
      .select("carrier_name, status, supplement_requested_amount, supplement_approved_amount")
      .gte("created_at", thirtyDaysAgo);

    const carrierRates: Record<string, { submitted: number; approved: number }> = {};
    for (const pkg of packages || []) {
      const c = pkg.carrier_name || "Unknown";
      if (!carrierRates[c]) carrierRates[c] = { submitted: 0, approved: 0 };
      carrierRates[c].submitted++;
      if (pkg.status === "approved") carrierRates[c].approved++;
    }

    for (const [carrier, stats] of Object.entries(carrierRates)) {
      if (stats.submitted < 3) continue;
      const rate = stats.approved / stats.submitted;
      if (rate < 0.5) {
        patterns.push({
          pattern_type: "supplement",
          pattern_description:
            `${carrier} is approving only ${Math.round(rate * 100)}% ` +
            `of supplements. Below target of 65%.`,
          recommendation:
            `Review ${carrier} supplement language. ` +
            `Add more specific code citations. ` +
            `Consider invoking appraisal clause on high-value denials.`,
          evidence_count: stats.submitted,
          confidence_score: 0.85
        });
      }
    }
  } catch {}

  // Pattern 3 — Pricing opportunity
  try {
    const { data: closedJobs } = await supabase
      .from("roofing_jobs")
      .select("contract_amount, zip_code")
      .in("status", ["complete", "paid"])
      .gte("created_at", thirtyDaysAgo);

    if ((closedJobs?.length || 0) > 10) {
      const avgValue = (closedJobs || []).reduce(
        (sum, j) => sum + (j.contract_amount || 0), 0
      ) / (closedJobs?.length || 1);

      const industryAvg = 15000;

      if (avgValue < industryAvg * 0.85) {
        patterns.push({
          pattern_type: "pricing",
          pattern_description:
            `Average job value $${avgValue.toLocaleString()} ` +
            `is below industry average of $15,000.`,
          recommendation:
            `Review pricing structure. ` +
            `Consider 5-8% price increase on standard jobs. ` +
            `Ensure all code upgrades are included in estimates.`,
          evidence_count: closedJobs?.length || 0,
          confidence_score: 0.75
        });
      }
    }
  } catch {}

  // Save patterns
  if (patterns.length > 0) {
    await supabase.from("roofing_patterns").insert(patterns);

    const patternText = patterns
      .map(p => `• ${p.recommendation}`)
      .join("\n");

    await sendTelegram(
      `🧠 *Roofing OS — New Patterns Detected*\n\n` +
      `${patternText}\n\n` +
      `Reply \`apply patterns\` to implement recommendations.`
    );
  }

  return Response.json({
    ok: true,
    patterns_detected: patterns.length,
    patterns
  });
});

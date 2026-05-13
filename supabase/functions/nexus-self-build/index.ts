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
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function detectVerticalOpportunities() {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: diagnostics } = await supabase.from("nexus_diagnostics").select("industry, nexus_score, status, intake_biggest_fix").gt("created_at", cutoff).not("industry", "is", null);

  // Group by industry
  const byIndustry: Record<string, any[]> = {};
  for (const d of diagnostics || []) {
    if (!d.industry) continue;
    if (!byIndustry[d.industry]) byIndustry[d.industry] = [];
    byIndustry[d.industry].push(d);
  }

  const alerts: string[] = [];

  for (const [industry, industryDiags] of Object.entries(byIndustry)) {
    if (industryDiags.length < 5) continue; // lower threshold for early detection

    // Check if vertical OS already exists
    const { data: existing } = await supabase.from("projects").select("id").eq("category", "vertical").ilike("name", `%${industry}%`).maybeSingle();
    if (existing) continue;

    const estimatedMonthly = industryDiags.length * 499;

    // Check existing proposal
    const { data: existingProposal } = await supabase.from("nexus_vertical_proposals").select("id, status, evidence_count").eq("industry", industry).maybeSingle();

    if (industryDiags.length >= 10) {
      // Threshold met — analyze with Claude
      const commonGaps = await claude(`Analyze these ${industryDiags.length} ${industry} business diagnostics.

Top stated challenges: ${industryDiags.map(d => d.intake_biggest_fix).filter(Boolean).join("; ").slice(0, 500)}
Average Nexus Score: ${Math.round(industryDiags.reduce((s, d) => s + (d.nexus_score || 0), 0) / industryDiags.length)}

Are the gaps consistent enough to build a productized ${industry} OS?
What would it include?

Respond in JSON: { consistent: boolean, common_gaps: string[], os_features: string[], market_size_estimate: number, build_recommendation: string }`, 600);

      try {
        const parsed = JSON.parse(commonGaps.replace(/```json|```/g, "").trim());

        if (existingProposal) {
          await supabase.from("nexus_vertical_proposals").update({ evidence_count: industryDiags.length, status: "threshold_met", proposed_at: new Date().toISOString(), common_gaps: parsed.common_gaps }).eq("id", existingProposal.id);
        } else {
          await supabase.from("nexus_vertical_proposals").insert({ vertical_name: `${industry} OS`, industry, evidence_count: industryDiags.length, common_gaps: parsed.common_gaps, estimated_market_size: parsed.market_size_estimate || 0, estimated_monthly_revenue: estimatedMonthly, status: "threshold_met", proposed_at: new Date().toISOString() });
        }

        alerts.push(`🚀 *Vertical OS Opportunity: ${industry}*\n${industryDiags.length} diagnostics run | Est. $${estimatedMonthly.toLocaleString()}/mo\nGaps: ${(parsed.common_gaps || []).slice(0, 3).join(", ")}\n\nReply \`approve vertical: ${industry}\` to build.`);
      } catch { /* ignore parse error */ }
    } else {
      // Update or create detecting proposal
      if (existingProposal) {
        await supabase.from("nexus_vertical_proposals").update({ evidence_count: industryDiags.length }).eq("id", existingProposal.id);
      } else {
        await supabase.from("nexus_vertical_proposals").insert({ vertical_name: `${industry} OS`, industry, evidence_count: industryDiags.length, estimated_monthly_revenue: estimatedMonthly, status: "detecting" }).catch(() => {});
      }
    }
  }

  return alerts;
}

async function updateBenchmarks() {
  const { data: recent } = await supabase.from("nexus_diagnostics").select("industry, nexus_score").gt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).not("industry", "is", null).not("nexus_score", "is", null);

  for (const d of recent || []) {
    if (!d.industry || !d.nexus_score) continue;
    const { data: existing } = await supabase.from("nexus_benchmarks").select("*").eq("industry", d.industry).eq("metric_name", "avg_nexus_score").maybeSingle();
    if (existing) {
      const newAvg = (existing.metric_value * existing.sample_size + d.nexus_score) / (existing.sample_size + 1);
      await supabase.from("nexus_benchmarks").update({ metric_value: Math.round(newAvg), sample_size: existing.sample_size + 1, last_updated: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("nexus_benchmarks").insert({ industry: d.industry, metric_name: "avg_nexus_score", metric_value: d.nexus_score, sample_size: 1 }).catch(() => {});
    }
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, test: true });

  const action = body.action || "detect_verticals";

  if (action === "update_benchmarks") {
    await updateBenchmarks();
    return Response.json({ ok: true, action: "benchmarks_updated" });
  }

  // Default: detect verticals + update benchmarks
  const [alerts] = await Promise.all([
    detectVerticalOpportunities(),
    updateBenchmarks()
  ]);

  for (const alert of alerts) {
    await tg(alert);
  }

  return Response.json({ ok: true, vertical_alerts: alerts.length });
});

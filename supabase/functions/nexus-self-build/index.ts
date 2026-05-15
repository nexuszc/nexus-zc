import { supabaseAdmin } from "../_shared/supabase.ts";
import { callClaude } from "../_shared/claude.ts";
import { tg } from "../_shared/telegram.ts";
import { safeStringify } from "../nexus-core/json-utils.ts";

const supabase = supabaseAdmin;

async function detectVerticalOpportunities() {
  const threshold = 3;
  const alerts: string[] = [];

  const { data: diagnostics } = await supabase.from("nexus_diagnostics").select("*").gt("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).not("industry", "is", null);

  if (!diagnostics || diagnostics.length === 0) {
    console.log("[detectVerticalOpportunities] No diagnostics found in last 30 days");
    return [];
  }

  const industryGroups = diagnostics.reduce((acc, d) => {
    if (!d.industry) return acc;
    if (!acc[d.industry]) acc[d.industry] = [];
    acc[d.industry].push(d);
    return acc;
  }, {} as Record<string, any[]>);

  console.log(`[detectVerticalOpportunities] Found ${Object.keys(industryGroups).length} industries`);

  for (const [industry, industryDiags] of Object.entries(industryGroups)) {
    if (industryDiags.length < threshold) continue;

    console.log(`[detectVerticalOpportunities] Industry "${industry}" has ${industryDiags.length} diagnostics (threshold: ${threshold})`);

    const { data: existingProposal } = await supabase.from("nexus_vertical_proposals").select("*").eq("industry", industry).maybeSingle();

    const estimatedMonthly = industryDiags.length * 2000;

    if (industryDiags.length >= threshold) {
      const commonGaps = await callClaude(`You are analyzing diagnostic data for the ${industry} industry.

${industryDiags.length} diagnostics have been run. Average Nexus Score: ${Math.round(industryDiags.reduce((s, d) => s + (d.nexus_score || 0), 0) / industryDiags.length)}

Are the gaps consistent enough to build a productized ${industry} OS?
What would it include?

Respond in JSON: { consistent: boolean, common_gaps: string[], os_features: string[], market_size_estimate: number, build_recommendation: string }`, 600);

      if (!commonGaps || commonGaps.trim().length === 0) {
        console.error(`[detectVerticalOpportunities] Empty Claude response for industry: ${industry}`);
        continue;
      }

      try {
        const cleanedResponse = commonGaps.replace(/```json|```/g, "").trim();
        console.log(`[detectVerticalOpportunities] Parsing Claude response for ${industry}: ${cleanedResponse.length} chars`);
        
        if (!cleanedResponse.startsWith("{") && !cleanedResponse.startsWith("[")) {
          console.error(`[detectVerticalOpportunities] Response does not look like JSON for ${industry}: ${cleanedResponse.slice(0, 200)}`);
          continue;
        }
        
        if (cleanedResponse.length < 10) {
          console.error(`[detectVerticalOpportunities] Response too short to be valid JSON for ${industry}: ${cleanedResponse.length} chars`);
          continue;
        }
        
        const openBraces = (cleanedResponse.match(/{/g) || []).length;
        const closeBraces = (cleanedResponse.match(/}/g) || []).length;
        if (openBraces !== closeBraces) {
          console.error(`[detectVerticalOpportunities] Mismatched braces for ${industry}: ${openBraces} open, ${closeBraces} close`);
          console.error(`[detectVerticalOpportunities] Response: ${cleanedResponse}`);
          continue;
        }
        
        let parsed;
        try {
          parsed = JSON.parse(cleanedResponse);
        } catch (parseError) {
          console.error(`[detectVerticalOpportunities] JSON parse failed for ${industry}: ${parseError.message}`);
          console.error(`[detectVerticalOpportunities] Stack trace: ${parseError.stack}`);
          console.error(`[detectVerticalOpportunities] Attempted to parse: ${cleanedResponse.slice(0, 500)}`);
          continue;
        }
        
        if (!parsed || typeof parsed !== "object") {
          console.error(`[detectVerticalOpportunities] Parsed result is not an object for ${industry}: ${typeof parsed}`);
          continue;
        }
        
        if (!Array.isArray(parsed.common_gaps)) {
          console.warn(`[detectVerticalOpportunities] common_gaps missing or not array for ${industry}, defaulting to []`);
          parsed.common_gaps = [];
        }
        
        if (typeof parsed.market_size_estimate !== "number") {
          console.warn(`[detectVerticalOpportunities] market_size_estimate not a number for ${industry}, defaulting to 0`);
          parsed.market_size_estimate = 0;
        }

        const updateData = {
          evidence_count: industryDiags.length,
          status: "threshold_met",
          proposed_at: new Date().toISOString(),
          common_gaps: parsed.common_gaps
        };

        let updateDataString;
        try {
          updateDataString = safeStringify(updateData);
        } catch (stringifyError) {
          console.error(`[detectVerticalOpportunities] Failed to stringify update data for ${industry}: ${stringifyError.message}`);
          console.error(`[detectVerticalOpportunities] Stack trace: ${stringifyError.stack}`);
          continue;
        }

        if (existingProposal) {
          await supabase.from("nexus_vertical_proposals").update(updateData).eq("id", existingProposal.id);
        } else {
          const insertData = {
            vertical_name: `${industry} OS`,
            industry,
            evidence_count: industryDiags.length,
            common_gaps: parsed.common_gaps,
            estimated_market_size: parsed.market_size_estimate || 0,
            estimated_monthly_revenue: estimatedMonthly,
            status: "threshold_met",
            proposed_at: new Date().toISOString()
          };

          let insertDataString;
          try {
            insertDataString = safeStringify(insertData);
          } catch (stringifyError) {
            console.error(`[detectVerticalOpportunities] Failed to stringify insert data for ${industry}: ${stringifyError.message}`);
            console.error(`[detectVerticalOpportunities] Stack trace: ${stringifyError.stack}`);
            continue;
          }

          await supabase.from("nexus_vertical_proposals").insert(insertData);
        }

        alerts.push(`🎯 *Vertical OS Opportunity: ${industry}*\n${industryDiags.length} diagnostics run | Est. $${estimatedMonthly.toLocaleString()}/mo\nGaps: ${(parsed.common_gaps || []).slice(0, 3).join(", ")}\n\nReply \`approve vertical: ${industry}\` to build.`);
      } catch (error) {
        console.error(`[detectVerticalOpportunities] Unexpected error processing ${industry}: ${error.message}`);
        console.error(`[detectVerticalOpportunities] Stack: ${error.stack}`);
      }
    } else {
      const updateData = {
        evidence_count: industryDiags.length
      };

      const insertData = {
        vertical_name: `${industry} OS`,
        industry,
        evidence_count: industryDiags.length,
        estimated_monthly_revenue: estimatedMonthly,
        status: "detecting"
      };

      if (existingProposal) {
        await supabase.from("nexus_vertical_proposals").update(updateData).eq("id", existingProposal.id);
      } else {
        await supabase.from("nexus_vertical_proposals").insert(insertData).catch((err) => {
          console.error(`[detectVerticalOpportunities] Failed to insert detecting proposal for ${industry}: ${err.message}`);
        });
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
  let body;
  try {
    const rawBody = await req.text();
    console.log(`[serve] Request body received: ${rawBody.length} chars`);
    
    if (!rawBody || rawBody.trim().length === 0) {
      console.log("[serve] Empty request body, using empty object");
      body = {};
    } else {
      try {
        body = JSON.parse(rawBody);
      } catch (parseError) {
        console.error(`[serve] Request JSON parse error: ${parseError.message}`);
        console.error(`[serve] Stack trace: ${parseError.stack}`);
        console.error(`[serve] Raw body (first 500 chars): ${rawBody.slice(0, 500)}`);
        body = {};
      }
    }
  } catch (error) {
    console.error(`[serve] Error reading request: ${error.message}`);
    console.error(`[serve] Stack trace: ${error.stack}`);
    body = {};
  }
  
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
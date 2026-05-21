import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function claude(prompt: string, maxTokens = 800): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function saveProposal(opts: {
  title: string;
  problem: string;
  proposed_fix: string;
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  estimated_impact: string;
}) {
  // Deduplicate: skip if same title proposed in last 7 days
  const { data: existing } = await supabase
    .from("nexus_roofing_proposals")
    .select("id")
    .eq("title", opts.title)
    .eq("status", "pending")
    .gt("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .maybeSingle();

  if (existing) return null;

  const { data } = await supabase.from("nexus_roofing_proposals").insert({
    title: opts.title,
    problem: opts.problem,
    proposed_fix: opts.proposed_fix,
    priority: opts.priority,
    category: opts.category,
    estimated_impact: opts.estimated_impact,
    status: "pending",
    ai_generated: true,
  }).select().single();

  return data;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-self-improve ready" });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const proposals: { title: string; problem: string; proposed_fix: string; priority: "critical" | "high" | "medium" | "low"; category: string; estimated_impact: string }[] = [];
  const contextParts: string[] = [];

  // Pattern 1 — Supplement approval rates by carrier
  try {
    const { data: packages } = await supabase
      .from("supplement_packages")
      .select("carrier_name, status, supplement_requested_amount, supplement_approved_amount")
      .gte("created_at", thirtyDaysAgo);

    const carrierRates: Record<string, { submitted: number; approved: number; total_approved: number }> = {};
    for (const pkg of packages || []) {
      const c = pkg.carrier_name || "Unknown";
      if (!carrierRates[c]) carrierRates[c] = { submitted: 0, approved: 0, total_approved: 0 };
      carrierRates[c].submitted++;
      if (pkg.status === "approved") {
        carrierRates[c].approved++;
        carrierRates[c].total_approved += pkg.supplement_approved_amount || 0;
      }
    }

    for (const [carrier, stats] of Object.entries(carrierRates)) {
      if (stats.submitted < 3) continue;
      const rate = stats.approved / stats.submitted;
      contextParts.push(`${carrier}: ${Math.round(rate * 100)}% approval rate (${stats.submitted} submitted)`);
      if (rate < 0.5) {
        proposals.push({
          title: `Improve supplement approval rate for ${carrier}`,
          problem: `${carrier} is approving only ${Math.round(rate * 100)}% of supplements (target: 65%). ${stats.submitted} submitted in last 30 days.`,
          proposed_fix: `Review ${carrier}-specific line item language. Add code citations per Xactimate. Surface appraisal clause option for high-value denials (>$2k). Update carrier_intelligence table with new tactics.`,
          priority: rate < 0.35 ? "high" : "medium",
          category: "supplement",
          estimated_impact: `+${Math.round((0.65 - rate) * stats.submitted)} additional approvals/month`,
        });
      }
    }
  } catch { /* non-fatal */ }

  // Pattern 2 — Job value vs industry average
  try {
    const { data: closedJobs } = await supabase
      .from("roofing_jobs")
      .select("contract_amount")
      .in("status", ["complete", "paid"])
      .gte("created_at", thirtyDaysAgo);

    if ((closedJobs?.length || 0) >= 10) {
      const avgValue = (closedJobs || []).reduce((sum, j) => sum + (j.contract_amount || 0), 0) / closedJobs!.length;
      const industryAvg = 15000;
      contextParts.push(`Avg job value: $${Math.round(avgValue).toLocaleString()} vs industry $${industryAvg.toLocaleString()}`);

      if (avgValue < industryAvg * 0.85) {
        proposals.push({
          title: "Average job value below industry benchmark",
          problem: `Avg job value $${Math.round(avgValue).toLocaleString()} is ${Math.round((1 - avgValue / industryAvg) * 100)}% below the $${industryAvg.toLocaleString()} industry average.`,
          proposed_fix: `Add code upgrade checklist to estimate flow. Prompt contractors to include ice-and-water, drip edge, and ventilation line items on every job. Build in price calculator showing margin at each tier.`,
          priority: "medium",
          category: "product",
          estimated_impact: `$${Math.round((industryAvg - avgValue) * closedJobs!.length).toLocaleString()} additional revenue over same job volume`,
        });
      }
    }
  } catch { /* non-fatal */ }

  // Pattern 3 — Revenue / churn risk
  try {
    const { data: accounts } = await supabase
      .from("contractor_accounts")
      .select("company_name, plan, plan_price_cents, churn_risk_score, last_login_at, total_jobs, onboarding_completed")
      .eq("status", "active")
      .neq("is_test_account", true);

    const active = accounts || [];
    const paid = active.filter(a => a.plan !== "free");
    const mrr = paid.reduce((s, a) => s + (a.plan_price_cents || 0), 0);
    const atRisk = paid.filter(a => (a.churn_risk_score || 0) >= 70);
    const notOnboarded = active.filter(a => !a.onboarding_completed && !a.last_login_at);
    const noLoginRecent = paid.filter(a => a.last_login_at && new Date(a.last_login_at) < new Date(fourteenDaysAgo));

    contextParts.push(`MRR: $${(mrr / 100).toFixed(0)}/mo, paid contractors: ${paid.length}, churn risk ≥70: ${atRisk.length}`);

    if (atRisk.length > 0) {
      proposals.push({
        title: `${atRisk.length} paid contractor(s) at churn risk`,
        problem: `${atRisk.map(a => a.company_name).join(", ")} have churn_risk_score ≥ 70. Combined MRR at risk: $${(atRisk.reduce((s, a) => s + (a.plan_price_cents || 0), 0) / 100).toFixed(0)}/mo.`,
        proposed_fix: `Queue Aria outreach check-in call for each at-risk account. Offer 1-on-1 onboarding session. Consider 1-month fee credit to re-engage. Log interaction in contractor dashboard.`,
        priority: "high",
        category: "retention",
        estimated_impact: `Save $${(atRisk.reduce((s, a) => s + (a.plan_price_cents || 0), 0) / 100).toFixed(0)}/mo in at-risk MRR`,
      });
    }

    if (noLoginRecent.length > 0) {
      proposals.push({
        title: `${noLoginRecent.length} paid contractor(s) haven't logged in for 14+ days`,
        problem: `Paid accounts with no recent login: ${noLoginRecent.map(a => a.company_name).join(", ")}. Silent churn risk before score hits critical threshold.`,
        proposed_fix: `Send automated re-engagement email via Resend. Show new features added since last login. Offer free measurement report as re-activation incentive.`,
        priority: "medium",
        category: "retention",
        estimated_impact: `Prevent passive churn on ${noLoginRecent.length} account(s)`,
      });
    }

    if (notOnboarded.length > 0) {
      proposals.push({
        title: `${notOnboarded.length} contractor(s) haven't completed onboarding`,
        problem: `New accounts that haven't completed onboarding and never logged in: ${notOnboarded.map(a => a.company_name).join(", ")}.`,
        proposed_fix: `Trigger Aria onboarding call within 24h of signup. Send magic link reminder email at +1h, +24h, +72h intervals. Add onboarding completion % to morning digest.`,
        priority: "medium",
        category: "onboarding",
        estimated_impact: `Reduce first-week churn, improve activation rate`,
      });
    }
  } catch { /* non-fatal */ }

  // Pattern 4 — AI-generated product improvement (weekly Claude synthesis)
  try {
    if (contextParts.length > 0) {
      const aiSuggestion = await claude(
        `You are the product advisor for Roofing OS, a software platform for roofing contractors.
Here's what the data shows this week:

${contextParts.join("\n")}

Identify ONE specific product improvement (not already listed below) that would have the highest impact on retention or revenue. Think about UX friction, missing features, or automation gaps.

Existing proposals this cycle:
${proposals.map(p => `- ${p.title}`).join("\n")}

Return a JSON object with exactly these fields:
- title: short title (max 60 chars)
- problem: what the data suggests is broken or missing (2 sentences)
- proposed_fix: specific implementation suggestion (2-3 sentences, technical enough to act on)
- priority: "high" or "medium"
- category: one of: product, supplement, retention, onboarding, marketing
- estimated_impact: one-line estimate of business value

Return ONLY valid JSON.`,
        400
      );

      try {
        const parsed = JSON.parse(aiSuggestion.replace(/```json\n?|\n?```/g, "").trim());
        if (parsed.title && parsed.problem && parsed.proposed_fix) {
          proposals.push({
            title: parsed.title,
            problem: parsed.problem,
            proposed_fix: parsed.proposed_fix,
            priority: ["critical", "high", "medium", "low"].includes(parsed.priority) ? parsed.priority : "medium",
            category: parsed.category || "product",
            estimated_impact: parsed.estimated_impact || "",
          });
        }
      } catch { /* skip if Claude JSON was malformed */ }
    }
  } catch { /* non-fatal */ }

  // Save all proposals to nexus_roofing_proposals (with dedup)
  let saved = 0;
  for (const proposal of proposals) {
    const result = await saveProposal(proposal);
    if (result) saved++;
  }

  return Response.json({
    ok: true,
    proposals_generated: proposals.length,
    proposals_saved: saved,
    context_signals: contextParts,
  });
});

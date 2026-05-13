import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function claude(prompt: string, maxTokens = 1000): Promise<string> {
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
  return data.content[0].text;
}

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  });
}

async function webSearch(query: string) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 5 })
  });
  const data = await res.json();
  return data.organic || [];
}

async function observeProductHealth() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalContractors },
    { count: onboardedContractors },
    { count: totalJobs },
    { count: jobsWithPortal },
    { count: totalMessages },
    { count: totalDocs },
    { count: portalErrors },
    { count: totalProspects },
    { count: activeOutreach },
    { count: hotLeads },
    { count: closedWon }
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("clients").select("*", { count: "exact", head: true }).eq("onboarding_complete", true),
    supabase.from("roofing_jobs").select("*", { count: "exact", head: true }),
    supabase.from("roofing_jobs").select("*", { count: "exact", head: true }).not("portal_token", "is", null),
    supabase.from("job_messages").select("*", { count: "exact", head: true }),
    supabase.from("job_documents").select("*", { count: "exact", head: true }),
    supabase.from("nexus_audit_log").select("*", { count: "exact", head: true })
      .eq("engine", "roofing-notify").eq("outcome", "failure").gt("created_at", yesterday),
    supabase.from("roofing_prospects").select("*", { count: "exact", head: true }),
    supabase.from("roofing_prospects").select("*", { count: "exact", head: true }).eq("status", "outreach_active"),
    supabase.from("roofing_prospects").select("*", { count: "exact", head: true }).eq("status", "hot"),
    supabase.from("roofing_prospects").select("*", { count: "exact", head: true }).eq("status", "closed_won")
  ]);

  const snapshot = {
    total_contractors: totalContractors || 0,
    onboarded_contractors: onboardedContractors || 0,
    total_jobs: totalJobs || 0,
    jobs_with_portal_sent: jobsWithPortal || 0,
    total_homeowner_messages: totalMessages || 0,
    total_documents_generated: totalDocs || 0,
    portal_errors_24h: portalErrors || 0,
    total_prospects: totalProspects || 0,
    active_outreach: activeOutreach || 0,
    hot_leads: hotLeads || 0,
    closed_won: closedWon || 0
  };

  let score = 50;
  if ((snapshot.total_contractors || 0) > 0) score += 20;
  if ((snapshot.portal_errors_24h || 0) === 0) score += 10;
  if ((snapshot.total_jobs || 0) > 5) score += 10;
  if ((snapshot.active_outreach || 0) > 10) score += 10;
  score = Math.min(100, score);

  await supabase.from("roofing_health_snapshots").insert({
    ...snapshot,
    product_health_score: score
  });

  return { ...snapshot, product_health_score: score };
}

async function checkCompetitors() {
  const competitors = [
    "JobNimbus roofing software new features 2026",
    "Roofr app update 2026",
    "AccuLynx roofing new feature 2026",
    "CompanyCam update 2026",
    "Jobber roofing contractor update 2026"
  ];

  const newIntel: string[] = [];

  for (const query of competitors) {
    const results = await webSearch(query);
    if (!results.length) continue;

    const competitorName = query.split(" ")[0];
    const snippet = results[0]?.snippet || "";
    const title = results[0]?.title || "";

    const { data: existing } = await supabase
      .from("competitor_intel")
      .select("id")
      .eq("competitor_name", competitorName)
      .ilike("feature_found", `%${snippet.slice(0, 50)}%`)
      .maybeSingle();

    if (existing) continue;

    const analysis = await claude(`You are analyzing a competitor update for Roofing OS.

Roofing OS is a $499/month SaaS for roofing contractors that gives homeowners a branded project portal with timeline, photos, documents, messaging, and payments.

Competitor: ${competitorName}
Finding: "${title} — ${snippet}"

Is this a significant new feature or update that Roofing OS should respond to?
Does Roofing OS already have this capability?

Respond with JSON only (no backticks):
{
  "is_significant": true,
  "feature_description": "what the competitor added",
  "already_have": false,
  "relevance": "high|medium|low",
  "roofing_os_response": "what we should build or improve in response (if relevant)"
}`, 400);

    try {
      const parsed = JSON.parse(analysis.replace(/```json|```/g, "").trim());

      await supabase.from("competitor_intel").insert({
        competitor_name: competitorName,
        feature_found: parsed.feature_description,
        source_url: results[0]?.link,
        relevance: parsed.relevance,
        already_have_this: parsed.already_have
      });

      if (parsed.is_significant && !parsed.already_have && parsed.relevance === "high") {
        newIntel.push(`${competitorName}: ${parsed.feature_description}`);
        await supabase.from("roofing_improvements").insert({
          category: "competitive_response",
          title: `Competitive response: ${competitorName} — ${parsed.feature_description.slice(0, 60)}`,
          problem: `${competitorName} just added: ${parsed.feature_description}. We don't have this.`,
          proposed_solution: parsed.roofing_os_response,
          evidence: `Found via competitive search: ${results[0]?.link}`,
          competitor_source: competitorName,
          priority: 7,
          impact_estimate: "high",
          effort_estimate: "medium",
          status: "proposed"
        });
      }
    } catch { /* skip parse errors */ }
  }

  return newIntel;
}

async function analyzeAndPropose(snapshot: Record<string, number>) {
  const { data: recentImprovements } = await supabase
    .from("roofing_improvements")
    .select("title, status")
    .in("status", ["proposed", "approved", "building", "live"])
    .order("created_at", { ascending: false })
    .limit(20);

  const existingTitles = recentImprovements?.map(i => i.title) || [];

  const prompt = `You are the autonomous product manager for Roofing OS — a $499/month SaaS for roofing contractors.

CURRENT PRODUCT STATE:
- Active contractors: ${snapshot.total_contractors}
- Onboarded (completed setup): ${snapshot.onboarded_contractors}
- Total jobs created: ${snapshot.total_jobs}
- Jobs with portal link sent: ${snapshot.jobs_with_portal_sent}
- Homeowner messages sent: ${snapshot.total_homeowner_messages}
- Documents generated: ${snapshot.total_documents_generated}
- Notify errors (24h): ${snapshot.portal_errors_24h}
- Prospects in pipeline: ${snapshot.total_prospects}
- Active outreach: ${snapshot.active_outreach}
- Hot leads: ${snapshot.hot_leads}
- Closed/won: ${snapshot.closed_won}
- Product health score: ${snapshot.product_health_score}/100

RECENT IMPROVEMENTS (don't duplicate these):
${existingTitles.join('\n')}

Based on this data, identify 1-3 high-value improvements for Roofing OS.

Think like a product manager:
- If jobs_with_portal_sent < total_jobs: why aren't contractors sending portal links?
- If onboarded < total_contractors: what's breaking in onboarding?
- If homeowner_messages = 0: is messaging broken or not promoted?
- If notify_errors > 0: email notifications are broken, fix it
- If prospects > 0 but closed_won = 0: sales funnel has a problem

Prioritize in this order:
1. Fix broken things (errors, failures)
2. Improve conversion (get contractors to use features)
3. Add features that increase value/stickiness
4. Add features that help sales/acquisition

Respond with JSON only (no backticks):
[
  {
    "category": "bug_fix",
    "title": "short title",
    "problem": "what's wrong or missing",
    "proposed_solution": "specific solution",
    "implementation_plan": "what files/functions to change",
    "evidence": "which metric triggered this",
    "priority": 8,
    "impact_estimate": "high",
    "effort_estimate": "simple",
    "success_metric": "how to measure if this worked"
  }
]`;

  const response = await claude(prompt, 1500);

  try {
    const proposals = JSON.parse(response.replace(/```json|```/g, "").trim());
    for (const proposal of proposals) {
      const isDuplicate = existingTitles.some(t =>
        t.toLowerCase().includes(proposal.title.toLowerCase().slice(0, 20))
      );
      if (isDuplicate) continue;
      await supabase.from("roofing_improvements").insert({ ...proposal, status: "proposed" });
    }
    return proposals;
  } catch {
    return [];
  }
}

Deno.serve(async (_req) => {
  const snapshot = await observeProductHealth();

  const { data: lastCompCheck } = await supabase
    .from("competitor_intel")
    .select("found_at")
    .order("found_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const daysSinceLastCheck = lastCompCheck
    ? (Date.now() - new Date(lastCompCheck.found_at).getTime()) / (1000 * 60 * 60 * 24)
    : 999;

  let newCompetitorIntel: string[] = [];
  if (daysSinceLastCheck >= 7) {
    newCompetitorIntel = await checkCompetitors();
  }

  const proposals = await analyzeAndPropose(snapshot);

  const { count: pendingCount } = await supabase
    .from("roofing_improvements")
    .select("*", { count: "exact", head: true })
    .eq("status", "proposed");

  const hasIssues = snapshot.portal_errors_24h > 0;
  const hasNewIntel = newCompetitorIntel.length > 0;
  const hasNewProposals = proposals.length > 0;

  if (hasIssues || hasNewIntel || hasNewProposals) {
    const msg = `🏠 *Roofing OS Product Monitor*\n\n` +
      `*Health Score:* ${snapshot.product_health_score}/100\n` +
      `*Contractors:* ${snapshot.total_contractors} active | ${snapshot.onboarded_contractors} onboarded\n` +
      `*Jobs:* ${snapshot.total_jobs} total | ${snapshot.jobs_with_portal_sent} with portal sent\n` +
      `*Pipeline:* ${snapshot.total_prospects} prospects | ${snapshot.hot_leads} hot | ${snapshot.closed_won} won\n\n` +
      (hasIssues ? `⚠️ *${snapshot.portal_errors_24h} errors in last 24h*\n\n` : '') +
      (hasNewIntel ? `🔍 *Competitor updates:*\n${newCompetitorIntel.map(i => `• ${i}`).join('\n')}\n\n` : '') +
      (hasNewProposals ? `💡 *${proposals.length} new improvements proposed*\n` : '') +
      `📋 Total pending: ${pendingCount}\n\n` +
      `_Reply \`roofing improvements\` to review queue._`;

    await sendTelegram(msg);
  }

  return Response.json({
    ok: true,
    health_score: snapshot.product_health_score,
    proposals_created: proposals.length,
    competitor_intel: newCompetitorIntel.length
  });
});

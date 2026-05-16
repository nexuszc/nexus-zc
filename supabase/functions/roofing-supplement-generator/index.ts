import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

function getCarrierType(carrierName: string): string {
  const n = carrierName.toLowerCase();
  if (n.includes("state farm")) return "state_farm";
  if (n.includes("allstate")) return "allstate";
  if (n.includes("liberty")) return "liberty_mutual";
  if (n.includes("travelers")) return "travelers";
  if (n.includes("usaa")) return "usaa";
  if (n.includes("nationwide")) return "nationwide";
  if (n.includes("farmers")) return "farmers";
  return "other";
}

function getCurrentPriceListCode(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `CODE8X_${month}${String(year).slice(2)}`;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-supplement-generator ready" });

  const { job_id, package_type = "pre_install", carrier_override } = body;

  if (!job_id) return Response.json({ error: "job_id required" }, { status: 400 });

  const { data: job } = await supabase.from("roofing_jobs").select("*").eq("id", job_id).single();
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

  const { data: claim } = await supabase
    .from("insurance_claims")
    .select("*")
    .eq("job_id", job_id)
    .maybeSingle();

  if (!claim) return Response.json({ error: "No insurance claim found" }, { status: 404 });

  // Get existing photo analyses
  let { data: photoAnalyses } = await supabase
    .from("supplement_photo_analysis")
    .select("*")
    .eq("job_id", job_id);

  // Trigger photo analysis if none yet
  if (!photoAnalyses?.length) {
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-supplement-analyzer`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ job_id, package_type })
    }).catch(() => {});
    const { data: fresh } = await supabase
      .from("supplement_photo_analysis")
      .select("*")
      .eq("job_id", job_id);
    photoAnalyses = fresh;
  }

  const carrierName = carrier_override || claim.carrier_name || "Unknown";
  const carrierType = getCarrierType(carrierName);

  const { data: carrierIntel } = await supabase
    .from("carrier_intelligence")
    .select("*")
    .eq("carrier_type", carrierType)
    .maybeSingle();

  const { data: codes } = await supabase.from("roofing_codes").select("*").eq("state", "CO");

  const priceListDate = getCurrentPriceListCode();

  const supplementPrompt = `You are an expert roofing insurance supplement specialist.
Generate a complete supplement package for this claim.

JOB DETAILS:
Property: ${job.property_address || "Unknown"}
Material: ${job.material_type || "Asphalt shingles"}
Package type: ${package_type}

INSURANCE CLAIM:
Carrier: ${carrierName}
Claim #: ${claim.claim_number || "TBD"}
Adjuster: ${claim.adjuster_name || "TBD"}
Original estimate: $${((claim.original_estimate || 0) / 100).toLocaleString()}

CARRIER BEHAVIOR:
Easy approvals: ${carrierIntel?.easy_approvals?.join(", ") || "standard items"}
Common denials: ${carrierIntel?.common_denials?.join(", ") || "O&P"}
Tips: ${carrierIntel?.tips?.slice(0, 3).join("; ") || "document thoroughly"}

PHOTO ANALYSIS FINDINGS:
${JSON.stringify((photoAnalyses || []).slice(0, 10).map(p => ({
  severity: p.severity,
  damage_types: p.damage_types,
  suggested_line_items: p.suggested_line_items
})), null, 2)}

APPLICABLE BUILDING CODES:
${codes?.map(c => `${c.code_type}: ${c.requirement} (${c.code_section})`).join("\n") || "IRC 2021 Colorado standards"}

TOP 10 COMMONLY MISSED LINE ITEMS:
1. Starter strips (cannot be cut from field shingles)
2. Ridge cap shingles (separate product required)
3. Step flashing at all walls
4. Drip edge at eaves AND rakes (separate line items)
5. Ice and water shield (all required areas)
6. Dumpster size (verify correct size)
7. Overhead and profit (if general contractor involved)
8. Code upgrades (cite IRC section numbers)
9. Valley lining (cannot be reused)
10. Labor minimums (verify against regional rates)

Use Xactimate price list: ${priceListDate}

Respond in JSON only:
{
  "executive_summary": "",
  "line_items": [{
    "xactimate_code": "",
    "description": "",
    "category": "missed|undervalued|code_upgrade",
    "unit": "",
    "quantity": 0,
    "unit_price": 0,
    "total": 0,
    "justification": "",
    "carrier_language": ""
  }],
  "code_upgrades": [{
    "code_section": "",
    "requirement": "",
    "xactimate_code": "",
    "amount": 0,
    "justification": ""
  }],
  "op_justification": null,
  "total_supplement_amount": 0,
  "carrier_specific_notes": "",
  "submission_strategy": ""
}`;

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 3000,
      messages: [{ role: "user", content: supplementPrompt }]
    })
  });

  const aiData = await aiRes.json();
  const aiText = aiData.content?.[0]?.text || "{}";

  let supplement: Record<string, unknown>;
  try {
    supplement = JSON.parse(aiText.replace(/```json|```/g, "").trim());
  } catch {
    supplement = { line_items: [], total_supplement_amount: 0 };
  }

  const lineItems = (supplement.line_items as any[]) || [];
  const codeUpgrades = (supplement.code_upgrades as any[]) || [];
  const totalAmount = (supplement.total_supplement_amount as number) || 0;

  const missedItems = lineItems.filter(i => i.category === "missed");
  const missedValue = missedItems.reduce((s: number, i: any) => s + (i.total || 0), 0);
  const codeValue = codeUpgrades.reduce((s: number, c: any) => s + (c.amount || 0), 0);

  const { data: savedPackage } = await supabase
    .from("supplement_packages")
    .insert({
      job_id,
      claim_id: claim.id,
      package_type,
      carrier_name: carrierName,
      carrier_type: carrierType,
      adjuster_name: claim.adjuster_name,
      adjuster_email: claim.adjuster_email,
      claim_number: claim.claim_number,
      original_estimate_amount: claim.original_estimate || 0,
      supplement_requested_amount: Math.round(totalAmount * 100),
      line_items: lineItems,
      missed_items_count: missedItems.length,
      missed_items_value: Math.round(missedValue * 100),
      code_upgrades: codeUpgrades,
      code_upgrade_value: Math.round(codeValue * 100),
      carrier_specific_notes: supplement.carrier_specific_notes as string || "",
      status: "va_review"
    })
    .select()
    .single();

  // Update supplement_tracker (existing portal table)
  await supabase.from("supplement_tracker").insert({
    job_id,
    claim_id: claim.id,
    supplement_type: package_type,
    items_submitted: lineItems.length,
    amount_requested: Math.round(totalAmount * 100),
    top_items: lineItems.slice(0, 5).map((i: any) => ({
      name: i.description,
      amount: Math.round((i.total || 0) * 100),
      status: "pending",
      homeowner_description: i.justification
    })),
    homeowner_summary: `We found ${lineItems.length} items your insurance estimate missed or undervalued. We've requested $${totalAmount.toLocaleString()} in additional coverage.`,
    homeowner_summary_es: `Encontramos ${lineItems.length} artículos que su estimado de seguro omitió o subvaluó.`
  }).catch(() => {});

  // Portal activity
  await supabase.from("portal_activities").insert({
    job_id,
    activity_type: "supplement_submitted",
    title: "Additional coverage requested",
    description: `We found ${lineItems.length} items your insurance missed. We've requested an additional $${totalAmount.toLocaleString()}.`,
    description_es: `Encontramos artículos que su seguro omitió. Solicitamos cobertura adicional.`,
    icon: "💰",
    visible_to_homeowner: true
  }).catch(() => {});

  return Response.json({
    ok: true,
    package_id: savedPackage?.id,
    line_items: lineItems.length,
    total_requested: totalAmount,
    status: "va_review"
  });
});

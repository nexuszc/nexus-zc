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

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-supplement-rebuttal ready" });

  const { supplement_package_id, denied_items } = body;

  if (!supplement_package_id) return Response.json({ error: "supplement_package_id required" }, { status: 400 });

  const { data: pkg } = await supabase
    .from("supplement_packages")
    .select("*, roofing_jobs(*)")
    .eq("id", supplement_package_id)
    .single();

  if (!pkg) return Response.json({ error: "Package not found" }, { status: 404 });

  const { data: carrierIntel } = await supabase
    .from("carrier_intelligence")
    .select("*")
    .eq("carrier_type", pkg.carrier_type || "other")
    .maybeSingle();

  const jobAddress = (pkg.roofing_jobs as Record<string, unknown>)?.property_address || "Property";
  const rebuttals = [];

  for (const denial of (denied_items || [])) {
    const rebuttalPrompt = `You are an expert roofing insurance supplement specialist writing a formal rebuttal letter.

CARRIER: ${pkg.carrier_name}
CLAIM: ${pkg.claim_number || "On file"}
PROPERTY: ${jobAddress}

DENIED LINE ITEM: ${denial.line_item}
DENIAL REASON: ${denial.reason}
AMOUNT DENIED: $${denial.amount}

CARRIER BEHAVIOR PATTERNS:
${carrierIntel?.tips?.join("\n") || "Document thoroughly and cite specific code sections"}

Write a professional formal rebuttal that:
1. Acknowledges the denial professionally
2. Cites specific evidence (photos, manufacturer specs, codes)
3. References industry standards and code requirements
4. Uses carrier-appropriate language
5. Requests specific reconsideration with 14-day deadline

For common denials use these strategies:
- O&P denial: Cite homeowner cannot coordinate multiple trades
- Code denial: Cite exact IRC section and local adoption
- Matching denial: Cite Colorado matching statute if applicable
- Labor rate denial: Cite regional Xactware price list
- Line item denial: Cite manufacturer installation requirements

Respond in JSON only:
{
  "strategy": "",
  "rebuttal_letter": "",
  "evidence_to_cite": [],
  "expected_outcome": "likely_approved|possibly_approved|escalate_appraisal"
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
        max_tokens: 1500,
        messages: [{ role: "user", content: rebuttalPrompt }]
      })
    });

    const aiData = await aiRes.json();
    const aiText = aiData.content?.[0]?.text || "{}";

    let rebuttalData: Record<string, unknown>;
    try {
      rebuttalData = JSON.parse(aiText.replace(/```json|```/g, "").trim());
    } catch {
      rebuttalData = { rebuttal_letter: aiText, strategy: "standard", expected_outcome: "possibly_approved" };
    }

    const { data: savedRebuttal } = await supabase
      .from("supplement_rebuttals")
      .insert({
        supplement_package_id,
        denied_line_item: denial.line_item,
        denial_reason: denial.reason,
        denial_amount: Math.round((denial.amount || 0) * 100),
        rebuttal_strategy: rebuttalData.strategy as string,
        rebuttal_content: rebuttalData.rebuttal_letter as string,
        evidence_cited: rebuttalData.evidence_to_cite as string[] || []
      })
      .select()
      .single();

    rebuttals.push(savedRebuttal);
  }

  await supabase.from("supplement_packages")
    .update({ status: "rebuttal_submitted" })
    .eq("id", supplement_package_id);

  return Response.json({ ok: true, rebuttals_generated: rebuttals.length, rebuttals });
});

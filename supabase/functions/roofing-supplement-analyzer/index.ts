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
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-supplement-analyzer ready" });

  const { job_id, photo_ids, package_type = "pre_install" } = body;

  if (!job_id) return Response.json({ error: "job_id required" }, { status: 400 });

  const { data: job } = await supabase
    .from("roofing_jobs")
    .select("*, insurance_claims(*)")
    .eq("id", job_id)
    .single();

  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });

  // Get photos to analyze
  let photos;
  if (photo_ids?.length) {
    const { data } = await supabase.from("portal_photos").select("*").in("id", photo_ids);
    photos = data;
  } else {
    const { data } = await supabase
      .from("portal_photos")
      .select("*")
      .eq("job_id", job_id)
      .order("created_at", { ascending: false });
    photos = data;
  }

  if (!photos?.length) {
    return Response.json({ ok: true, analyzed: 0, message: "No photos to analyze" });
  }

  // Get applicable codes for CO
  const { data: codes } = await supabase.from("roofing_codes").select("*").eq("state", "CO");

  const analysisResults = [];

  for (const photo of photos) {
    if (!photo.url) continue;

    const analysisPrompt = `You are an expert roofing damage assessor analyzing a photo for insurance supplement purposes.

Analyze this roofing photo and identify:
1. Damage types visible (be specific)
2. Affected areas of the roof
3. Severity (minor/moderate/severe)
4. Xactimate line items this photo supports
5. Photo quality assessment
6. Whether retake is needed and why

Xactimate codes to look for:
- RFG HNGS: Hail damage to shingles
- RFG MISS: Missing shingles
- RFG FLSH: Damaged flashing
- RFG DECK: Exposed/damaged decking
- RFG RDGE: Damaged ridge
- RFG GRNT: Granule loss
- RFG VENT: Damaged ventilation
- RFG GKWS: Damaged gutters
- RFG DRPE: Missing drip edge

Applicable Colorado codes: ${codes?.map(c => c.code_type).join(", ") || "standard IRC"}

Respond in JSON only:
{
  "damage_types": [],
  "affected_areas": [],
  "severity": "minor|moderate|severe",
  "suggested_line_items": [{"code": "", "description": "", "confidence": 0}],
  "photo_quality": "excellent|good|acceptable|poor|unusable",
  "quality_issues": [],
  "retake_needed": false,
  "retake_instructions": null,
  "confidence_score": 0.8
}`;

    try {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: photo.url } },
              { type: "text", text: analysisPrompt }
            ]
          }]
        })
      });

      const aiData = await aiRes.json();
      const aiText = aiData.content?.[0]?.text || "{}";

      let analysis: Record<string, unknown>;
      try {
        analysis = JSON.parse(aiText.replace(/```json|```/g, "").trim());
      } catch {
        analysis = { damage_types: ["unknown"], severity: "moderate", photo_quality: "acceptable", confidence_score: 0.5 };
      }

      const { data: savedAnalysis } = await supabase
        .from("supplement_photo_analysis")
        .insert({
          job_id,
          photo_id: photo.id,
          photo_url: photo.url,
          damage_types: analysis.damage_types || [],
          affected_areas: analysis.affected_areas || [],
          severity: analysis.severity || "moderate",
          suggested_line_items: analysis.suggested_line_items || [],
          photo_quality: analysis.photo_quality || "acceptable",
          quality_issues: analysis.quality_issues || [],
          retake_needed: analysis.retake_needed || false,
          retake_instructions: analysis.retake_instructions || null,
          confidence_score: analysis.confidence_score || 0.7
        })
        .select()
        .single();

      analysisResults.push(savedAnalysis);

      if (analysis.retake_needed) {
        await supabase.from("portal_activities").insert({
          job_id,
          activity_type: "photo_retake_needed",
          title: "Photo retake needed",
          description: `One of your installation photos needs to be retaken: ${analysis.retake_instructions}`,
          description_es: "Una foto de instalación necesita ser retomada.",
          icon: "📸",
          visible_to_homeowner: false
        }).catch(() => {});
      }
    } catch (err) {
      console.error("Photo analysis error:", err);
    }
  }

  const retakesNeeded = analysisResults.filter(r => r?.retake_needed).length;

  if (retakesNeeded > 0) {
    await tg(`📸 *Photo Analysis Complete*\n${analysisResults.length} photos analyzed\n${retakesNeeded} retakes needed`);
  }

  return Response.json({
    ok: true,
    analyzed: analysisResults.length,
    results: analysisResults,
    retakes_needed: retakesNeeded
  });
});

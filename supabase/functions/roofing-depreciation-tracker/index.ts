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

async function generateReleaseLetterAndUpdate(
  job: Record<string, unknown>,
  claim: Record<string, unknown>
): Promise<void> {
  const heldAmount = ((claim.depreciation_held as number) || 0) / 100;

  const completionPrompt = `Generate a professional depreciation release request letter for a completed roofing project.

Property: ${job.property_address}
Carrier: ${claim.carrier_name}
Claim #: ${claim.claim_number || "On file"}
Held depreciation: $${heldAmount.toLocaleString()}

The letter should:
1. State the project is 100% complete
2. Request release of held depreciation
3. Reference the claim number
4. Include 14-day payment request
5. Be professional and firm

Return just the letter text.`;

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
      messages: [{ role: "user", content: completionPrompt }]
    })
  });

  const aiData = await aiRes.json();
  const letter = aiData.content?.[0]?.text || "";

  await supabase.from("depreciation_tracking")
    .update({
      completion_docs_submitted: true,
      completion_docs_submitted_at: new Date().toISOString(),
      release_requested_at: new Date().toISOString(),
      status: "submitted"
    })
    .eq("job_id", job.id as string);

  await supabase.from("portal_activities").insert({
    job_id: job.id as string,
    activity_type: "depreciation_submitted",
    title: "Final payment request submitted",
    description: `We've submitted documentation to release your held insurance funds of $${heldAmount.toLocaleString()}.`,
    description_es: "Hemos enviado documentación para liberar sus fondos de seguro retenidos.",
    icon: "💵",
    visible_to_homeowner: true
  }).catch(() => {});

  await tg(
    `💵 *Depreciation Release Submitted*\n` +
    `Job: ${job.property_address}\n` +
    `Carrier: ${claim.carrier_name}\n` +
    `Amount: $${heldAmount.toLocaleString()}\n` +
    `Letter generated and logged. VA to submit to carrier.\n\n` +
    `_Letter preview:_\n${letter.slice(0, 500)}...`
  );
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-depreciation-tracker ready" });

  // Mark a depreciation as released
  if (body.action === "mark_released" && body.job_id) {
    await supabase.from("depreciation_tracking")
      .update({ status: "released", released_at: new Date().toISOString() })
      .eq("job_id", body.job_id);
    return Response.json({ ok: true, action: "marked_released" });
  }

  if (body.action !== "scan" && body.action !== undefined) {
    return Response.json({ ok: true });
  }

  // Default action: scan all completed jobs with unreleased depreciation
  const { data: completedJobs } = await supabase
    .from("roofing_jobs")
    .select("id, property_address, status")
    .in("status", ["complete", "paid"]);

  let actionsTriggered = 0;

  for (const job of completedJobs || []) {
    const { data: claim } = await supabase
      .from("insurance_claims")
      .select("*")
      .eq("job_id", job.id)
      .maybeSingle();

    if (!claim?.depreciation_held) continue;

    const { data: deprTracking } = await supabase
      .from("depreciation_tracking")
      .select("*")
      .eq("job_id", job.id)
      .maybeSingle();

    if (deprTracking?.status === "released") continue;

    // Create tracking record if none exists
    if (!deprTracking) {
      await supabase.from("depreciation_tracking").insert({
        job_id: job.id,
        claim_id: claim.id,
        total_depreciation_held: claim.depreciation_held || 0,
        status: "pending"
      });
    }

    // If not yet submitted — generate and submit
    if (!deprTracking?.completion_docs_submitted) {
      await generateReleaseLetterAndUpdate(job, claim);
      actionsTriggered++;
      continue;
    }

    // If submitted but no response in 10 days — alert for follow-up
    const daysSinceSubmission = deprTracking.completion_docs_submitted_at
      ? (Date.now() - new Date(deprTracking.completion_docs_submitted_at).getTime()) / (1000 * 60 * 60 * 24)
      : 0;

    if (daysSinceSubmission > 10 && deprTracking.status !== "released") {
      await tg(
        `⏰ *Depreciation Follow-up Needed*\n` +
        `Job: ${job.property_address}\n` +
        `Held: $${((claim.depreciation_held || 0) / 100).toLocaleString()}\n` +
        `Submitted ${Math.round(daysSinceSubmission)} days ago.\n` +
        `Call ${claim.carrier_name} to follow up.`
      );

      await supabase.from("depreciation_tracking")
        .update({
          last_followup_at: new Date().toISOString(),
          followup_count: (deprTracking.followup_count || 0) + 1
        })
        .eq("job_id", job.id);

      actionsTriggered++;
    }
  }

  return Response.json({ ok: true, actions_triggered: actionsTriggered });
});

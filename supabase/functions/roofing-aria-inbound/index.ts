import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RETELL_API_KEY = Deno.env.get("RETELL_API_KEY")!;
const RETELL_AGENT_ID = Deno.env.get("RETELL_AGENT_ID") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-aria-inbound ready" });

  const fromNumber = body.from_number || body.from || "";
  const toNumber = body.to_number || body.to || "";

  // Check if existing homeowner (has portal session)
  const { data: existingSession } = await supabase
    .from("homeowner_sessions")
    .select("*, roofing_jobs(*)")
    .eq("homeowner_phone", fromNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Check if known lead
  const { data: existingDiagnostic } = await supabase
    .from("nexus_diagnostics")
    .select("*")
    .eq("owner_phone", fromNumber)
    .maybeSingle();

  let contactType = "unknown";
  let jobContext: Record<string, unknown> | null = null;
  let personalization = "";

  if (existingSession) {
    contactType = "existing_customer";
    jobContext = existingSession.roofing_jobs as Record<string, unknown> | null;
    const firstName = (existingSession.homeowner_name || "").split(" ")[0] || "there";
    personalization = `
This is an existing customer calling.
Name: ${existingSession.homeowner_name}
Property: ${jobContext?.property_address || "on file"}
Job status: ${jobContext?.status || "unknown"}
Start with: "Hi ${firstName}, I can see you're calling about your project at ${jobContext?.property_address || "your property"}."
If they ask about project status: ${jobContext?.status || "check with the office"}
Portal: https://roofingos.dev/portal/${existingSession.magic_link_token}
`;
  } else if (existingDiagnostic) {
    contactType = "existing_lead";
    personalization = `
This person has inquired before.
Name: ${existingDiagnostic.owner_name || "unknown"}
Start with their name if available.
`;
  }

  // Look up contractor by the number they called (graceful if table missing)
  let contractorName = "your roofing company";
  try {
    const { data: contractor } = await supabase
      .from("roofing_contractors")
      .select("company_name")
      .eq("aria_phone_number", toNumber)
      .maybeSingle();
    if (contractor?.company_name) contractorName = contractor.company_name;
  } catch {}

  const agentPrompt = `You are Aria, an AI assistant for ${contractorName}.
CRITICAL: You MUST disclose you are an AI in your first sentence.
Keep responses under 3 sentences. Always end with a question.

${personalization}

YOUR CAPABILITIES:
- Schedule free roof inspections
- Answer questions about insurance claims
- Check status of existing projects
- Send portal links via text
- Connect caller with a rep (say rep will call within the hour)
- Answer questions about storm damage

IF NEW CALLER:
"Thank you for calling ${contractorName}. This is Aria, an AI assistant. How can I help you today?"
→ Get their name and address
→ Schedule inspection or answer question
→ Offer to send confirmation text

IF EXISTING CUSTOMER: Start with their name and property. Pull their job status.

ALWAYS:
- Get their name early
- Offer to send a text confirmation
- End with clear next steps
- If they want a human: "I'll have a team member call you within the hour"`;

  // Log inbound call
  const { data: callRecord } = await supabase
    .from("roofing_inbound_calls")
    .insert({
      from_number: fromNumber,
      call_type: contactType,
      job_id: jobContext?.id as string || null
    })
    .select()
    .single();

  // Initiate via Retell (web call for inbound routing)
  const retellRes = await fetch("https://api.retellai.com/v2/create-web-call", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RETELL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: RETELL_AGENT_ID,
      metadata: {
        inbound_call_id: callRecord?.id,
        contact_type: contactType,
        contractor_name: contractorName,
        agent_prompt: agentPrompt
      }
    })
  }).catch(() => null);

  return Response.json({ ok: true, contact_type: contactType });
});

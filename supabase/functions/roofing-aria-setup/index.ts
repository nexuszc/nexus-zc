// roofing-aria-setup — one-shot: create Aria v2 LLM + agent, assign phone, fire test call
// Called once from Claude Code. Returns agent_id. Delete after use.

const RETELL_API_KEY = Deno.env.get("RETELL_API_KEY") || "";

const PHONE_NUMBER = "+17202921930";
const TEST_TO_NUMBER = "+17203948574";

async function retellGet(path: string): Promise<{ status: number; ok: boolean; data: unknown }> {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${RETELL_API_KEY}` },
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function retellPatch(path: string, body: unknown): Promise<{ status: number; ok: boolean; data: unknown }> {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${RETELL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

async function retellPost(path: string, body: unknown): Promise<{ status: number; ok: boolean; data: unknown }> {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RETELL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: res.status, ok: res.ok, data };
}

const GENERAL_PROMPT = `You are Aria, an AI voice assistant for Roofing OS. You help storm restoration roofing contractors.

Your identity: You are a roofing industry AI named Aria. You are not a call center, helpdesk, or support agent of any kind. You are a roofing specialist.

For cold_outbound_contractor:
Open with the begin_message exactly as written.
Goal: get them to look at the portal demo.
One ask only.

For homeowner_intake:
Say: Hi {{contact_name}} — this is Aria calling from {{contractor_name}}. I am an AI assistant. Your roof project at {{property_address}} was just set up. Did you get your portal link?

For storm_alert:
Say: Hi {{contact_name}} — Aria from {{contractor_name}}. Hail hit near {{property_address}} last night. Your roof is under warranty and we want to send someone to check it at no charge. Does tomorrow morning work?

For contractor_welcome:
Say: Hi {{contact_name}} — Aria from Roofing OS. Your portal is ready. Do you have a job address and homeowner phone so we can get your first portal sent right now?

OBJECTION HANDLING:
Already have software: Does it send homeowners real-time photos during installation?
How much: $49 to start. Want to see the portal while we are on the phone?
Not interested: Is it timing or does the problem not apply to you?
Send email: What is your email? Is the portal or supplement recovery more relevant right now?
I am on the roof: Can I send you a text with a link to look at when you are down?

ALWAYS:
- Under 3 sentences per response
- End every response with a question
- Never make up numbers or dates
- If they want a human say: I will have Zach call you within the hour
- Honor any opt-out immediately and permanently`;

const POST_CALL_ANALYSIS_DATA = [
  { name: "call_outcome", type: "string", description: "One of: appointment_booked, portal_sent, interested, callback_scheduled, not_interested, voicemail, no_answer, human_requested" },
  { name: "primary_objection", type: "string", description: "Main objection if call did not convert" },
  { name: "homeowner_carrier", type: "string", description: "Insurance carrier if mentioned" },
  { name: "appointment_time", type: "string", description: "Date and time if booked" },
  { name: "drop_point", type: "string", description: "Moment caller disengaged" },
  { name: "sentiment_score", type: "number", description: "1 to 10 where 1 is hostile and 10 is enthusiastic" },
  { name: "email_address", type: "string", description: "Email if provided" },
];

Deno.serve(async (req) => {
  if (!RETELL_API_KEY) {
    return Response.json({ ok: false, error: "RETELL_API_KEY not set" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const step = body.step || "all";
  const agentIdOverride = body.agent_id;
  const llmIdOverride = body.llm_id;
  const voiceIdOverride = body.voice_id || "retell-Ashley";

  const results: Record<string, unknown> = {};

  // ── DIAGNOSTIC: List voices / phones ──────────────────────────────────────
  if (step === "list_voices") {
    const { status, data } = await retellGet("/list-voices");
    return Response.json({ ok: true, status, voices: data });
  }
  if (step === "list_phones") {
    const { status, data } = await retellGet("/v2/list-phone-numbers");
    return Response.json({ ok: true, status, phones: data });
  }
  if (step === "probe_assign") {
    // Try multiple endpoint patterns to find the correct one
    const agentId = body.agent_id || "agent_d38204246ed5404f3ae8d91e24";
    const paths = [
      ["PATCH", "/update-phone-number/+17202921930"],
      ["POST", "/update-phone-number/+17202921930"],
      ["PATCH", "/v2/update-phone-number/+17202921930"],
      ["PATCH", "/v2/phone-number/+17202921930"],
    ];
    const probes: Record<string, unknown> = {};
    for (const [method, path] of paths) {
      const res = await fetch(`https://api.retellai.com${path}`, {
        method,
        headers: { "Authorization": `Bearer ${RETELL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inbound_agent_id: agentId, outbound_agent_id: agentId }),
      });
      const text = await res.text();
      probes[`${method} ${path}`] = { status: res.status, body: text.slice(0, 200) };
    }
    return Response.json({ ok: true, probes });
  }

  // ── STEP 0: Create Retell LLM ──────────────────────────────────────────────
  let llmId = llmIdOverride;
  if (!llmId && (step === "all" || step === "create")) {
    const { status, ok, data } = await retellPost("/create-retell-llm", {
      general_prompt: GENERAL_PROMPT,
      begin_message: "Hey — Aria here from Roofing OS. This call may be recorded. Quick question — are your homeowners blowing up your phone during installations?",
      post_call_analysis_data: POST_CALL_ANALYSIS_DATA,
    });

    results.create_llm = { status, data };

    if (!ok) {
      return Response.json({ ok: false, step: "create_llm", error: data, results }, { status: 500 });
    }

    llmId = (data as any)?.llm_id;
    results.llm_id = llmId;
  }

  // ── STEP 1: Create agent ───────────────────────────────────────────────────
  if (step === "all" || step === "create") {
    if (!llmId) {
      return Response.json({ ok: false, error: "llm_id required for agent creation", results }, { status: 400 });
    }

    const { status, ok, data } = await retellPost("/create-agent", {
      agent_name: "Roofing OS Aria v2",
      voice_id: voiceIdOverride,
      voice_temperature: 0.7,
      voice_speed: 0.92,
      responsiveness: 0.8,
      interruption_sensitivity: 0.5,
      enable_backchannel: true,
      language: "en-US",
      response_engine: {
        type: "retell-llm",
        llm_id: llmId,
      },
      webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-aria-webhook`,
      max_call_duration: 480,
      enable_voicemail_detection: true,
      voicemail_message: "Hey — Aria here from Roofing OS. We built something that makes your homeowners stop calling during installations. Sending you a link now. Takes 30 seconds. Talk soon.",
      end_call_after_silence_ms: 20000,
    });

    results.create_agent = { status, data };

    if (!ok) {
      return Response.json({ ok: false, step: "create_agent", error: data, results }, { status: 500 });
    }
  }

  // Determine agent_id for subsequent steps
  const agentId = agentIdOverride ||
    (results.create_agent as any)?.data?.agent_id;

  if (!agentId && (step === "assign" || step === "call" || step === "all")) {
    return Response.json({ ok: false, error: "agent_id required", results }, { status: 400 });
  }

  results.agent_id = agentId;

  // ── STEP 2: Assign phone number ────────────────────────────────────────────
  if (step === "all" || step === "assign") {
    const { status, data } = await retellPatch(`/update-phone-number/${PHONE_NUMBER}`, {
      inbound_agent_id: agentId,
      outbound_agent_id: agentId,
    });
    results.assign_phone = { status, data };
  }

  // ── STEP 3: Fire test call ─────────────────────────────────────────────────
  if (step === "all" || step === "call") {
    const { status, data } = await retellPost("/v2/create-phone-call", {
      from_number: PHONE_NUMBER,
      to_number: TEST_TO_NUMBER,
      agent_id: agentId,
    });
    results.test_call = { status, data };
  }

  return Response.json({ ok: true, agent_id: agentId, llm_id: llmId, results });
});

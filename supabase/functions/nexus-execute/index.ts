// nexus-execute — natural language to self-build pipeline
// Accepts a plain English instruction, researches it, specs it, builds it

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getTelegramChatId(): Promise<string | null> {
  const { data } = await supabase
    .from("channel_conversations")
    .select("external_id")
    .eq("channel", "telegram")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.external_id || null;
}

async function sendTelegram(chatId: string, text: string) {
  const truncated = text.length > 4000 ? text.slice(0, 3900) + "..." : text;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: truncated, parse_mode: "Markdown" }),
  });
}

async function webSearch(query: string): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  const data = await res.json();
  return (data.organic || []).map((r: { title: string; link: string; snippet: string }) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

async function claudeGenerate(prompt: string, maxTokens = 2000): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content[0].text;
}

async function auditLog(actionType: string, detail: string, data?: Record<string, unknown>) {
  await supabase.from("nexus_audit_log").insert({
    engine: "nexus-execute",
    action_type: actionType,
    action_detail: detail,
    risk_level: "low",
    autonomous: false,
    outcome: "success",
    data: data || null,
  });
}

Deno.serve(async (req) => {
  const { instruction } = await req.json();
  if (!instruction?.trim()) {
    return Response.json({ error: "instruction required" }, { status: 400 });
  }

  const chatId = await getTelegramChatId();

  try {
    await auditLog("execute_start", `Instruction: ${instruction}`, { instruction });
    if (chatId) await sendTelegram(chatId, `🔍 *Researching:* ${instruction}`);

    // Research: two passes — what it is, and how to implement it
    const [generalResults, implResults] = await Promise.all([
      webSearch(instruction),
      webSearch(`${instruction} implementation API how to build`),
    ]);
    const allResults = [...generalResults, ...implResults].slice(0, 8);

    // Generate spec
    const specPrompt = `You are the spec writer for Nexus, an AI business operating system built on Supabase Edge Functions (Deno/TypeScript).

Zach has asked Nexus to build this new ability:
"${instruction}"

Research context:
${allResults.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   URL: ${r.url}`).join("\n\n")}

Nexus chat function rules — every handler MUST follow these exactly:
- Handler shape: if (msgLower.startsWith("trigger phrase")) { ... }
- Must call: await logUsage(supabase, "ability_name", true/false, responseMs, channel)
- Must call: return earlyReturn(reply)
- Available in scope: supabase, message, msgLower, channel, earlyReturn, logUsage
- For HTTP calls: use fetch() directly — no new imports needed
- Available env vars (already declared at top of file): SUPABASE_URL, ANTHROPIC_API_KEY, SERPER_API_KEY, TELEGRAM_BOT_TOKEN
- Keep handlers self-contained — no helper functions, no new top-level declarations

Generate a complete, buildable implementation spec for this ability.

Respond with JSON only — no markdown, no backticks, no explanation:
{
  "ability_name": "snake_case_name",
  "trigger_command": "exact phrase Zach types to trigger this",
  "description": "what this ability does in 1-2 sentences",
  "value_reasoning": "why this is valuable to Nexus",
  "evidence": "what research context supports this approach",
  "estimated_complexity": "simple|medium|complex",
  "implementation_plan": "detailed step-by-step plan for the TypeScript handler — include exact Supabase queries, API calls, response format, and error handling"
}`;

    const specRaw = await claudeGenerate(specPrompt, 1500);
    const spec = JSON.parse(specRaw.replace(/```json|```/g, "").trim());

    // Save proposal as approved (skip the pending step — Zach already approved by saying build:)
    const { data: proposal, error: insertError } = await supabase
      .from("nexus_ability_proposals")
      .insert({
        ability_name: spec.ability_name,
        trigger_command: spec.trigger_command,
        description: spec.description,
        value_reasoning: spec.value_reasoning,
        evidence: spec.evidence,
        implementation_plan: spec.implementation_plan,
        estimated_complexity: spec.estimated_complexity,
        status: "approved",
        approved_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError || !proposal) {
      throw new Error(`Failed to save proposal: ${insertError?.message}`);
    }

    await auditLog("execute_spec_saved", `Spec saved: ${spec.ability_name}`, {
      proposal_id: proposal.id,
      trigger: spec.trigger_command,
    });

    if (chatId) {
      await sendTelegram(
        chatId,
        `🔨 *Building:* \`${spec.ability_name}\`\n` +
        `Trigger: \`${spec.trigger_command}\`\n` +
        `Complexity: ${spec.estimated_complexity}\n\n` +
        `_Nexus-builder is writing the handler now. I'll notify you when it's ready to test._`
      );
    }

    // Fire nexus-builder — fire and forget
    fetch(`${SUPABASE_URL}/functions/v1/nexus-builder`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ proposal_id: proposal.id, action: "build" }),
    });

    await auditLog("execute_build_triggered", `Build triggered: ${spec.ability_name}`, {
      proposal_id: proposal.id,
      trigger: spec.trigger_command,
      complexity: spec.estimated_complexity,
    });

    return Response.json({
      ok: true,
      proposal_id: proposal.id,
      ability_name: spec.ability_name,
      trigger_command: spec.trigger_command,
    });
  } catch (err) {
    const msg = String(err);
    if (chatId) await sendTelegram(chatId, `❌ *nexus-execute failed:* ${msg}`);
    await auditLog("execute_error", `Failed: ${msg}`, { instruction, error: msg });
    return Response.json({ error: msg }, { status: 500 });
  }
});

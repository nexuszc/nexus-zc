import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function draftResponse(opportunity: Record<string, string>): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `Draft a HARO response for this journalist query.

You are Zach Curtis, founder of Roofing OS, Denver CO.
Background: Built a roofing contractor software platform.
Former entrepreneur with experience in construction tech.
Straight shooter. Data-driven. Helpful.

Journalist query: ${opportunity.query_title}
Query details: ${opportunity.query_body || "No additional details"}

Rules:
- Answer the specific question asked
- Include 1-2 specific data points or examples
- Mention Roofing OS naturally ONLY if relevant
- Under 200 words
- No fluff or corporate speak
- End with: "Zach Curtis, Founder, Roofing OS (roofingos.dev)"

Write the response only. No subject line needed.`,
      }],
    }),
  });
  const d = await res.json();
  return d.content?.[0]?.text || "";
}

async function sendTelegram(msg: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT,
        text: msg,
        parse_mode: "HTML",
      }),
    });
  } catch { /* non-critical */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "seo-haro-monitor ready" }, { headers: CORS });
  }

  // Get pending opportunities that need draft responses
  const { data: opportunities } = await supabase
    .from("seo_haro_opportunities")
    .select("*")
    .eq("status", "pending")
    .is("draft_response", null)
    .limit(5);

  if (!opportunities?.length) {
    return Response.json({ ok: true, opportunities_found: 0, drafted: 0 }, { headers: CORS });
  }

  let drafted = 0;
  for (const opp of opportunities) {
    const response = await draftResponse(opp);

    try {
      await supabase
        .from("seo_haro_opportunities")
        .update({ draft_response: response, status: "draft_ready" })
        .eq("id", opp.id);
    } catch { /* non-critical */ }

    const msg = `🎯 <b>HARO Opportunity</b>

<b>Query:</b> ${opp.query_title}
<b>Category:</b> ${opp.category || "General"}
<b>Deadline:</b> ${opp.deadline || "ASAP"}

<b>Draft Response:</b>
${response.substring(0, 500)}...

Reply with "send haro ${opp.id}" to submit`;

    await sendTelegram(msg);
    drafted++;
  }

  return Response.json({
    ok: true,
    opportunities_found: opportunities.length,
    drafted,
  }, { headers: CORS });
});

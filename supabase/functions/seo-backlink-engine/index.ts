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

async function draftOutreachEmail(
  target: Record<string, unknown>,
): Promise<{ subject: string; body: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `Write a short outreach email for link building.

From: Zach Curtis, founder of Roofing OS
To: ${target.domain} (${target.page_title})
They link to: ${target.links_to_competitor}
Outreach type: ${target.outreach_type}

Goal: Get them to link to roofingos.dev or feature Roofing OS as an alternative.

Rules:
- Under 100 words
- Mention their site specifically
- One clear ask
- No spam language
- Sound like a real person
- Include offer (free account, guest post, etc)

Return JSON only:
{"subject":"email subject line","body":"email body"}`,
      }],
    }),
  });
  const d = await res.json();
  try {
    const text = d.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return {
      subject: `Roofing OS — Alternative to ${target.links_to_competitor}`,
      body: `Hi,\n\nI noticed you mention ${target.links_to_competitor} on ${target.domain}.\n\nWe just launched Roofing OS — free roofing contractor software with homeowner portals and AI supplement tracking.\n\nWould you consider adding us as an alternative?\n\nHappy to give your readers a free account.\n\nZach Curtis\nFounder, Roofing OS\nroofingos.dev`,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "seo-backlink-engine ready" }, { headers: CORS });
  }

  // Get pending targets, prioritized by domain authority
  const { data: targets } = await supabase
    .from("seo_backlink_targets")
    .select("*")
    .eq("status", "pending")
    .order("domain_authority", { ascending: false })
    .limit(body.limit || 5);

  if (!targets?.length) {
    return Response.json({ ok: true, message: "No pending targets" }, { headers: CORS });
  }

  const drafted: Array<{ domain: string; da: number; subject: string }> = [];

  for (const target of targets) {
    const email = await draftOutreachEmail(target);

    try {
      await supabase
        .from("seo_backlink_targets")
        .update({ status: "draft_ready" })
        .eq("id", target.id);

      await supabase
        .from("seo_outreach_log")
        .insert({
          target_id: target.id,
          email_to: `contact@${target.domain}`,
          subject: email.subject,
          body: email.body,
        });
    } catch { /* non-critical */ }

    drafted.push({
      domain: target.domain as string,
      da: target.domain_authority as number,
      subject: email.subject,
    });
  }

  const digestMsg = `🔗 Backlink outreach drafted for ${drafted.length} sites:\n` +
    drafted.map((d) => `• ${d.domain} (DA ${d.da}) — ${d.subject}`).join("\n") +
    "\n\nReview in dashboard → approve to send";

  try {
    await supabase.from("telegram_digest_queue").insert({
      message: digestMsg,
      category: "seo",
    });
  } catch { /* non-critical */ }

  return Response.json({ ok: true, drafted: drafted.length, targets: drafted }, { headers: CORS });
});

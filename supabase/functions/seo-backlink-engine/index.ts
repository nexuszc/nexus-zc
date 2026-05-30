import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") || "").trim();
const FROM_EMAIL = "zach@roofingos.dev";
const FROM_NAME = "Zach from Roofing OS";

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

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [to],
        subject,
        text: body,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "seo-backlink-engine ready" }, { headers: CORS });
  }

  const { data: targets } = await supabase
    .from("seo_backlink_targets")
    .select("*")
    .eq("status", "pending")
    .order("domain_authority", { ascending: false })
    .limit(body.limit || 5);

  if (!targets?.length) {
    return Response.json({ ok: true, message: "No pending targets" }, { headers: CORS });
  }

  const sent: Array<{ domain: string; da: number; subject: string; delivered: boolean }> = [];

  for (const target of targets) {
    const email = await draftOutreachEmail(target);
    const to = `contact@${target.domain}`;
    const delivered = await sendEmail(to, email.subject, email.body);

    const now = new Date().toISOString();

    try {
      await supabase
        .from("seo_backlink_targets")
        .update({ status: "sent" })
        .eq("id", target.id);

      await supabase
        .from("seo_outreach_log")
        .insert({
          target_id: target.id,
          email_to: to,
          subject: email.subject,
          body: email.body,
          sent_at: delivered ? now : null,
        });
    } catch { /* non-critical */ }

    sent.push({
      domain: target.domain as string,
      da: target.domain_authority as number,
      subject: email.subject,
      delivered,
    });
  }

  return Response.json({ ok: true, sent: sent.length, targets: sent }, { headers: CORS });
});

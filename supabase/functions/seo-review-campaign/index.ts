import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLATFORMS = [
  {
    name: "G2",
    url: "https://www.g2.com/products/roofing-os/reviews/new",
    benefit: "helps other contractors find us",
  },
  {
    name: "Capterra",
    url: "https://reviews.capterra.com/new/roofingos",
    benefit: "gets us in front of more roofers",
  },
];

async function sendReviewRequest(contractor: Record<string, string>) {
  const platform = PLATFORMS[Math.floor(Math.random() * PLATFORMS.length)];
  const firstName = (contractor.owner_name || "").split(" ")[0] || "there";

  const emailHtml = `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,sans-serif;background:#f4f6f9;padding:40px 20px">
<div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
  <div style="font-size:20px;font-weight:800;color:#0a0f1a;margin-bottom:24px">
    Roofing<span style="color:#3b82f6">OS</span>
  </div>
  <p style="color:#374151;font-size:16px;line-height:1.6">Hey ${firstName},</p>
  <p style="color:#374151;font-size:16px;line-height:1.6">
    Quick ask — would you leave us a review on ${platform.name}?
    Takes 2 minutes and ${platform.benefit}.
  </p>
  <p style="text-align:center;margin:32px 0">
    <a href="${platform.url}"
      style="background:#3b82f6;color:#fff;padding:14px 28px;border-radius:8px;
      text-decoration:none;font-weight:700;font-size:16px">
      Leave a Review on ${platform.name} →
    </a>
  </p>
  <p style="color:#6b7280;font-size:14px">
    Thanks for being a Roofing OS contractor. Your feedback genuinely helps us improve.
  </p>
  <p style="color:#374151;font-size:14px;margin-top:16px">
    — Zach<br>Founder, Roofing OS
  </p>
</div>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Zach from Roofing OS <zach@roofingos.dev>",
      to: contractor.owner_email,
      subject: "Quick favor — 2 minute review?",
      html: emailHtml,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "seo-review-campaign ready" }, { headers: CORS });
  }

  // Get real paid contractors (exclude test/internal accounts)
  const { data: contractors } = await supabase
    .from("contractor_accounts")
    .select("owner_email, owner_name, company_name")
    .not("owner_email", "ilike", "%test%")
    .not("owner_email", "ilike", "%nexuszc%")
    .not("owner_email", "is", null)
    .limit(10);

  let sent = 0;
  const errors: string[] = [];

  for (const contractor of (contractors || [])) {
    try {
      await sendReviewRequest(contractor);
      sent++;
    } catch (e) {
      errors.push(`${contractor.owner_email}: ${(e as Error).message}`);
    }
  }

  return Response.json({ ok: true, sent, errors }, { headers: CORS });
});

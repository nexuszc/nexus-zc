// contractor-welcome-sequence v1
// Cron: daily at 14:00 UTC
// Sends a 3-email onboarding drip to new contractors: day 0 (same day), day 2, day 5

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY            = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL                = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME                 = Deno.env.get("RESEND_FROM_NAME")  || "Zach @ Roofing OS";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PHYSICAL_ADDRESS = "Roofing OS · 1700 Lincoln St · Denver, CO 80203";
const UNSUBSCRIBE_URL  = "https://roofingos.dev/unsubscribe";

function unsubFooter(email: string) {
  return `<p style="font-size:11px;color:#888;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
  ${PHYSICAL_ADDRESS}<br>
  <a href="${UNSUBSCRIBE_URL}?email=${encodeURIComponent(email)}" style="color:#888;">Unsubscribe</a>
</p>`;
}

const EMAILS: Record<number, {
  subject: string;
  html: (name: string, companyName: string, contractorId: string, email: string) => string;
}> = {
  0: {
    subject: "you're in — here's your first move",
    html: (name, companyName, cid, email) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111;line-height:1.6;">
  <p style="font-size:16px;">Hey ${name || "there"},</p>
  <p>Welcome to Roofing OS. You just signed up — now let's make sure you actually get value from it.</p>
  <p><strong>Your first move: add a job.</strong></p>
  <p>Takes 30 seconds. You enter a homeowner name and address, and they instantly get a portal link — so they can track their job in real time. That one thing eliminates 90% of "where are we at" calls.</p>
  <p style="margin:24px 0;">
    <a href="https://app.nexuszc.com/roofing/jobs/new" style="background:#4a9eff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Add Your First Job →</a>
  </p>
  <p>Reply to this email if you run into anything. I check it.</p>
  <p>— Zach</p>
  ${unsubFooter(email)}
</div>`
  },
  2: {
    subject: "did you add that job yet?",
    html: (name, companyName, cid, email) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111;line-height:1.6;">
  <p style="font-size:16px;">Hey ${name || "there"},</p>
  <p>You signed up for Roofing OS 2 days ago. Checking in.</p>
  <p>The most common thing I hear from contractors who "tried it and moved on" is: they never added a job. They signed up, poked around, and left.</p>
  <p>The ones who stick — they added a job in the first 24 hours, sent a portal link, and got a text from their homeowner saying "this is awesome." That's it. That's the moment.</p>
  <p style="margin:24px 0;">
    <a href="https://app.nexuszc.com/roofing/jobs/new" style="background:#4a9eff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Add a Job Right Now →</a>
  </p>
  <p>Two minutes. Promise.</p>
  <p>— Zach</p>
  ${unsubFooter(email)}
</div>`
  },
  5: {
    subject: "5 days in — what do you need?",
    html: (name, companyName, cid, email) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111;line-height:1.6;">
  <p style="font-size:16px;">Hey ${name || "there"},</p>
  <p>It's been 5 days. Quick check-in.</p>
  <p>Three things worth knowing at this point:</p>
  <ol>
    <li style="margin-bottom:8px;"><strong>Homeowner portal</strong> — if you've got a job in progress right now, send the portal link today. It takes 30 seconds and your homeowner will love you for it.</li>
    <li style="margin-bottom:8px;"><strong>Supplement tracker</strong> — if you're doing insurance work, the supplement tab in each job helps you track held back line items and get them paid.</li>
    <li style="margin-bottom:8px;"><strong>Aria (AI calling)</strong> — not live for everyone yet, but if you want to be first in line when we launch outbound calling for your market, reply "Aria" and I'll add you to the list.</li>
  </ol>
  <p style="margin:24px 0;">
    <a href="https://app.nexuszc.com/roofing/jobs" style="background:#4a9eff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Open Your Dashboard →</a>
  </p>
  <p>What do you need help with? Just reply.</p>
  <p>— Zach</p>
  ${unsubFooter(email)}
</div>`
  },
};

async function alreadySent(contractorId: string, day: number): Promise<boolean> {
  const { count } = await supabase
    .from("nexus_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("engine", "contractor-welcome-sequence")
    .eq("action_detail", `${contractorId}:day${day}`);
  return (count || 0) > 0;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to, subject, html }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "contractor-welcome-sequence v1 ready" });

  const now = Date.now();
  const sent: string[] = [];
  const skipped: string[] = [];

  try {
    // Find contractors to email at each day checkpoint
    for (const [dayNum, email] of Object.entries(EMAILS)) {
      const day = Number(dayNum);
      // Match contractors created between (day * 24h) and ((day + 1) * 24h) ago
      const windowStart = new Date(now - (day + 1) * 86400000).toISOString();
      const windowEnd   = new Date(now - day * 86400000).toISOString();

      const { data: contractors } = await supabase
        .from("contractor_accounts")
        .select("id, owner_name, company_name, owner_email")
        .gte("created_at", windowStart)
        .lt("created_at", windowEnd)
        .eq("status", "active")
        .neq("is_test_account", true)
        .not("owner_email", "is", null);

      for (const c of contractors || []) {
        if (!c.owner_email) continue;

        // Dedup check
        if (await alreadySent(c.id, day)) {
          skipped.push(`${c.owner_email}:day${day}`);
          continue;
        }

        const firstName = (c.owner_name || "").split(" ")[0] || "";
        const html = email.html(firstName, c.company_name || "", c.id, c.owner_email);
        const ok = await sendEmail(c.owner_email, email.subject, html);

        // Log regardless of send success to prevent double-sends
        await supabase.from("nexus_audit_log").insert({
          engine: "contractor-welcome-sequence",
          action_type: "welcome_email_sent",
          action_detail: `${c.id}:day${day}`,
          outcome: ok ? "success" : "failure",
          data: { email: c.owner_email, day, subject: email.subject },
        }).catch(() => {});

        if (ok) sent.push(`${c.owner_email}:day${day}`);
      }
    }

    return Response.json({ ok: true, sent: sent.length, skipped: skipped.length, emails: sent });

  } catch (err) {
    console.error("contractor-welcome-sequence error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});

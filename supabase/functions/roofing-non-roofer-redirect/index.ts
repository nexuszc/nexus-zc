// roofing-non-roofer-redirect v1
// Sends redirect email to contractor_accounts that don't look like roofers.
// Trigger 1: new signup (< 2h old) where company_name has no roofing keywords
// Trigger 2: account > 48h old with 0 jobs and no email sent yet
// Runs hourly via pg_cron. Template: email_templates.name = 'non_roofer_redirect'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = (Deno.env.get("RESEND_API_KEY") || "").replace(/[^\x20-\x7E]/g, "").trim();
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "zach@roofingos.dev";
const FROM_NAME  = Deno.env.get("RESEND_FROM_NAME")  || "Zach @ Roofing OS";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const ROOFER_KEYWORDS = ["roofing", "roof", "restoration", "storm", "construction", "contracting", "contractor", "exterior", "siding", "gutter"];

function isLikelyRoofer(companyName: string | null): boolean {
  if (!companyName) return false;
  const lower = companyName.toLowerCase();
  return ROOFER_KEYWORDS.some(k => lower.includes(k));
}

function firstName(name: string | null | undefined): string {
  return (name || "").split(" ")[0] || "there";
}

async function sendRedirectEmail(email: string, name: string, referralCode: string, templateHtml: string, templateText: string, subject: string): Promise<boolean> {
  const fn = firstName(name);
  const code = referralCode || "ROOFINGOS";
  const html = templateHtml
    .replace(/\[firstName\]/gi, fn)
    .replace(/\[referral_code\]/gi, code);
  const text = templateText
    .replace(/\[firstName\]/gi, fn)
    .replace(/\[referral_code\]/gi, code);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        reply_to: FROM_EMAIL,
        to: [email],
        subject,
        html,
        text,
      }),
    });
    const data = await res.json();
    return !!data.id;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.test) return Response.json({ ok: true, message: "roofing-non-roofer-redirect v1 ready" });

    const startMs = Date.now();
    const now = new Date();

    // Fetch template once
    const { data: tmpl } = await supabase
      .from("email_templates")
      .select("subject, body_html, body_text")
      .eq("name", "non_roofer_redirect")
      .single();

    if (!tmpl) {
      return Response.json({ ok: false, error: "non_roofer_redirect template not found" }, { status: 500 });
    }

    // Find candidates: new non-roofer signups OR 48h no-job accounts
    const cutoff48h = new Date(now.getTime() - 48 * 3600 * 1000).toISOString();
    const cutoff2h  = new Date(now.getTime() -  2 * 3600 * 1000).toISOString();

    const { data: candidates } = await supabase
      .from("contractor_accounts")
      .select("id, company_name, owner_name, owner_email, referral_code, created_at, jobs_used, first_job_created_at")
      .eq("non_roofer_email_sent", false)
      .not("owner_email", "is", null)
      .or(`created_at.gte.${cutoff2h},created_at.lte.${cutoff48h}`)
      .limit(50);

    if (!candidates?.length) {
      return Response.json({ ok: true, sent: 0, skipped: 0, message: "no candidates" });
    }

    let sent = 0, skipped = 0;

    for (const acct of candidates) {
      const isNew = new Date(acct.created_at) >= new Date(cutoff2h);
      const isOld = new Date(acct.created_at) <= new Date(cutoff48h);
      const hasNoJobs = !acct.first_job_created_at && (acct.jobs_used ?? 0) === 0;

      const sendBecauseNonRoofer = isNew && !isLikelyRoofer(acct.company_name);
      const sendBecauseNoJobs    = isOld && hasNoJobs;

      if (!sendBecauseNonRoofer && !sendBecauseNoJobs) {
        skipped++;
        continue;
      }

      // Generate referral code if missing
      let code = acct.referral_code;
      if (!code) {
        code = (acct.company_name || "USER").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase() || acct.id.slice(0, 8).toUpperCase();
        await supabase.from("contractor_accounts").update({ referral_code: code }).eq("id", acct.id);
      }

      const ok = await sendRedirectEmail(acct.owner_email, acct.owner_name, code, tmpl.body_html, tmpl.body_text, tmpl.subject);
      if (ok) {
        await supabase.from("contractor_accounts").update({ non_roofer_email_sent: true }).eq("id", acct.id);
        sent++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    return Response.json({ ok: true, sent, skipped, candidates: candidates.length, duration_ms: Date.now() - startMs });

  } catch (fatal) {
    console.error("roofing-non-roofer-redirect fatal:", fatal);
    return Response.json({ ok: false, error: String(fatal) }, { status: 500 });
  }
});

// One-shot: send pending roofing_partnership_targets via Resend
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "send-partnership-emails v2 ready" });

  if (body.debug) {
    const { data, error } = await supabase
      .from("roofing_partnership_targets")
      .select("id, name, sent_at, status");
    return Response.json({ data, error, resend_key_set: Boolean(RESEND_KEY) });
  }

  const { data: targets, error: qErr } = await supabase
    .from("roofing_partnership_targets")
    .select("id, name, email, subject, body")
    .is("sent_at", null)
    .order("created_at");

  if (qErr) return Response.json({ ok: false, error: qErr.message }, { status: 500 });
  if (!targets || targets.length === 0) {
    return Response.json({ ok: true, sent: 0, message: "no pending targets" });
  }

  const results: { name: string; email: string; success: boolean; error?: string }[] = [];

  for (const t of targets) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Zach Curtis <zach@nexuszc.com>",
        to: [t.email],
        subject: t.subject,
        text: t.body,
      }),
    });
    const data = await res.json();

    if (data.id) {
      await supabase
        .from("roofing_partnership_targets")
        .update({ sent_at: new Date().toISOString(), status: "sent" })
        .eq("id", t.id);
      results.push({ name: t.name, email: t.email, success: true });
    } else {
      results.push({ name: t.name, email: t.email, success: false, error: data.message || JSON.stringify(data) });
    }
  }

  return Response.json({ ok: true, sent: results.filter(r => r.success).length, results });
});

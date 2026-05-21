// ae-tasks v1
// All AE task operations. Token validation on every request.
// POST { token, action: "get" }                           → today's tasks + stats
// POST { token, action: "complete", task_id }             → mark done
// POST { token, action: "escalate", task_id, reason }     → escalate + Telegram

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_CHAT_ID   = Deno.env.get("TELEGRAM_CHAT_ID") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function validateToken(token: string): Promise<{ valid: boolean; ae?: any }> {
  const { data: session } = await supabase
    .from("ae_sessions")
    .select("id, expires_at, ae_accounts(name, email)")
    .eq("token", token)
    .maybeSingle();

  if (!session || new Date(session.expires_at) < new Date()) return { valid: false };
  return { valid: true, ae: session.ae_accounts };
}

async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    // Try dynamic chat ID fallback
    const { data: row } = await supabase
      .from("channel_conversations")
      .select("external_id")
      .eq("channel", "telegram")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row?.external_id) return;
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: row.external_id, text: text.slice(0, 4000) }),
    }).catch(() => {});
    return;
  }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000) }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "ae-tasks v1 ready" }, { headers: cors });

  const { token, action, task_id, reason } = body;
  if (!token) return Response.json({ error: "token required" }, { status: 401, headers: cors });

  const { valid, ae } = await validateToken(token);
  if (!valid) return Response.json({ error: "invalid_token" }, { status: 401, headers: cors });

  const today = new Date().toISOString().slice(0, 10);

  // ── GET ────────────────────────────────────────────────────────────────
  if (action === "get" || !action) {
    const [{ data: tasks }, { count: signupsToday }] = await Promise.all([
      supabase
        .from("roofing_va_tasks")
        .select("*")
        .eq("date", today)
        .eq("assigned_to", "ae")
        .order("priority")
        .order("created_at"),
      supabase
        .from("contractor_accounts")
        .select("*", { count: "exact", head: true })
        .gte("created_at", today + "T00:00:00Z"),
    ]);

    const all       = tasks || [];
    const done      = all.filter(t => t.status === "completed").length;
    const remaining = all.filter(t => t.status === "pending").length;
    const totalMins = all.filter(t => t.status === "pending")
      .reduce((s, t) => s + (t.time_estimate_minutes || 0), 0);

    return Response.json({
      ok: true,
      ae,
      tasks: all,
      stats: {
        done,
        remaining,
        signups_today: signupsToday || 0,
        est_hours: +(totalMins / 60).toFixed(1),
      },
    }, { headers: cors });
  }

  // ── COMPLETE ───────────────────────────────────────────────────────────
  if (action === "complete") {
    if (!task_id) return Response.json({ error: "task_id required" }, { status: 400, headers: cors });

    await supabase
      .from("roofing_va_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString(), completed_by: ae?.email })
      .eq("id", task_id);

    return Response.json({ ok: true }, { headers: cors });
  }

  // ── ESCALATE ──────────────────────────────────────────────────────────
  if (action === "escalate") {
    if (!task_id) return Response.json({ error: "task_id required" }, { status: 400, headers: cors });

    const { data: task } = await supabase
      .from("roofing_va_tasks")
      .select("title, task_type, copy_text, steps")
      .eq("id", task_id)
      .maybeSingle();

    await supabase
      .from("roofing_va_tasks")
      .update({
        status:              "escalated",
        escalated_at:        new Date().toISOString(),
        escalation_reason:   reason || "No reason provided",
        escalation_status:   "pending",
      })
      .eq("id", task_id);

    if (task) {
      const isHotLead    = task.task_type === "hot_lead_followup";
      const isPartnership = task.task_type === "partnership_followup";
      let extraLine = "";
      if (isHotLead) {
        const stepsText = JSON.stringify(task.steps || []);
        const phoneMatch = stepsText.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
        const nameMatch  = (task.steps as any[])?.[0]?.match(/Call (.+?) at/);
        if (phoneMatch || nameMatch) {
          extraLine = `\nContact: ${nameMatch?.[1] || "—"} ${phoneMatch?.[0] || ""}`.trimEnd();
        }
      }
      if (isPartnership) {
        extraLine = `\nPartner: ${task.title}`;
      }

      const msg = `⚠️ AE escalation — needs your attention

Task: ${task.title}
Type: ${task.task_type}

What happened:
${reason || "No reason provided"}${extraLine}

Handle at app.nexuszc.com/roofing`;

      await sendTelegram(msg);
    }

    return Response.json({ ok: true }, { headers: cors });
  }

  // ── ZACH RESOLVE ──────────────────────────────────────────────────────
  if (action === "resolve_escalation") {
    if (!task_id) return Response.json({ error: "task_id required" }, { status: 400, headers: cors });
    const resolution = body.resolution || "resolved"; // "resolved" | "reassign" | "dismissed"

    if (resolution === "reassign") {
      // Create a new task for the AE
      const { data: orig } = await supabase
        .from("roofing_va_tasks")
        .select("*")
        .eq("id", task_id)
        .maybeSingle();
      if (orig) {
        await supabase.from("roofing_va_tasks").insert({
          date:                 new Date().toISOString().slice(0, 10),
          task_type:            orig.task_type,
          title:                orig.title,
          description:          orig.description,
          steps:                orig.steps,
          copy_text:            orig.copy_text,
          priority:             orig.priority,
          time_estimate_minutes: orig.time_estimate_minutes,
        });
      }
    }

    const esStatus = resolution === "reassign" ? "reassigned" :
                     resolution === "dismissed" ? "dismissed" : "resolved";

    await supabase
      .from("roofing_va_tasks")
      .update({ escalation_status: esStatus })
      .eq("id", task_id);

    return Response.json({ ok: true }, { headers: cors });
  }

  return Response.json({ error: "unknown action" }, { status: 400, headers: cors });
});

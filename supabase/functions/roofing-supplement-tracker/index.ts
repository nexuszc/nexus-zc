import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-supplement-tracker ready" });

  const { action, package_id, adjuster_response, approved_amount, denied_items } = body;

  // Mark package as submitted to adjuster
  if (action === "mark_submitted" && package_id) {
    await supabase.from("supplement_packages")
      .update({ status: "submitted", submitted_to_adjuster_at: new Date().toISOString() })
      .eq("id", package_id);
    return Response.json({ ok: true, action: "marked_submitted" });
  }

  // Record adjuster response (partial/full approval or denial)
  if (action === "record_response" && package_id) {
    const update: Record<string, unknown> = {
      adjuster_response_at: new Date().toISOString(),
      outcome_notes: adjuster_response || ""
    };

    if (approved_amount != null) {
      update.supplement_approved_amount = Math.round(approved_amount * 100);
      if (denied_items?.length) {
        update.supplement_denied_amount = (denied_items as any[]).reduce(
          (s: number, i: any) => s + Math.round((i.amount || 0) * 100), 0
        );
        update.status = "partial_approved";
      } else {
        update.status = "approved";
      }
    } else {
      update.status = "denied";
    }

    const { data: pkg } = await supabase.from("supplement_packages")
      .update(update).eq("id", package_id).select().single();

    if (pkg) {
      // Update carrier intelligence totals
      await supabase.from("carrier_intelligence")
        .update({
          total_supplements: supabase.rpc ? undefined : undefined,
          last_updated: new Date().toISOString()
        })
        .eq("carrier_type", pkg.carrier_type || "other")
        .catch(() => {});

      // Trigger referral engine on approval
      if ((outcome === "approved" || outcome === "partial_approved") && pkg.contractor_id) {
        fetch(`${SUPABASE_URL}/functions/v1/roofing-referral-engine`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger: "supplement_approved",
            package_id,
            contractor_id: pkg.contractor_id
          })
        }).catch(() => {});
      }
    }

    return Response.json({ ok: true, action: "response_recorded", status: update.status });
  }

  // List all pending supplements
  if (action === "list_pending") {
    const { data: pending } = await supabase
      .from("supplement_packages")
      .select("id, job_id, carrier_name, status, supplement_requested_amount, submitted_to_adjuster_at, adjuster_name")
      .in("status", ["va_review", "submitted", "partial_approved"])
      .order("created_at", { ascending: false });

    return Response.json({ ok: true, pending: pending || [] });
  }

  return Response.json({ ok: true });
});

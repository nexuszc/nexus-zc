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
  if (body.test) return Response.json({ ok: true, message: "roofing-material-order ready" });

  const { action } = body;

  switch (action) {

    case "create_order": {
      const { job_id, supplier, items, delivery_date, delivery_address } = body;
      if (!job_id || !supplier) return Response.json({ error: "job_id and supplier required" }, { status: 400 });

      const totalAmount = (items || []).reduce(
        (sum: number, item: Record<string, unknown>) => sum + ((item.total as number) || 0), 0
      );

      const { data: order } = await supabase.from("material_orders").insert({
        job_id,
        supplier,
        items: items || [],
        total_amount: totalAmount,
        delivery_date,
        delivery_address,
        status: "submitted",
        ordered_at: new Date().toISOString()
      }).select().single();

      // Update job status
      await supabase.from("roofing_jobs").update({ status: "materials_ordered" }).eq("id", job_id);

      // Portal activity
      await fetch(`${SUPABASE_URL}/functions/v1/portal-activity-generator`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id,
          activity_type: "materials_ordered",
          metadata: {
            material: (items as any)?.[0]?.description || "materials",
            delivery_date
          }
        })
      }).catch(() => {});

      // Update job financials
      await supabase.from("job_financials")
        .update({ material_cost: totalAmount })
        .eq("job_id", job_id);

      await tg(
        `📦 *Materials Ordered*\n` +
        `Supplier: ${supplier}\n` +
        `Total: $${(totalAmount / 100).toLocaleString()}\n` +
        `Delivery: ${delivery_date || "TBD"}`
      );

      return Response.json({ ok: true, order_id: order?.id });
    }

    case "confirm_delivery": {
      const { order_id, job_id, notes } = body;
      if (!order_id) return Response.json({ error: "order_id required" }, { status: 400 });

      await supabase.from("material_orders").update({
        status: "delivered",
        delivery_confirmed: true,
        delivery_confirmed_at: new Date().toISOString(),
        notes: notes || null
      }).eq("id", order_id);

      if (job_id) {
        await fetch(`${SUPABASE_URL}/functions/v1/portal-activity-generator`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            job_id,
            activity_type: "materials_ordered",
            metadata: { delivery_date: "today" }
          })
        }).catch(() => {});
      }

      return Response.json({ ok: true });
    }

    case "report_issue": {
      const { order_id, issue_description } = body;
      if (!order_id) return Response.json({ error: "order_id required" }, { status: 400 });

      await supabase.from("material_orders")
        .update({ status: "issue", notes: issue_description })
        .eq("id", order_id);

      await tg(
        `⚠️ *Material Delivery Issue*\n` +
        `Order: ${(order_id as string).slice(0, 8)}\n` +
        `Issue: ${issue_description}\n` +
        `Contact supplier immediately.`
      );

      return Response.json({ ok: true });
    }

    case "list": {
      const { job_id } = body;
      const query = supabase.from("material_orders").select("*").order("created_at", { ascending: false }).limit(20);
      if (job_id) query.eq("job_id", job_id);
      const { data: orders } = await query;
      return Response.json({ ok: true, orders: orders || [] });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
});

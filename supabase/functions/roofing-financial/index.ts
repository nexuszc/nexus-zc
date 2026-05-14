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
  if (body.test) return Response.json({ ok: true, message: "roofing-financial ready" });

  const { action } = body;

  switch (action) {

    case "dashboard": {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [{ data: jobs }, { data: financials }, { data: supplements }] = await Promise.all([
        supabase.from("roofing_jobs").select("status, contract_amount, created_at").gte("created_at", thirtyDaysAgo),
        supabase.from("job_financials").select("total_revenue, gross_profit, total_collected, amount_outstanding"),
        supabase.from("supplement_packages")
          .select("supplement_requested_amount, supplement_approved_amount, status")
          .gte("created_at", thirtyDaysAgo)
      ]);

      const totalRevenue = (financials || []).reduce((s, f) => s + (f.total_revenue || 0), 0);
      const totalProfit = (financials || []).reduce((s, f) => s + (f.gross_profit || 0), 0);
      const totalCollected = (financials || []).reduce((s, f) => s + (f.total_collected || 0), 0);
      const outstanding = (financials || []).reduce((s, f) => s + (f.amount_outstanding || 0), 0);
      const supplementRevenue = (supplements || [])
        .filter(s => s.status === "approved")
        .reduce((s, r) => s + (r.supplement_approved_amount || 0), 0);
      const pipeline = (jobs || []).reduce(
        (s, j) => ["contracted", "in_progress", "complete"].includes(j.status)
          ? s + Math.round((j.contract_amount || 0) * 100)
          : s, 0
      );

      const activeJobs = (jobs || []).filter(j => !["cancelled", "paid"].includes(j.status)).length;
      const paidJobs = (jobs || []).filter(j => j.status === "paid").length;

      return Response.json({
        ok: true,
        period: "30_days",
        revenue: totalRevenue,
        profit: totalProfit,
        collected: totalCollected,
        outstanding,
        supplement_revenue: supplementRevenue,
        pipeline,
        avg_margin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
        active_jobs: activeJobs,
        paid_jobs: paidJobs
      });
    }

    case "cash_flow": {
      const { data: activeJobs } = await supabase
        .from("roofing_jobs")
        .select("id, contract_amount, scheduled_end, scheduled_start, status")
        .in("status", ["contracted", "materials_ordered", "scheduled", "in_progress"]);

      const byMonth: Record<string, number> = {};

      for (const job of activeJobs || []) {
        const expectedDate = job.scheduled_end
          || job.scheduled_start
          || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const month = (expectedDate as string).slice(0, 7);
        if (!byMonth[month]) byMonth[month] = 0;
        byMonth[month] += Math.round((job.contract_amount || 0) * 100);
      }

      return Response.json({
        ok: true,
        projection: byMonth,
        total_projected: Object.values(byMonth).reduce((s, v) => s + v, 0),
        jobs_in_pipeline: (activeJobs || []).length
      });
    }

    case "pay_sub": {
      const { sub_assignment_id, amount } = body;
      if (!sub_assignment_id || !amount) {
        return Response.json({ error: "sub_assignment_id and amount required" }, { status: 400 });
      }

      await supabase.from("sub_assignments").update({
        paid_at: new Date().toISOString(),
        payment_amount: amount,
        status: "paid"
      }).eq("id", sub_assignment_id);

      const { data: assignment } = await supabase
        .from("sub_assignments")
        .select("*, roofing_subcontractors(company_name, email, contact_name)")
        .eq("id", sub_assignment_id)
        .single();

      const sub = assignment?.roofing_subcontractors as Record<string, unknown>;

      await tg(
        `💸 *Sub Payment Recorded*\n` +
        `Sub: ${(sub?.company_name as string) || "Unknown"}\n` +
        `Amount: $${(amount / 100).toLocaleString()}\n` +
        (sub?.email ? `Lien waiver request: ${sub.email}` : "No email on file")
      );

      // Mark lien waiver needed
      await supabase.from("sub_assignments")
        .update({ lien_waiver_required: true })
        .eq("id", sub_assignment_id);

      return Response.json({ ok: true });
    }

    case "job_report": {
      const { job_id } = body;
      if (!job_id) return Response.json({ error: "job_id required" }, { status: 400 });

      const [{ data: job }, { data: fin }, { data: orders }, { data: subs }] = await Promise.all([
        supabase.from("roofing_jobs").select("property_address, status, contract_amount").eq("id", job_id).single(),
        supabase.from("job_financials").select("*").eq("job_id", job_id).maybeSingle(),
        supabase.from("material_orders").select("total_amount, status").eq("job_id", job_id),
        supabase.from("sub_assignments").select("agreed_amount, payment_amount, status").eq("job_id", job_id)
      ]);

      return Response.json({
        ok: true,
        job: { address: job?.property_address, status: job?.status, contract: job?.contract_amount },
        financials: fin,
        material_orders: orders,
        sub_assignments: subs
      });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-analytics ready" });

  const { action, period_days = 30 } = body;

  switch (action) {

    case "rep_performance": {
      const since = new Date(
        Date.now() - period_days * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: jobs } = await supabase
        .from("roofing_jobs")
        .select("id, sales_rep_id, status, contract_amount, created_at")
        .gte("created_at", since)
        .not("sales_rep_id", "is", null);

      const byRep: Record<string, { signed: number; revenue: number; total: number }> = {};

      for (const job of jobs || []) {
        const repId = job.sales_rep_id as string;
        if (!byRep[repId]) byRep[repId] = { signed: 0, revenue: 0, total: 0 };
        byRep[repId].total++;
        if (!["lead", "cancelled"].includes(job.status)) {
          byRep[repId].signed++;
          byRep[repId].revenue += job.contract_amount || 0;
        }
      }

      const repReports = [];
      const periodStart = new Date(Date.now() - period_days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const periodEnd = new Date().toISOString().split("T")[0];

      for (const [repId, stats] of Object.entries(byRep)) {
        const closeRate = stats.total > 0 ? stats.signed / stats.total : 0;
        const avgJobValue = stats.signed > 0 ? stats.revenue / stats.signed : 0;

        repReports.push({
          rep_id: repId,
          name: repId.slice(0, 8),
          total_jobs: stats.total,
          signed: stats.signed,
          close_rate: Math.round(closeRate * 100),
          total_revenue: stats.revenue,
          avg_job_value: Math.round(avgJobValue)
        });

        await supabase.from("rep_analytics").insert({
          rep_id: repId,
          period_start: periodStart,
          period_end: periodEnd,
          leads_generated: stats.total,
          contracts_signed: stats.signed,
          close_rate: closeRate,
          avg_job_value: Math.round(avgJobValue),
          total_revenue: stats.revenue
        });
      }

      repReports.sort((a, b) => b.total_revenue - a.total_revenue);

      return Response.json({ ok: true, period_days, reps: repReports });
    }

    case "market_penetration": {
      const { data: jobs } = await supabase
        .from("roofing_jobs")
        .select("zip_code, contract_amount, status")
        .not("zip_code", "is", null);

      const byZip: Record<string, { jobs: number; revenue: number }> = {};

      for (const job of jobs || []) {
        const zip = job.zip_code as string;
        if (!byZip[zip]) byZip[zip] = { jobs: 0, revenue: 0 };
        byZip[zip].jobs++;
        byZip[zip].revenue += job.contract_amount || 0;
      }

      for (const [zip, data] of Object.entries(byZip)) {
        await supabase.from("market_intelligence")
          .upsert({
            zip_code: zip,
            jobs_completed: data.jobs,
            avg_job_value: data.jobs > 0 ? Math.round(data.revenue / data.jobs) : 0,
            last_updated: new Date().toISOString()
          }, { onConflict: "zip_code" });
      }

      return Response.json({
        ok: true,
        markets: Object.keys(byZip).length,
        top_markets: Object.entries(byZip)
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 10)
          .map(([zip, data]) => ({ zip, ...data }))
      });
    }

    case "pricing_analysis": {
      const { data: jobs } = await supabase
        .from("roofing_jobs")
        .select("contract_amount, status, zip_code, material_type")
        .in("status", ["contracted", "complete", "paid"]);

      const pricePoints: Record<string, { count: number; total: number }> = {};

      for (const job of jobs || []) {
        const bracket = Math.floor((job.contract_amount || 0) / 2000) * 2000;
        const key = `$${bracket.toLocaleString()}-$${(bracket + 2000).toLocaleString()}`;
        if (!pricePoints[key]) pricePoints[key] = { count: 0, total: 0 };
        pricePoints[key].count++;
        pricePoints[key].total += job.contract_amount || 0;
      }

      return Response.json({
        ok: true,
        price_distribution: pricePoints,
        avg_contract: (jobs?.length || 0) > 0
          ? (jobs!.reduce((s, j) => s + (j.contract_amount || 0), 0) / jobs!.length).toFixed(0)
          : 0
      });
    }

    case "supplement_performance": {
      const { data: packages } = await supabase
        .from("supplement_packages")
        .select("carrier_name, carrier_type, status, supplement_requested_amount, supplement_approved_amount");

      const byCarrier: Record<string, {
        submitted: number; approved: number; denied: number;
        requested: number; approved_amount: number;
      }> = {};

      for (const pkg of packages || []) {
        const carrier = pkg.carrier_name || "Unknown";
        if (!byCarrier[carrier]) {
          byCarrier[carrier] = { submitted: 0, approved: 0, denied: 0, requested: 0, approved_amount: 0 };
        }
        byCarrier[carrier].submitted++;
        byCarrier[carrier].requested += pkg.supplement_requested_amount || 0;
        if (pkg.status === "approved") {
          byCarrier[carrier].approved++;
          byCarrier[carrier].approved_amount += pkg.supplement_approved_amount || 0;
        }
        if (pkg.status === "denied") byCarrier[carrier].denied++;
      }

      return Response.json({ ok: true, by_carrier: byCarrier });
    }

    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
});

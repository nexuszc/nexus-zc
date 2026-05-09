import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { action, job_id, contractor_id, data } = await req.json();

  switch (action) {

    case "generate_estimate": {
      const { data: job } = await supabase.from("roofing_jobs").select("*, clients(name, brand_name, phone)").eq("id", job_id).single();
      if (!job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });
      const { data: materials } = await supabase.from("material_selections").select("*").eq("job_id", job_id);

      const prompt = `Generate a professional roofing estimate.

CONTRACTOR: ${job.clients?.brand_name || job.clients?.name}
HOMEOWNER: ${job.homeowner_name}
PROPERTY: ${job.property_address}
JOB TYPE: ${job.job_type}
ROOF SIZE: ${job.roof_size_squares || "TBD"} squares
MATERIAL: ${job.material_type} — ${job.shingle_brand || ""} ${job.shingle_color || ""}
MATERIALS LIST: ${materials?.map((m: any) => `${m.product_name}: ${m.quantity} ${m.unit} @ $${m.unit_cost}`).join(", ") || "Standard materials"}

Generate a detailed, professional estimate including:
- Line items for materials and labor
- Tear-off and disposal
- Permits and inspections
- Warranty information
- Payment terms (typically 10% deposit, 40% at start, 50% at completion)
- Total amount

Format as a clean text document. Be specific with line items and amounts.`;

      const res = await callClaude(prompt, 1500);
      const estimate = res?.content?.[0]?.text || "";

      await supabase.from("job_documents").insert({
        job_id, doc_type: "estimate",
        title: `Estimate — ${job.homeowner_name} — ${job.property_address}`,
        content: estimate,
      });

      const totalMatch = estimate.match(/total[:\s]*\$?([\d,]+)/i);
      if (totalMatch) {
        const amount = parseFloat(totalMatch[1].replace(",", ""));
        await supabase.from("roofing_jobs").update({ estimate_amount: amount }).eq("id", job_id);
      }

      return new Response(JSON.stringify({ ok: true, estimate }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    case "generate_contract": {
      const { data: job } = await supabase.from("roofing_jobs").select("*, clients(name, brand_name, address, phone, contractor_license)").eq("id", job_id).single();
      if (!job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });

      const prompt = `Generate a professional roofing contract/service agreement.

CONTRACTOR: ${job.clients?.brand_name || job.clients?.name}
LICENSE: ${job.clients?.contractor_license || "Licensed & Insured"}
ADDRESS: ${job.clients?.address || "Colorado"}
PHONE: ${job.clients?.phone || ""}

HOMEOWNER: ${job.homeowner_name}
PROPERTY: ${job.property_address}
CONTRACT AMOUNT: $${job.contract_amount || job.estimate_amount || "TBD"}
START DATE: ${job.estimated_start_date || "TBD"}
JOB TYPE: ${job.job_type}

Write a complete, professional roofing contract covering:
- Scope of work
- Materials to be used
- Contract price and payment schedule
- Start date and completion timeline
- Warranty (workmanship + manufacturer)
- Insurance and liability
- Change order process
- Dispute resolution (Colorado law)
- Cancellation policy
- Signature blocks for both parties

Use plain English. Professional but readable. Colorado governing law.`;

      const res = await callClaude(prompt, 2000);
      const contract = res?.content?.[0]?.text || "";

      await supabase.from("job_documents").insert({
        job_id, doc_type: "contract",
        title: `Contract — ${job.homeowner_name} — ${job.property_address}`,
        content: contract,
      });

      return new Response(JSON.stringify({ ok: true, contract }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    case "generate_invoice": {
      const { data: job } = await supabase.from("roofing_jobs").select("*, clients(name, brand_name, phone, address)").eq("id", job_id).single();
      if (!job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });

      const prompt = `Generate a professional roofing invoice.

FROM: ${job.clients?.brand_name || job.clients?.name}
ADDRESS: ${job.clients?.address || ""}
PHONE: ${job.clients?.phone || ""}

TO: ${job.homeowner_name}
PROPERTY: ${job.property_address}
CONTRACT AMOUNT: $${job.contract_amount || 0}
AMOUNT PAID: $${job.amount_paid || 0}
BALANCE DUE: $${(job.contract_amount || 0) - (job.amount_paid || 0)}
COMPLETION DATE: ${job.completion_date || new Date().toLocaleDateString()}

Generate a clean professional invoice with line items, payment history, balance due, and payment instructions.`;

      const res = await callClaude(prompt, 800);
      const invoice = res?.content?.[0]?.text || "";

      await supabase.from("job_documents").insert({
        job_id, doc_type: "invoice",
        title: `Invoice — ${job.homeowner_name}`,
        content: invoice,
      });

      return new Response(JSON.stringify({ ok: true, invoice }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    case "generate_timeline": {
      const { data: job } = await supabase.from("roofing_jobs").select("*").eq("id", job_id).single();
      if (!job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });

      const stages = [
        { stage: "lead", title: "Initial Contact", description: "We received your inquiry and are preparing your estimate." },
        { stage: "estimate_sent", title: "Estimate Sent", description: "Your detailed estimate has been prepared and sent for review." },
        { stage: "contract_signed", title: "Contract Signed", description: "Contract signed. Your job is confirmed and being scheduled." },
        { stage: "materials_ordered", title: "Materials Ordered", description: `Your ${job.shingle_brand || "roofing"} materials have been ordered and are being delivered.` },
        { stage: "scheduled", title: "Crew Scheduled", description: "Your installation crew has been assigned and your start date is confirmed." },
        { stage: "in_progress", title: "Work in Progress", description: "Our crew is on-site working on your roof installation." },
        { stage: "inspection", title: "Inspection", description: "Final inspection to ensure everything meets our quality standards." },
        { stage: "complete", title: "Job Complete", description: "Your new roof is complete. Welcome to your warranty period!" },
        { stage: "paid", title: "Paid in Full", description: "Payment received. Thank you for choosing us!" },
      ];

      const statusOrder = ["lead", "estimate_sent", "contract_signed", "materials_ordered", "scheduled", "in_progress", "inspection", "complete", "invoiced", "paid"];
      const currentIndex = statusOrder.indexOf(job.status);

      for (const s of stages) {
        const isCompleted = statusOrder.indexOf(s.stage) <= currentIndex;
        await supabase.from("job_timeline").upsert({
          job_id,
          stage: s.stage,
          title: s.title,
          description: s.description,
          completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
        }, { onConflict: "job_id,stage" });
      }

      return new Response(JSON.stringify({ ok: true, stages_count: stages.length }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    case "job_summary": {
      const { data: job } = await supabase.from("roofing_jobs").select("*, clients(name, brand_name)").eq("id", job_id).single();
      if (!job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });

      const prompt = `Summarize this roofing job for the homeowner in a friendly, reassuring tone.

JOB: ${job.job_type} at ${job.property_address}
STATUS: ${job.status}
MATERIAL: ${job.shingle_brand || ""} ${job.shingle_color || ""} ${job.material_type}
START DATE: ${job.estimated_start_date || "TBD"}
AMOUNT: $${job.contract_amount || job.estimate_amount || "TBD"}

Write 2-3 sentences that:
1. Confirm what's happening
2. Set expectations for next steps
3. End with a reassuring note

Friendly but professional. No jargon.`;

      const res = await callClaude(prompt, 200);
      return new Response(JSON.stringify({ ok: true, summary: res?.content?.[0]?.text || "" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    default:
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
});

async function callClaude(prompt: string, maxTokens: number) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  return await res.json();
}

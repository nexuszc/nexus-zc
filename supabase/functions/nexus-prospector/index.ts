import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) + "-" + Date.now().toString(36);
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "Nexus prospector ready" });

  // Step 1: Fire roofing-prospector in background (today's prospects → available tomorrow)
  fetch(`${SUPABASE_URL}/functions/v1/roofing-prospector`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({})
  }).catch(() => {});

  // Step 2: Find top 5 undiagnosed prospects from previous prospector runs
  const { data: prospects } = await supabase
    .from("roofing_prospects")
    .select("company_name, website, email, phone, city, lead_score, score_reasoning, hook_1")
    .eq("status", "researched")
    .not("email", "is", null)
    .order("lead_score", { ascending: false })
    .limit(20);

  if (!prospects?.length) {
    // MOVED_TO_DASHBOARD [date: 2026-05-17]: prospector status visible in Pipeline tab (roofing_prospects table)
    // await tg("📋 *Nexus Prospector*\n\nNo undiagnosed prospects found yet — roofing-prospector is running now, prospects available tomorrow.");
    return Response.json({ ok: true, prospector_fired: true, diagnostics_queued: 0 });
  }

  // Filter out any already in nexus_diagnostics by website
  const { data: existingDiags } = await supabase
    .from("nexus_diagnostics")
    .select("business_url")
    .in("business_url", prospects.map(p => p.website).filter(Boolean));

  const diagnosedUrls = new Set((existingDiags || []).map(d => d.business_url));
  const todiagnose = prospects.filter(p => p.website && !diagnosedUrls.has(p.website)).slice(0, 5);

  if (!todiagnose.length) {
    // MOVED_TO_DASHBOARD [date: 2026-05-17]: diagnostic status visible in Pipeline tab (nexus_diagnostics table)
    // await tg("📋 *Nexus Prospector*\n\nTop prospects already diagnosed. roofing-prospector running now for fresh leads.");
    return Response.json({ ok: true, prospector_fired: true, diagnostics_queued: 0 });
  }

  // Step 3: Create nexus_diagnostics records + fire nexus-diagnostic for each
  const queued: string[] = [];

  for (const prospect of todiagnose) {
    const slug = slugify(prospect.company_name);

    const { data: diag, error } = await supabase
      .from("nexus_diagnostics")
      .insert({
        slug,
        business_name: prospect.company_name,
        business_url: prospect.website,
        owner_email: prospect.email,
        owner_phone: prospect.phone || null,
        industry: "roofing",
        intake_urgency: `Lead score ${prospect.lead_score}/100 from roofing-prospector. ${prospect.score_reasoning || ""}`.slice(0, 300),
        intake_biggest_fix: prospect.hook_1 || null,
        status: "pending"
      })
      .select("id")
      .single();

    if (error || !diag) continue;

    // Fire nexus-diagnostic in background
    fetch(`${SUPABASE_URL}/functions/v1/nexus-diagnostic`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostic_id: diag.id })
    }).catch(() => {});

    queued.push(prospect.company_name);
  }

  // MOVED_TO_DASHBOARD [date: 2026-05-17]: queued diagnostics visible in Pipeline tab (nexus_diagnostics.status='pending')
  // await tg(`🔍 *Nexus Prospector — Daily Run*\n\nRoofing prospector: running in background\nDiagnostics queued: ${queued.length}\n\n${queued.map(n => `• ${n}`).join("\n")}\n\n_Reports in ~3 min each. You'll be alerted per completion._`);

  return Response.json({ ok: true, prospector_fired: true, diagnostics_queued: queued.length, queued });
});

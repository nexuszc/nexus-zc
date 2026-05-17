import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function serper(query: string): Promise<{ title: string; snippet: string; link: string }[]> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 5 })
    });
    const data = await res.json();
    return data.organic || [];
  } catch { return []; }
}

async function fetchUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) });
    return (await res.text()).slice(0, 5000);
  } catch { return ""; }
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, test: true });

  const { url, business_name, proactive = false, industry } = body;
  if (!url && !business_name) return Response.json({ error: "url or business_name required" }, { status: 400 });

  // Deduplicate — skip if already scanned
  if (url) {
    const { data: existing } = await supabase.from("nexus_diagnostics").select("id").eq("business_url", url).maybeSingle();
    if (existing) return Response.json({ ok: true, skipped: true, reason: "already_scanned" });
  }

  const name = business_name || url?.replace(/https?:\/\//, "").split("/")[0] || "Unknown";

  // Quick 3-layer scan
  const [html, searchResults, reviewResults] = await Promise.all([
    url ? fetchUrl(url) : Promise.resolve(""),
    serper(`"${name}"`),
    serper(`${name} reviews`),
  ]);

  const hasSSL = url?.startsWith("https://") || false;
  const hasForm = html.includes("<form");
  const hasCTA = html.match(/get started|book|schedule|free|quote/i) !== null;
  const appearsInSearch = searchResults.length > 0;
  const hasReviews = reviewResults.some(r => r.snippet.match(/\d+.*review|\d+.*star|rating/i));

  // Quick score
  let quickScore = 20;
  if (hasSSL) quickScore += 15;
  if (hasForm) quickScore += 15;
  if (hasCTA) quickScore += 15;
  if (appearsInSearch) quickScore += 20;
  if (hasReviews) quickScore += 15;
  quickScore = Math.min(100, quickScore);

  // Only proceed to full diagnostic if promising (score > 40) or explicitly requested
  if (quickScore < 40 && !body.force) {
    return Response.json({ ok: true, quick_score: quickScore, action: "skipped_low_score" });
  }

  // Create diagnostic record for full run
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 30) + "-" + Date.now();

  const { data: diagnostic } = await supabase.from("nexus_diagnostics").insert({
    slug,
    business_name: name,
    business_url: url || null,
    owner_email: `scan-${Date.now()}@proactive.nexuszc.com`, // placeholder for proactive scans
    industry: industry || "general",
    source: proactive ? "proactive_scan" : "quick_scan",
    proactive_run: proactive,
    status: "new"
  }).select().single();

  if (!diagnostic) return Response.json({ ok: true, quick_score: quickScore, action: "insert_failed" });

  // Trigger full diagnostic async
  fetch(`${SUPABASE_URL}/functions/v1/nexus-diagnostic`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ diagnostic_id: diagnostic.id })
  }).catch(() => {});

  // MOVED_TO_DASHBOARD [date: 2026-05-17]: proactive scan leads visible in Pipeline tab (nexus_diagnostics table)
  // if (proactive && quickScore >= 60) {
  //   await tg(`🔍 *Proactive Scan — Promising Lead*\n*Business:* ${name}\n*URL:* ${url || "unknown"}\n*Quick Score:* ${quickScore}/100\nFull 24-layer diagnostic running now.`);
  // }

  return Response.json({ ok: true, quick_score: quickScore, diagnostic_id: diagnostic.id, slug });
});

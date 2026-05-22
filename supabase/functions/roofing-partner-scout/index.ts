// roofing-partner-scout v1
// Scheduled: Monday 9am MT (15:00 UTC) via pg_cron
// Searches for new partnership targets via Serper API
// Inserts into roofing_partnership_targets with status='target'
// Sends Telegram Monday morning report

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERPER_API_KEY     = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID   = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const SEARCH_QUERIES = [
  "roofing contractor coach",
  "roofing business training program",
  "storm restoration training contractor",
  "supplement consultant roofing insurance",
  "roofing YouTube channel contractor",
  "roofing association membership organization",
  "roofing distributor representative",
  "public adjuster roofing contractor",
  "roofing software review blog",
  "roofing contractor podcast host",
];

const PARTNER_TYPE_MAP: [string, string][] = [
  ["podcast",      "content_creator"],
  ["youtube",      "content_creator"],
  ["coach",        "educator"],
  ["training",     "educator"],
  ["association",  "association"],
  ["distributor",  "vendor"],
  ["software",     "vendor"],
  ["consultant",   "consultant"],
  ["adjuster",     "service_provider"],
  ["review",       "media"],
];

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function serperSearch(query: string): Promise<Array<{ title: string; link: string; snippet: string }>> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 10 }),
  }).catch(() => null);
  if (!res?.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.organic || [];
}

function extractEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

function estimateAudience(snippet: string, title: string): number {
  const text = (snippet + " " + title).toLowerCase();
  if (text.match(/\d+\s*million|\d+m\+/)) return 1_000_000;
  const m = text.match(/(\d[\d,]*)\s*(k\b|thousand|subscriber|follower|member|viewer|listener)/);
  if (m) {
    const base = parseInt(m[1].replace(/,/g, ""));
    return /k|thousand/.test(m[2]) ? base * 1000 : base;
  }
  if (text.includes("podcast")) return 5_000;
  if (text.includes("national") || text.includes("association")) return 15_000;
  if (text.includes("youtube") || text.includes("channel")) return 8_000;
  if (text.includes("coach") || text.includes("trainer")) return 2_000;
  return 1_000;
}

function detectPartnerType(query: string, title: string, snippet: string): string {
  const text = (query + " " + title + " " + snippet).toLowerCase();
  for (const [kw, type] of PARTNER_TYPE_MAP) {
    if (text.includes(kw)) return type;
  }
  return "general";
}

function cleanDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url.slice(0, 60); }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-partner-scout v1 ready" });

  // Rotate queries: one per week based on ISO week number
  const weekNum = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const query = body.query || SEARCH_QUERIES[weekNum % SEARCH_QUERIES.length];

  const results = await serperSearch(query);
  if (!results.length) {
    return Response.json({ ok: false, error: "No Serper results", query });
  }

  const inserted: Array<{ name: string; org: string; audience: number }> = [];

  for (const result of results) {
    try {
      const domain    = cleanDomain(result.link);
      const email     = extractEmail(result.snippet + " " + result.title);
      const audience  = estimateAudience(result.snippet, result.title);
      const type      = detectPartnerType(query, result.title, result.snippet);
      const name      = result.title.replace(/\s*[-|–|·]\s*.+$/, "").trim().slice(0, 120);

      if (!name || name.length < 4) continue;

      // Deduplicate by domain
      const { data: byDomain } = await supabase
        .from("roofing_partnership_targets")
        .select("id")
        .eq("website", result.link)
        .maybeSingle();
      if (byDomain) continue;

      // Deduplicate by name similarity
      const { data: byName } = await supabase
        .from("roofing_partnership_targets")
        .select("id")
        .ilike("name", `%${name.slice(0, 30)}%`)
        .maybeSingle();
      if (byName) continue;

      const { error } = await supabase.from("roofing_partnership_targets").insert({
        name,
        email:        email || null,
        website:      result.link,
        org_name:     domain,
        audience_size: audience,
        partner_type: type,
        notes:        result.snippet?.slice(0, 500) || null,
        status:       "target",
        source:       "partner_scout",
        touch_count:  0,
      });

      if (!error) {
        inserted.push({ name, org: domain, audience });
      }
    } catch { /* non-fatal */ }
  }

  inserted.sort((a, b) => b.audience - a.audience);

  if (inserted.length > 0) {
    const top3 = inserted.slice(0, 3);
    const lines = top3.map((p, i) =>
      `${i + 1}. ${p.name} — ${p.org} — ${p.audience.toLocaleString()} reach`
    ).join("\n");

    await tg(
      `🤝 *Partner scout found ${inserted.length} new target${inserted.length !== 1 ? "s" : ""} this week.*\n\n` +
      `Search: _${query}_\n\n` +
      `Top ${Math.min(3, inserted.length)}:\n${lines}\n\n` +
      `Outreach starts today at 1pm MT.`
    );
  }

  return Response.json({
    ok: true,
    query,
    searched: results.length,
    inserted: inserted.length,
    top: inserted.slice(0, 5),
  });
});

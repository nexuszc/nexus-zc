// roofing-lead-scout v1
// Scheduled: Tuesday + Friday at 8am MT (14:00 UTC) via pg_cron
// Finds new roofing contractor prospects via Serper API
// Inserts into roofing_prospects, enrolls in email sequence, queues Aria calls
// Target: 100 new prospects per run → 200/week

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERPER_API_KEY     = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID   = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const MARKETS: Array<{ state: string; cities: string[] }> = [
  { state: "CO", cities: ["Denver", "Colorado Springs", "Fort Collins", "Lakewood", "Aurora"] },
  { state: "TX", cities: ["Dallas", "Houston", "San Antonio", "Austin", "Fort Worth"] },
  { state: "FL", cities: ["Orlando", "Tampa", "Jacksonville", "Miami", "St. Petersburg"] },
  { state: "GA", cities: ["Atlanta", "Savannah", "Augusta", "Columbus", "Marietta"] },
  { state: "OH", cities: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron"] },
  { state: "IL", cities: ["Chicago", "Naperville", "Aurora", "Rockford", "Springfield"] },
  { state: "NC", cities: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Cary"] },
  { state: "TN", cities: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville"] },
  { state: "MO", cities: ["Kansas City", "St. Louis", "Springfield", "Columbia", "Independence"] },
  { state: "KS", cities: ["Wichita", "Overland Park", "Kansas City", "Topeka", "Olathe"] },
  { state: "OK", cities: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond"] },
  { state: "AR", cities: ["Little Rock", "Fort Smith", "Fayetteville", "Springdale", "Jonesboro"] },
  { state: "AL", cities: ["Birmingham", "Montgomery", "Huntsville", "Mobile", "Tuscaloosa"] },
  { state: "SC", cities: ["Columbia", "Charleston", "Greenville", "Spartanburg", "North Charleston"] },
  { state: "VA", cities: ["Virginia Beach", "Norfolk", "Richmond", "Arlington", "Chesapeake"] },
  { state: "MD", cities: ["Baltimore", "Frederick", "Rockville", "Gaithersburg", "Annapolis"] },
  { state: "PA", cities: ["Philadelphia", "Pittsburgh", "Allentown", "Reading", "Erie"] },
  { state: "NJ", cities: ["Newark", "Jersey City", "Toms River", "Edison", "Woodbridge"] },
  { state: "LA", cities: ["New Orleans", "Baton Rouge", "Shreveport", "Metairie", "Lafayette"] },
  { state: "MS", cities: ["Jackson", "Gulfport", "Southaven", "Hattiesburg", "Biloxi"] },
];

const SEARCH_TEMPLATES = [
  "{city} {state} roofing contractor insurance restoration",
  "{city} storm damage roof repair company",
  "{city} {state} hail damage roofing contractor",
];

function fmtPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const m = d.match(/^1?(\d{3})(\d{3})(\d{4})$/);
  return m ? `+1${m[1]}${m[2]}${m[3]}` : null;
}

function extractPhone(text: string): string | null {
  const m = text.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return m ? fmtPhone(m[0]) : null;
}

function extractEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

function scoreProspect(title: string, snippet: string): number {
  const text = (title + " " + snippet).toLowerCase();
  let score = 50;
  if (text.match(/insurance|storm|hail|restoration/)) score += 20;
  if (text.includes("residential")) score += 10;
  if (text.includes("commercial only")) score -= 20;
  if (text.match(/5[\s\-]star|4\.[5-9]|4\.9|5\.0/)) score += 10;
  if (text.match(/licensed|certified|bbb|gaf|owens/)) score += 5;
  if (text.match(/small|startup|new|just started/)) score -= 10;
  return Math.min(100, Math.max(10, score));
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

function nextWeekdayMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setUTCHours(15, 0, 0, 0); // 9am MT = 15:00 UTC
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  if (dow === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  return d.toISOString();
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-lead-scout v1 ready" });

  const dayNum = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  // Pick 4 markets per run, rotating daily
  const markets = [0, 1, 2, 3].map(i => MARKETS[(dayNum + i) % MARKETS.length]);
  const template = SEARCH_TEMPLATES[dayNum % SEARCH_TEMPLATES.length];
  const fireAt = nextWeekdayMorning();

  let totalInserted = 0;
  let totalQueued   = 0;
  let totalEnrolled = 0;
  const stateCount: Record<string, number> = {};

  for (const market of markets) {
    const city  = market.cities[dayNum % market.cities.length];
    const query = template.replace("{city}", city).replace("{state}", market.state);

    const results = await serperSearch(query);

    for (const result of results) {
      try {
        const phone       = extractPhone(result.snippet);
        const email       = extractEmail(result.snippet);
        const companyName = result.title.replace(/\s*[-|–|·]\s*.+$/, "").trim().slice(0, 150);
        const score       = scoreProspect(result.title, result.snippet);

        if (!companyName || companyName.length < 4) continue;
        // Skip generic directories
        if (/yelp|angi|houzz|homeadvisor|thumbtack|bbb\.org/.test(result.link)) continue;

        // Deduplicate
        const dedup = await supabase
          .from("roofing_prospects")
          .select("id")
          .or(`company_name.ilike.${companyName.slice(0, 40)}%,website.eq.${result.link}`)
          .maybeSingle();
        if (dedup.data) continue;

        const { data: inserted, error } = await supabase
          .from("roofing_prospects")
          .insert({
            company_name: companyName,
            email:        email || null,
            phone:        phone || null,
            website:      result.link,
            city,
            state:        market.state,
            source:       "lead_scout",
            source_detail: query,
            lead_score:   score,
            status:       "new",
            added_by:     "roofing-lead-scout",
          })
          .select("id")
          .single();

        if (error || !inserted) continue;

        totalInserted++;
        stateCount[market.state] = (stateCount[market.state] || 0) + 1;

        // Auto-enroll in cold email sequence (2h delay before first send)
        if (email) {
          await supabase.from("email_sequences").insert({
            prospect_id:   inserted.id,
            prospect_email: email,
            prospect_name: companyName,
            market:        market.state,
            current_step:  0,
            next_send_at:  new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            completed:     false,
            unsubscribed:  false,
            status:        "active",
            type:          "cold_outreach",
          }).catch(() => {});
          totalEnrolled++;
        }

        // Add to Aria call queue — fires next weekday 9am MT (TCPA-compliant)
        if (phone) {
          await supabase.from("aria_call_queue").insert({
            call_type:    "cold_outreach",
            contact_phone: phone,
            contact_name: companyName,
            contact_type: "roofing_prospect",
            fire_at:      fireAt,
            status:       "pending",
            attempt_count: 0,
            queue_reason: `lead_scout:${market.state}`,
            metadata: {
              company_name: companyName,
              city,
              state:  market.state,
              source: "lead_scout",
            },
          }).catch(() => {});
          totalQueued++;
        }
      } catch { /* non-fatal */ }
    }
  }

  // Telegram report
  if (totalInserted > 0) {
    const topMarkets = Object.entries(stateCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([s, n]) => `${s}: ${n}`)
      .join(", ");

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: `🎯 *Lead scout found ${totalInserted} new prospect${totalInserted !== 1 ? "s" : ""}.*\n\nAdded to Aria queue and email sequence.\nTop markets: ${topMarkets}\nQueued for calls: ${totalQueued}\nEnrolled in email: ${totalEnrolled}`,
        parse_mode: "Markdown",
      }),
    }).catch(() => {});
  }

  return Response.json({
    ok: true,
    inserted: totalInserted,
    queued:   totalQueued,
    enrolled: totalEnrolled,
    markets:  stateCount,
  });
});

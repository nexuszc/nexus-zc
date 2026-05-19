import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function searchRoofers(query: string): Promise<Array<{
  title: string; link: string; snippet: string;
}>> {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 10, gl: "us", hl: "en" })
  });
  const data = await res.json();
  return data.organic || [];
}

async function checkHailZones(): Promise<string[]> {
  const results = await searchRoofers("hail storm damage roofing 2026 site:weather.com OR site:noaa.gov OR site:hailstrike.com");
  const cities: string[] = [];
  const cityPattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),?\s*([A-Z]{2})\b/g;
  for (const result of results) {
    const matches = (result.snippet + result.title).matchAll(cityPattern);
    for (const match of matches) {
      cities.push(`${match[1]}, ${match[2]}`);
    }
  }
  return [...new Set(cities)].slice(0, 5);
}

// Try to extract email/phone from the company's actual website
async function scrapeContactFromWebsite(url: string): Promise<{ email: string | null; phone: string | null }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }
    });
    if (!res.ok) return { email: null, phone: null };
    const html = await res.text();
    // Avoid false positives: skip noreply/example addresses, images, scripts
    const emailMatches = [...html.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)]
      .map(m => m[0].toLowerCase())
      .filter(e => !e.includes("noreply") && !e.includes("example") && !e.includes(".png") && !e.includes(".jpg") && !e.endsWith(".js"));
    const phoneMatches = [...html.matchAll(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g)].map(m => m[0]);
    return {
      email: emailMatches[0] || null,
      phone: phoneMatches[0] || null
    };
  } catch {
    return { email: null, phone: null };
  }
}

async function extractLeadInfo(result: { title: string; link: string; snippet: string }, queryCity = "Denver, CO"): Promise<{
  company_name: string;
  website: string;
  email: string | null;
  phone: string | null;
  city: string;
} | null> {
  // Skip non-business URLs
  const skipDomains = ["yelp.com", "bbb.org", "angi.com", "homeadvisor.com", "thumbtack.com",
    "facebook.com", "google.com", "yellowpages.com", "houzz.com", "nextdoor.com"];
  if (skipDomains.some(d => result.link.includes(d))) return null;

  const city = queryCity;

  // Try snippet first (fast)
  const phoneMatch = result.snippet.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/);
  const emailMatch = result.snippet.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

  let email = emailMatch ? emailMatch[0].toLowerCase() : null;
  let phone = phoneMatch ? phoneMatch[0] : null;

  // If no email from snippet, scrape the website
  if (!email) {
    const scraped = await scrapeContactFromWebsite(result.link);
    email = scraped.email;
    if (!phone) phone = scraped.phone;
  }

  const company_name = result.title
    .replace(/\s*[-|–]\s*.+$/, '')
    .replace(/\s*\|\s*.+$/, '')
    .trim()
    .slice(0, 100);

  return { company_name, website: result.link, email, phone, city };
}

async function scoreLead(lead: { company_name: string; website: string; snippet: string }): Promise<{
  score: number;
  reasoning: string;
  hook_1: string;
  hook_2: string;
  crew_size: string;
  tech_sophistication: string;
}> {
  const prompt = `You are scoring a roofing contractor as a sales prospect for Roofing OS — a $499/month software that gives their homeowners a branded project portal with timeline, photos, documents, and messaging.

Company: ${lead.company_name}
Website: ${lead.website}
Description: ${lead.snippet}

Score this prospect 1-100 for likelihood to buy. Higher score = more likely.

Factors that increase score:
- Small to medium size (2-8 crews)
- No mention of existing software/portal/app
- Active in residential roofing
- Local/independent (not a franchise)
- Storm damage/insurance work (more jobs = more need for organization)

Factors that decrease score:
- Large franchise (they have their own software)
- Commercial only
- Very new company (no budget)
- Already has digital tools mentioned

Respond with JSON only (no backticks):
{
  "score": 75,
  "reasoning": "brief reason",
  "hook_1": "personalized opening hook about their specific situation",
  "hook_2": "second angle specific to them",
  "crew_size": "small|medium|large",
  "tech_sophistication": "low|medium|high"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  try {
    return JSON.parse(data.content[0].text.replace(/```json|```/g, "").trim());
  } catch {
    return { score: 50, reasoning: "Could not parse", hook_1: "", hook_2: "", crew_size: "medium", tech_sophistication: "low" };
  }
}

Deno.serve(async (_req) => {
  const newProspects: string[] = [];
  let skippedNoEmail = 0;
  let skippedDuplicate = 0;
  let skippedLowScore = 0;

  const denverQueries = [
    // Colorado
    "roofing contractor Denver CO residential reviews",
    "roofing company Aurora Colorado insurance claims",
    "roof repair Lakewood CO small business",
    "roofer Englewood Colorado residential",
    "roofing contractor Centennial CO",
    "roofing company Colorado Springs CO hail damage",
    "roofer Fort Collins Colorado residential",
    "roofing contractor Thornton CO storm damage",
    // Texas
    "roofing contractor Dallas TX residential hail",
    "roofer Houston TX storm damage insurance",
    "roofing company San Antonio TX residential",
    "roofer Fort Worth TX residential reviews",
    "roofing contractor Austin TX small business",
    // Florida
    "roofing contractor Orlando FL residential",
    "roofer Tampa FL storm damage reviews",
    "roofing company Jacksonville FL residential",
    // Midwest
    "roofing contractor Kansas City MO residential",
    "roofer Omaha NE storm damage",
    "roofing contractor Minneapolis MN residential",
    "roofer St Louis MO residential insurance",
    "roofing contractor Oklahoma City OK hail damage",
    "roofer Wichita KS storm damage residential",
  ];

  const hailCities = await checkHailZones();
  const hailQueries = hailCities.map(city => `roofing contractor ${city} hail damage repair`);
  const allQueries = [...denverQueries, ...hailQueries];

  for (const query of allQueries) {
    const results = await searchRoofers(query);
    // Extract "City STATE" from query for city field
    const cityMatch = query.match(/([A-Za-z]+(?:\s[A-Za-z]+)?)\s+([A-Z]{2})\b/);
    const queryCity = cityMatch ? `${cityMatch[1]}, ${cityMatch[2]}` : "Denver, CO";
    for (const result of results) {
      const leadInfo = await extractLeadInfo(result, queryCity);
      if (!leadInfo) continue;

      // Require email — roofing-outreach is email-only
      if (!leadInfo.email) {
        skippedNoEmail++;
        continue;
      }

      // Deduplicate by website
      const { data: existingByWebsite } = await supabase
        .from("roofing_prospects")
        .select("id")
        .eq("website", leadInfo.website)
        .maybeSingle();
      if (existingByWebsite) { skippedDuplicate++; continue; }

      // Deduplicate by email
      const { data: existingByEmail } = await supabase
        .from("roofing_prospects")
        .select("id")
        .eq("email", leadInfo.email)
        .maybeSingle();
      if (existingByEmail) { skippedDuplicate++; continue; }

      const score = await scoreLead({
        company_name: leadInfo.company_name,
        website: leadInfo.website,
        snippet: result.snippet
      });

      if (score.score < 40) { skippedLowScore++; continue; }

      const isHailZone = hailCities.some(city => query.includes(city.split(",")[0]));

      const { data: newProspect } = await supabase.from("roofing_prospects").insert({
        company_name: leadInfo.company_name,
        email: leadInfo.email,
        phone: leadInfo.phone,
        website: leadInfo.website,
        city: leadInfo.city,
        source: isHailZone ? "hail_zone" : "serper",
        lead_score: score.score,
        score_reasoning: score.reasoning,
        hook_1: score.hook_1,
        hook_2: score.hook_2,
        crew_size_estimate: score.crew_size,
        tech_sophistication: score.tech_sophistication,
        status: "researched",
        next_touch_at: new Date().toISOString()
      }).select("id").single();

      // Auto-enroll in email sequence
      if (newProspect?.id) {
        await supabase.from("email_sequences").insert({
          prospect_id: newProspect.id,
          prospect_email: leadInfo.email,
          prospect_name: leadInfo.company_name,
          current_touch: 0,
          tier: score.score >= 70 ? "warm" : "cold",
          status: "active",
          next_touch_at: new Date().toISOString(),
        }).catch(() => {});
      }

      newProspects.push(leadInfo.company_name);
    }
  }

  return Response.json({
    ok: true,
    new_prospects: newProspects.length,
    skipped_no_email: skippedNoEmail,
    skipped_duplicate: skippedDuplicate,
    skipped_low_score: skippedLowScore
  });
});

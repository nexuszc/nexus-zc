// roofing-youtube-engine v2
// 3 YouTube shorts per run, Mon+Thu cadence, 8-category rotation,
// 30-day title dedup, auto-approve → voiceover pipeline (no Telegram approval)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CATEGORIES = [
  {
    topic: "supplement_tips",
    title_formula: "The ${amount} Supplement Most Contractors Miss After Hail Damage",
    angle: "Specific line items adjusters routinely omit and exactly how to recover them",
  },
  {
    topic: "homeowner_communication",
    title_formula: "The One Text That Stops 80% of Homeowner Anxiety Calls",
    angle: "Exact scripts that prevent homeowners from feeling ignored during the claim",
  },
  {
    topic: "storm_strategy",
    title_formula: "The 72-Hour Storm Playbook: How to Win Market Share After Hail",
    angle: "Minute-by-minute response protocol that doubles inspection bookings",
  },
  {
    topic: "business_ops",
    title_formula: "Why Roofing Contractors Go Broke During Their Busiest Month",
    angle: "Cash flow timing trap and the 3-step fix that eliminates it",
  },
  {
    topic: "lead_gen",
    title_formula: "6 Doors, 20 Minutes, 1 Extra Job Per Week — The Neighbor Knock",
    angle: "Highest-ROI prospecting strategy in residential roofing, fully scripted",
  },
  {
    topic: "carrier_intelligence",
    title_formula: "State Farm vs. Allstate vs. USAA: Who Actually Pays and How to Get It",
    angle: "Carrier-specific documentation strategies that change the approval rate",
  },
  {
    topic: "code_compliance",
    title_formula: "The IRC Calculation That Ends Every Ventilation Argument",
    angle: "Step-by-step math that makes ventilation supplements unarguable",
  },
  {
    topic: "technology_tools",
    title_formula: "The $300/Month Software Stack That Runs a Tight Roofing Operation",
    angle: "Exact tools, costs, and break-even points for a modern roofing crew",
  },
];

async function claude(prompt: string, maxTokens = 1500): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function getRecentTitles(): Promise<string[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("roofing_content")
    .select("title, scheduled_topic")
    .in("type", ["youtube_short", "youtube_long", "youtube_script"])
    .gte("created_at", since);
  return (data || []).map((r: any) => (r.title || "").toLowerCase());
}

async function getRecentCategories(): Promise<string[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("roofing_content")
    .select("scheduled_topic")
    .in("type", ["youtube_short", "youtube_long"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data || []).map((r: any) => r.scheduled_topic).filter(Boolean);
}

function pickNextCategories(recentCategories: string[], count: number): typeof CATEGORIES {
  // Weight categories that haven't appeared recently
  const categoryCounts: Record<string, number> = {};
  for (const cat of CATEGORIES) categoryCounts[cat.topic] = 0;
  for (const recent of recentCategories) {
    if (categoryCounts[recent] !== undefined) categoryCounts[recent]++;
  }
  const sorted = [...CATEGORIES].sort((a, b) => categoryCounts[a.topic] - categoryCounts[b.topic]);
  return sorted.slice(0, count);
}

function isTitleDuplicate(title: string, recentTitles: string[]): boolean {
  const normalized = title.toLowerCase();
  return recentTitles.some(existing => {
    const words = existing.split(" ").filter(w => w.length > 4);
    const matches = words.filter(w => normalized.includes(w)).length;
    return matches >= 4;
  });
}

async function generateShort(category: typeof CATEGORIES[0], context: Record<string, string>): Promise<{ title: string; script: string; hook: string; thumbnail_text: string } | null> {
  const market = context.market || "Denver, CO";
  const month = new Date().toLocaleString("en-US", { month: "long" });
  const year = new Date().getFullYear();

  let title = category.title_formula
    .replace("${amount}", context.amount || "$2,400")
    .replace("${carrier}", context.carrier || "State Farm")
    .replace("${market}", market)
    .replace("${month}", month)
    .replace("${year}", String(year));

  const script = await claude(
    `Write a 60-90 second YouTube Shorts script for roofing contractors.

TOPIC: ${category.topic}
TITLE: ${title}
CORE ANGLE: ${category.angle}
MARKET: ${market}

Format:
[HOOK] — First 3 seconds. One shocking number or fact. No "hey guys."
[POINT 1] — 15 seconds. First actionable insight.
[POINT 2] — 15 seconds. Second actionable insight.
[POINT 3] — 15 seconds. Third actionable insight.
[CTA] — 5 seconds. One action. "Comment your market below" or "Link in bio."

Rules:
- Speak directly to a roofing contractor watching on their phone
- Every sentence must be concrete (dollar amounts, Xactimate codes, IRC sections, timeframes)
- No filler words, no corporate language
- End with a question or CTA that drives comments
- Total word count: 120-180 words

Return ONLY the script with section labels.`,
    600
  );

  if (!script) return null;

  const hookMatch = script.match(/\[HOOK\]([\s\S]*?)(\[POINT|\[CTA)/);
  const hook = hookMatch ? hookMatch[1].trim().slice(0, 200) : script.slice(0, 200);
  const thumbnail_text = title.split(":")[0].split("—")[0].trim().slice(0, 50).toUpperCase();

  return { title, script, hook, thumbnail_text };
}

async function getStormContext(): Promise<{ city: string; state: string } | null> {
  const { data } = await supabase
    .from("hail_events")
    .select("city, state")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { city: data.city, state: data.state } : null;
}

async function getCarrierContext(): Promise<string | null> {
  const { data } = await supabase
    .from("carrier_intelligence")
    .select("carrier_type")
    .order("last_updated", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.carrier_type || null;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-engine v2 ready" });

  const startMs = Date.now();
  const count = Math.min(body.count || 3, 6);

  const [recentTitles, recentCategories] = await Promise.all([
    getRecentTitles(),
    getRecentCategories(),
  ]);

  const storm = await getStormContext();
  const carrier = await getCarrierContext();

  const selectedCategories = pickNextCategories(recentCategories, count);
  let generated = 0;
  const titles: string[] = [];

  for (const category of selectedCategories) {
    const context: Record<string, string> = {
      market: storm ? `${storm.city}, ${storm.state}` : "Denver, CO",
      carrier: carrier || "State Farm",
    };

    const result = await generateShort(category, context);
    if (!result) continue;

    if (isTitleDuplicate(result.title, recentTitles)) {
      continue;
    }

    const { error } = await supabase.from("roofing_content").insert({
      type: "youtube_short",
      format: "video",
      title: result.title,
      body: result.script,
      hook: result.hook,
      thumbnail_text: result.thumbnail_text,
      status: "approved",
      channel: "youtube",
      scheduled_topic: category.topic,
      market: context.market,
      carrier: context.carrier || null,
      tags: [category.topic, "youtube_short", context.market],
      youtube_upload_ready: false,
    });

    if (!error) {
      generated++;
      titles.push(result.title);
      recentTitles.push(result.title.toLowerCase());
    }

    await new Promise(r => setTimeout(r, 800));
  }

  await supabase.from("system_heartbeats").insert({
    function_name: "roofing-youtube-engine",
    status: "ok",
    response_ms: Date.now() - startMs,
    checked_at: new Date().toISOString(),
  }).catch(() => {});

  return Response.json({
    ok: true,
    generated,
    titles,
    duration_ms: Date.now() - startMs,
  });
});

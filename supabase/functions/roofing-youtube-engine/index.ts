// roofing-youtube-engine v3
// New conversion-focused script format, 8-category rotation, long-form mode,
// hook_text/thumbnail_text/topic_category/target_keywords extracted per script.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CATEGORIES = [
  { topic: "homeowner_communication",  angle: "homeowners calling contractors mid-job and portals that stop it" },
  { topic: "supplement_recovery",      angle: "denied or underpaid supplements and AI that recovers the money" },
  { topic: "companycam_replacement",   angle: "canceling CompanyCam and getting everything free with Roofing OS" },
  { topic: "storm_leads",              angle: "hitting a hail market in the first 48 hours and winning more jobs" },
  { topic: "carrier_tactics",          angle: "State Farm, Allstate, USAA tactics and carrier-specific documentation" },
  { topic: "crew_management",          angle: "crew showing up without homeowners knowing and coordination failures" },
  { topic: "reviews_closing",          angle: "getting 5-star reviews automatically and closing more jobs faster" },
  { topic: "product_demo",             angle: "Roofing OS setup in 4 minutes and the first thing contractors notice" },
];

const SHORT_SYSTEM = `You write 30-second YouTube Shorts scripts for roofing contractors. Every script must follow this EXACT structure:

HOOK (0-3 seconds): ONE sentence. Painful, specific, relatable. Under 12 words. Specific number or scenario. Addresses the contractor directly (you/your). Never generic.
Examples:
"Your homeowner called 6 times today."
"State Farm just cut your supplement by $4,200."
"You lost a $22K job because you replied 4 hours late."
"CompanyCam just charged you $49. Again."
"Your crew showed up. Nobody told the homeowner."

PROBLEM (3-8 seconds): 2 sentences max. Why this keeps happening. The real cost of this problem.

SOLUTION (8-22 seconds): Roofing OS fixes it. Show the outcome, not the feature.
NEVER: "Roofing OS has a portal feature."
ALWAYS: "Your homeowner sees every photo your crew takes in real time. They stop calling."
Be specific about what the contractor and homeowner experience.

CTA (22-30 seconds): Urgent and specific. Include "roofingos.dev" twice. Include "free forever, no credit card" once.

RULES:
- Total script: 90-110 words for 30 seconds
- Use "you" and "your" not "we" and "our"
- Include one specific dollar amount or number
- Never use corporate language
- Sound like a contractor talking to a contractor

After the script, on a new line, provide these exact fields:
hook_text: [the hook sentence only, under 12 words]
thumbnail_text: [4 words max, all caps, most shocking part]
topic_category: [exact topic key]
target_keywords: [5 YouTube search terms, comma-separated]`;

const LONG_FORM_SYSTEM = `You write 10-minute YouTube video scripts for roofing contractors. Format as follows:

INTRO (0-60 sec): Hook the biggest pain point. Tell them exactly what they'll learn. Preview key outcomes.

SECTION 1 — THE PROBLEM (60-180 sec): Deep dive. Specific scenarios, dollar amounts. Why existing solutions fail. Make the contractor feel seen.

SECTION 2 — THE SOLUTION (180-360 sec): Walk through Roofing OS step by step. Describe what the contractor sees on screen. Show specific features as outcomes. Every feature tied to a dollar amount or time saved.

SECTION 3 — REAL RESULTS (360-480 sec): Specific before/after scenarios. Dollar amounts recovered. Calls stopped. Time saved. Frame as "contractors using this see..."

OUTRO (480-600 sec): roofingos.dev. How to get started. What happens in the first 4 minutes. What their homeowners will experience.

RULES:
- 1,400-1,600 words total (approx 10 minutes at 150 wpm)
- Mention roofingos.dev at least 4 times
- Include at least 3 specific dollar amounts
- Use "you/your" throughout
- Sound like an expert contractor peer, not a salesperson

After the script provide:
hook_text: [first sentence of intro only]
thumbnail_text: [4 words max, all caps]
topic_category: [relevant topic]
target_keywords: [8 YouTube search terms]`;

async function claude(system: string, prompt: string, maxTokens = 1200): Promise<string> {
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
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

function parseScriptFields(raw: string): {
  script: string;
  hook_text: string;
  thumbnail_text: string;
  topic_category: string;
  target_keywords: string[];
} {
  const lines = raw.split("\n");
  const metaStart = lines.findIndex(l =>
    /^hook_text:/i.test(l.trim()) ||
    /^thumbnail_text:/i.test(l.trim()) ||
    /^topic_category:/i.test(l.trim())
  );

  const script = metaStart > 0 ? lines.slice(0, metaStart).join("\n").trim() : raw.trim();
  const metaBlock = metaStart > 0 ? lines.slice(metaStart).join("\n") : "";

  const get = (key: string) =>
    (metaBlock.match(new RegExp(`^${key}:\\s*(.+)`, "im"))?.[1] || "").trim();

  const hook_text = get("hook_text").slice(0, 120);
  const thumbnail_text = get("thumbnail_text").slice(0, 50).toUpperCase();
  const topic_category = get("topic_category");
  const keywordsRaw = get("target_keywords");
  const target_keywords = keywordsRaw
    ? keywordsRaw.split(",").map((k: string) => k.trim()).filter(Boolean).slice(0, 8)
    : [];

  return { script, hook_text, thumbnail_text, topic_category, target_keywords };
}

async function getRecentTitles(): Promise<string[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("roofing_content")
    .select("title")
    .in("type", ["youtube_short", "youtube_long"])
    .gte("created_at", since);
  return (data || []).map((r: Record<string, string>) => (r.title || "").toLowerCase());
}

async function getRecentCategories(): Promise<string[]> {
  const { data } = await supabase
    .from("roofing_content")
    .select("scheduled_topic")
    .in("type", ["youtube_short", "youtube_long"])
    .order("created_at", { ascending: false })
    .limit(16);
  return (data || []).map((r: Record<string, string>) => r.scheduled_topic).filter(Boolean);
}

function pickNextCategories(recentCategories: string[], count: number): typeof CATEGORIES {
  const categoryCounts: Record<string, number> = {};
  for (const cat of CATEGORIES) categoryCounts[cat.topic] = 0;
  for (const recent of recentCategories) {
    if (categoryCounts[recent] !== undefined) categoryCounts[recent]++;
  }
  const sorted = [...CATEGORIES].sort((a, b) => categoryCounts[a.topic] - categoryCounts[b.topic]);
  // Cycle through all categories to fill count
  const result: typeof CATEGORIES = [];
  let i = 0;
  while (result.length < count) {
    result.push(sorted[i % sorted.length]);
    i++;
  }
  return result;
}

function isTitleDuplicate(title: string, recentTitles: string[]): boolean {
  const normalized = title.toLowerCase();
  return recentTitles.some(existing => {
    const words = existing.split(" ").filter((w: string) => w.length > 4);
    const matches = words.filter((w: string) => normalized.includes(w)).length;
    return matches >= 4;
  });
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

async function generateShort(
  category: typeof CATEGORIES[0],
  market: string,
  carrier: string,
  recentTitles: string[]
): Promise<{
  title: string; script: string; hook_text: string;
  thumbnail_text: string; topic_category: string; target_keywords: string[];
} | null> {
  const month = new Date().toLocaleString("en-US", { month: "long" });

  const prompt = `Topic: ${category.topic}
Angle: ${category.angle}
Market: ${market}
Carrier context: ${carrier}
Month: ${month}

Write a 30-second YouTube Short script following the system instructions exactly.
Generate a fresh, specific title that isn't generic. Include a real dollar amount or specific number in the hook.`;

  const raw = await claude(SHORT_SYSTEM, prompt, 800);
  if (!raw) return null;

  const { script, hook_text, thumbnail_text, topic_category, target_keywords } = parseScriptFields(raw);

  // Derive title from hook or first line
  const firstLine = script.split("\n").find(l => l.trim() && !l.match(/^(HOOK|PROBLEM|SOLUTION|CTA):/i))?.trim();
  const title = (hook_text || firstLine || script.slice(0, 80)).slice(0, 100);

  if (isTitleDuplicate(title, recentTitles)) return null;

  return { title, script, hook_text, thumbnail_text, topic_category: topic_category || category.topic, target_keywords };
}

async function generateLongForm(
  topic: string,
  market: string
): Promise<{
  title: string; script: string; hook_text: string;
  thumbnail_text: string; topic_category: string; target_keywords: string[];
} | null> {
  const LONG_FORM_TOPICS: Record<string, string> = {
    homeowner_calls: "Complete Guide to Stopping Homeowner Calls During Installations (2026)",
    supplement_ai:   "How to Recover $3,000+ in Denied Supplements Using AI (Step by Step)",
    cancel_companycam: "Cancel CompanyCam: Complete Roofing OS Setup Guide (Free Forever)",
    storm_playbook:  "Storm Season Playbook: How Top Roofers Get Leads Before Anyone Else",
  };

  const title = LONG_FORM_TOPICS[topic] || LONG_FORM_TOPICS.homeowner_calls;

  const prompt = `Topic: ${topic}
Title: ${title}
Market: ${market}

Write a complete 10-minute video script following the system instructions. This is for YouTube long-form (not a Short). Target 1,400-1,600 words.`;

  const raw = await claude(LONG_FORM_SYSTEM, prompt, 2000);
  if (!raw) return null;

  const { script, hook_text, thumbnail_text, topic_category, target_keywords } = parseScriptFields(raw);

  return { title, script, hook_text, thumbnail_text, topic_category: topic_category || topic, target_keywords };
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-engine v3 ready" });

  const startMs = Date.now();

  const storm   = await getStormContext();
  const carrier = await getCarrierContext();
  const market  = storm ? `${storm.city}, ${storm.state}` : "Denver, CO";
  const carrierName = carrier || "State Farm";

  // Long-form mode
  if (body.long_form) {
    const topics = ["homeowner_calls", "supplement_ai", "cancel_companycam", "storm_playbook"];
    const count  = Math.min(body.count || 4, topics.length);
    const generated: string[] = [];

    for (const topic of topics.slice(0, count)) {
      const result = await generateLongForm(topic, market);
      if (!result) continue;

      const { error } = await supabase.from("roofing_content").insert({
        type:                "youtube_long",
        format:              "video",
        title:               result.title,
        body:                result.script,
        hook:                result.hook_text,
        hook_text:           result.hook_text,
        thumbnail_text:      result.thumbnail_text,
        topic_category:      result.topic_category,
        target_keywords:     result.target_keywords,
        status:              "approved",
        channel:             "youtube",
        scheduled_topic:     result.topic_category,
        market,
        tags:                [result.topic_category, "youtube_long", market],
        youtube_upload_ready: false,
      });

      if (!error) generated.push(result.title);
      await new Promise(r => setTimeout(r, 1000));
    }

    return Response.json({ ok: true, generated: generated.length, titles: generated, duration_ms: Date.now() - startMs });
  }

  // Short-form mode (default)
  const count = Math.min(body.count || 6, 20);
  const [recentTitles, recentCategories] = await Promise.all([
    getRecentTitles(),
    getRecentCategories(),
  ]);

  const selectedCategories = pickNextCategories(recentCategories, count);
  let generated = 0;
  const titles: string[] = [];

  for (const category of selectedCategories) {
    const result = await generateShort(category, market, carrierName, recentTitles);
    if (!result) continue;

    const { error } = await supabase.from("roofing_content").insert({
      type:                "youtube_short",
      format:              "video",
      title:               result.title,
      body:                result.script,
      hook:                result.hook_text,
      hook_text:           result.hook_text,
      thumbnail_text:      result.thumbnail_text,
      topic_category:      result.topic_category,
      target_keywords:     result.target_keywords,
      status:              "approved",
      channel:             "youtube",
      scheduled_topic:     result.topic_category,
      market,
      carrier:             carrierName,
      tags:                [result.topic_category, "youtube_short", market, ...result.target_keywords.slice(0, 3)],
      youtube_upload_ready: false,
    });

    if (!error) {
      generated++;
      titles.push(result.title);
      recentTitles.push(result.title.toLowerCase());
    }

    await new Promise(r => setTimeout(r, 600));
  }

  try {
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-youtube-engine",
      status: "ok",
      response_ms: Date.now() - startMs,
      checked_at: new Date().toISOString(),
    });
  } catch { /* non-fatal */ }

  return Response.json({ ok: true, generated, titles, duration_ms: Date.now() - startMs });
});

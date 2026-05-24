// roofing-youtube-engine v3
// New conversion-focused script format, 8-category rotation, long-form mode,
// hook_text/thumbnail_text/topic_category/target_keywords extracted per script.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ALL topics must be directly about a Roofing OS feature or product.
// NEVER generate generic roofing tips, supplement tactics, or carrier advice.
const CATEGORIES = [
  { topic: "homeowner_portal",       angle: "the homeowner portal — real-time photos and job updates on their phone, so they stop calling" },
  { topic: "companycam_replacement", angle: "canceling CompanyCam and getting unlimited photo storage + homeowner portal free with Roofing OS" },
  { topic: "supplement_ai",          angle: "the Roofing OS AI supplement tool — scan your job photos, AI finds missed line items automatically" },
  { topic: "storm_leads",            angle: "the Roofing OS storm leads feature — get notified when hail hits your market, run to the jobs first" },
  { topic: "contractor_dashboard",   angle: "the Roofing OS contractor dashboard — all your jobs, homeowners, and status in one screen" },
  { topic: "crew_photo_upload",      angle: "crew photo upload via SMS — your crew texts photos, homeowner portal updates in real time" },
  { topic: "review_request",         angle: "the Roofing OS review request flow — one tap sends homeowner a review link after job close" },
  { topic: "referral_system",        angle: "the Roofing OS referral system — homeowners refer neighbors, contractors earn free job credits" },
  { topic: "magic_link",             angle: "the Roofing OS magic link — one link sent to homeowner, they see their entire project live" },
  { topic: "portal_pro_vs_free",     angle: "Roofing OS Free vs Starter — what 5 jobs free gets you and what $149/mo unlocks" },
];

const SHORT_SYSTEM = `You write 30-second YouTube Shorts scripts for roofing contractors about Roofing OS features.

CRITICAL RULE: Every single script MUST be about a specific Roofing OS feature or product.
NEVER write about: generic supplement tactics, State Farm tips, carrier advice, general business tips, or anything not directly tied to a Roofing OS feature.

APPROVED TOPICS ONLY:
- The homeowner portal (real-time photos, job updates, one link)
- Replacing CompanyCam with Roofing OS for free
- The AI supplement tool
- Storm leads feature
- The contractor dashboard
- Crew photo upload via SMS
- Automated review requests
- The referral system
- The magic link
- Free vs Starter ($149/mo) comparison

STRUCTURE (exact):
HOOK (0-3 sec): ONE sentence. Under 12 words. Specific pain. Contractor-to-contractor voice.
Examples that work:
"Your homeowner called 6 times today. Roofing OS stops that."
"CompanyCam just charged you $49. Again. We do it free."
"Your crew showed up. Nobody told the homeowner."

PROBLEM (3-8 sec): 2 sentences. The daily pain this Roofing OS feature solves.

SOLUTION (8-22 sec): Show the Roofing OS feature as an outcome, not a description.
NEVER: "Roofing OS has a portal feature."
ALWAYS: "Your homeowner sees every photo your crew takes in real time. They stop calling."

CTA (22-30 sec): Include "roofingos.dev" twice. Include "free forever, no credit card" once.

RULES:
- 90-110 words total
- Always name the specific Roofing OS feature
- Use "you/your" not "we/our"
- Sound like a contractor, not a marketer

After the script provide:
hook_text: [hook sentence, under 12 words]
thumbnail_text: [4 words max, ALL CAPS]
topic_category: [exact topic key from APPROVED TOPICS]
target_keywords: [5 YouTube search terms, comma-separated]`;

const LONG_FORM_SYSTEM = `You write 10-minute YouTube video scripts for roofing contractors about Roofing OS features.

CRITICAL RULE: Every script MUST be about a specific Roofing OS product or feature.
NEVER write generic roofing advice. Every section must tie back to Roofing OS.

APPROVED LONG-FORM TOPICS:
- How Roofing OS stops homeowner calls (homeowner portal walkthrough)
- Cancel CompanyCam: Roofing OS full setup guide
- Roofing OS AI supplement tool: step-by-step walkthrough
- Roofing OS storm leads feature: how to use it
- Free vs Starter: what you get at each Roofing OS tier

STRUCTURE:
INTRO (0-60 sec): The exact pain the Roofing OS feature solves. What they'll learn.

PROBLEM (60-180 sec): What contractors experience without this feature. Specific scenarios, costs.

FEATURE WALKTHROUGH (180-360 sec): Walk through the specific Roofing OS feature step by step. What the contractor does. What the homeowner sees. Be specific about every screen and action.

RESULTS (360-480 sec): Specific before/after. Time saved, calls stopped, money recovered. Frame as outcomes from this feature.

OUTRO (480-600 sec): roofingos.dev. What happens in first 4 minutes. Free forever, no credit card.

RULES:
- 1,400-1,600 words
- Name "Roofing OS" at least 6 times
- Mention roofingos.dev at least 4 times
- Include at least 3 specific numbers (time saved, dollars, calls stopped)
- Use "you/your" throughout

After the script provide:
hook_text: [first sentence only]
thumbnail_text: [4 words max, ALL CAPS]
topic_category: [one of the approved topic keys]
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
    homeowner_portal:   "How Roofing OS Stops Homeowner Calls Completely (Full Portal Walkthrough)",
    cancel_companycam:  "Cancel CompanyCam: Complete Roofing OS Setup Guide (Free Forever)",
    supplement_ai:      "Roofing OS AI Supplement Tool: How It Finds Missed Line Items (Walkthrough)",
    storm_leads:        "Roofing OS Storm Leads: How to Get Jobs Before Any Other Crew (Step by Step)",
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

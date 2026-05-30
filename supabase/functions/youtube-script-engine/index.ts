import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type VideoType = "comparison" | "tutorial" | "educational" | "local" | "short";

async function ai(prompt: string, model = "claude-haiku-4-5-20251001"): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

async function generateScript(
  type: VideoType,
  context: Record<string, string>,
): Promise<{ script: string; title: string; description: string; tags: string[] }> {
  const prompts: Record<VideoType, string> = {
    comparison: `Write a 3-minute YouTube script comparing Roofing OS vs ${context.competitor}.

Hook (15s): "If you're paying for ${context.competitor}, watch this before your next billing cycle."

Cover:
1. Price difference (be specific)
2. Feature Roofing OS has that ${context.competitor} lacks
3. Feature ${context.competitor} has (be honest)
4. Who should switch and who shouldn't
5. CTA: "Free at roofingos.dev"

Voice: Zach Curtis. Direct. No hype. Like a contractor telling his buddy the truth.
Return JSON: {"script":"...","title":"...","description":"...","tags":["..."]}`,

    tutorial: `Write a 2-minute YouTube tutorial script.
Topic: "${context.feature}"

Structure:
0:00 "I'll show you how to ${context.feature} in under 2 minutes"
0:10 Why this matters (one sentence)
0:20 Step 1 (specific action)
0:45 Step 2 (specific action)
1:10 Step 3 (specific action)
1:35 Result + what to do next
1:50 "Free at roofingos.dev"

Voice: Screen recording walkthrough style. Clear. Simple. No wasted words.
Return JSON: {"script":"...","title":"...","description":"...","tags":["..."]}`,

    educational: `Write a 4-minute educational YouTube script.
Topic: "${context.topic}"
Audience: Roofing contractors

Hook (20s): Surprising stat or bold claim
Problem (40s): The real pain contractors feel
Solution (2min): Practical advice they can use TODAY
Roofing OS mention (30s): Natural, not forced
CTA (30s): "roofingos.dev — free to start"

Voice: Zach Curtis. Think Joe Rogan meets contractor. Real talk. No fluff.
Return JSON: {"script":"...","title":"...","description":"...","tags":["..."]}`,

    local: `Write a 2-minute YouTube script about roofing in ${context.city}, ${context.state}.

Cover:
1. Hail/storm risk in ${context.city}
2. Insurance claim landscape there
3. What top ${context.city} roofers do differently
4. How software helps in ${context.city} market
5. "Free at roofingos.dev"

Target keyword: "roofing contractor ${context.city}"
Return JSON: {"script":"...","title":"...","description":"...","tags":["..."]}`,

    short: `Write a 45-second YouTube Shorts script.
Topic: "${context.topic}"

Structure:
0:00-0:05 Hook (one punchy sentence)
0:05-0:35 One specific tip or fact
0:35-0:45 CTA

Fast paced. No filler words. Every second counts.
Return JSON: {"script":"...","title":"...","description":"...","tags":["..."]}`,
  };

  const usesSonnet = type === "comparison" || type === "educational";
  const result = await ai(prompts[type], usesSonnet ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001");

  try {
    return JSON.parse(result.replace(/```json|```/g, "").trim());
  } catch {
    return {
      script: result,
      title: context.title || `Roofing OS ${type}`,
      description: "Free roofing contractor software at roofingos.dev",
      tags: ["roofing software", "roofing CRM", "roofingos"],
    };
  }
}

async function queueVideo(
  type: VideoType,
  title: string,
  script: string,
  description: string,
  tags: string[],
) {
  try {
    await supabase.from("youtube_video_queue").insert({
      title,
      script,
      status: "pending",
      video_type: type,
      seo_description: description,
      seo_tags: tags,
    });
  } catch { /* non-critical */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "youtube-script-engine v2 ready" }, { headers: CORS });
  }

  const queued: Array<{ type: string; title: string }> = [];

  // 1. Comparison video (VS competitor)
  const competitors = ["JobNimbus", "AccuLynx", "CompanyCam", "Roofr", "Jobber", "ServiceTitan"];
  // Pick the competitor we haven't done recently
  const { data: recentComps } = await supabase
    .from("youtube_video_queue")
    .select("title")
    .eq("video_type", "comparison")
    .order("created_at", { ascending: false })
    .limit(6);
  const usedComps = (recentComps || []).map((r) => r.title);
  const nextComp = competitors.find((c) => !usedComps.some((u) => u.includes(c))) || competitors[0];

  const comp = await generateScript("comparison", { competitor: nextComp });
  await queueVideo("comparison", comp.title, comp.script, comp.description, comp.tags);
  queued.push({ type: "comparison", title: comp.title });

  // 2. Tutorial videos (2 per run)
  const features = [
    "send a homeowner portal in 60 seconds",
    "create your first roofing job",
    "order aerial measurements",
    "set up your crew on Roofing OS",
    "track a supplement claim step by step",
  ];
  for (const feature of features.slice(0, 2)) {
    const result = await generateScript("tutorial", { feature });
    await queueVideo("tutorial", result.title, result.script, result.description, result.tags);
    queued.push({ type: "tutorial", title: result.title });
  }

  // 3. Educational video (1 per run)
  const topics = [
    "how top roofers close more insurance jobs",
    "storm season preparation checklist",
    "how to get 5-star Google reviews automatically",
    "supplement secrets insurance adjusters hate",
    "how to scale from 10 to 50 jobs a month",
  ];
  const edTopic = topics[new Date().getDay() % topics.length];
  const edu = await generateScript("educational", { topic: edTopic });
  await queueVideo("educational", edu.title, edu.script, edu.description, edu.tags);
  queued.push({ type: "educational", title: edu.title });

  // 4. Local market video (1 per run)
  const cities = [
    { city: "Denver", state: "CO" },
    { city: "Dallas", state: "TX" },
    { city: "Oklahoma City", state: "OK" },
    { city: "Atlanta", state: "GA" },
    { city: "Nashville", state: "TN" },
    { city: "Phoenix", state: "AZ" },
    { city: "Chicago", state: "IL" },
  ];
  const cityCtx = cities[new Date().getDate() % cities.length];
  const local = await generateScript("local", cityCtx);
  await queueVideo("local", local.title, local.script, local.description, local.tags);
  queued.push({ type: "local", title: local.title });

  // 5. YouTube Short (1 per run)
  const shortTopics = [
    "one roofing software feature that saves 2 hours a day",
    "why roofers lose money on insurance claims",
    "the 60-second homeowner portal demo",
    "how to double your close rate on storm jobs",
    "the supplement line item every roofer misses",
  ];
  const shortTopic = shortTopics[new Date().getHours() % shortTopics.length];
  const short = await generateScript("short", { topic: shortTopic });
  await queueVideo("short", short.title, short.script, short.description, short.tags);
  queued.push({ type: "short", title: short.title });

  return Response.json({ ok: true, queued: queued.length, videos: queued }, { headers: CORS });
});

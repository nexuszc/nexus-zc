import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getFullSEOState() {
  const [
    posts,
    videos,
    keywords,
    backlinks,
    locationCount,
    carrierCount,
    materialCount,
    stateCount,
    performance,
    trending,
  ] = await Promise.all([
    supabase.from("seo_posts").select("title, quality_score, word_count").eq("status", "published").order("published_at", { ascending: false }).limit(5),
    supabase.from("youtube_video_queue").select("title, video_type, status").order("created_at", { ascending: false }).limit(5),
    supabase.from("seo_keyword_queue").select("keyword").eq("status", "pending").order("created_at", { ascending: false }).limit(10),
    supabase.from("seo_backlink_targets").select("domain, domain_authority, status").order("domain_authority", { ascending: false }).limit(5),
    supabase.from("seo_location_pages").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("seo_carrier_pages").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("seo_material_pages").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("seo_state_pages").select("id", { count: "exact", head: true }).eq("status", "published"),
    supabase.from("seo_posts").select("keyword, google_clicks, google_impressions, google_position").gt("google_clicks", 0).order("google_clicks", { ascending: false }).limit(5),
    supabase.from("seo_keyword_queue").select("keyword").eq("source", "trend-detector").order("created_at", { ascending: false }).limit(5),
  ]);

  return {
    posts: posts.data || [],
    videos: videos.data || [],
    top_keywords: keywords.data || [],
    backlinks: backlinks.data || [],
    page_counts: {
      locations: locationCount.count || 0,
      carriers: carrierCount.count || 0,
      materials: materialCount.count || 0,
      states: stateCount.count || 0,
    },
    performance: performance.data || [],
    trending: trending.data || [],
  };
}

async function generateAdvisory(state: Awaited<ReturnType<typeof getFullSEOState>>): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `You are Nexus — Zach Curtis's AI Chief of Staff for Roofing OS.
Give a sharp SEO advisory. Be a COO. Direct. Numbers. No fluff.

Current SEO state:
- Published posts: ${state.posts.length} (latest: ${state.posts[0]?.title || "none"})
- Videos published: ${state.videos.filter((v) => v.status === "published").length}
- Location pages: ${state.page_counts.locations}
- Carrier pages: ${state.page_counts.carriers}
- Material pages: ${state.page_counts.materials}
- State pages: ${state.page_counts.states}
- Keywords in queue: ${state.top_keywords.length}
  Top: ${state.top_keywords[0]?.keyword || "none"}
- Backlink targets ready: ${state.backlinks.length}
  Best: ${state.backlinks[0]?.domain || "none"} (DA ${state.backlinks[0]?.domain_authority || 0})
- GSC clicks: ${state.performance.length > 0 ? "getting clicks" : "no GSC data yet — site too new"}
  Top: ${state.performance[0]?.keyword || "none"} (${state.performance[0]?.google_clicks || 0} clicks)
- Trending topics queued: ${state.trending.map((t: { keyword: string }) => t.keyword).join(", ") || "none detected yet"}

Write a 150-word advisory covering:
1. What's working right now (be specific with numbers)
2. What needs attention most urgently
3. One backlink outreach Zach should personally send TODAY (specific domain from list)
4. Single priority action for tomorrow

Second person ("Your site..."). No bullet points. Flowing sentences. No SEO 101 explanations.`,
      }],
    }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "Advisory unavailable.";
}

async function sendTelegram(msg: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: msg, parse_mode: "HTML" }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "nexus-seo-advisor ready" }, { headers: CORS });
  }

  const state = await getFullSEOState();
  const advisory = await generateAdvisory(state);

  const msg = `🧠 <b>Nexus SEO Advisory</b>
${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}

${advisory}

<b>Quick actions:</b>
- "seo boost" → run orchestrator now
- "seo brief" → full status report
- "seo backlinks" → send top 5 outreach
- "seo write [topic]" → write post now`;

  await sendTelegram(msg);

  try {
    await supabase.from("entries").insert({
      content: `SEO Advisory: ${advisory}`,
      type: "seo_advisory",
      importance: 3,
      project_names: ["Roofing OS", "SEO"],
      task_status: "completed",
    });
  } catch { /* non-critical */ }

  return Response.json({
    ok: true,
    advisory,
    state_summary: {
      posts: state.posts.length,
      videos: state.videos.length,
      keywords_queued: state.top_keywords.length,
      backlinks_ready: state.backlinks.length,
    },
  }, { headers: CORS });
});

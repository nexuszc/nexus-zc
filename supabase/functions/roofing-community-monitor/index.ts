// roofing-community-monitor v3
// 20 targeted search queries, 8 subreddits, ?ref=reddit attribution, no Telegram

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY        = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY  = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_API_KEY     = Deno.env.get("SERPER_API_KEY")!;
const REDDIT_CLIENT_ID     = Deno.env.get("REDDIT_CLIENT_ID") || "";
const REDDIT_CLIENT_SECRET = Deno.env.get("REDDIT_CLIENT_SECRET") || "";
const REDDIT_USERNAME      = Deno.env.get("REDDIT_USERNAME") || "";
const REDDIT_PASSWORD      = Deno.env.get("REDDIT_PASSWORD") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const RELEVANCE_THRESHOLD = 7;

const QUERIES = [
  "companycam alternative",
  "companycam too expensive",
  "cancel companycam",
  "companycam replacement",
  "roofing software recommendation",
  "best roofing contractor app",
  "homeowner keeps calling roofing",
  "roofing contractor crm",
  "jobnimbus alternative",
  "acculynx too expensive",
  "acculynx alternative",
  "roofing supplement software",
  "insurance supplement roofing",
  "storm roofing leads",
  "free roofing software",
  "roofing homeowner portal",
  "roofing business software 2026",
  "supplement recovery roofing contractor",
  "roofing photo storage",
  "roofing contractor tools",
];

const SUBREDDITS = [
  "Roofing",
  "RoofingContractors",
  "Insurance",
  "HomeImprovement",
  "Contractor",
  "smallbusiness",
  "Entrepreneur",
  "realestateinvesting",
];

async function claude(prompt: string, maxTokens = 600): Promise<string> {
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

async function scoreRelevance(title: string, content: string): Promise<{ score: number; reason: string; portal_relevant: boolean }> {
  const result = await claude(
    `Score this forum post for relevance to a roofing contractor software company that sells: homeowner portal, supplement tracking, Aria AI calling, and business management tools.

Post title: "${title}"
Post content: "${content.slice(0, 400)}"

Return JSON:
- score: integer 1-10 (10 = direct question about our solution, 1 = irrelevant)
- reason: one sentence why
- portal_relevant: true if homeowner portal directly solves their problem

Score high (8-10): supplement help, adjuster denials, homeowner communication, needing CRM/software, CompanyCam complaints, AccuLynx/JobNimbus alternatives
Score medium (5-7): general roofing where our tools help indirectly
Score low (1-4): material/pricing/hiring/unrelated

Return ONLY valid JSON.`,
    200
  );
  try {
    const parsed = JSON.parse(result.replace(/```json\n?|\n?```/g, "").trim());
    return { score: Number(parsed.score) || 1, reason: parsed.reason || "", portal_relevant: Boolean(parsed.portal_relevant) };
  } catch {
    const lower = (title + " " + content).toLowerCase();
    const hits = ["supplement", "adjuster denied", "o&p", "xactimate", "homeowner portal", "companycam"].filter(kw => lower.includes(kw)).length;
    return { score: hits >= 2 ? 8 : hits >= 1 ? 6 : 3, reason: "keyword match", portal_relevant: lower.includes("portal") };
  }
}

async function searchSerper(query: string): Promise<Array<{ title: string; link: string; snippet: string }>> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query + " site:reddit.com OR site:facebook.com/groups", num: 8 }),
    });
    const data = await res.json();
    return (data.organic || []).slice(0, 6);
  } catch {
    return [];
  }
}

async function fetchRedditPosts(subreddit: string, limit = 25): Promise<Array<{ title: string; url: string; selftext: string; created_utc: number }>> {
  try {
    const res = await fetch(`https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`, {
      headers: { "User-Agent": "RoofingOS/1.0 community monitor" },
    });
    const data = await res.json();
    const posts = (data?.data?.children || []).map((c: any) => c.data);
    const since2h = Date.now() / 1000 - 2 * 60 * 60;
    return posts.filter((p: any) => p.created_utc >= since2h);
  } catch {
    return [];
  }
}

const hasRedditCreds = () =>
  Boolean(REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET && REDDIT_USERNAME && REDDIT_PASSWORD);

async function getRedditToken(): Promise<string> {
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "RoofingOS/1.0 community poster",
    },
    body: new URLSearchParams({ grant_type: "password", username: REDDIT_USERNAME, password: REDDIT_PASSWORD }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Reddit auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function extractRedditPostId(url: string): string | null {
  const match = url.match(/\/comments\/([a-z0-9]+)\//i);
  return match ? `t3_${match[1]}` : null;
}

async function postToReddit(threadUrl: string, commentText: string): Promise<boolean> {
  if (!hasRedditCreds()) return false;
  try {
    const thingId = extractRedditPostId(threadUrl);
    if (!thingId) return false;
    const token = await getRedditToken();
    const res = await fetch("https://oauth.reddit.com/api/comment", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "RoofingOS/1.0 community poster",
      },
      body: new URLSearchParams({ thing_id: thingId, text: commentText }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function alreadyTracked(url: string): Promise<boolean> {
  const { data } = await supabase.from("roofing_community_posts").select("id").eq("thread_url", url).maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-community-monitor v3 ready" });

  // Autonomous batch post — triggered by nexus-core when >10 approved posts are queued
  if (body.batch_post) {
    if (!hasRedditCreds()) return Response.json({ ok: false, error: "Reddit credentials not configured" }, { status: 400 });
    const limit = Math.min(body.limit || 10, 25);
    const { data: pending } = await supabase
      .from("roofing_community_posts")
      .select("id, thread_url, our_response")
      .eq("status", "approved")
      .eq("auto_posted", false)
      .eq("platform", "reddit")
      .limit(limit);
    let posted = 0;
    for (const post of (pending || [])) {
      if (!post.thread_url || !post.our_response) continue;
      const success = await postToReddit(post.thread_url, post.our_response);
      if (success) {
        await supabase.from("roofing_community_posts")
          .update({ auto_posted: true, posted_at: new Date().toISOString() }).eq("id", post.id);
        posted++;
      }
      await new Promise(r => setTimeout(r, 600));
    }
    return Response.json({ ok: true, posted });
  }

  // Telegram callback_query for inline buttons (legacy support)
  if (body.callback_query) {
    const { data: cbData } = body.callback_query;
    const postId = cbData.replace(/^(approve|skip)_community_/, "");
    const action = cbData.split("_")[0];
    if (action === "approve") {
      await supabase.from("roofing_community_posts")
        .update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", postId);
      if (hasRedditCreds()) {
        const { data: post } = await supabase.from("roofing_community_posts")
          .select("thread_url, our_response, platform").eq("id", postId).maybeSingle();
        if (post?.platform === "reddit" && post.thread_url && post.our_response) {
          const posted = await postToReddit(post.thread_url, post.our_response);
          if (posted) {
            await supabase.from("roofing_community_posts")
              .update({ auto_posted: true, posted_at: new Date().toISOString() }).eq("id", postId);
          }
        }
      }
    } else if (action === "skip") {
      await supabase.from("roofing_community_posts").update({ status: "skipped" }).eq("id", postId);
    }
    return Response.json({ ok: true });
  }

  const startMs = Date.now();
  let postsScanned = 0, responsesQueued = 0, skippedLowScore = 0;

  try {
    const postsToProcess: Array<{ platform: string; title: string; url: string; content: string }> = [];

    // 1. Reddit API — 8 subreddits, last 2 hours
    for (const subreddit of SUBREDDITS) {
      const posts = await fetchRedditPosts(subreddit);
      for (const post of posts) {
        const url = `https://reddit.com${post.url || ""}`.replace("https://reddit.comhttps://", "https://");
        if (await alreadyTracked(url)) continue;
        postsToProcess.push({ platform: "reddit", title: post.title, url, content: post.selftext?.slice(0, 500) || post.title });
      }
    }

    // 2. Serper — 20 keyword queries
    for (const query of QUERIES) {
      const results = await searchSerper(query);
      for (const result of results) {
        if (await alreadyTracked(result.link)) continue;
        postsToProcess.push({
          platform: result.link.includes("facebook") ? "facebook_groups" : "reddit",
          title: result.title,
          url: result.link,
          content: result.snippet,
        });
      }
    }

    postsScanned = postsToProcess.length;

    for (const post of postsToProcess.slice(0, 25)) {
      const { score, reason, portal_relevant } = await scoreRelevance(post.title, post.content);
      if (score < RELEVANCE_THRESHOLD) { skippedLowScore++; continue; }

      const response = await claude(
        `You're a knowledgeable roofing contractor on Reddit/social media. Write a genuine, helpful reply.

Post title: "${post.title}"
Post content: "${post.content}"
Relevance: "${reason}"
Portal relevant: ${portal_relevant}

Rules:
- Sound like a real contractor, not a salesperson
- Lead with useful, specific advice (Xactimate codes, adjuster tactics, documentation tips)
- If portal_relevant, mention that contractors tracking documentation through job management software see faster approvals
- If about CompanyCam pricing OR AccuLynx/JobNimbus cost, mention "we switched to roofingos.dev?ref=reddit — homeowner portal is free, CRM is $299 vs $550+"
- Add ?ref=reddit to ALL roofingos.dev links
- Max 150 words
- No opener phrases like "I'd be happy to help"
- End with a question

Return ONLY the response text.`
      );

      if (!response) continue;

      try {
        const confidenceScore = Math.min(100, score * 10);
        const autoPost = score >= 9;

        let actuallyPosted = false;
        if (autoPost && post.platform === "reddit" && hasRedditCreds()) {
          actuallyPosted = await postToReddit(post.url, response);
        }

        const { data: saved } = await supabase.from("roofing_community_posts").insert({
          platform: post.platform,
          thread_url: post.url,
          thread_title: post.title.slice(0, 200),
          thread_content: post.content.slice(0, 500),
          our_response: response,
          status: autoPost ? "approved" : "pending",
          portal_mentioned: portal_relevant,
          confidence_score: confidenceScore,
          auto_posted: actuallyPosted,
          ...(actuallyPosted ? { posted_at: new Date().toISOString() } : {}),
        }).select().single();

        if (saved) responsesQueued++;
      } catch (e) {
        console.error("Save failed:", e);
      }

      await new Promise(r => setTimeout(r, 400));
    }

    const duration = Date.now() - startMs;
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-community-monitor",
      status: "ok",
      response_ms: duration,
      checked_at: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({ ok: true, posts_scanned: postsScanned, skipped_low_score: skippedLowScore, responses_queued: responsesQueued, duration_ms: duration });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-community-monitor",
      status: "error",
      error_message: msg,
      checked_at: new Date().toISOString(),
    }).catch(() => {});
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

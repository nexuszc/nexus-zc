// roofing-community-monitor — Every 2 hours
// Monitors Reddit and Facebook Groups for relevant posts, drafts helpful responses

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function claude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function searchSerper(query: string): Promise<Array<{ title: string; link: string; snippet: string }>> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 10 })
    });
    const data = await res.json();
    return (data.organic || []).slice(0, 8);
  } catch {
    return [];
  }
}

async function fetchRedditPosts(subreddit: string): Promise<Array<{ title: string; url: string; selftext: string; created_utc: number }>> {
  try {
    const res = await fetch(`https://www.reddit.com/r/${subreddit}/new.json?limit=25`, {
      headers: { "User-Agent": "RoofingOS/1.0 community monitor" }
    });
    const data = await res.json();
    const posts = (data?.data?.children || []).map((child: any) => child.data);
    const since2h = Date.now() / 1000 - 2 * 60 * 60;
    return posts.filter((p: any) => p.created_utc >= since2h);
  } catch {
    return [];
  }
}

function isRelevant(text: string): boolean {
  const keywords = [
    "homeowner call", "supplement software", "customer portal", "hail storm roofer",
    "roofing app", "adjuster denied", "O&P denied", "o&p", "xactimate",
    "supplement denied", "insurance claim", "adjuster", "supplement",
    "how do i", "recommend", "software", "crm", "help with"
  ];
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw));
}

async function alreadyTracked(threadUrl: string): Promise<boolean> {
  const { data } = await supabase
    .from("roofing_community_posts")
    .select("id")
    .eq("thread_url", threadUrl)
    .maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-community-monitor ready" });

  const startMs = Date.now();
  let postsFound = 0;
  let responsesQueued = 0;

  try {
    const postsToProcess: Array<{ platform: string; title: string; url: string; content: string }> = [];

    // 1. Reddit r/Roofing and r/RoofingContractors
    for (const subreddit of ["Roofing", "RoofingContractors"]) {
      const posts = await fetchRedditPosts(subreddit);
      for (const post of posts) {
        if (!isRelevant(post.title + " " + (post.selftext || ""))) continue;
        const url = `https://reddit.com${post.url || ""}`.replace("https://reddit.comhttps://", "https://");
        if (await alreadyTracked(url)) continue;
        postsToProcess.push({
          platform: "reddit",
          title: post.title,
          url,
          content: post.selftext?.slice(0, 500) || post.title
        });
      }
    }

    // 2. Serper web search for each keyword group
    const searchQueries = [
      `site:reddit.com roofing "supplement software" OR "homeowner portal" OR "adjuster denied" 2026`,
      `site:reddit.com/r/Roofing "O&P" OR "supplement" OR "hail claim" help`,
      `site:facebook.com/groups roofing contractor "supplement" OR "adjuster" OR "insurance claim" 2026`,
      `site:reddit.com roofing contractor app CRM recommendation 2026`
    ];

    for (const query of searchQueries) {
      const results = await searchSerper(query);
      for (const result of results) {
        if (!isRelevant(result.title + " " + result.snippet)) continue;
        if (await alreadyTracked(result.link)) continue;
        postsToProcess.push({
          platform: result.link.includes("facebook") ? "facebook_groups" : "reddit",
          title: result.title,
          url: result.link,
          content: result.snippet
        });
      }
    }

    postsFound = postsToProcess.length;

    // Draft responses for each relevant post
    for (const post of postsToProcess.slice(0, 10)) {
      const response = await claude(
        `You're a knowledgeable roofing contractor on Reddit/social media. Write a genuine, helpful reply to this post.

Post title: "${post.title}"
Post content: "${post.content}"

Rules:
- Sound like a real contractor, not a salesperson
- Lead with genuinely useful advice (be specific — mention actual Xactimate codes, adjuster tactics, documentation tips)
- If relevant, you can mention Roofing OS as a tool you use, but only if it directly answers their question
- Max 150 words
- No marketing speak, no "I'd be happy to help" openers
- End with a question to continue the conversation

Return ONLY the response text, nothing else.`
      );

      if (!response) continue;

      try {
        const { data: saved } = await supabase.from("roofing_community_posts").insert({
          platform: post.platform,
          thread_url: post.url,
          thread_title: post.title.slice(0, 200),
          thread_content: post.content.slice(0, 500),
          our_response: response,
          status: "pending"
        }).select().single();

        if (saved) {
          await tg(
            `🗣️ *Community Post — ${post.platform}*\n` +
            `*${post.title.slice(0, 80)}*\n` +
            `🔗 ${post.url}\n\n` +
            `*Our response:*\n${response.slice(0, 500)}\n\n` +
            `Approve: \`approve community ${saved.id}\`\n` +
            `_Copy to clipboard on approval_`
          );
          responsesQueued++;
        }
      } catch (e) {
        console.error("Save community post failed:", e);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    const duration = Date.now() - startMs;

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-community-monitor",
      status: "ok",
      response_ms: duration,
      checked_at: new Date().toISOString()
    }).catch(() => {});

    if (responsesQueued === 0) {
      // Silent run — no new relevant posts
      return Response.json({ ok: true, posts_found: postsFound, responses_queued: 0, duration_ms: duration });
    }

    await tg(`✅ *Community Monitor Complete*\nPosts scanned: ${postsFound}\nResponses drafted: ${responsesQueued}\n_Reply with approve commands above to post_`);

    return Response.json({ ok: true, posts_found: postsFound, responses_queued: responsesQueued, duration_ms: duration });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-community-monitor",
      status: "error",
      error_message: msg,
      checked_at: new Date().toISOString()
    }).catch(() => {});
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

// roofing-community-monitor v2
// Relevance scoring 1-10 (only respond >= 7), portal_mentioned tracking, inline button approvals

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const RELEVANCE_THRESHOLD = 7;

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}


async function claude(prompt: string, maxTokens = 600): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function scoreRelevance(title: string, content: string): Promise<{ score: number; reason: string; portal_relevant: boolean }> {
  const result = await claude(
    `Score this forum post for relevance to a roofing contractor software company that sells: homeowner portal, supplement tracking, Aria AI calling, and business management tools.

Post title: "${title}"
Post content: "${content.slice(0, 400)}"

Return a JSON object with:
- score: integer 1-10 (10 = direct question about our exact solution, 1 = completely irrelevant)
- reason: one sentence why
- portal_relevant: boolean — true if the homeowner portal would directly solve their problem

Score high (8-10) for: supplement help, adjuster denials, homeowner communication issues, needing software/CRM, hail damage questions from contractors
Score medium (5-7) for: general roofing questions where our tools help but aren't the core answer
Score low (1-4) for: pricing questions, material questions, hiring, unrelated topics

Return ONLY valid JSON, no other text.`,
    200
  );

  try {
    const parsed = JSON.parse(result.replace(/```json\n?|\n?```/g, "").trim());
    return {
      score: Number(parsed.score) || 1,
      reason: parsed.reason || "",
      portal_relevant: Boolean(parsed.portal_relevant)
    };
  } catch {
    // Fallback: basic keyword score
    const lower = (title + " " + content).toLowerCase();
    const highValue = ["supplement", "adjuster denied", "o&p", "xactimate", "homeowner portal", "supplement software"].filter(kw => lower.includes(kw)).length;
    return { score: highValue >= 2 ? 8 : highValue >= 1 ? 6 : 3, reason: "keyword match", portal_relevant: lower.includes("portal") || lower.includes("homeowner") };
  }
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

  // Handle Telegram callback_query for inline buttons
  if (body.callback_query) {
    const { data: callbackData } = body.callback_query;
    const postId = callbackData.replace(/^(approve|skip)_community_/, "");
    const action = callbackData.split("_")[0];

    if (action === "approve") {
      await supabase.from("roofing_community_posts")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", postId);

      const { data: post } = await supabase
        .from("roofing_community_posts")
        .select("our_response, thread_url")
        .eq("id", postId)
        .maybeSingle();

      // Response copied from dashboard — no Telegram needed
    } else if (action === "skip") {
      await supabase.from("roofing_community_posts")
        .update({ status: "skipped" })
        .eq("id", postId);
    }
    return Response.json({ ok: true });
  }

  const startMs = Date.now();
  let postsScanned = 0;
  let responsesQueued = 0;
  let skippedLowScore = 0;

  try {
    const postsToProcess: Array<{ platform: string; title: string; url: string; content: string }> = [];

    // 1. Reddit r/Roofing and r/RoofingContractors
    for (const subreddit of ["Roofing", "RoofingContractors"]) {
      const posts = await fetchRedditPosts(subreddit);
      for (const post of posts) {
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

    // 2. Serper web search
    const searchQueries = [
      `site:reddit.com roofing "supplement software" OR "homeowner portal" OR "adjuster denied" 2026`,
      `site:reddit.com/r/Roofing "O&P" OR "supplement" OR "hail claim" help`,
      `site:facebook.com/groups roofing contractor "supplement" OR "adjuster" OR "insurance claim" 2026`,
      `site:reddit.com roofing contractor app CRM recommendation 2026`
    ];

    for (const query of searchQueries) {
      const results = await searchSerper(query);
      for (const result of results) {
        if (await alreadyTracked(result.link)) continue;
        postsToProcess.push({
          platform: result.link.includes("facebook") ? "facebook_groups" : "reddit",
          title: result.title,
          url: result.link,
          content: result.snippet
        });
      }
    }

    postsScanned = postsToProcess.length;

    // Score and respond to top posts
    for (const post of postsToProcess.slice(0, 15)) {
      const { score, reason, portal_relevant } = await scoreRelevance(post.title, post.content);

      if (score < RELEVANCE_THRESHOLD) {
        skippedLowScore++;
        continue;
      }

      const response = await claude(
        `You're a knowledgeable roofing contractor on Reddit/social media. Write a genuine, helpful reply to this post.

Post title: "${post.title}"
Post content: "${post.content}"
Relevance reason: "${reason}"
Portal relevant: ${portal_relevant}

Rules:
- Sound like a real contractor, not a salesperson
- Lead with genuinely useful advice (be specific — mention actual Xactimate codes, adjuster tactics, documentation tips)
- If portal_relevant is true, you can naturally mention that contractors tracking documentation through their job management system see faster approvals — don't name the product
- Max 150 words
- No marketing speak, no "I'd be happy to help" openers
- End with a question to continue the conversation

Return ONLY the response text, nothing else.`
      );

      if (!response) continue;

      try {
        // confidence_score: score * 10 (score 1-10 → 10-100)
        const confidenceScore = Math.min(100, score * 10);
        // Auto-post if score >= 9 (confidence >= 90), otherwise queue for review
        const autoPost = score >= 9;

        const { data: saved } = await supabase.from("roofing_community_posts").insert({
          platform: post.platform,
          thread_url: post.url,
          thread_title: post.title.slice(0, 200),
          thread_content: post.content.slice(0, 500),
          our_response: response,
          status: autoPost ? "approved" : "pending",
          portal_mentioned: portal_relevant,
          confidence_score: confidenceScore,
          auto_posted: false,
        }).select().single();

        if (saved) {
          responsesQueued++;
          // For medium confidence (75-90), send Telegram for quick review
          if (!autoPost && score >= 8) {
            const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
            const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
            if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
              await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: TELEGRAM_CHAT_ID,
                  text: `💬 *Community response ready* (score ${score}/10)\n\n*${post.title.slice(0, 80)}*\n\nDraft: "${response.slice(0, 200)}..."\n\nApprove in dashboard → Community tab`,
                  parse_mode: "Markdown",
                }),
              }).catch(() => {});
            }
          }
        }
      } catch (e) {
        console.error("Save community post failed:", e);
      }

      await new Promise(r => setTimeout(r, 400));
    }

    const duration = Date.now() - startMs;

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-community-monitor",
      status: "ok",
      response_ms: duration,
      checked_at: new Date().toISOString()
    }).catch(() => {});

    return Response.json({ ok: true, posts_scanned: postsScanned, skipped_low_score: skippedLowScore, responses_queued: responsesQueued, duration_ms: duration });

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

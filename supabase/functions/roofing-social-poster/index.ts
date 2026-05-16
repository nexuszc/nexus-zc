// roofing-social-poster
// Posts to Facebook and Reddit after a YouTube upload.
// Called automatically by roofing-youtube-uploader.
//
// REQUIRES SECRETS (manual setup in Supabase Dashboard):
//   FACEBOOK_PAGE_ID        — Roofing OS Facebook page ID
//   FACEBOOK_ACCESS_TOKEN   — Page access token (never-expiring via Business Manager)
//   REDDIT_CLIENT_ID        — Reddit app client ID (script type)
//   REDDIT_CLIENT_SECRET    — Reddit app client secret
//   REDDIT_USERNAME         — u/RoofingOS
//   REDDIT_PASSWORD         — account password

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FACEBOOK_PAGE_ID = Deno.env.get("FACEBOOK_PAGE_ID") || "";
const FACEBOOK_ACCESS_TOKEN = Deno.env.get("FACEBOOK_ACCESS_TOKEN") || "";
const REDDIT_CLIENT_ID = Deno.env.get("REDDIT_CLIENT_ID") || "";
const REDDIT_CLIENT_SECRET = Deno.env.get("REDDIT_CLIENT_SECRET") || "";
const REDDIT_USERNAME = Deno.env.get("REDDIT_USERNAME") || "";
const REDDIT_PASSWORD = Deno.env.get("REDDIT_PASSWORD") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" }),
  }).catch(() => {});
}

async function postToFacebook(title: string, hook: string, youtubeUrl: string): Promise<string | null> {
  if (!FACEBOOK_PAGE_ID || !FACEBOOK_ACCESS_TOKEN) return null;

  const message = `${hook}\n\nFull breakdown 👇\n${youtubeUrl}\n\n🏠 roofingos.dev — starts at $49/month`;

  const res = await fetch(
    `https://graph.facebook.com/v18.0/${FACEBOOK_PAGE_ID}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, link: youtubeUrl, access_token: FACEBOOK_ACCESS_TOKEN }),
    }
  );
  const data = await res.json();
  if (data.error) {
    console.error("Facebook error:", JSON.stringify(data.error));
    return null;
  }
  return data.id || null;
}

async function getRedditToken(): Promise<string | null> {
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) return null;

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "RoofingOS/1.0",
    },
    body: new URLSearchParams({ grant_type: "password", username: REDDIT_USERNAME, password: REDDIT_PASSWORD }),
  });
  const data = await res.json();
  return data.access_token || null;
}

async function postToReddit(
  accessToken: string,
  subreddit: string,
  title: string,
  youtubeUrl: string
): Promise<string | null> {
  const res = await fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "RoofingOS/1.0",
    },
    body: new URLSearchParams({ sr: subreddit, kind: "link", title: title.slice(0, 300), url: youtubeUrl, resubmit: "true" }),
  });
  const data = await res.json();
  const url = data.json?.data?.url || null;
  if (!url && data.json?.errors?.length) {
    console.error(`Reddit r/${subreddit} error:`, JSON.stringify(data.json.errors));
  }
  return url;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-social-poster ready" });

  const { content_id, youtube_url, title, hook } = body;
  if (!youtube_url || !title) return Response.json({ error: "youtube_url and title required" }, { status: 400 });

  const results: Record<string, string | null> = {};

  // Facebook
  try {
    results.facebook = await postToFacebook(title, hook || title, youtube_url);
  } catch (err) {
    console.error("Facebook post error:", err);
    results.facebook = null;
  }

  // Reddit
  const redditToken = await getRedditToken().catch(() => null);
  if (redditToken) {
    const subreddits = ["Roofing", "HomeImprovement", "InsuranceClaims"];
    for (const sub of subreddits) {
      try {
        await new Promise(r => setTimeout(r, 3000)); // rate limit between posts
        results[`reddit_${sub}`] = await postToReddit(redditToken, sub, title, youtube_url);
      } catch (err) {
        console.error(`Reddit r/${sub} error:`, err);
        results[`reddit_${sub}`] = null;
      }
    }
  } else {
    results.reddit = "skipped — credentials not configured";
  }

  // Update content record
  if (content_id) {
    await supabase.from("roofing_content").update({
      social_posted: true,
      social_post_ids: results,
      social_posted_at: new Date().toISOString(),
    }).eq("id", content_id).catch(() => {});
  }

  await tg(
    `📱 *Social Posts Done*\n\n` +
    `Facebook: ${results.facebook ? "✅" : "❌"}\n` +
    `Reddit r/Roofing: ${results.reddit_Roofing ? "✅" : "❌"}\n` +
    `Reddit r/HomeImprovement: ${results.reddit_HomeImprovement ? "✅" : "❌"}`
  );

  return Response.json({ ok: true, results });
});

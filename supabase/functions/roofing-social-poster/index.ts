// roofing-social-poster v3
// Handles scheduled daily facebook_page and facebook_group posts.
// Also called by roofing-youtube-uploader after a YouTube upload.
//
// Group ID 2266757270527259 is our owned group (Roofing Contractors — AI Tools & Tips).
// If FACEBOOK_GROUP_ACCESS_TOKEN is not set, falls back to FACEBOOK_PAGE_ACCESS_TOKEN.
//
// REQUIRES SECRETS:
//   FACEBOOK_PAGE_ID           — Roofing OS Facebook page numeric ID
//   FACEBOOK_PAGE_ACCESS_TOKEN — Page access token (never-expiring)
//   FACEBOOK_GROUP_ID          — Defaults to 2266757270527259 if not set
//   FACEBOOK_GROUP_ACCESS_TOKEN — Falls back to page token if not set

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FACEBOOK_PAGE_ID = Deno.env.get("FACEBOOK_PAGE_ID") || "";
const FACEBOOK_PAGE_ACCESS_TOKEN = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") || "";
const FACEBOOK_GROUP_ID = Deno.env.get("FACEBOOK_GROUP_ID") || "2266757270527259";
// Fall back to page token when group token not configured
const FACEBOOK_GROUP_ACCESS_TOKEN =
  Deno.env.get("FACEBOOK_GROUP_ACCESS_TOKEN") || FACEBOOK_PAGE_ACCESS_TOKEN;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function isChannelPaused(channel: string): Promise<boolean> {
  const { data } = await supabase
    .from("channel_kill_switches")
    .select("paused")
    .eq("channel", channel)
    .maybeSingle();
  return data?.paused === true;
}

async function postToFacebook(
  targetId: string,
  accessToken: string,
  message: string,
  link?: string
): Promise<{ success: boolean; post_id: string | null; error?: string }> {
  if (!targetId || !accessToken) {
    return { success: false, post_id: null, error: "credentials_not_configured" };
  }

  const payload: Record<string, string> = {
    message,
    access_token: accessToken,
  };
  if (link) payload.link = link;

  const res = await fetch(`https://graph.facebook.com/v18.0/${targetId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (data.error) {
    console.error("Facebook API error:", JSON.stringify(data.error));
    return { success: false, post_id: null, error: data.error.message };
  }
  return { success: true, post_id: data.id || null };
}

async function postScheduledContent(channel: "facebook_page" | "facebook_group", limit = 1): Promise<{
  posted: number;
  queued_for_copy: number;
  skipped: number;
}> {
  const today = todayUTC();

  const { data: posts } = await supabase
    .from("roofing_content")
    .select("id, title, body, hook")
    .eq("type", "facebook_post")
    .eq("channel", channel)
    .eq("status", "pending_approval")
    .eq("schedule_date", today)
    .limit(limit);

  if (!posts || posts.length === 0) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const { data: fallback } = await supabase
      .from("roofing_content")
      .select("id, title, body, hook")
      .eq("type", "facebook_post")
      .eq("channel", channel)
      .eq("status", "pending_approval")
      .eq("schedule_date", yesterday)
      .limit(limit);

    if (!fallback || fallback.length === 0) {
      return { posted: 0, queued_for_copy: 0, skipped: 0 };
    }
    posts.push(...fallback);
  }

  let posted = 0, queuedForCopy = 0, skipped = 0;

  const targetId = channel === "facebook_page" ? FACEBOOK_PAGE_ID : FACEBOOK_GROUP_ID;
  // Group posts fall back to page token when no dedicated group token
  const accessToken = channel === "facebook_page"
    ? FACEBOOK_PAGE_ACCESS_TOKEN
    : FACEBOOK_GROUP_ACCESS_TOKEN;
  const hasCredentials = Boolean(targetId && accessToken);

  for (const post of posts) {
    const message = `${post.hook || ""}\n\n${post.body || ""}`.trim();

    if (hasCredentials) {
      const result = await postToFacebook(targetId, accessToken, message);
      if (result.success) {
        await supabase.from("roofing_content").update({
          status: "published",
          published_url: result.post_id || null,
          social_posted: true,
          social_posted_at: new Date().toISOString(),
        }).eq("id", post.id);
        posted++;
      } else {
        await supabase.from("roofing_content").update({ status: "ready_to_copy" }).eq("id", post.id);
        queuedForCopy++;
      }
    } else {
      await supabase.from("roofing_content").update({ status: "ready_to_copy" }).eq("id", post.id);
      queuedForCopy++;
    }
  }

  return { posted, queued_for_copy: queuedForCopy, skipped };
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-social-poster v3 ready" });

  // ── Direct test post ──────────────────────────────────────────────────────
  if (body.test_post) {
    const useChannel = (body.channel as string) || "facebook_page";
    const targetId = useChannel === "facebook_page" ? FACEBOOK_PAGE_ID : FACEBOOK_GROUP_ID;
    const accessToken = useChannel === "facebook_page"
      ? FACEBOOK_PAGE_ACCESS_TOKEN
      : FACEBOOK_GROUP_ACCESS_TOKEN;

    if (!targetId || !accessToken) {
      return Response.json({ ok: false, error: `${useChannel} credentials not configured` }, { status: 503 });
    }

    const message = body.message as string || "Test post from Roofing OS";
    const result = await postToFacebook(targetId, accessToken, message, body.link as string | undefined);
    if (!result.success) return Response.json({ ok: false, error: result.error }, { status: 400 });
    return Response.json({ ok: true, post_id: result.post_id });
  }

  // ── Scheduled daily channel post (called by cron) ─────────────────────────
  if (body.channel) {
    const channel = body.channel as "facebook_page" | "facebook_group";
    if (!["facebook_page", "facebook_group"].includes(channel)) {
      return Response.json({ error: "channel must be facebook_page or facebook_group" }, { status: 400 });
    }

    if (await isChannelPaused(channel)) {
      return Response.json({ ok: true, skipped: true, reason: "channel_paused" });
    }

    const limit = Math.min(body.limit || 1, 5);
    const result = await postScheduledContent(channel, limit);

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-social-poster",
      status: "ok",
      response_ms: 0,
      checked_at: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({ ok: true, channel, ...result });
  }

  // ── YouTube upload social post (called by roofing-youtube-uploader) ────────
  const { content_id, youtube_url, title, hook } = body;
  if (!youtube_url || !title) {
    return Response.json({ error: "youtube_url and title required" }, { status: 400 });
  }

  const message = `${hook || title}\n\nFull breakdown 👇\n${youtube_url}\n\n🏠 roofingos.dev — free homeowner portal for every job`;

  const results: Record<string, string | null> = {};

  if (FACEBOOK_PAGE_ID && FACEBOOK_PAGE_ACCESS_TOKEN) {
    const r = await postToFacebook(FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN, message, youtube_url);
    results.facebook_page = r.post_id;
  }

  // Also post to our owned group
  if (FACEBOOK_GROUP_ID && FACEBOOK_GROUP_ACCESS_TOKEN) {
    const r = await postToFacebook(FACEBOOK_GROUP_ID, FACEBOOK_GROUP_ACCESS_TOKEN, message, youtube_url);
    results.facebook_group = r.post_id;
  }

  if (content_id) {
    await supabase.from("roofing_content").update({
      social_posted: true,
      social_post_ids: results,
      social_posted_at: new Date().toISOString(),
    }).eq("id", content_id).catch(() => {});
  }

  return Response.json({ ok: true, results });
});

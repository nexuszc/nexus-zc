// roofing-linkedin-poster v1
// Auto-posts YouTube content to LinkedIn when linkedin_copy is set.
// Requires: LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN (li:person:xxx)
// Until credentials are configured, logs the post and marks linkedin_posted_at.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ACCESS_TOKEN  = Deno.env.get("LINKEDIN_ACCESS_TOKEN") || "";
const PERSON_URN    = Deno.env.get("LINKEDIN_PERSON_URN") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-linkedin-poster v1 ready" });

  const { content_id } = body;

  // Cron mode: pick next approved YouTube-posted item that hasn't been LinkedIn-posted
  const targetId = content_id || await (async () => {
    const { data } = await supabase
      .from("roofing_content")
      .select("id")
      .eq("status", "published")
      .not("youtube_url", "is", null)
      .is("linkedin_posted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.id || null;
  })();

  if (!targetId) {
    return Response.json({ ok: true, message: "No content to post to LinkedIn" });
  }

  const { data: content } = await supabase
    .from("roofing_content")
    .select("*")
    .eq("id", targetId)
    .single();

  if (!content) return Response.json({ error: "Content not found" }, { status: 404 });

  const postText = content.linkedin_copy ||
    `${content.title}\n\n${content.hook_text || ""}\n\n🏠 roofingos.dev`;

  const youtubeUrl = content.youtube_url || "";

  if (!ACCESS_TOKEN || !PERSON_URN) {
    console.log(`LinkedIn creds not configured — would have posted: "${postText.slice(0, 100)}"`);
    await supabase.from("roofing_content")
      .update({ linkedin_posted_at: new Date().toISOString() })
      .eq("id", targetId);
    return Response.json({
      ok: false,
      missing_creds: true,
      message: "LinkedIn credentials not configured (LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN). Set secrets to enable auto-posting.",
    });
  }

  try {
    const shareBody: Record<string, unknown> = {
      author: `urn:li:person:${PERSON_URN}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: postText.slice(0, 3000) },
          shareMediaCategory: youtubeUrl ? "ARTICLE" : "NONE",
          ...(youtubeUrl ? {
            media: [{
              status: "READY",
              originalUrl: youtubeUrl,
              title: { text: content.title?.slice(0, 200) || "Roofing OS" },
            }],
          } : {}),
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(shareBody),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LinkedIn API ${res.status}: ${err.slice(0, 200)}`);
    }

    const result = await res.json();
    const postId = result.id || "";

    await supabase.from("roofing_content")
      .update({
        linkedin_posted_at: new Date().toISOString(),
        linkedin_post_id: postId,
      })
      .eq("id", targetId);

    console.log(`LinkedIn posted: ${postId} for content ${targetId}`);
    return Response.json({ ok: true, post_id: postId });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`LinkedIn post failed for ${targetId}:`, msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

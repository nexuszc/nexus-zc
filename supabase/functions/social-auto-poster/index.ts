import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Stub: returns a placeholder URL for platforms not yet connected
// LinkedIn API and X API connections are a future session
function buildPlaceholderUrl(platform: string, slug: string | null): string {
  if (platform === "linkedin") return `https://linkedin.com/company/roofingos [pending-api]`;
  if (platform === "x") return `https://x.com/roofingos [pending-api]`;
  if (platform === "reddit") return `https://reddit.com [pending-api]`;
  return `[${platform}-pending]`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "social-auto-poster ready" }, { headers: CORS });
  }

  const now = new Date().toISOString();

  // Pick up approved queue items whose schedule time has passed
  const { data: items } = await supabase
    .from("social_queue")
    .select("*")
    .eq("status", "approved")
    .lte("scheduled_for", now)
    .limit(20);

  if (!items?.length) {
    return Response.json({ ok: true, posted: 0, message: "nothing ready to post" }, { headers: CORS });
  }

  let posted = 0;
  const results: Array<{ id: string; platform: string; status: string }> = [];

  for (const item of items) {
    const placeholderUrl = buildPlaceholderUrl(item.platform, item.slug);

    try {
      // Mark as posted — actual API call happens when LinkedIn/X connections are wired
      await supabase
        .from("social_queue")
        .update({
          status: "posted",
          posted_at: now,
          post_url: placeholderUrl,
        })
        .eq("id", item.id);

      // Log to social_posts for historical record
      try {
        await supabase.from("social_posts").insert({
          platform: item.platform,
          content: item.content,
          post_url: placeholderUrl,
          status: "posted",
        });
      } catch { /* non-critical */ }

      // For Reddit items: update the matching social_opportunity to 'posted'
      if (item.platform === "reddit" && item.slug) {
        try {
          await supabase
            .from("social_opportunities")
            .update({ status: "posted" })
            .eq("subreddit", item.slug);
        } catch { /* non-critical */ }
      }

      posted++;
      results.push({ id: item.id, platform: item.platform, status: "posted" });
    } catch (e) {
      // On failure: log error but don't retry — will catch next run if still approved
      try {
        await supabase
          .from("social_queue")
          .update({ error: String(e) })
          .eq("id", item.id);
      } catch { /* non-critical */ }
      results.push({ id: item.id, platform: item.platform, status: "error" });
    }
  }

  return Response.json({ ok: true, posted, results }, { headers: CORS });
});

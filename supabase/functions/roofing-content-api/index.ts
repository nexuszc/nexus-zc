// roofing-content-api v1
// Action-based API for the Content & Posting Dashboard
// GET  ?action=dashboard             → roofing_content_dashboard view
// GET  ?action=community             → roofing_community_posts (pending first)
// GET  ?action=partners              → roofing_partnership_targets
// POST ?action=approve&id=X         → sets dashboard_approved=true
// POST ?action=facebook-done&id=X   → sets facebook_marked_done_at=now()
// POST ?action=tiktok-done&id=X     → sets tiktok_marked_done_at=now()
// POST ?action=generate-facebook&id=X → Claude generates facebook_copy
// POST ?action=generate-tiktok&id=X   → Claude generates tiktok_copy
// POST ?action=partner-sent&id=X    → sets sent_at=now() on partnership target

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("CLAUDE_API_KEY") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

async function claudeGenerate(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url   = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const id     = url.searchParams.get("id") || "";

  // ── GET handlers ─────────────────────────────────────────────────────────────

  if (req.method === "GET") {

    if (action === "dashboard") {
      const { data, error } = await supabase
        .from("roofing_content_dashboard")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true, data }, { headers: CORS });
    }

    if (action === "community") {
      const { data, error } = await supabase
        .from("roofing_community_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true, data }, { headers: CORS });
    }

    if (action === "partners") {
      const { data, error } = await supabase
        .from("roofing_partnership_targets")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true, data }, { headers: CORS });
    }

    if (action === "stats") {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const [postsRes, signupsRes, communityRes] = await Promise.all([
        supabase.from("roofing_content").select("channel", { count: "exact" })
          .gte("created_at", weekAgo).not("status", "eq", "rejected"),
        supabase.from("contractor_accounts").select("id", { count: "exact" })
          .gte("created_at", weekAgo),
        supabase.from("roofing_community_posts").select("id", { count: "exact" })
          .eq("status", "pending"),
      ]);
      return Response.json({
        ok: true,
        posts_this_week: postsRes.count || 0,
        signups_this_week: signupsRes.count || 0,
        community_pending: communityRes.count || 0,
      }, { headers: CORS });
    }

    return Response.json({ error: "Unknown action" }, { status: 400, headers: CORS });
  }

  // ── POST handlers ─────────────────────────────────────────────────────────────

  if (req.method === "POST") {
    if (!id && !["generate-facebook", "generate-tiktok"].includes(action)) {
      return Response.json({ error: "id required" }, { status: 400, headers: CORS });
    }

    if (action === "approve") {
      const { error } = await supabase.from("roofing_content")
        .update({ dashboard_approved: true })
        .eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true }, { headers: CORS });
    }

    if (action === "facebook-done") {
      const { error } = await supabase.from("roofing_content")
        .update({ facebook_marked_done_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true }, { headers: CORS });
    }

    if (action === "tiktok-done") {
      const { error } = await supabase.from("roofing_content")
        .update({ tiktok_marked_done_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true }, { headers: CORS });
    }

    if (action === "community-approve") {
      const { error } = await supabase.from("roofing_community_posts")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true }, { headers: CORS });
    }

    if (action === "community-skip") {
      const { error } = await supabase.from("roofing_community_posts")
        .update({ status: "skipped" })
        .eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true }, { headers: CORS });
    }

    if (action === "partner-sent") {
      const { error } = await supabase.from("roofing_partnership_targets")
        .update({ sent_at: new Date().toISOString(), status: "contacted" })
        .eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
      return Response.json({ ok: true }, { headers: CORS });
    }

    if (action === "generate-facebook") {
      if (!id) return Response.json({ error: "id required" }, { status: 400, headers: CORS });
      const { data: content } = await supabase.from("roofing_content").select("*").eq("id", id).single();
      if (!content) return Response.json({ error: "Content not found" }, { status: 404, headers: CORS });

      const copy = await claudeGenerate(
        `Write a Facebook post for roofing contractors promoting this video content. Be direct and conversational — no corporate speak.

Title: ${content.title}
Script excerpt: ${(content.script || "").slice(0, 400)}
Hook: ${content.hook_text || ""}

Format:
- Opening hook (1 sentence, grabs attention)
- Problem/pain point (2-3 sentences)
- Our solution (2-3 sentences, mention free portal or roofingos.dev)
- CTA (link to roofingos.dev/dashboard or roofingos.dev)
- 3-5 relevant hashtags

Keep total under 250 words. Sound like a contractor who found a solution, not a SaaS company.`
      );

      if (!copy) return Response.json({ error: "Generation failed" }, { status: 500, headers: CORS });

      await supabase.from("roofing_content").update({ facebook_copy: copy }).eq("id", id);
      return Response.json({ ok: true, copy }, { headers: CORS });
    }

    if (action === "generate-tiktok") {
      if (!id) return Response.json({ error: "id required" }, { status: 400, headers: CORS });
      const { data: content } = await supabase.from("roofing_content").select("*").eq("id", id).single();
      if (!content) return Response.json({ error: "Content not found" }, { status: 404, headers: CORS });

      const copy = await claudeGenerate(
        `Write a TikTok caption for roofing contractors. Short, punchy, direct.

Video title: ${content.title}
Hook: ${content.hook_text || ""}

Format:
- First line: 5-word hook (ALL CAPS or bold via *word*)
- 3 bullet points (one sentence each, specific pain point or benefit)
- CTA: one line (e.g., "Link in bio → roofingos.dev")
- 3-4 hashtags

Total: under 120 words. Be specific, not generic.`
      );

      if (!copy) return Response.json({ error: "Generation failed" }, { status: 500, headers: CORS });

      await supabase.from("roofing_content").update({ tiktok_copy: copy }).eq("id", id);
      return Response.json({ ok: true, copy }, { headers: CORS });
    }

    return Response.json({ error: "Unknown action" }, { status: 400, headers: CORS });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
});

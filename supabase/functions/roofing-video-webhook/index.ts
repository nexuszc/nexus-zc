// roofing-video-webhook
// Receives callback from GitHub Actions after FFmpeg video render.
// Stores video_url → triggers YouTube upload.
//
// Payload: { content_id, video_url, status: "ready"|"failed", error?, size? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function triggerUpload(contentId: string): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-uploader`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content_id: contentId }),
      signal: AbortSignal.timeout(180_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      console.error(`YouTube upload failed for ${contentId}:`, data.error || res.status);
    } else {
      console.log(`YouTube upload complete for ${contentId}:`, data.youtube_url);
    }
  } catch (err) {
    console.error(`YouTube upload threw for ${contentId}:`, err);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  if (body.test) return Response.json({ ok: true, message: "roofing-video-webhook ready" });

  const { content_id, video_url, status, error, size } = body;

  if (!content_id) return Response.json({ ok: false, error: "content_id required" }, { status: 400 });

  console.log(`roofing-video-webhook: ${content_id} status=${status} size=${size ?? "?"}`);

  // Handle render failure
  if (status === "failed") {
    try {
      await supabase.from("roofing_content").update({
        video_render_status: "failed",
        video_render_error: error || "GitHub Actions render failed",
      }).eq("id", content_id);
    } catch { /* non-fatal */ }
    console.error(`Render failed for ${content_id}:`, error);
    return Response.json({ ok: true, status: "failed" });
  }

  if (!video_url) {
    return Response.json({ ok: false, error: "video_url required for status=ready" }, { status: 400 });
  }

  // Store video_url and mark ready
  try {
    await supabase.from("roofing_content").update({
      video_url,
      video_render_status: "ready",
      youtube_upload_ready: true,
    }).eq("id", content_id);
  } catch (dbErr) {
    console.error("DB update failed:", dbErr);
    return Response.json({ ok: false, error: "DB update failed" }, { status: 500 });
  }

  // Trigger YouTube upload in background — return 200 immediately
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(triggerUpload(content_id));

  return Response.json({ ok: true, content_id, status: "uploading" });
});

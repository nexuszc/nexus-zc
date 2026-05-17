// roofing-shotstack-webhook
// Receives Shotstack render callbacks and triggers YouTube upload.
//
// Flow:
//   1. Shotstack POSTs when render is done (or failed)
//   2. Match render_id to roofing_content.shotstack_render_id
//   3. Store the rendered MP4 url in video_url
//   4. Call roofing-youtube-uploader to upload to YouTube (via EdgeRuntime.waitUntil)
//   5. Return 200 immediately — Shotstack doesn't wait on us
//
// Payload from Shotstack:
//   { id, status, url, owner, plan, duration, renderTime, ... }

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
      signal: AbortSignal.timeout(180_000), // 3 min for download + upload
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
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const renderId = payload.id as string | undefined;
  const status   = payload.status as string | undefined;
  const url      = payload.url as string | undefined;

  console.log(`Shotstack webhook: id=${renderId} status=${status}`);

  if (!renderId) {
    return Response.json({ ok: false, error: "Missing render id" }, { status: 400 });
  }

  // Ignore failed renders — log and return 200 so Shotstack doesn't retry
  if (status === "failed") {
    console.error(`Shotstack render failed: ${renderId}`);
    try {
      await supabase.from("system_heartbeats").insert({
        function_name: "roofing-shotstack-webhook",
        status: "error",
        response_ms: 0,
        error_message: `Render failed: ${renderId}`,
        recorded_at: new Date().toISOString(),
      });
    } catch { /* non-fatal */ }
    return Response.json({ ok: true, skipped: "render failed" });
  }

  if (status !== "done" || !url) {
    // Still in progress or unknown status — return 200 and ignore
    return Response.json({ ok: true, skipped: `status=${status}` });
  }

  // Find the content row by render_id
  const { data: content, error: findErr } = await supabase
    .from("roofing_content")
    .select("id, title, youtube_video_id")
    .eq("shotstack_render_id", renderId)
    .maybeSingle();

  if (findErr || !content) {
    console.error(`No content row for render_id ${renderId}:`, findErr?.message);
    // Still return 200 — may have been a test render or already handled
    return Response.json({ ok: true, skipped: "no matching content" });
  }

  // Already uploaded — nothing to do
  if (content.youtube_video_id) {
    return Response.json({ ok: true, skipped: "already uploaded", youtube_video_id: content.youtube_video_id });
  }

  // Store rendered MP4 URL
  try {
    await supabase
      .from("roofing_content")
      .update({ video_url: url })
      .eq("id", content.id);
  } catch (dbErr) {
    console.error(`video_url update failed for ${content.id}:`, dbErr);
    return Response.json({ ok: false, error: "DB update failed" }, { status: 500 });
  }

  console.log(`Render done for "${content.title}" — queuing YouTube upload`);

  // Trigger upload in background — return 200 immediately to Shotstack
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(triggerUpload(content.id));

  return Response.json({ ok: true, content_id: content.id, render_id: renderId });
});

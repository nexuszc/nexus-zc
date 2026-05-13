import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1×1 transparent GIF (GIF89a).
const TRANSPARENT_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00,
  0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0x02, 0x02, 0x44, 0x01, 0x00,
  0x3B,
]);

// ── Svix/Resend webhook signature verification ────────────────────────────────
// Resend uses Svix for webhook delivery. Secrets are prefixed "whsec_" and
// base64-encoded. Signed content = "${svix-id}.${svix-timestamp}.${rawBody}".
async function verifySignature(req: Request, rawBody: string, secret: string): Promise<boolean> {
  const svixId        = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject stale requests (> 5 minutes).
  const ts = parseInt(svixTimestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;

  // Strip "whsec_" prefix and base64-decode.
  const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // svix-signature can be space-separated multiple values: "v1,base64 v1,base64"
  const provided = svixSignature.split(" ").map(s => s.split(",")[1]).filter(Boolean);
  return provided.some(s => s === computed);
}

// ── Pixel handler ─────────────────────────────────────────────────────────────
async function handlePixel(supabase: SupabaseClient, token: string): Promise<Response> {
  // Always return the GIF immediately — don't let DB latency affect email client rendering.
  const dbUpdate = (async () => {
    const { data: row } = await supabase
      .from("email_sends")
      .select("id, opened_at, open_count")
      .eq("tracking_token", token)
      .maybeSingle();
    if (!row) return;

    await supabase.from("email_sends").update({
      opened_at: row.opened_at ?? new Date().toISOString(), // first open only
      open_count: (row.open_count as number) + 1,
    }).eq("id", row.id);
  })();

  // Fire-and-forget — don't await.
  dbUpdate.catch(e => console.error("pixel update error:", e));

  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}

// ── Click handler ─────────────────────────────────────────────────────────────
async function handleClick(
  supabase: SupabaseClient,
  token: string,
  rawUrl: string | null,
): Promise<Response> {
  const destination = rawUrl ? decodeURIComponent(rawUrl) : "https://nexuszc.com";

  // Log click in background — redirect immediately.
  (async () => {
    const { data: row } = await supabase
      .from("email_sends")
      .select("id, clicked_at, click_count")
      .eq("tracking_token", token)
      .maybeSingle();
    if (!row) return;

    await supabase.from("email_sends").update({
      clicked_at: row.clicked_at ?? new Date().toISOString(), // first click only
      click_count: (row.click_count as number) + 1,
    }).eq("id", row.id);
  })().catch(e => console.error("click update error:", e));

  return new Response(null, {
    status: 302,
    headers: { "Location": destination },
  });
}

// ── Webhook event handler ─────────────────────────────────────────────────────
async function handleWebhook(
  supabase: SupabaseClient,
  req: Request,
  secret: string,
): Promise<Response> {
  const rawBody = await req.text();

  const verified = await verifySignature(req, rawBody, secret);
  if (!verified) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const type = payload.type as string;
  const data = payload.data as Record<string, unknown> ?? {};

  // Resolve email_sends row via tracking_token embedded in tags.
  const tags = data.tags as Record<string, string> | null;
  const token = tags?.tracking_token ?? null;

  async function getRow() {
    if (!token) return null;
    const { data: row } = await supabase
      .from("email_sends")
      .select("id, lead_id, opened_at, clicked_at, open_count, click_count")
      .eq("tracking_token", token)
      .maybeSingle();
    return row as Record<string, unknown> | null;
  }

  // ── email.opened ────────────────────────────────────────────────────────────
  if (type === "email.opened") {
    const row = await getRow();
    if (row) {
      await supabase.from("email_sends").update({
        opened_at: row.opened_at ?? new Date().toISOString(),
        open_count: (row.open_count as number) + 1,
      }).eq("id", row.id);
    }
    return ok({ received: true });
  }

  // ── email.clicked ───────────────────────────────────────────────────────────
  if (type === "email.clicked") {
    const row = await getRow();
    if (row) {
      await supabase.from("email_sends").update({
        clicked_at: row.clicked_at ?? new Date().toISOString(),
        click_count: (row.click_count as number) + 1,
      }).eq("id", row.id);
    }
    return ok({ received: true });
  }

  // ── email.bounced ───────────────────────────────────────────────────────────
  if (type === "email.bounced") {
    const row = await getRow();
    if (!row) return ok({ received: true });

    const bounceData = data.bounce as Record<string, unknown> | null;
    // Resend bounce types: "hard", "soft"
    const bounceType = (bounceData?.type as string ?? "soft").toLowerCase();
    const isHard = bounceType === "hard";

    await supabase.from("email_sends")
      .update({ bounce_type: isHard ? "hard" : "soft" })
      .eq("id", row.id);

    if (isHard) {
      await supabase.from("leads")
        .update({ unsubscribed_from_email: true })
        .eq("id", row.lead_id);
    }
    return ok({ received: true });
  }

  // ── email.complained (spam) — treat as hard bounce / unsubscribe ────────────
  if (type === "email.complained") {
    const row = await getRow();
    if (row) {
      await supabase.from("email_sends")
        .update({ bounce_type: "hard", unsubscribed_at: new Date().toISOString() })
        .eq("id", row.id);
      await supabase.from("leads")
        .update({ unsubscribed_from_email: true })
        .eq("id", row.lead_id);
    }
    return ok({ received: true });
  }

  // ── inbound.received — match reply to lead by sender email ─────────────────
  if (type === "inbound.received") {
    const fromField = data.from as string | null;
    if (!fromField) return ok({ received: true });

    // Parse sender address from "Name <email>" or plain "email".
    const senderMatch = fromField.match(/<([^>]+)>/) ?? fromField.match(/(\S+@\S+)/);
    const senderEmail = senderMatch?.[1] ?? null;

    if (senderEmail) {
      // Find the lead with this email address.
      const { data: lead } = await supabase
        .from("leads")
        .select("id")
        .eq("email", senderEmail)
        .maybeSingle();

      if (lead) {
        // Find the most recent email sent to this lead that hasn't been replied to.
        const { data: emailSend } = await supabase
          .from("email_sends")
          .select("id")
          .eq("lead_id", lead.id)
          .is("replied_at", null)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (emailSend) {
          await supabase.from("email_sends").update({
            replied_at: new Date().toISOString(),
            reply_flagged: true,
          }).eq("id", emailSend.id);
        }
      }
    }

    // Route roofing replies to roofing-closer
    const toField = data.to as string | null;
    const subjectField = data.subject as string | null;
    const fromEmail = senderEmail;
    const fromNameMatch = fromField.match(/^([^<]+)</) ?? null;
    const fromName = fromNameMatch?.[1]?.trim() ?? null;
    const textBody = data.text as string | null;
    const htmlBody = data.html as string | null;
    if (toField?.includes('roofingos.dev') || subjectField?.toLowerCase().includes('roofing')) {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-closer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          from_email: fromEmail,
          from_name: fromName,
          subject: subjectField,
          body: textBody || htmlBody
        })
      });
    }

    return ok({ received: true });
  }

  // Unknown event type — acknowledge silently.
  return ok({ received: true, type: "unhandled" });
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  // Path after /functions/v1/email-webhook: ["pixel","TOKEN"], ["click","TOKEN"], or []
  const pathParts = url.pathname.split("/").filter(Boolean).slice(3);

  // GET /email-webhook/pixel/TOKEN
  if (req.method === "GET" && pathParts[0] === "pixel" && pathParts[1]) {
    return handlePixel(supabase, pathParts[1]);
  }

  // GET /email-webhook/click/TOKEN?url=...
  if (req.method === "GET" && pathParts[0] === "click" && pathParts[1]) {
    return handleClick(supabase, pathParts[1], url.searchParams.get("url"));
  }

  // OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, svix-id, svix-timestamp, svix-signature",
      },
    });
  }

  // POST — Resend webhook events
  if (req.method === "POST") {
    const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    if (!secret) {
      return new Response(
        JSON.stringify({ error: "RESEND_WEBHOOK_SECRET not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    return handleWebhook(supabase, req, secret);
  }

  return new Response("not found", { status: 404 });
});

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

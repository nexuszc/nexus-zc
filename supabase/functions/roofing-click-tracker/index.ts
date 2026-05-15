// roofing-click-tracker v1
// Tracks link clicks from all outreach — email, SMS, voice drop follow-ups
// Logs click, marks prospect as whale, fires whale alert, redirects

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PORTAL_URL = "https://app.nexuszc.com/roofing/portal/DEMO2026ROOFINGOS";
const WEBSITE_URL = "https://roofingos.dev";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const pid = url.searchParams.get("pid") || "";
  const touch = parseInt(url.searchParams.get("touch") || "0");
  const dest = url.searchParams.get("dest") || "portal";
  const redirectUrl = dest === "website" ? WEBSITE_URL : PORTAL_URL;

  if (!pid) return Response.redirect(redirectUrl, 302);

  try {
    const { data: prospect } = await supabase
      .from("roofing_prospects")
      .select("id, whale_alerted, owner_name, company_name, phone, city, state, status")
      .eq("id", pid)
      .maybeSingle();

    if (!prospect) return Response.redirect(redirectUrl, 302);

    const needsWhaleAlert = !prospect.whale_alerted;
    const now = new Date().toISOString();

    await supabase.from("roofing_click_events").insert({
      prospect_id: pid,
      source: "email",
      touch_number: touch,
      clicked_at: now,
    });

    await supabase.from("roofing_prospects").update({
      clicked: true,
      status: "whale",
      last_touch_at: now,
    }).eq("id", pid);

    await supabase.from("roofing_outreach_log")
      .update({ clicked_at: now })
      .eq("prospect_id", pid)
      .eq("touch_number", touch)
      .is("clicked_at", null);

    if (needsWhaleAlert) {
      EdgeRuntime.waitUntil((async () => {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/roofing-whale-alert`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${SERVICE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ prospect_id: pid, touch_number: touch }),
          });
        } catch { /* non-fatal */ }
      })());
    }

    supabase.from("system_heartbeats").insert({
      function_name: "roofing-click-tracker",
      status: "ok",
      response_ms: 0,
      metadata: { pid, touch, dest },
      recorded_at: now,
    }).catch(() => {});

  } catch { /* never block the redirect */ }

  return Response.redirect(redirectUrl, 302);
});

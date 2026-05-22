// roofing-aria-engine v1 — simple Twilio outbound trigger
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const FROM = Deno.env.get("TWILIO_PHONE_NUMBER") || Deno.env.get("TWILIO_FROM_NUMBER") || "";
const INBOUND = `${SUPABASE_URL}/functions/v1/roofing-aria-inbound`;
const TOLL_FREE = ["800","888","877","866","855","844","833","822"];
// Never auto-call internal numbers from the queue
const DNC = new Set(["+17203948574", "+17205006668"]);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function normalize(raw: string): string | null {
  const d = (raw || "").replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (n.length !== 10 || TOLL_FREE.includes(n.slice(0, 3))) return null;
  return `+1${n}`;
}

async function dial(phone: string, name: string, callType: string): Promise<boolean> {
  const p = new URLSearchParams({
    To: phone, From: FROM,
    Url: `${INBOUND}?step=outbound&name=${encodeURIComponent(name)}`,
    Method: "POST",
  });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: p.toString(),
  }).catch(() => null);
  if (r?.ok) {
    const d = await r.json().catch(() => ({}));
    try {
      await supabase.from("roofing_aria_calls").insert({
        call_type: callType, contact_phone: phone, contact_name: name,
        retell_call_id: d.sid || null, from_number: FROM, persona: "aria",
        script_used: "v1", script_version: "v1",
      });
    } catch { /* non-fatal */ }
  }
  return r?.ok ?? false;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.test) return Response.json({ ok: true, message: "roofing-aria-engine v1" });

    // Queue processor mode: { limit: N }
    if (body.limit) {
      const { data: queue } = await supabase.from("aria_call_queue")
        .select("*").in("status", ["queued", "pending"])
        .lte("fire_at", new Date().toISOString()).lt("attempt_count", 3)
        .order("fire_at", { ascending: true }).limit(body.limit);

      let fired = 0;
      for (const row of queue || []) {
        const phone = normalize(row.contact_phone);
        if (!phone || DNC.has(phone)) {
          try { await supabase.from("aria_call_queue").update({ status: "failed", last_attempt_at: new Date().toISOString() }).eq("id", row.id); } catch { /* non-fatal */ }
          continue;
        }
        const ok = await dial(phone, row.contact_name || "there", row.call_type);
        try {
          await supabase.from("aria_call_queue").update({
            status: ok ? "fired" : "queued",
            attempt_count: (row.attempt_count || 0) + 1,
            last_attempt_at: new Date().toISOString(),
            fired_at: ok ? new Date().toISOString() : null,
          }).eq("id", row.id);
        } catch { /* non-fatal */ }
        if (ok) fired++;
        await new Promise(r => setTimeout(r, 500));
      }
      return Response.json({ ok: true, fired, total: queue?.length || 0 });
    }

    // Direct call mode: { contact_phone, contact_name, call_type }
    const { contact_phone, contact_name = "there", call_type = "cold_outreach" } = body;
    if (!contact_phone) return Response.json({ error: "contact_phone required" }, { status: 400 });
    const phone = normalize(contact_phone);
    if (!phone) return Response.json({ ok: false, reason: "invalid phone" });
    const ok = await dial(phone, contact_name, call_type);
    return Response.json({ ok });
  } catch (fatal) {
    console.error("roofing-aria-engine fatal:", fatal);
    return Response.json({ ok: false, error: String(fatal) }, { status: 500 });
  }
});

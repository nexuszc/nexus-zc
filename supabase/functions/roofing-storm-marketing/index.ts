// roofing-storm-marketing
// Triggered by storm detection. Bundles all marketing assets and queues for one-tap approval.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function claude(prompt: string, maxTokens = 800): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function fireBundle(bundleId: string) {
  try {
    const { data: bundle } = await supabase
      .from("roofing_content")
      .select("*")
      .eq("id", bundleId)
      .eq("type", "storm_bundle")
      .single();

    if (!bundle) return { ok: false, error: "Bundle not found" };

    const bundleData = JSON.parse(bundle.body);
    const { storm_event_id, content_ids, prospect_ids, call_fire_at } = bundleData;

    // 1. Approve all bundled content pieces
    if (content_ids?.length) {
      await supabase.from("roofing_content")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .in("id", content_ids);
    }

    // 2. Activate email queue items
    const { data: emailItems } = await supabase
      .from("content_queue")
      .select("*")
      .eq("status", "pending")
      .not("recipient_email", "is", null)
      .filter("metadata->storm_bundle_id", "eq", bundleId);

    let emailsSent = 0;
    const { data: emailTemplate } = await supabase
      .from("roofing_content")
      .select("body, title")
      .eq("type", "email_template")
      .in("id", content_ids || [])
      .single();

    for (const item of emailItems || []) {
      try {
        const body = emailTemplate?.body?.replace(/\[HOMEOWNER_NAME\]/g, item.recipient_name || "Neighbor") || "";
        if (!body || !item.recipient_email) continue;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Roofing OS Alert <alerts@nexuszc.com>",
            to: item.recipient_email,
            subject: emailTemplate?.title || "Storm Damage Alert for Your Area",
            html: body
          })
        });

        await supabase.from("content_queue")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", item.id);

        emailsSent++;
      } catch { /* continue on individual failure */ }
    }

    // 3. Activate SMS queue
    const { data: smsItems } = await supabase
      .from("content_queue")
      .select("*")
      .eq("status", "pending")
      .not("recipient_phone", "is", null)
      .filter("metadata->storm_bundle_id", "eq", bundleId);

    let smsSent = 0;
    const { data: smsTemplate } = await supabase
      .from("roofing_content")
      .select("body")
      .eq("type", "sms_template")
      .in("id", content_ids || [])
      .single();

    for (const item of smsItems || []) {
      try {
        const smsBody = smsTemplate?.body?.replace(/\[NAME\]/g, item.recipient_name || "there") || "";
        if (!smsBody || !item.recipient_phone) continue;

        await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "sms", phone: item.recipient_phone, message: smsBody })
        });

        await supabase.from("content_queue")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", item.id);

        smsSent++;
        await new Promise(r => setTimeout(r, 200));
      } catch { /* continue */ }
    }

    // 4. Activate Aria call queue for next 9am
    if (prospect_ids?.length) {
      const { data: prospects } = await supabase
        .from("roofing_prospects")
        .select("id, owner_name, phone, company_name")
        .in("id", prospect_ids)
        .not("phone", "is", null);

      for (const p of prospects || []) {
        await supabase.from("aria_call_queue").insert({
          call_type: "storm_alert",
          contact_phone: p.phone,
          contact_name: p.owner_name || p.company_name,
          contact_type: "prospect",
          metadata: { storm_bundle_id: bundleId, storm_event_id, company_name: p.company_name },
          fire_at: call_fire_at || new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
          status: "queued"
        }).catch(() => {});
      }
    }

    // 5. Mark bundle as approved
    await supabase.from("roofing_content")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", bundleId);

    // MOVED_TO_DASHBOARD [date: 2026-05-17]: storm marketing fire results visible in Pipeline tab (roofing_content + aria_call_queue)
    // await tg(`⚡ *Storm Marketing Fired*\nEmails sent: ${emailsSent}\nSMS queued: ${smsSent}\nAria calls queued: ${(prospect_ids || []).length}\nCalls fire at 9am tomorrow\nFacebook/Google Ads content approved ✓`);

    return { ok: true, emails_sent: emailsSent, sms_sent: smsSent, calls_queued: (prospect_ids || []).length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await tg(`❌ *Storm Marketing Fire Failed*\n${msg}`);
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-storm-marketing ready" });

  // Fire an already-approved bundle
  if (body.action === "fire" && body.bundle_id) {
    const result = await fireBundle(body.bundle_id);
    return Response.json(result);
  }

  const { zip_codes, hail_size, city, state, storm_event_id } = body;

  if (!zip_codes?.length && !city) {
    return Response.json({ error: "zip_codes or city required" }, { status: 400 });
  }

  const location = city ? `${city}, ${state || "CO"}` : zip_codes.join(", ");
  const hailInches = hail_size || 1.25;
  const startMs = Date.now();

  try {
    // Find prospects in affected area
    const { data: prospects } = await supabase
      .from("roofing_prospects")
      .select("id, owner_name, phone, email, company_name, address")
      .not("phone", "is", null)
      .limit(200);

    const affectedProspects = (prospects || []).filter((p: any) => {
      if (!zip_codes?.length) return true;
      return zip_codes.some((z: string) => (p.address || "").includes(z));
    });

    const prospectIds = affectedProspects.map((p: any) => p.id);
    const contentIds: string[] = [];

    // Generate email template
    const emailHtml = await claude(
      `Write an HTML email for roofing contractors to send to homeowners after a ${hailInches}" hail storm near ${location}.

Subject: Your Roof May Have Storm Damage — Free Inspection Inside
From: A local roofing contractor

Content:
- Subject line urgency: adjusters file 30-day windows
- What ${hailInches}" hail does to asphalt shingles (1-2 sentences, specific)
- Free inspection offer — no obligation
- What they risk losing if they wait (depreciation, claim window closes)
- CTA: call or text [CONTRACTOR_PHONE] or reply to this email

Keep it under 200 words. Professional but warm. Use [HOMEOWNER_NAME] as a placeholder.
Return HTML body only (no <html> wrapper).`,
      800
    );

    const emailTitle = `Storm Damage Alert — ${location} ${hailInches}" Hail`;
    const { data: emailContent } = await supabase.from("roofing_content").insert({
      type: "email_template", title: emailTitle, body: emailHtml,
      status: "pending", channel: "email", storm_event_id: storm_event_id || null
    }).select().single();
    if (emailContent) contentIds.push(emailContent.id);

    // Generate SMS template
    const smsText = await claude(
      `Write an SMS (max 160 chars) for a roofing contractor to send to homeowners after a ${hailInches}" hail storm in ${location}. Include: urgent tone, free inspection offer, reply STOP to opt out. Use [NAME] placeholder. Return text only.`,
      200
    );
    const { data: smsContent } = await supabase.from("roofing_content").insert({
      type: "sms_template", title: "Storm SMS", body: smsText || `Hi [NAME], ${hailInches}" hail hit ${location}. Your roof may be damaged. Free inspection — call us today. Reply STOP to opt out.`,
      status: "pending", channel: "sms", storm_event_id: storm_event_id || null
    }).select().single();
    if (smsContent) contentIds.push(smsContent.id);

    // Generate voice drop script
    const voiceDrop = await claude(
      `Write a 30-second voicemail script for a roofing contractor after a ${hailInches}" hail storm near ${location}.
Tone: professional, urgent, helpful. Cover: storm hit the area, free inspection offer, callback number.
Format as spoken words only — no stage directions. Under 80 words.`,
      300
    );
    const { data: voiceContent } = await supabase.from("roofing_content").insert({
      type: "voice_drop", title: "Storm Voice Drop Script", body: voiceDrop,
      status: "pending", channel: "voice", storm_event_id: storm_event_id || null
    }).select().single();
    if (voiceContent) contentIds.push(voiceContent.id);

    // Generate Facebook post
    const fbPost = await claude(
      `Write a Facebook post (max 120 words) from a roofing contractor about the ${hailInches}" hail storm that just hit ${location}.
Offer free inspections. Create urgency around the 30-day insurance filing window. Ask people to tag neighbors.
Professional but approachable tone. Include 2-3 hashtags.`,
      300
    );
    const { data: fbContent } = await supabase.from("roofing_content").insert({
      type: "facebook", title: `Storm Alert — ${location}`, body: fbPost,
      status: "pending", channel: "facebook", storm_event_id: storm_event_id || null
    }).select().single();
    if (fbContent) contentIds.push(fbContent.id);

    // Generate Google Ads copy
    const googleAds = await claude(
      `Write 3 Google Search Ad variations for a roofing contractor targeting homeowners after a hail storm in ${location}.
Each ad: Headline 1 (30 chars max), Headline 2 (30 chars max), Description (90 chars max).
Keywords: hail damage roof, storm roof repair, free roof inspection.
Format as:
AD 1:
H1: [headline]
H2: [headline]
DESC: [description]
(repeat for AD 2 and AD 3)`,
      600
    );
    const { data: adsContent } = await supabase.from("roofing_content").insert({
      type: "google_ads", title: `Google Ads — ${location} Storm`, body: googleAds,
      status: "pending", channel: "paid", storm_event_id: storm_event_id || null
    }).select().single();
    if (adsContent) contentIds.push(adsContent.id);

    // Queue emails and SMS (status 'pending' until approved)
    const tomorrow9am = new Date();
    tomorrow9am.setUTCHours(15, 0, 0, 0); // 9am MT = 15:00 UTC
    if (new Date() >= tomorrow9am) tomorrow9am.setDate(tomorrow9am.getDate() + 1);

    for (const prospect of affectedProspects) {
      if ((prospect as any).email) {
        await supabase.from("content_queue").insert({
          content_id: emailContent?.id || null,
          channel: "email",
          recipient_email: (prospect as any).email,
          recipient_name: (prospect as any).owner_name,
          prospect_id: (prospect as any).id,
          status: "pending",
          scheduled_for: tomorrow9am.toISOString(),
          metadata: { storm_bundle_id: "PLACEHOLDER", storm_event_id }
        }).catch(() => {});
      }
      if ((prospect as any).phone) {
        await supabase.from("content_queue").insert({
          content_id: smsContent?.id || null,
          channel: "sms",
          recipient_phone: (prospect as any).phone,
          recipient_name: (prospect as any).owner_name,
          prospect_id: (prospect as any).id,
          status: "pending",
          scheduled_for: tomorrow9am.toISOString(),
          metadata: { storm_bundle_id: "PLACEHOLDER", storm_event_id }
        }).catch(() => {});
      }
    }

    // Create the master bundle
    const { data: bundle } = await supabase.from("roofing_content").insert({
      type: "storm_bundle",
      title: `Storm Bundle — ${location} ${hailInches}" Hail`,
      body: JSON.stringify({
        storm_event_id: storm_event_id || null,
        location,
        hail_size_inches: hailInches,
        content_ids: contentIds,
        prospect_ids: prospectIds,
        call_fire_at: tomorrow9am.toISOString()
      }),
      status: "pending",
      channel: "multi",
      storm_event_id: storm_event_id || null
    }).select().single();

    // Update queue records with real bundle_id
    if (bundle) {
      await supabase.from("content_queue")
        .update({ metadata: { storm_bundle_id: bundle.id, storm_event_id } })
        .eq("status", "pending")
        .not("metadata", "is", null);
    }

    const duration = Date.now() - startMs;

    await tg(
      `⛈️ *Storm Marketing Bundle Ready*\n` +
      `📍 Location: ${location}\n` +
      `🌨️ Hail: ${hailInches}"\n` +
      `👥 Prospects in area: ${affectedProspects.length}\n\n` +
      `*Generated:*\n` +
      `✉️ Email template\n` +
      `📱 SMS template\n` +
      `🎙️ Voice drop script\n` +
      `📘 Facebook post\n` +
      `🔍 Google Ads (3 variations)\n` +
      `📞 Aria calls queued for 9am\n\n` +
      `*One-tap approve:*\n` +
      `\`approve storm ${bundle?.id || "error"}\`\n\n` +
      `_All assets fire simultaneously on approval._`
    );

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-storm-marketing",
      status: "ok",
      response_ms: duration,
      checked_at: new Date().toISOString()
    }).catch(() => {});

    return Response.json({
      ok: true,
      bundle_id: bundle?.id,
      prospects_found: affectedProspects.length,
      content_pieces: contentIds.length,
      duration_ms: duration
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-storm-marketing",
      status: "error",
      error_message: msg,
      checked_at: new Date().toISOString()
    }).catch(() => {});
    await tg(`❌ *Storm Marketing Error*\n${msg}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

// roofing-youtube-engine v1
// 8 content slots/week, Claude script generation, Telegram inline button approvals

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const WEEKLY_SCHEDULE = [
  {
    day: "monday",
    topic: "carrier_intelligence",
    title_formula: "What [CARRIER] Is Doing Right Now in [MARKET] — [MONTH] [YEAR] Update",
    pain_angle: "Carriers are quietly changing their supplement approval patterns and contractors are leaving money on the table",
    portal_bridge: "The homeowner portal generates documentation that matches exactly what this carrier demands — show proof, get paid"
  },
  {
    day: "tuesday",
    topic: "supplement_deep_dive",
    title_formula: "The [AMOUNT] Supplement Most Contractors Miss After Hail Damage",
    pain_angle: "Adjusters bank on contractors not knowing specific line items that are always owed",
    portal_bridge: "Roofing OS auto-generates the supplement request with the exact Xactimate codes — contractors who use it capture 40% more"
  },
  {
    day: "wednesday",
    topic: "storm_analysis",
    title_formula: "[CITY] Hail Storm Damage Guide — What Homeowners Need to Know",
    pain_angle: "Homeowners don't know what hail damage looks like or what they're owed — contractors who educate them win the job",
    portal_bridge: "The homeowner portal shows real-time job updates and storm damage documentation — homeowners who see it sign faster"
  },
  {
    day: "thursday",
    topic: "homeowner_management",
    title_formula: "How Top Roofing Contractors Keep Homeowners from Going with the Cheapest Bid",
    pain_angle: "Price shopping kills margins — contractors who build trust and transparency before the estimate win on value not price",
    portal_bridge: "The homeowner portal creates transparency that eliminates price objections — show them everything and they stop shopping"
  },
  {
    day: "friday",
    topic: "business_intelligence",
    title_formula: "[MONTH] Roofing Market Report — What the Data Says About [MARKET]",
    pain_angle: "Most contractors operate on gut feel — the ones running data-driven operations are pulling away from the field",
    portal_bridge: "Roofing OS tracks every job metric automatically — contractors get a live dashboard instead of spreadsheets"
  },
  {
    day: "saturday",
    topic: "case_study",
    title_formula: "How One [MARKET] Contractor Added $[AMOUNT]/Month in Supplement Revenue",
    pain_angle: "Real contractors are getting real results — specific numbers, specific processes, specific timeline",
    portal_bridge: "This is what Roofing OS made possible — the system did the supplement work automatically"
  },
  {
    day: "sunday",
    topic: "quick_tip",
    title_formula: "60-Second Roofing Tip: [SPECIFIC_TIP]",
    pain_angle: "One actionable thing a contractor can do Monday morning to make more money",
    portal_bridge: "Roofing OS automates this entire process — what takes contractors 2 hours takes the system 2 minutes"
  },
  {
    day: "bonus",
    topic: "trending",
    title_formula: "Breaking: [TRENDING_TOPIC] — What It Means for Roofing Contractors",
    pain_angle: "Industry news that affects contractor revenue, explained simply with action steps",
    portal_bridge: "Stay ahead with the intelligence Roofing OS surfaces automatically"
  }
];

async function claude(prompt: string, maxTokens = 3000): Promise<string> {
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

async function sendTelegramApproval(contentId: string, title: string, preview: string): Promise<string | null> {
  const text = `🎬 *New YouTube Script Ready*\n\n*${title}*\n\n${preview.slice(0, 300)}...\n\n_Approve to save. Skip to discard._`;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve_content_${contentId}` },
          { text: "✏️ Edit", callback_data: `edit_content_${contentId}` },
          { text: "❌ Skip", callback_data: `skip_content_${contentId}` }
        ]]
      }
    })
  });
  const data = await res.json();
  return data.result?.message_id?.toString() || null;
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function getRecentCarrierIntel(): Promise<{ carrier: string; insight: string } | null> {
  const { data } = await supabase
    .from("carrier_intelligence")
    .select("carrier_type, tips, approval_rate_pct")
    .order("last_updated", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { carrier: data.carrier_type, insight: (data.tips || [])[0] || "" };
}

async function getRecentStorm(): Promise<{ city: string; hail_size: number; state: string } | null> {
  const { data } = await supabase
    .from("hail_events")
    .select("city, hail_size_inches, state")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { city: data.city, hail_size: data.hail_size_inches, state: data.state };
}

async function generateScript(slot: typeof WEEKLY_SCHEDULE[0], context: Record<string, string>): Promise<{ title: string; script: string; tiktok: string; hook: string; thumbnail_text: string }> {
  const market = context.market || "Denver, CO";
  const month = new Date().toLocaleString("en-US", { month: "long" });
  const year = new Date().getFullYear();

  let title = slot.title_formula
    .replace("[MARKET]", market)
    .replace("[MONTH]", month)
    .replace("[YEAR]", String(year))
    .replace("[CARRIER]", context.carrier || "State Farm")
    .replace("[AMOUNT]", context.amount || "$3,500")
    .replace("[CITY]", context.city || market.split(",")[0])
    .replace("[SPECIFIC_TIP]", context.tip || "How to Pre-Qualify Leads in 60 Seconds")
    .replace("[TRENDING_TOPIC]", context.trending || "New Hail Season Forecast");

  const scriptPrompt = `You are writing a YouTube script for a roofing contractor educator channel. The audience is roofing contractors who want to make more money on insurance claims and run better businesses.

TOPIC: ${slot.topic}
TITLE: ${title}
PAIN ANGLE: ${slot.pain_angle}
PORTAL BRIDGE (weave in naturally, never pitch directly): ${slot.portal_bridge}
MARKET CONTEXT: ${context.market || "Denver, CO"} ${context.extraContext || ""}

Write a complete YouTube script with:
1. HOOK (0-30 seconds): Open with a specific dollar amount or shocking stat. Create instant credibility. No "hey guys" openers.
2. PROBLEM (30-90 seconds): Explain the exact pain. Be specific. Name the carrier, the line item, the dollar amount contractors are missing.
3. EDUCATION (90 seconds - 5 minutes): The real content. Step-by-step. Specific. Actionable Monday morning.
4. BRIDGE (30 seconds): Mention naturally how contractors using modern systems automate this. Don't name Roofing OS directly — let them ask.
5. CTA (30 seconds): Tell them exactly what to do next. Comment their market. Subscribe. Check the link.

Format: [HOOK], [PROBLEM], [EDUCATION], [BRIDGE], [CTA] sections clearly labeled.
Tone: Direct, no-fluff, experienced contractor who figured it out.
Length: ~1500-2000 words.`;

  const script = await claude(scriptPrompt, 3000);

  const tiktokPrompt = `Take the core insight from this YouTube script and write a 60-second TikTok/Reels script:

ORIGINAL SCRIPT SUMMARY:
Topic: ${slot.topic}
Title: ${title}
Pain: ${slot.pain_angle}

Write:
- Hook line (first 3 seconds — must stop the scroll)
- 3 punchy points (10 seconds each)
- CTA (5 seconds)

Format: [HOOK] [POINT 1] [POINT 2] [POINT 3] [CTA]
Tone: Fast, punchy, no wasted words.`;

  const tiktok = await claude(tiktokPrompt, 600);

  // Extract hook from script
  const hookMatch = script.match(/\[HOOK\]([\s\S]*?)\[PROBLEM\]/);
  const hook = hookMatch ? hookMatch[1].trim().slice(0, 200) : script.slice(0, 200);

  const thumbnail_text = title.split("—")[0].trim().slice(0, 60).toUpperCase();

  return { title, script, tiktok, hook, thumbnail_text };
}

async function generateForSlot(slot: typeof WEEKLY_SCHEDULE[0]): Promise<void> {
  try {
    let context: Record<string, string> = { market: "Denver, CO" };

    if (slot.topic === "carrier_intelligence") {
      const intel = await getRecentCarrierIntel();
      if (intel) {
        context.carrier = intel.carrier;
        context.extraContext = intel.insight;
      }
    } else if (slot.topic === "storm_analysis") {
      const storm = await getRecentStorm();
      if (storm) {
        context.city = storm.city;
        context.market = `${storm.city}, ${storm.state}`;
        context.extraContext = `Recent hail: ${storm.hail_size}" diameter`;
      }
    }

    const { title, script, tiktok, hook, thumbnail_text } = await generateScript(slot, context);

    // Save youtube script
    const { data: ytContent } = await supabase
      .from("roofing_content")
      .insert({
        type: "youtube_script",
        title,
        body: script,
        status: "pending",
        channel: "youtube",
        hook,
        thumbnail_text,
        estimated_length_seconds: 480,
        source_type: slot.topic,
        market: context.market,
        carrier: context.carrier || null,
        scheduled_topic: slot.topic,
        scheduled_day: slot.day,
        tags: [slot.topic, slot.day, "youtube", context.market]
      })
      .select("id")
      .single();

    // Save tiktok companion
    if (ytContent?.id) {
      await supabase.from("roofing_content").insert({
        type: "tiktok_script",
        title: `[TikTok] ${title}`,
        body: tiktok,
        status: "pending",
        channel: "tiktok",
        hook: hook.slice(0, 100),
        estimated_length_seconds: 60,
        source_type: slot.topic,
        market: context.market,
        scheduled_topic: slot.topic,
        scheduled_day: slot.day,
        tags: [slot.topic, "tiktok", "short_form", context.market]
      });
    }

    // MOVED_TO_DASHBOARD [date: 2026-05-17]: YouTube scripts pending approval visible in Content tab
    // if (ytContent?.id) {
    //   const msgId = await sendTelegramApproval(ytContent.id, title, hook);
    //   if (msgId) {
    //     await supabase.from("roofing_content")
    //       .update({ telegram_message_id: msgId })
    //       .eq("id", ytContent.id);
    //   }
    // }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // MOVED_TO_DASHBOARD [date: 2026-05-17]: errors visible in System tab
    // await tg(`❌ YouTube engine error for ${slot.day}/${slot.topic}: ${msg}`);
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-youtube-engine ready" });

  // Handle Telegram callback_query (approve/skip)
  if (body.callback_query) {
    const { data: callbackData, message } = body.callback_query;
    const contentId = callbackData.replace(/^(approve|edit|skip)_content_/, "");
    const action = callbackData.split("_")[0];

    if (action === "approve") {
      await supabase.from("roofing_content")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", contentId);
      // MOVED_TO_DASHBOARD [date: 2026-05-17]: approval status visible in Content tab
      // await tg(`✅ YouTube script approved and queued for recording.`);
    } else if (action === "skip") {
      await supabase.from("roofing_content")
        .update({ status: "skipped" })
        .eq("id", contentId);
    }
    return Response.json({ ok: true });
  }

  const startMs = Date.now();

  // Generate for a specific slot or all pending slots for today
  if (body.slot) {
    const slot = WEEKLY_SCHEDULE.find(s => s.day === body.slot || s.topic === body.slot);
    if (!slot) return Response.json({ error: "unknown slot" }, { status: 400 });
    await generateForSlot(slot);
    return Response.json({ ok: true, generated: 1, duration_ms: Date.now() - startMs });
  }

  // Default: generate all 8 slots (called once per week or on-demand "youtube now")
  const results: string[] = [];
  for (const slot of WEEKLY_SCHEDULE) {
    await generateForSlot(slot);
    results.push(slot.day);
    await new Promise(r => setTimeout(r, 1000));
  }

  // MOVED_TO_DASHBOARD [date: 2026-05-17]: YouTube engine summary visible in Content tab
  // await tg(`🎬 *YouTube Engine Complete*\n${results.length} scripts generated and sent for approval.`);

  await fetch(`${SUPABASE_URL}/functions/v1/system-heartbeat`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ function_name: "roofing-youtube-engine", status: "ok", response_ms: Date.now() - startMs })
  }).catch(() => {});

  return Response.json({ ok: true, generated: results.length, slots: results, duration_ms: Date.now() - startMs });
});

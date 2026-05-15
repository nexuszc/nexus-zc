// roofing-content-engine — Daily 7am MT (13:00 UTC)
// Generates blog posts, social content, YouTube scripts, and carrier intel

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function claude(prompt: string, maxTokens = 1500): Promise<string> {
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
      system: "You are a content expert for Roofing OS — a platform that helps roofing contractors recover more supplement revenue and delight their homeowners. Write compelling, practical content for roofing contractors. Be direct, specific, and results-oriented. No fluff.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function saveAndNotify(type: string, title: string, body: string, channel: string, stormEventId?: string): Promise<string | null> {
  try {
    const { data: content } = await supabase.from("roofing_content").insert({
      type, title, body, status: "pending", channel,
      storm_event_id: stormEventId || null
    }).select().single();

    if (content) {
      const preview = body.slice(0, 350).replace(/\n+/g, " ");
      await tg(
        `📝 *${type.toUpperCase()} Ready for Approval*\n` +
        `*${title}*\n\n` +
        `${preview}…\n\n` +
        `Reply: \`approve content ${content.id}\``
      );
      return content.id;
    }
  } catch (e) {
    console.error(`saveAndNotify failed for ${type}:`, e);
  }
  return null;
}

async function getRecentStorms() {
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("hail_events")
    .select("*")
    .gte("created_at", since48h)
    .order("hail_size_inches", { ascending: false });

  const dbEvents = data || [];

  // Pull NOAA today's hail reports
  const external: Array<{ id: null; city: string; state: string; hail_size_inches: number; external: boolean }> = [];
  try {
    const noaaRes = await fetch("https://www.spc.noaa.gov/climo/reports/today.csv");
    if (noaaRes.ok) {
      const csv = await noaaRes.text();
      const lines = csv.split("\n").slice(1, 15);
      for (const line of lines) {
        const parts = line.split(",");
        const size = parseFloat(parts[3] || "0");
        if (size >= 1.0 && parts[5] && parts[6]) {
          external.push({ id: null, city: parts[5].trim(), state: parts[6].trim(), hail_size_inches: size, external: true });
        }
      }
    }
  } catch { /* NOAA optional */ }

  return [...dbEvents, ...external.slice(0, 3)];
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-content-engine ready" });

  const generated: string[] = [];
  const isMonday = new Date().getUTCDay() === 1;
  const startMs = Date.now();

  try {
    const storms = await getRecentStorms();

    // Storm blog posts (up to 3)
    for (const storm of storms.slice(0, 3)) {
      const location = (storm as any).city
        ? `${(storm as any).city}, ${(storm as any).state || "CO"}`
        : (storm as any).location || "the affected area";
      const hailSize = (storm as any).hail_size_inches || 1.0;

      const blogContent = await claude(
        `Write a 600-word blog post for roofing contractors about the recent hail storm near ${location} (${hailSize}" hail reported).

Title should be: "${location} Hail Storm: How to Maximize Your Supplement Revenue Before Adjusters Close the File"

Cover:
1. Damage documentation checklist specific to ${hailSize}" hail (what to photograph, how many shots per square)
2. 3 Xactimate line items adjusters commonly miss on ${hailSize}" hail events (be specific with codes)
3. How to counter adjuster low-ball tactics on this storm type
4. Why sending homeowners a live portal link during the claim process gets contractors 40% fewer callbacks

End with: "Want to generate a pre-built supplement package for this storm in 90 seconds? Try Roofing OS free for 14 days at roofingos.dev"

Format: H1 title, then H2 sections, then a closing CTA paragraph.`,
        2000
      );

      if (blogContent) {
        const titleLine = blogContent.split("\n")[0].replace(/^#+\s*/, "").replace(/\*+/g, "");
        const id = await saveAndNotify("blog", titleLine || `${location} Storm Guide`, blogContent, "blog", (storm as any).id);
        if (id) generated.push(`blog: ${location}`);
      }
    }

    // 3 Facebook post drafts
    const fbPrompts = [
      `Write a Facebook post (max 150 words) as a roofing contractor sharing a story: "We just recovered $4,200 in additional supplement revenue for a homeowner in [your city] that the adjuster tried to skip." Tell it as a brief, punchy story. End with a question: "Has this happened on any of your jobs?" Use 2-3 hashtags.`,
      `Write a Facebook post (max 150 words) warning homeowners about the #1 thing that gets their roof claims underpaid — lack of documentation. Be specific: mention the adjuster's 30-day window, photo requirements, and what happens when contractors don't follow up. Include one real stat if possible.`,
      `Write a Facebook post (max 150 words) describing the before/after experience of a homeowner working with a contractor who uses a homeowner portal vs. one who doesn't. Focus on the emotional: not knowing what's happening vs. getting live updates, photos, and insurance status in plain English. End with: "Your homeowners deserve better than radio silence."`
    ];

    for (let i = 0; i < fbPrompts.length; i++) {
      const post = await claude(fbPrompts[i], 400);
      if (post) {
        const id = await saveAndNotify("facebook", `Facebook Draft ${i + 1}`, post, "facebook");
        if (id) generated.push("facebook post");
      }
    }

    // LinkedIn post
    const linkedinPost = await claude(
      `Write a LinkedIn post (max 250 words) from Zach Curtis, founder of Roofing OS.

Topic: The roofing industry leaves $8,000 on average per insurance job because contractors aren't supplementing correctly. That's not a sales problem — it's a documentation and follow-up problem.

Share: One specific story (anonymized), the exact mechanism that causes this loss, and what Roofing OS does to solve it.

Tone: Founder-to-founder. Direct. No buzzwords. No corporate speak.

End with 3 relevant hashtags.`,
      600
    );
    if (linkedinPost) {
      const id = await saveAndNotify("linkedin", "LinkedIn Post", linkedinPost, "linkedin");
      if (id) generated.push("linkedin post");
    }

    // YouTube script
    const ytScript = await claude(
      `Write a 5-minute YouTube video script for roofing contractors.

Title: "How I Add $4,000+ to Every Insurance Roof Job (Step by Step)"

Structure:
- HOOK (30s): Shocking stat or claim — "The average roofing contractor leaves $8,000 on the table per job..."
- PROBLEM (60s): Why supplement revenue gets missed — adjuster tactics, documentation gaps, follow-up failures
- TACTIC 1 (60s): The pre-install supplement — file before you tear off
- TACTIC 2 (60s): The 3 Xactimate codes adjusters always skip (give real examples: O&P, code upgrades, drip edge)
- TACTIC 3 (60s): The homeowner portal move — why showing homeowners their claim status gets adjusters to approve faster
- TOOL REVEAL (45s): Introduce Roofing OS — what it does, how fast it works
- CTA (15s): "14-day free trial at roofingos.dev — link in description"

Write as natural spoken dialogue. Include stage directions like [PAUSE] or [SHOW SCREEN].`,
      2500
    );
    if (ytScript) {
      const id = await saveAndNotify("youtube", "How I Add $4,000+ to Every Insurance Roof Job", ytScript, "youtube");
      if (id) generated.push("youtube script");
    }

    // Carrier intelligence report (Mondays only)
    if (isMonday) {
      const { data: carriers } = await supabase.from("carrier_intelligence").select("*").limit(10);
      const carrierSummary = (carriers || [])
        .map((c: any) => `${c.carrier_name}: ${c.approval_rate_pct}% approval, avg ${c.avg_days_to_approval || "?"} days`)
        .join("\n") || "State Farm, Allstate, USAA, Travelers, Liberty Mutual, Farmers";

      const report = await claude(
        `Write a weekly carrier intelligence briefing for roofing contractors (400 words).

Current carrier data:
${carrierSummary}

Cover:
1. Which 2 carriers are being most difficult this week and why
2. 3 supplement tactics that are getting approvals right now (be specific — include Xactimate codes if relevant)
3. What to say to adjusters on calls this week (1-2 scripts)
4. One specific code combination that's been getting approved: suggest codes like ECH, EDP, O&P with amounts

Format as a professional briefing: bold section headers, short paragraphs.`,
        1200
      );

      if (report) {
        const title = `Weekly Carrier Intel — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
        const id = await saveAndNotify("carrier_intelligence", title, report, "email");
        if (id) generated.push("carrier intelligence");
      }
    }

    const duration = Date.now() - startMs;
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-content-engine",
      status: "ok",
      response_ms: duration,
      checked_at: new Date().toISOString()
    }).catch(() => {});

    await tg(`✅ *Content Engine Complete*\nGenerated: ${generated.length} pieces\n${generated.map(g => `• ${g}`).join("\n")}\n\n_Reply \`content queue\` to see all pending approvals._`);

    return Response.json({ ok: true, generated, storm_count: storms.length, duration_ms: duration });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-content-engine",
      status: "error",
      error_message: msg,
      checked_at: new Date().toISOString()
    }).catch(() => {});
    await tg(`❌ *Content Engine Error*\n${msg}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

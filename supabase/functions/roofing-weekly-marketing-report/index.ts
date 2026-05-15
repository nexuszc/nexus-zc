// roofing-weekly-marketing-report — Mondays 8am MT (14:00 UTC)
// Pulls 7 days of marketing data, generates improvement proposals, sends to Telegram

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

async function claude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-weekly-marketing-report ready" });

  const startMs = Date.now();
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const weekOf = weekStart.split("T")[0];

  try {
    // Pull all marketing data in parallel
    const [
      contentRes,
      queueRes,
      communityRes,
      referralsRes,
      ariaCallsRes,
      signupsRes,
      supplementsRes,
      hailRes
    ] = await Promise.all([
      supabase.from("roofing_content").select("type, status, channel, created_at").gte("created_at", weekStart),
      supabase.from("content_queue").select("channel, status, sent_at").gte("created_at", weekStart),
      supabase.from("roofing_community_posts").select("platform, status, created_at").gte("created_at", weekStart),
      supabase.from("contractor_referrals").select("status, created_at").gte("created_at", weekStart),
      supabase.from("roofing_aria_calls").select("outcome, call_type, created_at").gte("created_at", weekStart),
      supabase.from("contractor_accounts").select("plan, created_at").gte("created_at", weekStart),
      supabase.from("supplement_packages").select("status, supplement_approved_amount, created_at").gte("created_at", weekStart),
      supabase.from("hail_events").select("id, city, hail_size_inches, created_at").gte("created_at", weekStart)
    ]);

    const content = contentRes.data || [];
    const queue = queueRes.data || [];
    const communityPosts = communityRes.data || [];
    const referrals = referralsRes.data || [];
    const ariaCalls = ariaCallsRes.data || [];
    const signups = signupsRes.data || [];
    const supplements = supplementsRes.data || [];
    const hailEvents = hailRes.data || [];

    // Compute metrics
    const emailsSent = queue.filter((q: any) => q.channel === "email" && q.status === "sent").length;
    const smsSent = queue.filter((q: any) => q.channel === "sms" && q.status === "sent").length;
    const contentPublished = content.filter((c: any) => c.status === "published").length;
    const contentApproved = content.filter((c: any) => ["approved", "published"].includes(c.status)).length;
    const contentPending = content.filter((c: any) => c.status === "pending").length;
    const blogPosts = content.filter((c: any) => c.type === "blog").length;
    const fbPosts = content.filter((c: any) => c.type === "facebook").length;
    const communityApproved = communityPosts.filter((p: any) => ["approved", "posted"].includes(p.status)).length;
    const communityPending = communityPosts.filter((p: any) => p.status === "pending").length;
    const referralsGenerated = referrals.length;
    const referralConversions = referrals.filter((r: any) => r.status === "signed_up").length;
    const ariaCallsTotal = ariaCalls.length;
    const ariaCallsConverted = ariaCalls.filter((c: any) => c.outcome === "converted" || c.outcome === "interested").length;
    const ariaConversionRate = ariaCallsTotal > 0 ? Math.round((ariaCallsConverted / ariaCallsTotal) * 100) : 0;
    const newSignups = signups.length;
    const supplementsApproved = supplements.filter((s: any) => s.status === "approved").length;
    const supplementRevenue = supplements
      .filter((s: any) => s.status === "approved")
      .reduce((sum: number, s: any) => sum + ((s.supplement_approved_amount || 0) / 100), 0);

    // Build stats object for Claude
    const statsJson = {
      content: { blog_posts: blogPosts, facebook_drafts: fbPosts, total_generated: content.length, approved: contentApproved, published: contentPublished, pending: contentPending },
      outreach: { emails_sent: emailsSent, sms_sent: smsSent, aria_calls: ariaCallsTotal, aria_conversion_rate: `${ariaConversionRate}%` },
      community: { posts_approved: communityApproved, posts_pending: communityPending, reddit: communityPosts.filter((p: any) => p.platform === "reddit").length, facebook_groups: communityPosts.filter((p: any) => p.platform === "facebook_groups").length },
      referrals: { generated: referralsGenerated, converted: referralConversions },
      signups: { new_contractors: newSignups },
      supplements: { approved: supplementsApproved, revenue: `$${supplementRevenue.toLocaleString()}` },
      storms: { events: hailEvents.length }
    };

    // Save raw metrics to marketing_performance
    const metricsToSave = [
      { week_of: weekOf, channel: "email", metric_name: "sent", metric_value: emailsSent },
      { week_of: weekOf, channel: "sms", metric_name: "sent", metric_value: smsSent },
      { week_of: weekOf, channel: "aria", metric_name: "calls", metric_value: ariaCallsTotal },
      { week_of: weekOf, channel: "aria", metric_name: "conversion_rate", metric_value: ariaConversionRate },
      { week_of: weekOf, channel: "content", metric_name: "published", metric_value: contentPublished },
      { week_of: weekOf, channel: "community", metric_name: "posts_made", metric_value: communityApproved },
      { week_of: weekOf, channel: "referrals", metric_name: "generated", metric_value: referralsGenerated },
      { week_of: weekOf, channel: "signups", metric_name: "new_contractors", metric_value: newSignups },
    ];

    await supabase.from("marketing_performance").insert(metricsToSave).catch(() => {});

    // Generate 3 improvement proposals
    const proposals = await claude(
      `You're analyzing a week of marketing performance for Roofing OS — a SaaS platform for roofing contractors.

Weekly stats:
${JSON.stringify(statsJson, null, 2)}

Generate exactly 3 specific, actionable marketing improvement proposals.

For each proposal:
- Title (short, specific)
- Problem: what the data shows is underperforming
- Fix: exactly what to change, add, or test
- Expected impact: what metric improves and by how much

Focus on the lowest-performing channels and highest-leverage opportunities.
Format as numbered list. Be direct and data-driven. No generic advice.`
    );

    const duration = Date.now() - startMs;

    // Send full report to Telegram
    const reportParts = [
      `📊 *Weekly Marketing Report — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}*\n`,
      `*Content Generated:*\n` +
      `📝 Blog posts: ${blogPosts} | FB drafts: ${fbPosts}\n` +
      `✅ Approved: ${contentApproved} | 📤 Published: ${contentPublished} | ⏳ Pending: ${contentPending}\n`,
      `*Outreach:*\n` +
      `✉️ Emails sent: ${emailsSent}\n` +
      `📱 SMS sent: ${smsSent}\n` +
      `📞 Aria calls: ${ariaCallsTotal} (${ariaConversionRate}% converted)\n`,
      `*Community:*\n` +
      `💬 Posts approved: ${communityApproved} | Pending: ${communityPending}\n` +
      `Reddit: ${communityPosts.filter((p: any) => p.platform === "reddit").length} | FB Groups: ${communityPosts.filter((p: any) => p.platform === "facebook_groups").length}\n`,
      `*Results:*\n` +
      `🏗️ New contractors: ${newSignups}\n` +
      `🤝 Referrals: ${referralsGenerated} generated, ${referralConversions} converted\n` +
      `💰 Supplement revenue approved: $${supplementRevenue.toLocaleString()}\n` +
      `⛈️ Storm events: ${hailEvents.length}\n`,
      `*3 Improvement Proposals:*\n${proposals}`
    ];

    for (const part of reportParts) {
      await tg(part);
      await new Promise(r => setTimeout(r, 500));
    }

    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-weekly-marketing-report",
      status: "ok",
      response_ms: duration,
      checked_at: new Date().toISOString()
    }).catch(() => {});

    return Response.json({ ok: true, stats: statsJson, duration_ms: duration });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from("system_heartbeats").insert({
      function_name: "roofing-weekly-marketing-report",
      status: "error",
      error_message: msg,
      checked_at: new Date().toISOString()
    }).catch(() => {});
    await tg(`❌ *Weekly Marketing Report Error*\n${msg}`);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
});

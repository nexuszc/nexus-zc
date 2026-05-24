// NEXUS briefing v4 — COO morning brief via Telegram
// Scheduled: 13:00 UTC daily (7:00 AM MT)
// v4 adds: funnel pipeline, hot leads 24h, manual calls today, sequences running

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY        = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN       = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function tg(chatId: string, text: string) {
  const truncated = text.length > 4000 ? text.slice(0, 3900) + "..." : text;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: truncated }),
  });
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "briefing v4 ready" });

  try {
    // ── 0. Telegram chat ID ──────────────────────────────────────────────────
    const { data: channelRow } = await supabase
      .from("channel_conversations")
      .select("external_id").eq("channel", "telegram")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!channelRow?.external_id) return new Response("no chat id", { status: 200 });
    const chatId = channelRow.external_id;

    const now     = Date.now();
    const today   = new Date().toISOString().split("T")[0];
    const yest    = new Date(now - 86400000).toISOString();
    const weekAgo = new Date(now - 7 * 86400000).toISOString();
    const minus24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const minus48 = new Date(now - 48 * 60 * 60 * 1000).toISOString();
    const minus3d = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

    // ── 1. Personal brain context ─────────────────────────────────────────────
    const [openTasks, projects, overdueTasks, staleClients] = await Promise.all([
      supabase.from("entries").select("content, created_at, project_names")
        .eq("task_status", "open").eq("role", "user").order("created_at", { ascending: true }),
      supabase.from("projects").select("name, category").neq("category", "archived"),
      supabase.from("entries").select("content, created_at, project_names")
        .eq("task_status", "open").lt("created_at", minus3d).order("created_at").limit(5),
      supabase.from("clients").select("name, status, last_activity_at")
        .eq("status", "active")
        .or(`last_activity_at.lt.${new Date(now - 5 * 86400000).toISOString()},last_activity_at.is.null`).limit(5),
    ]);

    // ── 2. Roofing OS growth numbers ─────────────────────────────────────────
    const [
      signupsYestRes, signupsWeekRes, signupsTotalRes, visitsYestRes,
      ariaCallsRes, emailOpensRes,
      signupsTodayRes,
    ] = await Promise.all([
      supabase.from("roofing_captures").select("id", { count: "exact", head: true }).gte("created_at", `${today}T00:00:00`),
      supabase.from("roofing_captures").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
      supabase.from("roofing_captures").select("id", { count: "exact", head: true }),
      supabase.from("roofing_page_visits").select("visits").eq("date", today).eq("page", "/").maybeSingle(),
      supabase.from("roofing_aria_calls").select("contact_name, contact_phone, outcome, appointment_booked, answered")
        .gte("created_at", yest).limit(20),
      supabase.from("roofing_outreach_log").select("prospect_id, open_count")
        .eq("bot_open", false).not("first_opened_at", "is", null).gte("first_opened_at", yest).limit(20),
      supabase.from("contractor_accounts").select("id", { count: "exact", head: true })
        .gte("created_at", `${today}T00:00:00`).neq("is_test_account", true),
    ]);

    const signupsToday = signupsYestRes.count || 0;
    const signupsWeek  = signupsWeekRes.count || 0;
    const signupsTotal = signupsTotalRes.count || 0;
    const visitsToday  = (visitsYestRes.data as { visits?: number } | null)?.visits || 0;
    const ariaCalls    = ariaCallsRes.data || [];
    const ariaAnswered = ariaCalls.filter((c: any) => c.answered).length;
    const ariaInterested = ariaCalls.filter((c: any) => c.outcome === "interested" || c.appointment_booked).length;
    const emailOpens   = (emailOpensRes.data || []).length;
    const newContractorSignups = signupsTodayRes.count || 0;

    // Pace to 1000 signups (60-day goal)
    const paceNeeded = Math.ceil((1000 - signupsTotal) / 60);
    const onPace = signupsToday >= paceNeeded;
    const paceDays = signupsToday > 0 ? Math.ceil((1000 - signupsTotal) / signupsToday) : 999;

    // ── 3. Funnel pipeline ────────────────────────────────────────────────────
    const [funnelStagesRes, hotLeads24hRes, manualCallsTodayRes, sequencesActiveRes] = await Promise.all([
      supabase.from("roofing_prospects").select("funnel_stage"),
      supabase.from("roofing_prospects")
        .select("owner_name, company_name, phone")
        .eq("funnel_stage", "hot")
        .gte("funnel_stage_updated_at", minus24)
        .limit(5),
      supabase.from("roofing_outreach_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", `${today}T00:00:00`)
        .eq("direction", "outbound"),
      supabase.from("email_sequences")
        .select("id", { count: "exact", head: true })
        .eq("completed", false)
        .eq("unsubscribed", false),
    ]);

    const funnelCounts: Record<string, number> = {};
    for (const p of funnelStagesRes.data || []) {
      const s = p.funnel_stage || "unknown";
      funnelCounts[s] = (funnelCounts[s] || 0) + 1;
    }
    const funnelTotal = Object.values(funnelCounts).reduce((a, b) => a + b, 0);

    const hotLeads24h = (hotLeads24hRes.data || []).map((p: any) =>
      `${p.owner_name || "Unknown"} — ${p.company_name || ""} — ${p.phone || "no phone"}`
    );
    const manualCallsToday = manualCallsTodayRes.count || 0;
    const sequencesActive  = sequencesActiveRes.count || 0;

    // ── 4. Partnership pipeline ───────────────────────────────────────────────
    const [partnerStatusRes, partnerRepliesRes, partnerOutreachYestRes, newTargetsWeekRes] = await Promise.all([
      supabase.from("roofing_partnership_targets").select("status").neq("status", "archived"),
      supabase.from("roofing_partnership_targets").select("name, email")
        .not("responded_at", "is", null).gte("responded_at", weekAgo),
      supabase.from("nexus_audit_log").select("action_detail")
        .in("action_type", ["partner_outreach_sent", "partner_followup_sent"])
        .gte("created_at", yest).limit(10),
      supabase.from("roofing_partnership_targets").select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo),
    ]);

    const partnersByStatus: Record<string, number> = {};
    for (const p of partnerStatusRes.data || []) {
      partnersByStatus[p.status] = (partnersByStatus[p.status] || 0) + 1;
    }
    const activePartners    = partnersByStatus["active"]    || 0;
    const contactedPartners = partnersByStatus["contacted"] || 0;
    const newTargetsWeek    = newTargetsWeekRes.count || 0;
    const outreachYest      = (partnerOutreachYestRes.data || []).length;
    const partnerReplies    = (partnerRepliesRes.data || []);

    // ── 5. Content queue ─────────────────────────────────────────────────────
    const [ytReadyRes, ytPostedYestRes, contentQueueRes, ytAnalyticsRes, voiceoverCostRes, contentPublishedTodayRes] = await Promise.all([
      supabase.from("roofing_content").select("id, title").eq("youtube_upload_ready", true).is("published_url", null).limit(5),
      supabase.from("roofing_content").select("title").not("published_url", "is", null).gte("published_at", yest).limit(1),
      supabase.from("roofing_content").select("channel, status").eq("status", "approved").not("channel", "is", null),
      supabase.from("system_heartbeats").select("metadata, recorded_at")
        .eq("function_name", "roofing-youtube-analytics")
        .order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("roofing_content").select("voiceover_chars")
        .not("voiceover_chars", "is", null).gte("created_at", weekAgo),
      supabase.from("roofing_content").select("id", { count: "exact", head: true })
        .not("published_url", "is", null).gte("published_at", `${today}T00:00:00`),
    ]);

    const ytReady      = (ytReadyRes.data || []).length;
    const ytPostedYest = ytPostedYestRes.data?.[0]?.title || "none";
    const contentPublishedToday = contentPublishedTodayRes.count || 0;

    const contentByChannel: Record<string, number> = {};
    for (const c of contentQueueRes.data || []) {
      if (c.channel) contentByChannel[c.channel] = (contentByChannel[c.channel] || 0) + 1;
    }
    const ytQueueDays  = contentByChannel["youtube"] || 0;
    const fbQueueDays  = contentByChannel["facebook_page"] || 0;
    const redQueueDays = contentByChannel["reddit"] || 0;

    const ytMeta       = ((ytAnalyticsRes.data as { metadata?: Record<string, number> } | null)?.metadata) || {};
    const ytSubs       = (ytMeta as Record<string, number>).subscribers || 0;
    const ytWatchHours = (ytMeta as Record<string, number>).watch_hours || 0;
    const ytTotalViews = (ytMeta as Record<string, number>).total_views || 0;
    const ytSubsPct    = Math.min(100, Math.round(ytSubs / 1000 * 100));
    const ytHoursPct   = Math.min(100, Math.round(ytWatchHours / 4000 * 100));

    const voiceoverCharsWeek = (voiceoverCostRes.data || []).reduce((s: number, r: any) => s + (r.voiceover_chars || 0), 0);
    const ttsWeekCost = (voiceoverCharsWeek / 1000 * 0.030).toFixed(2);

    // ── 6. Revenue ───────────────────────────────────────────────────────────
    const { data: contractors } = await supabase
      .from("contractor_accounts").select("plan, plan_price_cents, status")
      .eq("status", "active").neq("is_test_account", true);

    const freeCount = (contractors || []).filter((c: any) => c.plan === "free").length;
    const paidCount = (contractors || []).filter((c: any) => c.plan !== "free").length;
    const mrr = (contractors || [])
      .filter((c: any) => c.plan !== "free")
      .reduce((s: number, c: any) => s + (c.plan_price_cents || 0), 0);

    // ── 7. Needs Zach ────────────────────────────────────────────────────────
    const [pendingApprovals, pendingReddit, aeTasks] = await Promise.all([
      supabase.from("nexus_roofing_proposals").select("title").eq("status", "pending").limit(3),
      supabase.from("roofing_community_posts").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("roofing_va_tasks").select("title, priority")
        .eq("date", today).eq("assigned_to", "ae").eq("status", "pending").order("priority").limit(3),
    ]);

    const needsZach: string[] = [];
    if (hotLeads24h.length > 0) hotLeads24h.forEach(l => needsZach.push(`📞 Call HOT: ${l}`));
    if (partnerReplies.length > 0) partnerReplies.forEach((p: any) => needsZach.push(`🤝 Partner replied: ${p.name} (${p.email})`));
    if ((pendingApprovals.data || []).length > 0) needsZach.push(`✅ Approve builds: ${(pendingApprovals.data || []).map((p: any) => p.title).join(", ")}`);
    if ((pendingReddit.count || 0) > 0) needsZach.push(`💬 Approve ${pendingReddit.count} Reddit replies`);

    // ── 8. Personal brain items ──────────────────────────────────────────────
    const openTaskCount    = (openTasks.data || []).length;
    const overdueTaskCount = (overdueTasks.data || []).length;
    const staleClientNames = (staleClients.data || []).map((c: any) => c.name).join(", ");

    const isMonday = new Date().getDay() === 1;
    let weeklySummary = "";
    if (isMonday) {
      const { data: lastReport } = await supabase
        .from("weekly_reports").select("fixes_attempted, fixes_successful")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (lastReport) weeklySummary = `\nLast week self-improvement: ${lastReport.fixes_successful}/${lastReport.fixes_attempted} fixes verified.`;
    }

    // ── 9. Build the briefing ─────────────────────────────────────────────────
    const dateLabel = new Date().toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric",
      timeZone: "America/Denver",
    });

    const funnelLine = [
      funnelCounts["new_lead"] ? `New: ${funnelCounts["new_lead"]}` : "",
      funnelCounts["contacted"] ? `Contacted: ${funnelCounts["contacted"]}` : "",
      funnelCounts["interested"] ? `Interested: ${funnelCounts["interested"]}` : "",
      funnelCounts["hot"] ? `Hot: ${funnelCounts["hot"]}` : "",
      funnelCounts["signed_up"] ? `Signed: ${funnelCounts["signed_up"]}` : "",
    ].filter(Boolean).join(" | ") || "No prospects yet";

    const briefing = [
      `🏠 ROOFING OS — ${dateLabel}`,
      "",
      `📈 GROWTH`,
      `Signups today: ${signupsToday} | This week: ${signupsWeek} | Total: ${signupsTotal}/1,000`,
      newContractorSignups > 0 ? `⭐ New contractor accounts today: ${newContractorSignups}` : "",
      `Pace to 1,000: ${paceDays} days ${onPace ? "✅" : "⚠️ behind — need " + paceNeeded + "/day"}`,
      visitsToday > 0 ? `Visits today: ${visitsToday} → conv ${visitsToday > 0 ? Math.round(signupsToday / visitsToday * 100) : 0}%` : "",
      "",
      `🎯 FUNNEL (${funnelTotal} active)`,
      funnelLine,
      hotLeads24h.length > 0
        ? `🔥 HOT last 24h:\n${hotLeads24h.map(l => `  • ${l}`).join("\n")}`
        : "No new hot leads in 24h",
      `Calls today: ${manualCallsToday} | Sequences running: ${sequencesActive}`,
      "",
      `📞 OUTREACH`,
      `Aria calls yesterday: ${ariaCalls.length} (${ariaAnswered} answered, ${ariaInterested} interested)`,
      `Email opens: ${emailOpens}`,
      "",
      `🤝 PARTNERSHIPS`,
      `Active: ${activePartners} | Pipeline: ${contactedPartners} | New targets this week: ${newTargetsWeek}`,
      `Outreach sent yesterday: ${outreachYest}`,
      partnerReplies.length > 0
        ? `Replies: ${partnerReplies.length}\n${partnerReplies.map((p: any) => `  • ${p.name} REPLIED`).join("\n")}`
        : "Replies: 0",
      "",
      `📱 CONTENT`,
      `Published today: ${contentPublishedToday} | Last upload: ${ytPostedYest}`,
      `Queue: ${ytReady} ready | YT ${ytQueueDays} | FB ${fbQueueDays} | Reddit ${redQueueDays}`,
      ytSubs > 0 ? `Channel: ${ytSubs} subs (${ytSubsPct}%) | ${ytTotalViews.toLocaleString()} views | ${ytWatchHours.toFixed(0)}h (${ytHoursPct}% to monetize)` : "",
      voiceoverCharsWeek > 0 ? `TTS this week: ${(voiceoverCharsWeek / 1000).toFixed(1)}K chars ≈ $${ttsWeekCost}` : "",
      ytReady < 3 ? "⚠️ YouTube queue low" : "",
      "",
      `💰 REVENUE`,
      `Free: ${freeCount} | Paid: ${paidCount} | MRR: $${Math.round(mrr / 100).toLocaleString()}`,
      "",
      needsZach.length > 0
        ? `⚠️ NEEDS YOU\n${needsZach.map(n => `  ${n}`).join("\n")}`
        : `✅ Nothing requires your decision right now.`,
      openTaskCount > 0 ? `\n📋 Open tasks: ${openTaskCount} (${overdueTaskCount} overdue)` : "",
      staleClientNames ? `\n🏢 Stale clients: ${staleClientNames}` : "",
      weeklySummary,
    ].filter(Boolean).join("\n");

    await tg(chatId, briefing);

    if ((aeTasks.data || []).length > 0) {
      const aeMsg = `📋 AE tasks today:\n${(aeTasks.data || []).map((t: any) => `• ${t.title}`).join("\n")}\n\napp.nexuszc.com/roofing/ae`;
      await tg(chatId, aeMsg);
    }

    if ((staleClients.data || []).length > 0) {
      await supabase.from("platform_insights").insert({
        insight: `${(staleClients.data || []).length} client(s) silent 5+ days: ${staleClientNames}`,
        insight_type: "risk",
        source_client_ids: [],
      }).catch(() => {});
    }

    return Response.json({ ok: true });

  } catch (err) {
    console.error("Briefing error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});

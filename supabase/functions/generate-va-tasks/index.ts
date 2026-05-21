// generate-va-tasks v2
// 1. Legacy VA task generation (Brian / client assignments)
// 2. AE daily task generation → roofing_va_tasks table
// Triggered by cron 13:00 UTC daily or { generate_ae_tasks: true }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY      = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL           = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── AE TASK GENERATION ────────────────────────────────────────────────────

async function generateAETasks(): Promise<{ generated: number }> {
  const todayStr = today();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Don't regenerate if tasks already exist for today
  const { count: existing } = await supabase
    .from("roofing_va_tasks")
    .select("*", { count: "exact", head: true })
    .eq("date", todayStr);
  if ((existing || 0) > 0) return { generated: 0 };

  const tasks: any[] = [];

  // ── PRIORITY 1: URGENT ─────────────────────────────────────────────────

  // Hot lead follow-up (interested calls in last 24h)
  const { data: hotLeads } = await supabase
    .from("roofing_aria_calls")
    .select("id, contact_name, contact_phone, company_name, call_type")
    .eq("outcome", "interested")
    .gte("created_at", since24h)
    .limit(5);

  for (const lead of (hotLeads || [])) {
    const name  = lead.contact_name || "the prospect";
    const phone = lead.contact_phone || "";
    const co    = lead.company_name  || "";
    tasks.push({
      date:                  todayStr,
      task_type:             "hot_lead_followup",
      title:                 `Follow up — ${name}${co ? ` (${co})` : ""}`,
      description:           `This prospect was interested on Aria's call yesterday. Call now before they go cold.`,
      priority:              1,
      time_estimate_minutes: 20,
      steps: JSON.stringify([
        `Call ${name} at ${phone || "[check CRM for phone]"}`,
        `Say: "Hey ${name}, this is [your name] from Roofing OS — following up on the call you had with our system. Did you get a chance to check out the portal?"`,
        `Goal: get them to roofingos.dev/dashboard and create their first job`,
        `No answer → leave voicemail → escalate`,
      ]),
      copy_text: `Hi ${name},\n\nFollowing up on your conversation with Roofing OS. Wanted to personally make sure you got set up — it only takes 4 minutes.\n\nCreate your first job at roofingos.dev/dashboard. I am here if you have questions.\n\n— [Your name]\nRoofing OS`,
    });
  }

  // Welcome calls (new contractors, no jobs yet)
  const { data: newContractors } = await supabase
    .from("contractor_accounts")
    .select("id, business_name, owner_name, phone")
    .gte("created_at", since24h)
    .limit(3);

  for (const c of (newContractors || [])) {
    const name = c.owner_name || c.business_name || "there";
    const phone = c.phone || "";
    tasks.push({
      date:                  todayStr,
      task_type:             "welcome_call",
      title:                 `Welcome call — ${c.business_name || c.owner_name}`,
      description:           `New contractor signed up. No jobs created yet. Warm call to get them started.`,
      priority:              1,
      time_estimate_minutes: 15,
      steps: JSON.stringify([
        `Call ${name} at ${phone || "[check account for phone]"}`,
        `Say: "Hey ${name}, welcome to Roofing OS — just wanted to make sure you are set up. Do you have 2 minutes?"`,
        `Walk them through creating first job at roofingos.dev/dashboard`,
        `No answer → escalate`,
      ]),
      copy_text: `Hi ${name},\n\nWelcome to Roofing OS! Your account is active.\n\nCreate your first job in under 4 minutes: roofingos.dev/dashboard\n\nLet me know if you need anything.\n\n— [Your name]\nRoofing OS`,
    });
  }

  // ── PRIORITY 2: IMPORTANT ──────────────────────────────────────────────

  // Approve content queue
  const { count: pendingPosts } = await supabase
    .from("roofing_community_posts")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  if ((pendingPosts || 0) > 0) {
    tasks.push({
      date:                  todayStr,
      task_type:             "content_approval",
      title:                 `Approve community posts (${pendingPosts} pending)`,
      description:           `AI-generated community posts need a human check before publishing.`,
      priority:              2,
      time_estimate_minutes: 15,
      steps: JSON.stringify([
        `Go to app.nexuszc.com/roofing/content`,
        `Click Community tab → filter Pending`,
        `Read each post — does it sound human?`,
        `Yes → Approve. Sounds wrong → Escalate.`,
      ]),
    });
  }

  // Partnership follow-ups (sent, not replied, sent > 48h ago)
  const { data: partners } = await supabase
    .from("roofing_partnership_targets")
    .select("id, name, email")
    .eq("status", "sent")
    .is("replied_at", null)
    .lte("sent_at", since48h)
    .limit(3);

  if ((partners || []).length > 0) {
    const partnerList = (partners || []).map(p => p.name).join(", ");
    tasks.push({
      date:                  todayStr,
      task_type:             "partnership_followup",
      title:                 `Partnership follow-up — ${partnerList}`,
      description:           `These partnership targets were emailed 48h+ ago and haven't replied.`,
      priority:              2,
      time_estimate_minutes: 20,
      steps: JSON.stringify([
        `Open the pre-written follow-up below`,
        `Edit name to match the contact`,
        `Send from zach@roofingos.dev`,
        `Got a reply you are unsure about → escalate`,
      ]),
      copy_text: `Hi [name],\n\nJust following up on my note from earlier this week about Roofing OS.\n\nWe are a free homeowner portal + supplement AI for roofing contractors. Your contractors would use it at no cost — and it saves them $79-199/month on CompanyCam immediately.\n\nWorth 15 minutes?\n\nZach Curtis\nRoofing OS · roofingos.dev`,
    });
  }

  // ── PRIORITY 3: DAILY EXECUTION ────────────────────────────────────────

  // Facebook group post — pull today's content
  const { data: fbPost } = await supabase
    .from("roofing_content")
    .select("id, title, body, hook")
    .eq("type", "facebook_post")
    .eq("channel", "facebook_group")
    .eq("status", "pending_approval")
    .eq("schedule_date", todayStr)
    .limit(1)
    .maybeSingle();

  const fbBody = fbPost
    ? `${fbPost.hook || ""}\n\n${fbPost.body || ""}`.trim()
    : "(No scheduled post today — use a tip from roofingos.dev)";

  tasks.push({
    date:                  todayStr,
    task_type:             "facebook_post",
    title:                 "Post to Facebook roofing groups",
    description:           "Copy the post below and share across roofing Facebook groups.",
    priority:              3,
    time_estimate_minutes: 20,
    steps: JSON.stringify([
      `Copy the post below`,
      `Log into Facebook personal account`,
      `Go to each roofing group — paste and post`,
      `Add first comment: roofingos.dev — free forever no card`,
      `Repeat for all 5 groups`,
    ]),
    copy_text: fbBody,
  });

  // Facebook group engagement
  tasks.push({
    date:                  todayStr,
    task_type:             "facebook_engagement",
    title:                 "Engage in Facebook roofing groups",
    description:           "Find real contractor problems and leave genuinely helpful comments.",
    priority:              3,
    time_estimate_minutes: 30,
    steps: JSON.stringify([
      `Search "supplement denied" in each group`,
      `Find real contractor problems`,
      `Comment something genuinely helpful`,
      `No links. No sales. Just help.`,
      `Target: 3 real comments across 3 groups`,
    ]),
  });

  // Reddit r/RoofingOS post
  const { data: redditPost } = await supabase
    .from("roofing_community_posts")
    .select("id, post_title, post_body")
    .eq("platform", "reddit")
    .eq("owns_community", true)
    .eq("schedule_date", todayStr)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();

  const redditBody = redditPost
    ? `${(redditPost as any).post_title || ""}\n\n${(redditPost as any).post_body || ""}`.trim()
    : "(No scheduled Reddit post — write a quick tip for r/RoofingOS)";

  tasks.push({
    date:                  todayStr,
    task_type:             "reddit_post",
    title:                 "Post to r/RoofingOS",
    description:           "Share today's content on the r/RoofingOS subreddit.",
    priority:              3,
    time_estimate_minutes: 10,
    steps: JSON.stringify([
      `Copy the post below`,
      `Go to reddit.com/r/RoofingOS`,
      `Create post → paste → submit`,
      `Add roofingos.dev in the post body`,
    ]),
    copy_text: redditBody,
  });

  // YouTube comments
  tasks.push({
    date:                  todayStr,
    task_type:             "youtube_comments",
    title:                 "Reply to YouTube comments",
    description:           "Respond to every comment on the Roofing OS YouTube channel.",
    priority:              3,
    time_estimate_minutes: 15,
    steps: JSON.stringify([
      `Go to studio.youtube.com → Comments`,
      `Reply to every comment`,
      `Question → real answer`,
      `Positive → thank you + roofingos.dev`,
      `Above 50 views → screenshot → Telegram Zach`,
    ]),
  });

  // ── PRIORITY 4: END OF DAY ─────────────────────────────────────────────

  tasks.push({
    date:                  todayStr,
    task_type:             "update_numbers",
    title:                 "Update dashboard follower counts",
    description:           "Manually update social follower counts in the dashboard.",
    priority:              4,
    time_estimate_minutes: 10,
    steps: JSON.stringify([
      `Check Facebook page followers → update manually in dashboard`,
      `Check Facebook group members → update`,
      `Check r/RoofingOS members → update`,
    ]),
  });

  tasks.push({
    date:                  todayStr,
    task_type:             "end_of_day_log",
    title:                 "Log what worked today",
    description:           "3-sentence debrief so tomorrow's AE knows what to do more of.",
    priority:              4,
    time_estimate_minutes: 10,
    steps: JSON.stringify([
      `Write 3 sentences in the Notes field`,
      `1. What got most engagement today`,
      `2. What got ignored`,
      `3. One thing to try tomorrow`,
    ]),
  });

  // ── INSERT ALL ─────────────────────────────────────────────────────────
  if (tasks.length > 0) {
    const { error } = await supabase.from("roofing_va_tasks").insert(tasks);
    if (error) console.error("roofing_va_tasks insert error:", error.message);
  }

  return { generated: tasks.length };
}

// ── LEGACY VA TASK GENERATION ─────────────────────────────────────────────

async function generateLegacyVATasks(): Promise<number> {
  const { data: assignments } = await supabase
    .from("va_assignments")
    .select(`
      id, va_name, client_id,
      clients(id, name, deal_type, rev_share_pct, monthly_fee,
        client_context(core_offer, goals, script, target_audience)
      )
    `)
    .eq("status", "active");

  if (!assignments?.length) return 0;

  let generated = 0;

  for (const assignment of assignments) {
    const client = assignment.clients as any;
    const ctx    = client?.client_context?.[0];

    const { data: recentCalls } = await supabase
      .from("call_logs")
      .select("outcome, notes, lead_name, logged_at")
      .eq("client_id", assignment.client_id)
      .order("logged_at", { ascending: false })
      .limit(10);

    const { data: openTasks } = await supabase
      .from("entries")
      .select("content")
      .eq("client_id", assignment.client_id)
      .eq("task_status", "open");

    const prompt = `Generate a daily task queue for a VA working on ${client?.name}.

CLIENT CONTEXT:
- Business: ${client?.name} (${client?.deal_type || "unknown deal type"})
- Core offer: ${ctx?.core_offer || "not set"}
- Goals: ${ctx?.goals || "not set"}
- Target audience: ${ctx?.target_audience || "not set"}
- Script: ${ctx?.script ? "Available" : "Not set"}

RECENT CALL ACTIVITY (last 10 calls):
${recentCalls?.map((c: any) => `- ${c.lead_name || "Unknown"}: ${c.outcome} — ${c.notes?.slice(0, 100) || "no notes"}`).join("\n") || "No recent calls"}

OPEN CLIENT TASKS:
${openTasks?.map((t: any) => `- ${t.content.slice(0, 100)}`).join("\n") || "None"}

Generate a focused daily task list for this VA. Return ONLY valid JSON:
{
  "tasks": [
    {
      "id": "1",
      "title": "Short task title",
      "description": "What to do and how",
      "priority": "high|medium|low",
      "type": "call|email|research|follow_up|admin",
      "estimated_minutes": 15
    }
  ],
  "daily_focus": "One sentence on what matters most today"
}

Max 8 tasks. Be specific. Reference actual client context.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const text = data?.content?.[0]?.text || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    try {
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { tasks: [] };

      await supabase.from("va_task_queues").upsert({
        va_assignment_id: assignment.id,
        client_id:        assignment.client_id,
        date:             today(),
        tasks:            parsed.tasks || [],
        total_count:      parsed.tasks?.length || 0,
        generated_at:     new Date().toISOString(),
      }, { onConflict: "va_assignment_id,date" });

      generated++;
    } catch (err) {
      console.error(`Failed to generate tasks for ${assignment.va_name}:`, err);
    }
  }

  return generated;
}

// ── HANDLER ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "generate-va-tasks v2 ready" });

  const startMs = Date.now();
  const [aeResult, legacyCount] = await Promise.all([
    generateAETasks(),
    generateLegacyVATasks(),
  ]);

  await supabase.from("system_heartbeats").insert({
    function_name: "generate-va-tasks",
    status:        "ok",
    response_ms:   Date.now() - startMs,
    checked_at:    new Date().toISOString(),
  }).catch(() => {});

  return Response.json({
    ok:             true,
    ae_tasks:       aeResult.generated,
    legacy_va_tasks: legacyCount,
    duration_ms:    Date.now() - startMs,
  });
});

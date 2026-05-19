// roofing-content-engine v4
// YouTube-first content system — pulls from content_topics, generates scripts,
// queues for dashboard approval. 7 shorts + 1 long per run.
// v3: YOUTUBE_DESCRIPTION_FOOTER appended to all long-form descriptions
// v4: 7 shorts per run (was 5)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── YOUTUBE DESCRIPTION FOOTER ────────────────────────────────────────────────
// Appended to every AI-generated long-form description for consistent CTAs + SEO

const YOUTUBE_DESCRIPTION_FOOTER = `

---
Try Roofing OS free for 14 days → https://roofingos.dev
No contract. No setup fees. Cancel anytime.

🏠 What is Roofing OS?
Roofing OS is a $49/month homeowner portal that gives your clients live job updates, photos, insurance status, and messaging — so they stop calling you during jobs.

✅ Live portal link sent in seconds
✅ Insurance claim status visible to homeowner
✅ Auto photo uploads from your crew
✅ 5-star reviews and referrals built in

See it live: https://roofingos.dev/portal/DEMO2026ROOFINGOS

Questions? Reply in comments or email zach@roofingos.dev

---
#RoofingOS #RoofingContractor #InsuranceRestoration #RoofingBusiness #HailDamage #RoofingTips #ContractorLife #RoofingCompany #RoofingCRM #HomeownerPortal`;

// ── PROMPTS ───────────────────────────────────────────────────────────────────

const SHORT_SYSTEM = `You write YouTube Shorts scripts for Roofing OS — a $49/month homeowner portal for roofing contractors.

TARGET: Insurance restoration roofers. Busy, skeptical, and practical.

STRUCTURE (strict — do not deviate):
0-3 sec: ONE sentence. The exact pain. No intro. No name. Just the problem.
3-15 sec: Make it worse. They feel it daily. One specific scenario.
15-25 sec: Roofing OS fixes this. One feature. One outcome.
25-30 sec: "roofingos.dev. Free trial. Link in bio."

RULES:
- Max 80 words. Under 30 seconds when spoken.
- No filler: "today" "guys" "awesome" "literally"
- Sound like a contractor not a marketer
- Mention roofingos.dev once at the end
- Every word earns its place

OUTPUT: JSON only. No markdown. No explanation.
{
  "title": "max 50 chars",
  "script": "full word-for-word script",
  "hook_text": "on-screen text for first 3 sec",
  "thumbnail_text": "3-5 word thumbnail overlay",
  "duration_estimate": 28
}`;

const LONG_SYSTEM = `You write short YouTube video scripts for Roofing OS — a $49/month homeowner portal for roofing contractors.

TARGET: Insurance restoration roofers. Busy. Skeptical. Practical. 2-50 employees.

STRUCTURE (follow exactly — 2-3 minutes total):
Hook (0:00-0:15): State the pain immediately. No intro. Make them feel it in 2 sentences.
Problem (0:15-0:45): Why this happens in roofing. One story or scenario with a number.
Cost (0:45-1:15): What it costs them. Time lost or revenue missed. One specific example.
Solution (1:15-2:30): How Roofing OS fixes it. What the roofer does, what the homeowner sees. Concrete steps.
CTA (2:30-end): "Go to roofingos.dev right now. 14-day free trial. No contract. Link in the description." Say the URL twice.

RULES:
- Max 400 words. 2-3 minutes when spoken.
- No filler words
- Mention roofingos.dev minimum 2 times
- Sound like a contractor helping contractors
- Specific numbers whenever possible

OUTPUT: JSON only. No markdown.
{
  "title": "max 65 chars, SEO optimized",
  "script": "full word-for-word script",
  "hook_text": "first sentence on screen",
  "thumbnail_text": "3-5 word thumbnail overlay",
  "description": "YouTube SEO description 200 words",
  "tags": ["tag1", "tag2"],
  "duration_estimate": 150
}`;

// ── GENERATE ──────────────────────────────────────────────────────────────────

async function generateScript(topic: { title: string; pain_point: string; format: string }): Promise<{
  title: string;
  script: string;
  hook_text: string;
  thumbnail_text: string;
  description?: string;
  tags?: string[];
  duration_estimate: number;
} | null> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  const controller = new AbortController();
  const timeoutMs = topic.format === "long" ? 50000 : 30000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: topic.format === "short" ? 400 : 2000,
        system: topic.format === "short" ? SHORT_SYSTEM : LONG_SYSTEM,
        messages: [{
          role: "user",
          content: `Topic: "${topic.title}"\nPain point: ${topic.pain_point}\nGenerate the script now. JSON only.`,
        }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text;
    if (!text) return null;

    try {
      return JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      console.error("Parse failed for topic:", topic.title, text?.slice(0, 200));
      return null;
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.test) return Response.json({ ok: true, message: "roofing-content-engine v3 ready" });

    const startMs = Date.now();

    const { data: usedTopics } = await supabase
      .from("content_topics")
      .select("topic_hash")
      .not("used_at", "is", null);

    const usedHashes = new Set((usedTopics || []).map((t: { topic_hash: string }) => t.topic_hash));

    const { data: existingContent } = await supabase
      .from("roofing_content")
      .select("topic_hash")
      .not("topic_hash", "is", null);

    const generatedHashes = new Set((existingContent || []).map((c: { topic_hash: string }) => c.topic_hash));

    const { data: allTopics } = await supabase
      .from("content_topics")
      .select("*")
      .order("created_at", { ascending: true });

    const unused = (allTopics || []).filter(
      (t: { topic_hash: string }) => !usedHashes.has(t.topic_hash) && !generatedHashes.has(t.topic_hash)
    );

    const shorts = unused.filter((t: { format: string }) => t.format === "short").slice(0, 7);
    const longs  = unused.filter((t: { format: string }) => t.format === "long").slice(0, 1);
    const toGenerate = [...shorts, ...longs];

    if (toGenerate.length === 0) {
      await supabase
        .from("content_topics")
        .update({ used_at: null })
        .lt("performance_score", 50);

      try {
        await supabase.from("system_heartbeats").insert({
          function_name: "roofing-content-engine",
          status: "ok",
          response_ms: Date.now() - startMs,
          metadata: { generated: 0, message: "all topics used — reset low performers" },
          recorded_at: new Date().toISOString(),
        });
      } catch { /* non-fatal */ }

      return Response.json({ ok: true, generated: 0, message: "All topics used — reset low performers" });
    }

    let generated = 0;
    const errors: string[] = [];

    for (const topic of toGenerate) {
      try {
        const parsed = await generateScript(topic);
        if (!parsed) {
          errors.push(`Parse failed: ${topic.title}`);
          continue;
        }

        const { error: insertErr } = await supabase.from("roofing_content").insert({
          title: parsed.title,
          body: parsed.script,
          script: parsed.script,
          hook_text: parsed.hook_text,
          thumbnail_text: parsed.thumbnail_text,
          seo_description: parsed.description ? parsed.description + YOUTUBE_DESCRIPTION_FOOTER : null,
          tags: parsed.tags || [],
          format: topic.format,
          pain_point: topic.pain_point,
          topic_hash: topic.topic_hash,
          duration_estimate: parsed.duration_estimate,
          type: topic.format === "long" ? "youtube_long" : "youtube_short",
          channel: "youtube",
          status: "pending_approval",
          schedule_slot: null,
        });

        if (insertErr) {
          errors.push(`Insert failed (${topic.title}): ${insertErr.message}`);
          continue;
        }

        await supabase
          .from("content_topics")
          .update({ used_at: new Date().toISOString() })
          .eq("topic_hash", topic.topic_hash);

        generated++;
      } catch (err) {
        errors.push(`${topic.title}: ${String(err).slice(0, 200)}`);
      }
    }

    try {
      await supabase.from("system_heartbeats").insert({
        function_name: "roofing-content-engine",
        status: errors.length > 0 && generated === 0 ? "error" : "ok",
        response_ms: Date.now() - startMs,
        error_message: errors.length > 0 ? errors.join("; ").slice(0, 500) : null,
        metadata: { generated, errors: errors.length, topics_available: toGenerate.length },
        recorded_at: new Date().toISOString(),
      });
    } catch { /* non-fatal */ }

    return Response.json({ ok: true, generated, errors: errors.length > 0 ? errors : undefined });
  } catch (fatal) {
    console.error("roofing-content-engine fatal:", fatal);
    return Response.json({ ok: false, error: String(fatal) }, { status: 500 });
  }
});

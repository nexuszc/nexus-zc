// roofing-content-engine v2
// YouTube-first content system — pulls from content_topics, generates scripts,
// queues for dashboard approval. 5 shorts + 1 long per run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── PROMPTS ───────────────────────────────────────────────────────────────────

const SHORT_SYSTEM = `You write 60-second YouTube Shorts scripts for Roofing OS — a $49/month homeowner portal for roofing contractors.

TARGET: Insurance restoration roofers. Busy, skeptical, and practical.

STRUCTURE (strict — do not deviate):
0-5 sec: ONE sentence. The exact pain. No intro. No name. Just the problem.
5-25 sec: Make it worse. They feel it daily. Use specifics — times, dollar amounts, scenarios.
25-50 sec: Roofing OS fixes this. One feature. Be specific. Show the outcome.
50-60 sec: "Go to roofingos.dev. Free trial. Link in bio."

RULES:
- Max 130 words
- No filler: "today" "guys" "awesome" "literally"
- Sound like a contractor not a marketer
- Mention roofingos.dev once at the end
- Every word earns its place

OUTPUT: JSON only. No markdown. No explanation.
{
  "title": "max 50 chars",
  "script": "full word-for-word script",
  "hook_text": "on-screen text for first 5 sec",
  "thumbnail_text": "3-5 word thumbnail overlay",
  "duration_estimate": 55
}`;

const LONG_SYSTEM = `You write YouTube video scripts for Roofing OS — a $49/month homeowner portal for roofing contractors.

TARGET: Insurance restoration roofers. Busy. Skeptical. Practical. 2-50 employees.

STRUCTURE (follow exactly):
Hook (0:00-0:20): State the pain immediately. No intro. Make them feel it in 3 sentences.
Problem (0:20-2:00): Why this happens in roofing. Use data, stories, or common scenarios.
Cost (2:00-3:00): What it actually costs them. Time lost, revenue missed, stress caused.
Solution (3:00-5:30): How Roofing OS fixes it. Walk through the specific feature step by step. Be concrete — what the roofer does, what the homeowner sees.
CTA (5:30-end): "Go to roofingos.dev right now. 14-day free trial. No contract. I'll put the link in the description." Say the URL twice.

RULES:
- Max 800 words
- No filler words
- Mention roofingos.dev minimum 3 times
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
  "duration_estimate": 360
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
        max_tokens: topic.format === "short" ? 300 : 2000,
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
    if (body.test) return Response.json({ ok: true, message: "roofing-content-engine v2 ready" });

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

    const shorts = unused.filter((t: { format: string }) => t.format === "short").slice(0, 5);
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
          seo_description: parsed.description || null,
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

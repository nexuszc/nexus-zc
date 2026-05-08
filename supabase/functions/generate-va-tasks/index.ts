import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: assignments } = await supabase
    .from("va_assignments")
    .select(`
      id, va_name, client_id,
      clients(id, name, deal_type, rev_share_pct, monthly_fee,
        client_context(core_offer, goals, script, target_audience)
      )
    `)
    .eq("status", "active");

  if (!assignments?.length) return new Response(JSON.stringify({ ok: true, generated: 0 }));

  let generated = 0;

  for (const assignment of assignments) {
    const client = assignment.clients as any;
    const ctx = client?.client_context?.[0];

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
        client_id: assignment.client_id,
        date: new Date().toISOString().split("T")[0],
        tasks: parsed.tasks || [],
        total_count: parsed.tasks?.length || 0,
        generated_at: new Date().toISOString(),
      }, { onConflict: "va_assignment_id,date" });

      generated++;
    } catch (err) {
      console.error(`Failed to generate tasks for ${assignment.va_name}:`, err);
    }
  }

  return new Response(JSON.stringify({ ok: true, generated }), {
    headers: { "Content-Type": "application/json" },
  });
});

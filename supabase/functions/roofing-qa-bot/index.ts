import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function sendTelegram(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-qa-bot ready" });

  const callFn = async (name: string, payload: Record<string, unknown>) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return res;
  };

  const tests = [
    {
      name: "Portal API responds",
      fn: async () => {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/portal-api?token=test&action=overview`,
          { headers: { "Authorization": `Bearer ${SERVICE_KEY}` } }
        );
        return res.status !== 500;
      }
    },
    {
      name: "Supplement generator responds",
      fn: async () => {
        const res = await callFn("roofing-supplement-generator", { test: true });
        return res.ok;
      }
    },
    {
      name: "Crew manager responds",
      fn: async () => {
        const res = await callFn("roofing-crew-manager", { test: true });
        return res.ok;
      }
    },
    {
      name: "Aria engine responds",
      fn: async () => {
        const res = await callFn("roofing-aria-engine", { test: true });
        return res.ok;
      }
    },
    {
      name: "Job pipeline responds",
      fn: async () => {
        const res = await callFn("roofing-job-pipeline", { test: true });
        return res.ok;
      }
    },
    // roofing-financial function does not exist — test removed
    // {
    //   name: "Financial dashboard responds",
    //   fn: async () => {
    //     const res = await callFn("roofing-financial", { action: "dashboard" });
    //     const data = await res.json();
    //     return "revenue" in data;
    //   }
    // },
    {
      name: "Depreciation tracker responds",
      fn: async () => {
        const res = await callFn("roofing-depreciation-tracker", { action: "scan" });
        return res.ok;
      }
    },
    {
      name: "Portal magic link generation works",
      fn: async () => {
        const res = await callFn("portal-magic-link", {
          job_id: "00000000-0000-0000-0000-000000000001",
          homeowner_email: "qa@roofingos.dev",
          homeowner_name: "QA Test",
          contractor_name: "Test Roofing"
        });
        const data = await res.json();
        return !!data.token;
      }
    },
    {
      name: "All required DB tables exist",
      fn: async () => {
        const tables = [
          "roofing_jobs", "roofing_crew", "material_orders",
          "roofing_permits", "supplement_packages",
          "hail_events", "homeowner_sessions", "portal_activities"
        ];
        for (const table of tables) {
          const { error } = await supabase.from(table).select("id").limit(1);
          if (error) return false;
        }
        return true;
      }
    },
    {
      name: "Carrier intelligence seeded",
      fn: async () => {
        const { data } = await supabase
          .from("carrier_intelligence")
          .select("carrier_type")
          .eq("carrier_type", "state_farm")
          .single();
        return !!data;
      }
    }
  ];

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const start = Date.now();
    try {
      const result = await test.fn();
      const duration = Date.now() - start;

      await supabase.from("roofing_qa_results").insert({
        test_name: test.name,
        test_type: "smoke",
        passed: result,
        response_time_ms: duration
      });

      if (result) passed++;
      else failed++;

      results.push({ name: test.name, passed: result, ms: duration });
    } catch (err) {
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await supabase.from("roofing_qa_results").insert({
        test_name: test.name,
        test_type: "smoke",
        passed: false,
        error_message: errorMsg,
        response_time_ms: Date.now() - start
      });

      results.push({ name: test.name, passed: false, error: errorMsg });
    }
  }

  if (failed > 0) {
    const failedTests = results
      .filter(r => !r.passed)
      .map(r => `❌ ${r.name}${"error" in r ? ": " + r.error : ""}`)
      .join("\n");

    await sendTelegram(
      `🔬 *Roofing OS QA Report*\n` +
      `${passed}/${tests.length} tests passed\n\n` +
      `*Failures:*\n${failedTests}`
    );
  }

  return Response.json({ ok: true, passed, failed, total: tests.length, results });
});

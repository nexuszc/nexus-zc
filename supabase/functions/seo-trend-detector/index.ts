import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_KEY = Deno.env.get("SERPER_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SEARCH_QUERIES = [
  "roofing contractor software 2025",
  "roofing insurance claims process",
  "storm damage roofing leads",
  "roofing CRM reviews",
  "roofing business management app",
  "hail damage roof replacement",
  "roofing supplement claims tips",
  "roofing contractor marketing",
];

async function searchNews(query: string): Promise<string[]> {
  const r = await fetch("https://google.serper.dev/news", {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: 5, tbs: "qdr:w" }),
  });
  const d = await r.json();
  return (d.news || []).map((n: Record<string, string>) => n.title || "").filter(Boolean);
}

async function extractKeywords(headlines: string[], query: string): Promise<string[]> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Based on these roofing industry news headlines, suggest 3-5 specific blog post keywords that roofing contractors are searching for right now.

Headlines:
${headlines.join("\n")}

Context: We're ${query}

Return JSON only: {"keywords": ["keyword 1", "keyword 2", "keyword 3"]}
Keywords should be 3-6 words, specific, searchable phrases that roofing contractors type into Google.`,
      }],
    }),
  });
  const d = await r.json();
  try {
    const text = d.content?.[0]?.text || "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return parsed.keywords || [];
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "seo-trend-detector ready" }, { headers: CORS });
  }

  const allKeywords: string[] = [];
  const errors: string[] = [];

  for (const query of SEARCH_QUERIES) {
    try {
      const headlines = await searchNews(query);
      if (headlines.length === 0) continue;
      const keywords = await extractKeywords(headlines, query);
      allKeywords.push(...keywords);
    } catch (e) {
      errors.push(`${query}: ${(e as Error).message}`);
    }
  }

  let queued = 0;
  for (const keyword of allKeywords) {
    if (!keyword || keyword.length < 5) continue;
    try {
      const { error } = await supabase
        .from("seo_keyword_queue")
        .upsert({
          keyword,
          keyword_type: "trending",
          source: "trend-detector",
          priority: 80,
        }, { onConflict: "keyword" });
      if (!error) queued++;
    } catch { /* non-critical */ }
  }

  return Response.json({
    ok: true,
    queued,
    total_found: allKeywords.length,
    errors: errors.length ? errors : undefined,
  }, { headers: CORS });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const SERPER_KEY = Deno.env.get("SERPER_API_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUBREDDITS = [
  "Roofing",
  "RoofingContractors",
  "Insurance",
  "Entrepreneur",
  "smallbusiness",
  "HomeImprovement",
  "HomeOwners",
  "Construction",
];

const ROOFING_KEYWORDS = [
  "roofing software",
  "roof replacement",
  "insurance claim roof",
  "supplement roofing",
  "roofing CRM",
  "roofing contractor app",
  "storm damage roof",
  "roof estimate software",
  "jobnimbus alternative",
  "acculynx alternative",
  "roofing business management",
  "track roofing jobs",
  "homeowner roof portal",
];

async function searchReddit(subreddit: string, keyword: string): Promise<{
  title: string;
  url: string;
  snippet: string;
}[]> {
  try {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        q: `site:reddit.com/r/${subreddit} ${keyword}`,
        num: 5,
        tbs: "qdr:w",
      }),
    });
    const d = await r.json();
    return (d.organic || []).map((item: { title: string; link: string; snippet: string }) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet || "",
    }));
  } catch {
    return [];
  }
}

function scoreOpportunity(title: string, snippet: string): number {
  const text = `${title} ${snippet}`.toLowerCase();
  let score = 0;

  if (/recommend|suggestion|what.*(use|app|software|tool)/i.test(text)) score += 3;
  if (/alternative|switch|replacing|looking for/i.test(text)) score += 4;
  if (/jobnimbus|acculynx|companycam|jobber|hatch/i.test(text)) score += 5;
  if (/roofing software|roofing app|roofing crm|roofing tool/i.test(text)) score += 3;
  if (/insurance claim|supplement|adjuster/i.test(text)) score += 2;
  if (/frustrated|hate|terrible|bad experience|switched from/i.test(text)) score += 3;
  if (/homeowner portal|customer portal|client portal/i.test(text)) score += 2;
  if (/small business|startup|just started|new contractor/i.test(text)) score += 1;
  if (/roofing/i.test(text)) score += 1;

  return score;
}

async function draftReply(title: string, snippet: string, subreddit: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are Zach Curtis — Denver-based founder of Roofing OS, a software company that helps roofing contractors manage jobs, send homeowner portals, and track insurance claims.

You're writing a helpful Reddit comment in r/${subreddit}. Be genuine. Give real advice first. Only mention Roofing OS if it directly solves their problem — don't force it. Never say "I work for" or "disclaimer." Just be a helpful founder who knows roofing.

Thread title: "${title}"
Context: "${snippet}"

Write a 3-4 sentence reply. No formatting. No bullet points. Conversational Reddit tone. If you mention Roofing OS, keep it brief and natural (e.g., "what we built at Roofing OS").`,
      }],
    }),
  });
  const d = await r.json();
  return d.content?.[0]?.text || "";
}

async function getExistingUrls(): Promise<Set<string>> {
  const { data } = await supabase
    .from("social_opportunities")
    .select("thread_url");
  return new Set((data || []).map((r: { thread_url: string }) => r.thread_url));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const body = await req.json().catch(() => ({}));
  if (body.test) {
    return Response.json({ ok: true, message: "social-reddit-monitor ready" }, { headers: CORS });
  }

  const existingUrls = await getExistingUrls();
  let saved = 0;
  let drafted = 0;

  for (const subreddit of SUBREDDITS) {
    for (const keyword of ROOFING_KEYWORDS.slice(0, 5)) {
      const results = await searchReddit(subreddit, keyword);

      for (const result of results) {
        if (existingUrls.has(result.url)) continue;
        existingUrls.add(result.url);

        const score = scoreOpportunity(result.title, result.snippet);
        if (score < 3) continue;

        let draft_reply: string | null = null;
        if (score >= 5) {
          draft_reply = await draftReply(result.title, result.snippet, subreddit);
          drafted++;
        }

        try {
          await supabase.from("social_opportunities").insert({
            platform: "reddit",
            thread_url: result.url,
            thread_title: result.title,
            thread_body: result.snippet,
            subreddit,
            score,
            draft_reply,
            status: draft_reply ? "draft_ready" : "found",
          });
          saved++;
        } catch { /* skip duplicates */ }
      }

      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return Response.json({ ok: true, saved, drafted }, { headers: CORS });
});

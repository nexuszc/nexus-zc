import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "nexuszc/nexus-zc";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FUNCTION_PATHS: Record<string, string> = {
  chat: "supabase/functions/chat/index.ts",
  briefing: "supabase/functions/briefing/index.ts",
  reminders: "supabase/functions/reminders/index.ts",
  provision: "supabase/functions/provision/index.ts",
  "health-monitor": "supabase/functions/health-monitor/index.ts",
  "auto-fix": "supabase/functions/auto-fix/index.ts",
};

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = await req.json();
  const { improvement_id, telegram_chat_id } = body;

  if (!improvement_id || !telegram_chat_id) {
    return new Response(JSON.stringify({ error: "improvement_id and telegram_chat_id required" }), { status: 400 });
  }

  const { data: improvement } = await supabase
    .from("nexus_improvements")
    .select("*")
    .eq("id", improvement_id)
    .single();

  if (!improvement) {
    return new Response(JSON.stringify({ error: "Improvement not found" }), { status: 404 });
  }

  await supabase.from("nexus_improvements")
    .update({ auto_fix_attempted: true, auto_fix_at: new Date().toISOString(), status: "in_dev" })
    .eq("id", improvement_id);

  try {
    // Sync dev to main before writing the fix — prevents divergence conflicts
    await syncDevToMain();

    const filePath = FUNCTION_PATHS[improvement.affected_function] || FUNCTION_PATHS.chat;
    const currentCode = await readFileFromGitHub(filePath, "main");
    const { fixedCode, summary, filesChanged } = await generateFix(improvement, currentCode, filePath);

    await writeFileToBranch(filePath, fixedCode, `Auto-fix: ${improvement.title}`, "dev");

    const devSha = await getLatestCommitSha("dev");

    await supabase.from("nexus_improvements").update({
      auto_fix_code: fixedCode,
      fix_summary: summary,
      files_changed: filesChanged,
      dev_commit_sha: devSha,
    }).eq("id", improvement_id);

    const msg =
      `🔧 AUTO-FIX READY\n\n` +
      `Problem: ${improvement.title}\n` +
      `Root cause: ${improvement.problem}\n\n` +
      `Fix: ${summary}\n` +
      `Files changed: ${filesChanged.join(", ")}\n` +
      `Estimated impact: ${improvement.estimated_minutes} min of manual work saved\n\n` +
      `Reply:\n✅ "approve" → push to production\n❌ "reject" → discard this fix`;

    await sendTelegram(telegram_chat_id, msg);

    return new Response(JSON.stringify({ ok: true, summary }), { status: 200 });

  } catch (err: any) {
    console.error("Auto-fix error:", err);

    await supabase.from("nexus_improvements").update({
      auto_fix_error: err.message,
      status: "pending",
    }).eq("id", improvement_id);

    await sendTelegram(telegram_chat_id,
      `⚠️ Auto-fix attempted for "${improvement.title}" but encountered an error.\n\nError: ${err.message}\n\nThis has been logged and will be retried next cycle.`
    );

    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

async function generateFix(improvement: any, currentCode: string, filePath: string): Promise<{
  fixedCode: string;
  summary: string;
  filesChanged: string[];
}> {
  const prompt = `You are improving the Nexus AI system. You must write a complete, working fix for the following issue.

IMPROVEMENT TO IMPLEMENT:
Title: ${improvement.title}
Problem: ${improvement.problem}
Recommended fix: ${improvement.recommended_fix}
Affected function: ${improvement.affected_function}
File: ${filePath}

CURRENT CODE:
\`\`\`typescript
${currentCode.slice(0, 12000)}
\`\`\`

REQUIREMENTS:
1. Write the COMPLETE updated file — not just the changed section
2. The fix must be minimal and surgical — only change what's needed
3. Do not introduce new dependencies
4. Maintain all existing functionality
5. Add comments where you made changes: // AUTO-FIX: [what you changed]
6. The code must be production-ready TypeScript for Deno/Supabase Edge Functions

Return ONLY a JSON object with this exact structure:
{
  "fixedCode": "the complete updated file contents",
  "summary": "one sentence describing what was changed and why",
  "filesChanged": ["${filePath}"]
}

Return only the JSON. No explanation. No markdown code blocks around the JSON.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const text = data?.content?.[0]?.text || "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude did not return valid JSON");

  const result = JSON.parse(jsonMatch[0]);
  if (!result.fixedCode || result.fixedCode.length < 100) {
    throw new Error("Claude returned empty or invalid code");
  }

  return result;
}

async function syncDevToMain(): Promise<void> {
  const mainRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`,
    { headers: { "Authorization": `Bearer ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json" } }
  );
  const mainData = await mainRes.json();
  const mainSha = mainData.object?.sha;
  if (!mainSha) return;
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/dev`,
    {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: mainSha, force: true }),
    }
  );
}

async function readFileFromGitHub(path: string, branch = "main"): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${branch}`,
    {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
      },
    }
  );
  if (!res.ok) throw new Error(`Failed to read ${path} from GitHub: ${res.status}`);
  const data = await res.json();
  return atob(data.content.replace(/\n/g, ""));
}

async function writeFileToBranch(path: string, content: string, commitMessage: string, branch = "dev"): Promise<void> {
  const checkRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${branch}`,
    {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
      },
    }
  );

  let sha: string | undefined;
  if (checkRes.ok) {
    const existing = await checkRes.json();
    sha = existing.sha;
  }

  const encoded = btoa(unescape(encodeURIComponent(content)));
  const body: any = { message: commitMessage, content: encoded, branch };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub write failed: ${JSON.stringify(err)}`);
  }
}

async function getLatestCommitSha(branch = "dev"): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/${branch}`,
    {
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
      },
    }
  );
  const data = await res.json();
  return data.object?.sha || "";
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const truncated = text.length > 4000 ? text.slice(0, 3900) + "..." : text;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: truncated }),
  });
}

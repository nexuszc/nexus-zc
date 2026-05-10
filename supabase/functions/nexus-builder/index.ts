// NEXUS nexus-builder — self-skill creator
// Takes approved ability proposals, writes code, deploys to dev, notifies for production approval

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "nexuszc/nexus-zc";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getTelegramChatId(): Promise<string | null> {
  const { data } = await supabase
    .from("channel_conversations")
    .select("external_id")
    .eq("channel", "telegram")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.external_id || null;
}

async function claudeWrite(prompt: string, maxTokens = 3000): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content[0].text;
}

async function sendTelegram(text: string) {
  const chatId = await getTelegramChatId();
  if (!chatId) return;
  const truncated = text.length > 4000 ? text.slice(0, 3900) + "..." : text;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: truncated, parse_mode: "Markdown" }),
  });
}

async function auditLog(actionType: string, detail: string, data?: Record<string, unknown>) {
  await supabase.from("nexus_audit_log").insert({
    engine: "nexus-builder",
    action_type: actionType,
    action_detail: detail,
    risk_level: "medium",
    autonomous: false,
    approval_required: true,
    outcome: "success",
    data: data || null,
  });
}

async function getFileFromGitHub(path: string, branch = "main"): Promise<{ content: string; sha: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const data = await res.json();
  return {
    content: atob(data.content.replace(/\n/g, "")),
    sha: data.sha,
  };
}

async function commitToGitHub(
  path: string,
  content: string,
  message: string,
  branch = "dev"
): Promise<string> {
  let sha: string | undefined;
  try {
    const current = await getFileFromGitHub(path, branch);
    sha = current.sha;
  } catch { /* new file */ }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        branch,
        ...(sha ? { sha } : {}),
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`GitHub commit failed: ${JSON.stringify(data)}`);
  return data.commit?.sha || "";
}

// ── SYNC DEV TO MAIN ──────────────────────────────────────────────────────────

async function syncDevToMain(): Promise<void> {
  const mainRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  const mainData = await mainRes.json();
  const mainSha = mainData.object?.sha;
  if (!mainSha) return;
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/dev`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: mainSha, force: true }),
    }
  );
}

Deno.serve(async (req) => {
  const { proposal_id, action } = await req.json();

  if (!proposal_id) return Response.json({ error: "proposal_id required" }, { status: 400 });

  const { data: proposal } = await supabase
    .from("nexus_ability_proposals")
    .select("*")
    .eq("id", proposal_id)
    .single();

  if (!proposal) return Response.json({ error: "Proposal not found" }, { status: 404 });

  // ── BUILD ─────────────────────────────────────────────────────────────────────
  if (action === "build") {
    await supabase.from("nexus_ability_proposals")
      .update({ status: "building" }).eq("id", proposal_id);

    await auditLog("build_start", `Building: ${proposal.ability_name}`, { proposal_id });

    // Sync dev to main before writing
    try {
      await syncDevToMain();
    } catch (err) {
      console.error("syncDevToMain failed:", err);
    }

    let chatContent: string;
    try {
      const file = await getFileFromGitHub("supabase/functions/chat/index.ts");
      chatContent = file.content;
    } catch (err) {
      await sendTelegram(`❌ nexus-builder: Failed to read chat/index.ts — ${String(err)}`);
      await supabase.from("nexus_ability_proposals").update({ status: "proposed" }).eq("id", proposal_id);
      return Response.json({ error: "Could not read chat file" }, { status: 500 });
    }

    const triggerBase = proposal.trigger_command.replace(": [", ": ").split("[")[0];

    const buildPrompt = `You are nexus-builder, an AI that adds new abilities to the Nexus chat function.

ABILITY TO BUILD:
Name: ${proposal.ability_name}
Trigger: ${proposal.trigger_command}
Description: ${proposal.description}
Value: ${proposal.value_reasoning}
Implementation plan: ${proposal.implementation_plan}

CURRENT CHAT FUNCTION (last 4000 chars):
${chatContent.slice(-4000)}

RULES (CRITICAL):
1. Write ONLY the new handler block — nothing else
2. Format: if (msgLower.startsWith('${triggerBase.toLowerCase()}')) { ... }
3. Must include: await logUsage('${proposal.ability_name.toLowerCase().replace(/ /g, "_")}', true/false, responseMs, channel)
4. Must call earlyReturn(reply) or build a reply string and use earlyReturn
5. Keep it clean and minimal — no overengineering
6. If it needs external API calls, use fetch() directly with env vars already defined at top of file
7. Handler must be self-contained — no new imports needed
8. Add a comment at the top: // ── ${proposal.ability_name.toUpperCase()} ──

OUTPUT FORMAT (ABSOLUTE RULES — violation will cause a deploy failure):
- Raw TypeScript ONLY
- Do NOT wrap output in backticks or code fences (\`\`\`typescript, \`\`\`javascript, \`\`\`, or any variant)
- Do NOT include any explanation, prose, or markdown before or after the code
- The very first character of your response must be a space or the start of the if statement
- The very last character must be the closing } of the handler`;

    const rawHandler = await claudeWrite(buildPrompt, 2000);

    // Strip any markdown fencing the model may have added despite instructions
    const handlerCode = rawHandler
      .replace(/^```[a-zA-Z]*\n?/m, "")
      .replace(/\n?```\s*$/m, "")
      .trim();

    // Safety check
    if (!handlerCode.includes("logUsage") || !handlerCode.includes("earlyReturn")) {
      await sendTelegram(
        `⚠️ nexus-builder: Generated handler for *${proposal.ability_name}* failed safety check.\n` +
        `Missing logUsage or earlyReturn. Marking for manual review.`
      );
      await supabase.from("nexus_ability_proposals").update({ status: "proposed" }).eq("id", proposal_id);
      return Response.json({ error: "Handler failed safety check" }, { status: 400 });
    }

    // Inject handler — find insertion point
    const insertionMarker = "// ── END OF COMMAND HANDLERS ──";
    const fallbackMarker = "// Default: treat as memory entry";

    let newChatContent: string;
    if (chatContent.includes(insertionMarker)) {
      newChatContent = chatContent.replace(insertionMarker, `${handlerCode}\n\n${insertionMarker}`);
    } else if (chatContent.includes(fallbackMarker)) {
      newChatContent = chatContent.replace(fallbackMarker, `${handlerCode}\n\n${fallbackMarker}`);
    } else {
      // Find last handler block and inject after it
      const lastHandlerIdx = chatContent.lastIndexOf("if (msgLower");
      if (lastHandlerIdx > -1) {
        // Find end of that if block
        let depth = 0;
        let i = lastHandlerIdx;
        while (i < chatContent.length) {
          if (chatContent[i] === "{") depth++;
          if (chatContent[i] === "}") { depth--; if (depth === 0) break; }
          i++;
        }
        newChatContent = chatContent.slice(0, i + 1) + "\n\n" + handlerCode + "\n" + chatContent.slice(i + 1);
      } else {
        newChatContent = chatContent + `\n\n${handlerCode}`;
      }
    }

    // File size guard (90% — builder adds code so 80% isn't appropriate here)
    if (newChatContent.length < chatContent.length * 0.9) {
      await sendTelegram(
        `⚠️ nexus-builder: ABORTED building *${proposal.ability_name}*.\n` +
        `File size dropped from ${chatContent.length} to ${newChatContent.length} chars. Possible corruption.`
      );
      await supabase.from("nexus_ability_proposals").update({ status: "proposed" }).eq("id", proposal_id);
      return Response.json({ error: "File size guard triggered" }, { status: 400 });
    }

    let commitSha: string;
    try {
      commitSha = await commitToGitHub(
        "supabase/functions/chat/index.ts",
        newChatContent,
        `nexus-builder: Add ${proposal.ability_name} ability (auto-built)`,
        "dev"
      );
    } catch (err) {
      await sendTelegram(`❌ nexus-builder: Failed to commit *${proposal.ability_name}* — ${String(err)}`);
      await supabase.from("nexus_ability_proposals").update({ status: "proposed" }).eq("id", proposal_id);
      return Response.json({ error: "Commit failed" }, { status: 500 });
    }

    await supabase.from("nexus_ability_proposals").update({
      status: "testing",
      built_at: new Date().toISOString(),
      dev_commit_sha: commitSha,
    }).eq("id", proposal_id);

    await auditLog("build_complete", `Built: ${proposal.ability_name}`, {
      proposal_id,
      commit_sha: commitSha,
    });

    await sendTelegram(
      `🔨 *nexus-builder: Ability ready for testing*\n\n` +
      `*${proposal.ability_name}*\n` +
      `Trigger: \`${proposal.trigger_command}\`\n` +
      `Commit: \`${commitSha.slice(0, 8)}\` (dev branch)\n\n` +
      `Test it, then:\n` +
      `• \`approve ability ${proposal_id.slice(0, 8)}\` → deploy to production\n` +
      `• \`reject ability ${proposal_id.slice(0, 8)}\` → discard`
    );

    return Response.json({ ok: true, commit_sha: commitSha, status: "testing" });
  }

  // ── DEPLOY (stages to dev — Zach's approve command does the main merge) ─────
  if (action === "deploy") {
    if (proposal.status !== "testing") {
      return Response.json({ error: "Proposal must be in testing status" }, { status: 400 });
    }

    const { content: devContent } = await getFileFromGitHub(
      "supabase/functions/chat/index.ts",
      "dev"
    );

    // Guard: abort if file looks corrupted
    const lineCount = devContent.split("\n").length;
    if (lineCount < 2000) {
      await sendTelegram(
        `🚨 *Deploy aborted — file too small, possible corruption*\n\n` +
        `Ability: *${proposal.ability_name}*\n` +
        `Dev branch chat/index.ts has only ${lineCount} lines (expected 2000+).\n` +
        `Manual review required before any deploy.`
      );
      await supabase.from("nexus_ability_proposals")
        .update({ status: "testing" }).eq("id", proposal_id);
      return Response.json({ error: "Deploy aborted — file too small, possible corruption" }, { status: 400 });
    }

    const devCommitSha = await commitToGitHub(
      "supabase/functions/chat/index.ts",
      devContent,
      `Stage ${proposal.ability_name} ability (ready for approve)`,
      "dev"
    );

    await supabase.from("nexus_ability_proposals").update({
      status: "testing",
      dev_commit_sha: devCommitSha,
    }).eq("id", proposal_id);

    await auditLog("deploy_staged", `Staged to dev: ${proposal.ability_name}`, {
      proposal_id,
      commit_sha: devCommitSha,
    });

    await sendTelegram(
      `🔬 *${proposal.ability_name}* staged to dev — ready for production\n\n` +
      `Trigger: \`${proposal.trigger_command}\`\n` +
      `Commit: \`${devCommitSha.slice(0, 8)}\` (dev)\n\n` +
      `Reply \`approve\` to merge to main, or \`reject\` to discard.`
    );

    return Response.json({ ok: true, commit_sha: devCommitSha, status: "testing" });
  }

  return Response.json({ error: "Unknown action. Use 'build' or 'deploy'." }, { status: 400 });
});

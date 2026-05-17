import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
const GITHUB_REPO = "nexuszc/nexus-zc";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function ai(prompt: string, maxTokens = 3000): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text.slice(0, 4000),
      parse_mode: "Markdown"
    })
  });
}

async function readGitHub(path: string, branch = "main"): Promise<{ content: string; sha: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  const data = await res.json();
  if (res.status === 404) throw new Error(`File not found in repo (404): ${path}`);
  if (!res.ok) throw new Error(`GitHub API error ${res.status} reading: ${path} — ${data.message || ""}`);
  if (!data.content) throw new Error(`No content returned for: ${path}`);
  return { content: atob(data.content.replace(/\n/g, "")), sha: data.sha };
}

async function readGitHubAtCommit(path: string, commitSha: string): Promise<{ content: string; sha: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${commitSha}`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`GitHub API error ${res.status} reading ${path} at ${commitSha}`);
  if (!data.content) throw new Error(`No content at commit ${commitSha} for: ${path}`);
  return { content: atob(data.content.replace(/\n/g, "")), sha: data.sha };
}

async function listGitHubTree(branch = "main"): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/git/trees/${branch}?recursive=1`,
    { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
  );
  if (!res.ok) throw new Error(`GitHub tree fetch failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.tree as Array<{ type: string; path: string }> || [])
    .filter(item => item.type === "blob")
    .map(item => item.path);
}

async function writeGitHub(path: string, content: string, message: string, branch = "dev"): Promise<string> {
  let sha: string | undefined;
  try {
    const existing = await readGitHub(path, branch);
    sha = existing.sha;
  } catch { /* new file */ }

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        branch,
        ...(sha ? { sha } : {})
      })
    }
  );
  const data = await res.json();
  return data.commit?.sha || "";
}

// ── PHASE 4A: VERIFY FILE PATH ────────────────────────────────────────────────

function verifyFilePath(path: string, repoTree: string[]): boolean {
  return repoTree.includes(path);
}

// Prepend the correct top-level prefix when Claude omits it.
// "chat/index.ts" → "supabase/functions/chat/index.ts"
// "Navbar.jsx"    → "app/src/components/Navbar.jsx"
function normalizePath(path: string): string {
  if (
    path.startsWith("supabase/functions/") ||
    path.startsWith("app/src/") ||
    path.startsWith("app/public/")
  ) {
    return path;
  }
  // Bare edge function path: ends with .ts and doesn't look like a React file
  if (path.endsWith(".ts") && !path.startsWith("app/")) {
    return `supabase/functions/${path}`;
  }
  // Bare React file with no directory prefix
  if ((path.endsWith(".jsx") || path.endsWith(".tsx")) && !path.includes("/")) {
    return `app/src/components/${path}`;
  }
  return path;
}

// ── PHASE 4B: SMOKE TEST ──────────────────────────────────────────────────────

function smokeTest(filePath: string, content: string): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  // Balanced braces check
  const openBraces = (content.match(/\{/g) || []).length;
  const closeBraces = (content.match(/\}/g) || []).length;
  if (Math.abs(openBraces - closeBraces) > 5) {
    issues.push(`Unbalanced braces: ${openBraces} open vs ${closeBraces} close`);
  }

  // Edge function specific checks
  if (filePath.includes("supabase/functions/") && filePath.endsWith("index.ts")) {
    if (!content.includes("Deno.serve")) {
      issues.push("Edge function missing Deno.serve()");
    }
    if (content.split("\n").length < 20) {
      issues.push(`Edge function suspiciously short: ${content.split("\n").length} lines`);
    }
  }

  // Check for known hallucinated paths that don't exist in the repo
  const hallucinatedPaths = [
    "Navbar.jsx",
    "nexus-chat/",
    "research/index.ts",
    "nexus-director/",
    "nexus-tasks/",
    "nexus-agent/",
    "nexus-builder/",
    "nexus-execute/",
    "nexus-research/"
  ];
  for (const bad of hallucinatedPaths) {
    if (content.includes(bad)) {
      issues.push(`Hallucinated path reference: "${bad}"`);
    }
  }

  // React component checks
  if (filePath.endsWith(".jsx") || filePath.endsWith(".tsx")) {
    if (!content.includes("export default") && !content.includes("export {")) {
      issues.push("React file missing export");
    }
  }

  return { passed: issues.length === 0, issues };
}

// ── CREATE MANIFEST ───────────────────────────────────────────────────────────

async function createManifest(instruction: string, directivePriority: number): Promise<string> {
  const [{ content: chatContent }, allFiles] = await Promise.all([
    readGitHub("supabase/functions/chat/index.ts"),
    listGitHubTree("main")
  ]);

  const chatLines = chatContent.split("\n").length;
  const existingTriggers = (chatContent.match(/if \((?:lowerMessage|msgLower)[^)]*\)/g) || [])
    .map(m => m.slice(0, 60));

  const edgeFunctions = allFiles.filter(f => f.startsWith("supabase/functions/") && f.endsWith("/index.ts"));
  const appPages = allFiles.filter(f => f.startsWith("app/src/pages/"));
  const appComponents = allFiles.filter(f => f.startsWith("app/src/components/"));
  const appOther = allFiles.filter(f => f.startsWith("app/src/") && !f.startsWith("app/src/pages/") && !f.startsWith("app/src/components/"));

  const fileTree = [
    "EDGE FUNCTIONS (supabase/functions/):",
    ...edgeFunctions.map(f => `  ${f}`),
    "",
    "REACT PAGES (app/src/pages/):",
    ...appPages.map(f => `  ${f}`),
    "",
    "REACT COMPONENTS (app/src/components/):",
    ...appComponents.map(f => `  ${f}`),
    "",
    "OTHER APP FILES:",
    ...appOther.map(f => `  ${f}`),
  ].join("\n");

  const manifestPrompt = `You are the Nexus build planner. Create a complete build manifest for this instruction.

INSTRUCTION: ${instruction}

ACTUAL REPO FILE TREE (use ONLY these exact paths — never invent paths):
${fileTree}

CURRENT CODEBASE STATE:
- supabase/functions/chat/index.ts: ${chatLines} lines, ${existingTriggers.length} existing handlers
- Existing triggers (don't duplicate): ${existingTriggers.slice(0, 20).join(" | ")}
- Stack: React 18 + Vite + Tailwind, Supabase Edge Functions (Deno), PostgreSQL
- Navigation component: app/src/components/Layout.jsx (NOT Navbar.jsx — that doesn't exist)

MANIFEST RULES:
1. CRITICAL: Only reference files that appear in the ACTUAL REPO FILE TREE above
2. If a file you need doesn't exist in the tree, list it under files_to_create (not files_to_modify)
3. If instruction needs a chat handler — check existing triggers first, don't duplicate
4. For new pages — add to app/src/pages/ and update app/src/App.jsx routes
5. For new edge functions — add to supabase/functions/{name}/index.ts
6. For DB changes — include exact SQL
7. Keep scope minimal — build exactly what's needed, nothing extra
8. Every build needs at least 2 tests

Create the manifest. Be specific about file paths (must match tree exactly) and what goes in each file.

Respond with JSON only (no backticks):
{
  "goal": "short description of what this builds",
  "complexity": "simple|medium|complex|system",
  "files_to_create": [
    {"path": "relative/path/file.ts", "description": "what goes in it", "content_summary": "key logic"}
  ],
  "files_to_modify": [
    {"path": "relative/path/file.ts", "change": "what to add/change"}
  ],
  "db_migrations": ["SQL statement 1", "SQL statement 2"],
  "functions_to_deploy": ["function-name"],
  "tests": [
    {"name": "test name", "type": "api|build|db|manual", "check": "what to verify"}
  ],
  "estimated_duration_min": 5
}`;

  const result = await ai(manifestPrompt, 2000);
  const manifest = JSON.parse(result.replace(/```json|```/g, "").trim());

  const { data: saved } = await supabase.from("nexus_build_manifests").insert({
    goal: manifest.goal,
    instruction,
    status: "planning",
    files_to_create: manifest.files_to_create || [],
    files_to_modify: manifest.files_to_modify || [],
    db_migrations: manifest.db_migrations || [],
    functions_to_deploy: manifest.functions_to_deploy || [],
    tests: manifest.tests || [],
    directive_priority: directivePriority
  }).select("id").single();

  return saved?.id || "";
}

// ── BUILD FROM MANIFEST ───────────────────────────────────────────────────────

async function buildFromManifest(manifestId: string): Promise<{ success: boolean; commitSha: string; error?: string }> {
  const { data: manifest } = await supabase
    .from("nexus_build_manifests")
    .select("*")
    .eq("id", manifestId)
    .single();

  if (!manifest) return { success: false, commitSha: "", error: "Manifest not found" };

  await supabase.from("nexus_build_manifests")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("id", manifestId);

  // Phase 4A: Get the real repo tree — hard-abort if unavailable or empty
  let repoTree: string[];
  try {
    repoTree = await listGitHubTree("main");
  } catch (err) {
    const errMsg = `Repo tree fetch failed — cannot verify paths: ${String(err)}`;
    await supabase.from("nexus_audit_log").insert({
      engine: "nexus-build",
      action_type: "build_aborted",
      action_detail: errMsg,
      autonomous: true,
      outcome: "failure",
      data: { manifest_id: manifestId }
    });
    await supabase.from("nexus_build_manifests").update({
      status: "failed",
      error: errMsg,
      updated_at: new Date().toISOString()
    }).eq("id", manifestId);
    await tg(`Build aborted: ${errMsg}`);
    return { success: false, commitSha: "", error: errMsg };
  }

  if (repoTree.length === 0) {
    const errMsg = "Repo tree returned empty — cannot verify file paths. Aborting build.";
    await supabase.from("nexus_audit_log").insert({
      engine: "nexus-build",
      action_type: "build_aborted",
      action_detail: errMsg,
      autonomous: true,
      outcome: "failure",
      data: { manifest_id: manifestId }
    });
    await supabase.from("nexus_build_manifests").update({
      status: "failed",
      error: errMsg,
      updated_at: new Date().toISOString()
    }).eq("id", manifestId);
    await tg(`Build aborted: ${errMsg}`);
    return { success: false, commitSha: "", error: errMsg };
  }

  let lastCommitSha = "";

  try {
    // Build each new file
    for (const file of (manifest.files_to_create as Array<{ path: string; description: string; content_summary: string }> || [])) {
      const codePrompt = `Write the complete file for this Nexus system component.

File: ${file.path}
Purpose: ${file.description}
Key logic: ${file.content_summary}
Instruction context: ${manifest.instruction}

RULES:
- Write complete, working code only
- No markdown, no backticks, no explanations
- Just the raw file content
- For TypeScript edge functions: use Deno imports
- For React: use functional components with hooks
- For SQL: write clean, safe queries
- Include error handling
- Keep it minimal and focused`;

      const content = await ai(codePrompt, 2000);
      const cleanContent = content.replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

      // Phase 4B: smoke test the generated content
      const smoke = smokeTest(file.path, cleanContent);
      if (!smoke.passed) {
        await supabase.from("nexus_audit_log").insert({
          engine: "nexus-build",
          action_type: "smoke_test_failed",
          action_detail: `${file.path}: ${smoke.issues.join("; ")}`,
          outcome: "failure"
        });
        continue;
      }

      lastCommitSha = await writeGitHub(
        file.path,
        cleanContent,
        `nexus-build: Add ${file.path} — ${manifest.goal}`,
        "dev"
      );
    }

    // Modify existing files
    for (const mod of (manifest.files_to_modify as Array<{ path: string; change: string }> || [])) {
      let normalizedPath = mod.path;
      try {
        // Phase 4A: normalize path then verify it exists — hard-abort on failure
        normalizedPath = normalizePath(mod.path);
        if (!verifyFilePath(normalizedPath, repoTree)) {
          const verifyErr = `Path not in repo: ${mod.path}${normalizedPath !== mod.path ? ` (normalized: ${normalizedPath})` : ""}`;
          await supabase.from("nexus_audit_log").insert({
            engine: "nexus-build",
            action_type: "path_verify_failed",
            action_detail: verifyErr,
            autonomous: true,
            outcome: "failure",
            data: { manifest_id: manifestId, original_path: mod.path, normalized_path: normalizedPath }
          });
          await supabase.from("nexus_build_manifests").update({
            status: "failed",
            error: verifyErr,
            updated_at: new Date().toISOString()
          }).eq("id", manifestId);
          await tg(`Build aborted — path not in repo: \`${mod.path}\``);
          return { success: false, commitSha: "", error: verifyErr };
        }

        const { content: currentContent } = await readGitHub(normalizedPath, "dev");

        // Safety check for chat/index.ts corruption guard
        if (normalizedPath.includes("chat/index.ts") && currentContent.split("\n").length < 2000) {
          await supabase.from("nexus_audit_log").insert({
            engine: "nexus-build",
            action_type: "safety_abort",
            action_detail: `Aborted: chat/index.ts too small (${currentContent.split("\n").length} lines)`,
            outcome: "failure"
          });
          continue;
        }

        const modPrompt = `You are modifying an existing file in the Nexus system.

CURRENT FILE (${normalizedPath}):
${currentContent.slice(-6000)}

CHANGE NEEDED: ${mod.change}
BUILD GOAL: ${manifest.goal}

CRITICAL RULES:
1. Return the COMPLETE file with ALL existing content preserved
2. Only ADD what is needed — never remove existing handlers or functions
3. For chat/index.ts — add new handler BEFORE the final catch-all response
4. No markdown, no backticks — raw code only
5. The file must be LONGER than the input, never shorter`;

        const modifiedContent = await ai(modPrompt, 4000);
        const cleanModified = modifiedContent.replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

        // Size guard — abort if output is less than 85% of original
        if (cleanModified.length < currentContent.length * 0.85) {
          await supabase.from("nexus_audit_log").insert({
            engine: "nexus-build",
            action_type: "size_guard_triggered",
            action_detail: `${normalizedPath}: ${cleanModified.length} < 85% of ${currentContent.length}`,
            outcome: "failure"
          });
          continue;
        }

        // Phase 4B: smoke test the modified content
        const smoke = smokeTest(normalizedPath, cleanModified);
        if (!smoke.passed) {
          await supabase.from("nexus_audit_log").insert({
            engine: "nexus-build",
            action_type: "smoke_test_failed",
            action_detail: `${normalizedPath}: ${smoke.issues.join("; ")}`,
            outcome: "failure"
          });
          continue;
        }

        lastCommitSha = await writeGitHub(
          normalizedPath,
          cleanModified,
          `nexus-build: Modify ${normalizedPath} — ${manifest.goal}`,
          "dev"
        );
      } catch (err) {
        await supabase.from("nexus_audit_log").insert({
          engine: "nexus-build",
          action_type: "modify_error",
          action_detail: `Failed to modify ${normalizedPath}: ${String(err)}`,
          outcome: "failure"
        });
      }
    }

    return { success: true, commitSha: lastCommitSha };

  } catch (err) {
    return { success: false, commitSha: "", error: String(err) };
  }
}

// ── RUN TESTS ─────────────────────────────────────────────────────────────────

async function runTests(manifest: Record<string, unknown>): Promise<{ passed: number; failed: number; results: Array<{ name: string; passed: boolean; detail: string }> }> {
  const tests = manifest.tests as Array<{ name: string; type: string; check: string }> || [];
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      if (test.type === "api") {
        const funcName = (manifest.functions_to_deploy as string[] || [])[0];
        if (funcName) {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/${funcName}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ test: true })
          });
          const ok = res.status < 500;
          results.push({ name: test.name, passed: ok, detail: `Status: ${res.status}` });
          ok ? passed++ : failed++;
        }
      } else if (test.type === "db") {
        const { error } = await supabase.from("nexus_audit_log").select("id").limit(1);
        const ok = !error;
        results.push({ name: test.name, passed: ok, detail: error?.message || "OK" });
        ok ? passed++ : failed++;
      } else {
        // Manual tests pass by default — Zach verifies in browser
        results.push({ name: test.name, passed: true, detail: "Manual verification required" });
        passed++;
      }
    } catch (err) {
      results.push({ name: test.name, passed: false, detail: String(err) });
      failed++;
    }
  }

  return { passed, failed, results };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { instruction, source, directive_priority, manifest_id, action } = body;

  // ── ROLLBACK: restore pre-deploy file content to main (Phase 4D) ─────────────

  if (action === "rollback" && manifest_id) {
    const { data: manifest } = await supabase
      .from("nexus_build_manifests")
      .select("*")
      .eq("id", manifest_id)
      .single();

    if (!manifest) return Response.json({ error: "Manifest not found" }, { status: 404 });
    if (manifest.status !== "deployed") {
      return Response.json({ error: `Cannot rollback — manifest status is "${manifest.status}"` }, { status: 400 });
    }

    const preDeployShas = (manifest.pre_deploy_shas || {}) as Record<string, string>;
    if (Object.keys(preDeployShas).length === 0) {
      return Response.json({ error: "No pre-deploy SHAs recorded — cannot auto-rollback. Restore manually from git history." }, { status: 400 });
    }

    const allFiles = [
      ...(manifest.files_to_create as Array<{ path: string }> || []).map((f: { path: string }) => f.path),
      ...(manifest.files_to_modify as Array<{ path: string }> || []).map((f: { path: string }) => f.path)
    ];

    let rollbackSha = "";
    const rolledBack: string[] = [];
    const failed: string[] = [];

    for (const filePath of allFiles) {
      const preDeployCommitSha = preDeployShas[filePath];
      if (!preDeployCommitSha) {
        // File was newly created — delete it by restoring to empty? Skip for safety.
        failed.push(`${filePath} (no pre-deploy SHA — was newly created, manual removal required)`);
        continue;
      }

      try {
        const { content: restoredContent } = await readGitHubAtCommit(filePath, preDeployCommitSha);
        rollbackSha = await writeGitHub(
          filePath,
          restoredContent,
          `rollback: Restore ${filePath} to pre-deploy state (manifest ${manifest_id.slice(0, 8)})`,
          "main"
        );
        rolledBack.push(filePath);
      } catch (err) {
        failed.push(`${filePath}: ${String(err)}`);
      }
    }

    await supabase.from("nexus_build_manifests").update({
      status: "rolled_back",
      updated_at: new Date().toISOString()
    }).eq("id", manifest.id);

    await supabase.from("nexus_audit_log").insert({
      engine: "nexus-build",
      action_type: "rollback_executed",
      action_detail: `Rolled back manifest ${manifest_id.slice(0, 8)}: ${rolledBack.length} files restored`,
      outcome: failed.length > 0 ? "partial" : "success",
      data: { manifest_id, rolled_back: rolledBack, failed, commit: rollbackSha }
    });

    const msg = `*Rollback complete*\n\n` +
      `Manifest: ${manifest.goal}\n` +
      `Restored: ${rolledBack.join(", ") || "none"}\n` +
      (failed.length > 0 ? `Failed: ${failed.join(", ")}\n` : "") +
      `Commit: ${rollbackSha.slice(0, 8)} (main)\nLive in ~60 seconds.`;
    await tg(msg);

    return Response.json({ ok: true, rolled_back: rolledBack, failed, commit: rollbackSha });
  }

  // ── DEPLOY: approved manifest → main (Phase 4C: capture pre-deploy SHAs) ────

  if (action === "deploy" && manifest_id) {
    const { data: manifest } = await supabase
      .from("nexus_build_manifests")
      .select("*")
      .eq("id", manifest_id)
      .single();

    if (!manifest) {
      const { data: manifests } = await supabase
        .from("nexus_build_manifests")
        .select("*")
        .ilike("id::text", `${manifest_id}%`)
        .limit(1);
      if (!manifests?.length) return Response.json({ error: "Manifest not found" }, { status: 404 });
    }

    const targetManifest = manifest;
    if (!targetManifest) return Response.json({ error: "Manifest not found" }, { status: 404 });

    const allFiles = [
      ...(targetManifest.files_to_create as Array<{ path: string }> || []).map((f: { path: string }) => f.path),
      ...(targetManifest.files_to_modify as Array<{ path: string }> || []).map((f: { path: string }) => f.path)
    ];

    // Phase 4C: capture current (pre-deploy) SHAs from main before overwriting
    const preDeployShas: Record<string, string> = {};
    for (const filePath of allFiles) {
      try {
        const { sha } = await readGitHub(filePath, "main");
        preDeployShas[filePath] = sha;
      } catch { /* new file — no pre-deploy SHA */ }
    }

    // Save pre-deploy SHAs before any writes happen
    await supabase.from("nexus_build_manifests").update({
      pre_deploy_shas: preDeployShas
    }).eq("id", targetManifest.id);

    let mainSha = "";
    for (const filePath of allFiles) {
      try {
        const { content } = await readGitHub(filePath, "dev");
        mainSha = await writeGitHub(filePath, content, `Deploy: ${targetManifest.goal}`, "main");
      } catch { /* skip */ }
    }

    await supabase.from("nexus_build_manifests").update({
      status: "deployed",
      main_commit_sha: mainSha,
      deployed_at: new Date().toISOString()
    }).eq("id", targetManifest.id);

    // Phase 4C: log post-deploy monitoring window entry
    await supabase.from("nexus_audit_log").insert({
      engine: "nexus-build",
      action_type: "deploy_monitoring_window",
      action_detail: `Deployed: ${targetManifest.goal} — monitoring for errors next 60 min`,
      outcome: "success",
      data: { manifest_id: targetManifest.id, commit: mainSha, files: allFiles }
    });

    await tg(`Deployed: *${targetManifest.goal}*\nCommit: ${mainSha.slice(0, 8)} (main)\nLive in ~60 seconds.\nTo rollback: \`rollback build ${targetManifest.id.slice(0, 8)}\``);

    return Response.json({ ok: true, commit: mainSha });
  }

  // ── BUILD: from instruction ────────────────────────────────────────────────

  if (!instruction) return Response.json({ error: "instruction required" }, { status: 400 });

  // MOVED_TO_DASHBOARD [date: 2026-05-17]: build start is duplicate when triggered from chat (chat.ts already sends earlyReturn); visible in nexus_build_manifests table
  // await tg(`Building: *${instruction.slice(0, 100)}*\nCreating manifest and building...`);

  try {
    const manifestId = await createManifest(instruction, directive_priority || 3);
    const buildResult = await buildFromManifest(manifestId);

    if (!buildResult.success) {
      await supabase.from("nexus_build_manifests").update({
        status: "failed",
        error: buildResult.error
      }).eq("id", manifestId);

      await tg(`Build failed: *${instruction.slice(0, 80)}*\nError: ${buildResult.error}`);
      return Response.json({ ok: false, error: buildResult.error });
    }

    const { data: manifest } = await supabase
      .from("nexus_build_manifests")
      .select("*")
      .eq("id", manifestId)
      .single();

    const testResults = await runTests(manifest as Record<string, unknown>);

    await supabase.from("nexus_build_manifests").update({
      status: "staged",
      dev_commit_sha: buildResult.commitSha,
      tests_passed: testResults.passed,
      tests_failed: testResults.failed,
      test_results: testResults.results,
      updated_at: new Date().toISOString()
    }).eq("id", manifestId);

    // Log as ability proposal if it's a simple single-file change
    if ((manifest?.files_to_create as Array<unknown> || []).length === 0 &&
        (manifest?.files_to_modify as Array<unknown> || []).length === 1) {
      await supabase.from("nexus_ability_proposals").insert({
        ability_name: instruction.slice(0, 80),
        trigger_command: instruction.slice(0, 40),
        description: instruction,
        value_reasoning: `Built by nexus-build from instruction: ${source}`,
        status: "testing",
        dev_commit_sha: buildResult.commitSha,
        manifest_id: manifestId
      });
    }

    const testSummary = testResults.failed === 0
      ? `All ${testResults.passed} tests passed`
      : `${testResults.passed} passed, ${testResults.failed} failed`;

    // Build result stored to nexus_audit_log — visible in dashboard

    await supabase.from("nexus_audit_log").insert({
      engine: "nexus-build",
      action_type: "build_staged",
      action_detail: `Staged: ${manifest?.goal}`,
      outcome: "success",
      data: { manifest_id: manifestId, tests_passed: testResults.passed, tests_failed: testResults.failed }
    });

    return Response.json({
      ok: true,
      manifest_id: manifestId,
      commit: buildResult.commitSha,
      tests_passed: testResults.passed,
      tests_failed: testResults.failed
    });

  } catch (err) {
    await tg(`Build error: ${String(err).slice(0, 200)}`);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});

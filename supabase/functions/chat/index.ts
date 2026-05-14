import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

async function sendTelegramWithRetry(token: string, chatId: number, text: string, maxRetries = 3): Promise<boolean> {
  const truncated = text.length > 4000 ? text.slice(0, 3900) + "..." : text;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: truncated }),
      });
      if (res.ok) return true;
      const err = await res.json();
      if (res.status < 500) { console.error("Telegram client error (not retrying):", err); return false; }
      throw new Error(`Telegram API ${res.status}`);
    } catch (err: any) {
      console.error(`Telegram attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }
  return false;
}

async function callAnthropicWithRetry(body: any, maxRetries = 3): Promise<any> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${errText}`);
      }
      return await res.json();
    } catch (err: any) {
      lastError = err;
      console.error(`Claude API attempt ${attempt}/${maxRetries} failed:`, err.message);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, Math.pow(2, attempt - 1) * 1000));
    }
  }
  throw lastError || new Error("Claude API failed after all retries");
}

async function logUsage(supabase: any, ability: string, success: boolean, responseMs: number, channel: string) {
  try {
    await supabase.from("nexus_usage").insert({ ability, success, response_ms: responseMs, channel });
  } catch (err) {
    console.error("Usage log error:", err);
  }
}

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { message, channel = "web", external_id = null, source = null, voice_file_id = null, duration_seconds = null } = body;
    if (!message) return new Response(JSON.stringify({ error: "message required" }), { status: 400 });

    const msgLower = message.toLowerCase().trim();
    const tgChatId = channel === "telegram" && external_id ? Number(external_id) : null;

    const earlyReturn = async (reply: string) => {
      const LIMIT = 4000;
      const tgMessage = reply.length > LIMIT
        ? reply.slice(0, LIMIT) + "... (truncated  -  full version saved to Nexus memory)"
        : reply;
      if (tgChatId && TELEGRAM_BOT_TOKEN) await sendTelegramWithRetry(TELEGRAM_BOT_TOKEN, tgChatId, tgMessage);
      return new Response(JSON.stringify({ reply }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    // ================================================================
    // CLIENT COMMAND SHORTCUTS
    // ================================================================

    if (msgLower.startsWith("new client:") || msgLower.startsWith("add client:")) {
      const start = Date.now();
      const clientName = message.split(":").slice(1).join(":").trim();
      try {
        const { data: newClient, error } = await supabase
          .from("clients").insert({ name: clientName, status: "active" }).select().single();
        if (error) {
          await logUsage(supabase, "new client", false, Date.now() - start, channel);
          return earlyReturn(` -  Failed to create client: ${error.message}`);
        }
        await logUsage(supabase, "new client", true, Date.now() - start, channel);
        return earlyReturn(` -  Client brain created for ${clientName} (ID: ${newClient.id})\n\nSet up their context:\n -  "client context: ${clientName} | deal: rev_share | offer: [their offer] | goals: [their goals]"\n -  "assign va: ${clientName} | va: [VA name]"`);
      } catch (err: any) {
        await logUsage(supabase, "new client", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed to create client: ${err.message}`);
      }
    }

    if (msgLower.startsWith("client context:")) {
      const start = Date.now();
      const parts = message.slice(15).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const contextFields: any = {};
      const clientFields: any = {};
      for (const part of parts.slice(1)) {
        const colonIdx = part.indexOf(":");
        if (colonIdx === -1) continue;
        const k = part.slice(0, colonIdx).trim().toLowerCase();
        const v = part.slice(colonIdx + 1).trim();
        if (k === "deal") clientFields.deal_type = v;
        if (k === "fee") clientFields.monthly_fee = parseFloat(v);
        if (k === "revshare") clientFields.rev_share_pct = parseFloat(v);
        if (k === "offer") contextFields.core_offer = v;
        if (k === "goals") contextFields.goals = v;
        if (k === "audience") contextFields.target_audience = v;
        if (k === "voice") contextFields.brand_voice = v;
        if (k === "script") contextFields.script = v;
        if (k === "pain") contextFields.pain_points = v;
        if (k === "notes") contextFields.additional_context = v;
      }
      try {
        const { data: client } = await supabase
          .from("clients").select("id").ilike("name", `%${clientName}%`)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!client) {
          await logUsage(supabase, "client context", false, Date.now() - start, channel);
          return earlyReturn(` -  Client "${clientName}" not found. Create them first with "new client: ${clientName}"`);
        }
        if (Object.keys(clientFields).length) await supabase.from("clients").update(clientFields).eq("id", client.id);
        if (Object.keys(contextFields).length) {
          await supabase.from("client_context").upsert({
            client_id: client.id, ...contextFields, updated_at: new Date().toISOString(),
          });
        }
        await logUsage(supabase, "client context", true, Date.now() - start, channel);
        return earlyReturn(` -  Context updated for ${clientName}.`);
      } catch (err: any) {
        await logUsage(supabase, "client context", false, Date.now() - start, channel);
        return earlyReturn(` -  Context update failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("assign va:")) {
      const start = Date.now();
      const parts = message.slice(10).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const vaName = parts.find((p: string) => p.toLowerCase().startsWith("va:"))?.split(":").slice(1).join(":").trim();
      const vaContact = parts.find((p: string) => p.toLowerCase().startsWith("contact:"))?.split(":").slice(1).join(":").trim();
      try {
        const { data: client } = await supabase
          .from("clients").select("id").ilike("name", `%${clientName}%`)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!client) {
          await logUsage(supabase, "assign va", false, Date.now() - start, channel);
          return earlyReturn(` -  Client "${clientName}" not found.`);
        }
        if (!vaName) {
          await logUsage(supabase, "assign va", false, Date.now() - start, channel);
          return earlyReturn(` -  VA name required. Format: "assign va: ${clientName} | va: [name]"`);
        }
        await supabase.from("va_assignments").insert({ client_id: client.id, va_name: vaName, va_contact: vaContact || null });
        await logUsage(supabase, "assign va", true, Date.now() - start, channel);
        return earlyReturn(` -  ${vaName} assigned to ${clientName}.`);
      } catch (err: any) {
        await logUsage(supabase, "assign va", false, Date.now() - start, channel);
        return earlyReturn(` -  Assign VA failed: ${err.message}`);
      }
    }

    // ================================================================
    // PROVISION CLIENT COMMAND
    // ================================================================
    if (msgLower.startsWith("provision:")) {
      const start = Date.now();
      const parts = message.slice(10).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const dealType = parts.find((p: string) => p.toLowerCase().startsWith("type:"))?.slice(5).trim();
      const about = parts.find((p: string) => p.toLowerCase().startsWith("about:"))?.slice(6).trim();

      let { data: client } = await supabase
        .from("clients")
        .select("id, name, provision_status, slug")
        .ilike("name", `%${clientName}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!client) {
        const { data: newClient } = await supabase
          .from("clients")
          .insert({ name: clientName, status: "active", deal_type: dealType || null })
          .select().single();
        client = newClient;
      }

      if (client.provision_status === "live") {
        return earlyReturn(` -  ${clientName} is already provisioned at https://${client.slug}.nexuszc.com`);
      }

      if (about && client) {
        await supabase.from("client_context").upsert({
          client_id: client.id,
          core_offer: about,
          updated_at: new Date().toISOString(),
        });
      }

      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/provision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ client_id: client.id, telegram_chat_id: external_id }),
      });

      await logUsage(supabase, "provision", true, Date.now() - start, channel);
      return earlyReturn(` -  Provisioning ${clientName}...\n\nI'll message you when the site is live. This takes about 60 seconds.`);
    }

    // ================================================================
    // APPROVE COMMAND  -  merge dev  -  main
    // ================================================================
    if (msgLower.startsWith("approve:") || msgLower === "approve") {
      const improvementTitle = msgLower.startsWith("approve:") ? message.slice(8).trim() : null;

      const query = supabase.from("nexus_improvements").select("*").eq("status", "in_dev");
      if (improvementTitle) query.ilike("title", `%${improvementTitle}%`);
      const { data: improvements } = await query.order("identified_at", { ascending: false }).limit(1);

      const improvement = improvements?.[0];
      if (!improvement) return earlyReturn(" -  No pending dev improvements found to approve.");

      const mergeResult = await mergeDevToMain(improvement.title);

      if (mergeResult.ok) {
        await supabase.from("nexus_improvements")
          .update({ status: "live", approved_at: new Date().toISOString(), live_at: new Date().toISOString() })
          .eq("id", improvement.id);

        // Schedule 1-hour verification reminder
        const { data: convRow } = await supabase
          .from("channel_conversations").select("external_id")
          .eq("channel", "telegram").order("created_at", { ascending: false }).limit(1).maybeSingle();
        const tgChatId = convRow?.external_id;
        if (tgChatId) {
          await supabase.from("reminders").insert({
            chat_id: String(tgChatId),
            message: ` -  VERIFICATION CHECK\n\nFix "${improvement.title}" was approved 1 hour ago.\nSend "nexus status" to check if it's working correctly.\nIf things are broken, send "reject" to rollback.`,
            fire_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          });
        }

        await logUsage(supabase, "approve", true, 0, channel);
        return earlyReturn(` -  Approved and merged!\n\n"${improvement.title}" is live.\nCloudflare deploys in ~60 seconds.\n\nI'll check back in 1 hour to verify it's working.`);
      } else {
        await logUsage(supabase, "approve", false, 0, channel);
        return earlyReturn(` -  Merge failed: ${mergeResult.error}\nCheck GitHub for conflicts.`);
      }
    }

    // ================================================================
    // REJECT COMMAND  -  discard dev changes
    // ================================================================
    if (msgLower.startsWith("reject:") || msgLower === "reject") {
      const { data: improvements } = await supabase
        .from("nexus_improvements")
        .select("*")
        .eq("status", "in_dev")
        .order("identified_at", { ascending: false })
        .limit(1);

      const improvement = improvements?.[0];
      if (!improvement) return earlyReturn(" -  No pending dev improvements to reject.");

      await resetDevToMain();

      await supabase.from("nexus_improvements")
        .update({ status: "rejected" })
        .eq("id", improvement.id);

      await logUsage(supabase, "reject", true, 0, channel);
      return earlyReturn(` -  Rejected "${improvement.title}". Dev branch reset to main.`);
    }

    // ================================================================
    // AUDIT COMMAND
    // ================================================================
    if (msgLower === "nexus audit" || msgLower === "audit nexus") {
      const [health, improvements, usage, alerts] = await Promise.all([
        supabase.from("nexus_health").select("*").order("checked_at", { ascending: false }).limit(5),
        supabase.from("nexus_improvements").select("*").order("priority").limit(10),
        supabase.from("nexus_usage").select("ability, success").gt("logged_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from("nexus_alerts").select("*").eq("resolved", false).limit(5),
      ]);

      const auditPrompt = `You are auditing the Nexus AI system. Provide a comprehensive self-assessment.

HEALTH DATA (last 5 checks):
${JSON.stringify(health.data, null, 2)}

IMPROVEMENT QUEUE (${improvements.data?.length} items):
${JSON.stringify(improvements.data, null, 2)}

USAGE (last 7 days):
${JSON.stringify(usage.data, null, 2)}

ACTIVE ALERTS:
${JSON.stringify(alerts.data, null, 2)}

Provide a brutally honest audit covering:
1. What's working well
2. What's broken or at risk
3. What's being underutilized
4. Top 3 highest-impact improvements (with specific technical recommendations)
5. Overall system health score (0-100) with justification

Be direct, specific, and actionable. Reference actual data from above.`;

      try {
        const auditData = await callAnthropicWithRetry({
          model: "claude-sonnet-4-5",
          max_tokens: 1500,
          messages: [{ role: "user", content: auditPrompt }],
        });
        const audit = auditData?.content?.[0]?.text || "Audit failed.";

        await supabase.from("entries").insert({
          conversation_id: null,
          source: channel, role: "assistant",
          content: `NEXUS AUDIT\n\n${audit}`,
          entry_type: "meta", importance: 9, tags: ["audit", "health"],
          classification_status: "skip",
        });

        await logUsage(supabase, "nexus audit", true, 0, channel);
        return earlyReturn(` -  NEXUS AUDIT\n\n${audit}`);
      } catch (err: any) {
        await logUsage(supabase, "nexus audit", false, 0, channel);
        return earlyReturn(` -  Audit failed: ${err.message}`);
      }
    }

    // ================================================================
    // HEAL COMMAND  -  trigger health-monitor immediately
    // ================================================================
    if (msgLower === "nexus heal" || msgLower === "heal nexus") {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/health-monitor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({}),
      });
      await logUsage(supabase, "nexus heal", true, 0, channel);
      return earlyReturn(
        ` -  NEXUS HEAL TRIGGERED\n\nRunning full health check and improvement cycle now.\nYou'll receive updates via Telegram as issues are identified and fixes are prepared.\n\nSend "nexus status" in 2 minutes to see results.`
      );
    }

    // ================================================================
    // STATUS COMMAND
    // ================================================================
    if (msgLower === "nexus status" || msgLower === "status: nexus") {
      const [{ data: inDev }, { data: pending }, { data: recent }] = await Promise.all([
        supabase.from("nexus_improvements").select("title, problem, recommended_fix, estimated_minutes").eq("status", "in_dev"),
        supabase.from("nexus_improvements").select("title, priority, estimated_minutes").eq("status", "pending").order("priority", { ascending: true }).limit(5),
        supabase.from("nexus_health").select("function_name, status, error_count").order("checked_at", { ascending: false }).limit(4),
      ]);

      let statusMsg = " -  NEXUS STATUS\n\n";

      if (inDev?.length) {
        statusMsg += `IN DEV (waiting for approval):\n`;
        statusMsg += inDev.map((i: any) => ` -  ${i.title} (~${i.estimated_minutes}min fix)\n  ${i.recommended_fix}`).join("\n") + "\n\n";
        statusMsg += `Reply "approve" to push to production or "reject" to discard.\n\n`;
      }

      if (pending?.length) {
        statusMsg += `IMPROVEMENT QUEUE:\n`;
        statusMsg += pending.map((i: any, n: number) => `${n + 1}. ${i.title} (~${i.estimated_minutes}min)`).join("\n") + "\n\n";
      }

      if (recent?.length) {
        statusMsg += `FUNCTION HEALTH:\n`;
        statusMsg += recent.map((h: any) => ` -  ${h.function_name}: ${h.status}`).join("\n");
      }

      if (!inDev?.length && !pending?.length && !recent?.length) {
        statusMsg += "No health data yet. Run health-monitor first.";
      }

      await logUsage(supabase, "nexus status", true, 0, channel);
      return earlyReturn(statusMsg);
    }

    // ================================================================
    // TASK COMPLETION
    // ================================================================
    if (msgLower === "done all") {
      await supabase.from("entries").update({ task_status: "done" }).eq("task_status", "open");
      await logUsage(supabase, "done all", true, 0, channel);
      return earlyReturn(` -  All tasks marked done.`);
    } else if (msgLower.startsWith("done:")) {
      const taskDesc = message.slice(5).trim();
      await supabase.from("entries").update({ task_status: "done" }).eq("task_status", "open").ilike("content", `%${taskDesc}%`);
      await logUsage(supabase, "done", true, 0, channel);
      return earlyReturn(` -  Task marked done: "${taskDesc}"`);
    }

    // ================================================================
    // RESOLVE CONVERSATION (moved up so abilities can save entries)
    // ================================================================
    let conversationId: string | null = null;
    if (channel && external_id) {
      const { data: existing } = await supabase
        .from("channel_conversations")
        .select("conversation_id")
        .eq("channel", channel).eq("external_id", String(external_id)).maybeSingle();
      if (existing) conversationId = existing.conversation_id;
      else {
        const { data: newConv } = await supabase
          .from("conversations").insert({ channel, title: `${channel}:${external_id}` }).select().single();
        conversationId = newConv!.id;
        await supabase.from("channel_conversations").insert({
          channel, external_id: String(external_id), conversation_id: conversationId,
        });
      }
    } else {
      const { data: newConv } = await supabase
        .from("conversations").insert({ channel: channel || "web", title: "ad-hoc" }).select().single();
      conversationId = newConv!.id;
    }

    // ================================================================
    // ABILITY 1: WEB SEARCH
    // ================================================================
    if (msgLower.startsWith("search:")) {
      const start = Date.now();
      const query = message.slice(7).trim();
      try {
        const results = await webSearch(query);
        const summary = await summarizeSearchResults(query, results);
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: `SEARCH: ${query}\n\n${summary}`,
          entry_type: "note", importance: 6, tags: ["search", "research"],
          classification_status: "skip",
        });
        await logUsage(supabase, "search", true, Date.now() - start, channel);
        return earlyReturn(` -  Search: ${query}\n\n${summary}`);
      } catch (err: any) {
        await logUsage(supabase, "search", false, Date.now() - start, channel);
        return earlyReturn(` -  Search failed: ${err.message}`);
      }
    }

    // ================================================================
    // ABILITY 2: URL SUMMARIZATION
    // ================================================================
    if (msgLower.startsWith("summarize:")) {
      const start = Date.now();
      const url = message.slice(10).trim();
      try {
        const summary = await summarizeUrl(url);
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: `URL SUMMARY: ${url}\n\n${summary}`,
          entry_type: "note", importance: 6, tags: ["research", "url"],
          classification_status: "skip",
        });
        await logUsage(supabase, "summarize", true, Date.now() - start, channel);
        return earlyReturn(` -  Summary of ${url}\n\n${summary}`);
      } catch (err: any) {
        await logUsage(supabase, "summarize", false, Date.now() - start, channel);
        return earlyReturn(` -  Summarize failed: ${err.message}`);
      }
    }

    // ================================================================
    // ABILITY 3: EMAIL DRAFTING + SENDING
    // ================================================================
    if (msgLower.startsWith("draft email:")) {
      const start = Date.now();
      const parts = message.slice(12).split("|").map((p: string) => p.trim());
      const to = parts[0];
      const subject = parts.find((p: string) => p.toLowerCase().startsWith("subject:"))?.slice(8).trim() || "Follow-up";
      const about = parts.find((p: string) => p.toLowerCase().startsWith("about:"))?.slice(6).trim() || parts.slice(1).join(" ");
      try {
        const draft = await draftEmail(to, subject, about);
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: `EMAIL DRAFT to ${to}\nSubject: ${subject}\n\n${draft}`,
          entry_type: "note", importance: 7, tags: ["email", "draft"],
          classification_status: "skip",
        });
        await logUsage(supabase, "draft email", true, Date.now() - start, channel);
        return earlyReturn(` -  Email draft to ${to}\nSubject: ${subject}\n\n${draft}\n\n---\nTo send: "send email: ${to} | subject: ${subject} | body: [paste or edit above]"`);
      } catch (err: any) {
        await logUsage(supabase, "draft email", false, Date.now() - start, channel);
        return earlyReturn(` -  Draft failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("send email:")) {
      const start = Date.now();
      const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID");
      if (!GMAIL_CLIENT_ID) {
        await logUsage(supabase, "send email", false, Date.now() - start, channel);
        return earlyReturn(" -  Gmail not configured yet. Email draft saved to memory. Set up Gmail API keys to enable sending.");
      }
      const parts = message.slice(11).split("|").map((p: string) => p.trim());
      const to = parts[0];
      const subject = parts.find((p: string) => p.toLowerCase().startsWith("subject:"))?.slice(8).trim() || "Follow-up";
      const emailBody = parts.find((p: string) => p.toLowerCase().startsWith("body:"))?.slice(5).trim() || "";
      try {
        const result = await sendGmail(to, subject, emailBody);
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: `EMAIL SENT to ${to}\nSubject: ${subject}\n\n${emailBody}`,
          entry_type: "note", importance: 8, tags: ["email", "sent"],
          classification_status: "skip",
        });
        await logUsage(supabase, "send email", result, Date.now() - start, channel);
        return earlyReturn(result ? ` -  Email sent to ${to}` : ` -  Failed to send email. Check logs.`);
      } catch (err: any) {
        await logUsage(supabase, "send email", false, Date.now() - start, channel);
        return earlyReturn(` -  Send failed: ${err.message}`);
      }
    }

    // ================================================================
    // ABILITY 4: DOCUMENT GENERATION
    // ================================================================
    const docTypes = ["generate proposal:", "generate script:", "generate report:", "generate onepager:"];
    const matchedDoc = docTypes.find(d => msgLower.startsWith(d));
    if (matchedDoc) {
      const start = Date.now();
      const docType = matchedDoc.replace("generate ", "").replace(":", "").trim();
      const rest = message.slice(matchedDoc.length).trim();
      const parts = rest.split("|").map((p: string) => p.trim());
      const subject = parts[0];
      const details = parts.slice(1).join(" | ");
      try {
        const { data: clientData } = await supabase
          .from("clients").select("*, client_context(*)")
          .ilike("name", `%${subject}%`)
          .limit(1).maybeSingle();
        const doc = await generateDocument(docType, subject, details, clientData);
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: `${docType.toUpperCase()}: ${subject}\n\n${doc}`,
          entry_type: "note", importance: 8, tags: ["document", docType],
          client_id: clientData?.id || null,
          classification_status: "skip",
        });
        await logUsage(supabase, `generate ${docType}`, true, Date.now() - start, channel);
        return earlyReturn(` -  ${docType.charAt(0).toUpperCase() + docType.slice(1)}: ${subject}\n\n${doc}`);
      } catch (err: any) {
        await logUsage(supabase, `generate ${docType}`, false, Date.now() - start, channel);
        return earlyReturn(` -  Document generation failed: ${err.message}`);
      }
    }

    // ================================================================
    // ABILITY 5: TELEGRAM REMINDERS
    // ================================================================
    if (msgLower.startsWith("remind me:")) {
      const start = Date.now();
      const parts = message.slice(10).split("|").map((p: string) => p.trim());
      const reminderText = parts[0];
      const timePart = parts.find((p: string) => p.toLowerCase().startsWith("in:") || p.toLowerCase().startsWith("at:")) || "";
      const fireAt = parseReminderTime(timePart);
      if (!fireAt) return earlyReturn(` -  Couldn't parse time. Try: "remind me: [what] | in: 2 hours" or "in: 3 days"`);
      const chatId = external_id || "";
      try {
        await supabase.from("reminders").insert({
          chat_id: chatId,
          message: ` -  Reminder: ${reminderText}`,
          fire_at: fireAt.toISOString(),
        });
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "user",
          content: `REMINDER SET: ${reminderText} at ${fireAt.toISOString()}`,
          entry_type: "task", importance: 7, tags: ["reminder"],
          classification_status: "skip",
        });
        await logUsage(supabase, "remind me", true, Date.now() - start, channel);
        return earlyReturn(` -  Reminder set: "${reminderText}"\nFires: ${fireAt.toLocaleString("en-US", { timeZone: "America/Denver" })} MT`);
      } catch (err: any) {
        await logUsage(supabase, "remind me", false, Date.now() - start, channel);
        return earlyReturn(` -  Reminder failed: ${err.message}`);
      }
    }

    // ================================================================
    // ABILITY 6: RESEARCH MODE
    // ================================================================
    if (msgLower.startsWith("research:")) {
      const start = Date.now();
      const target = message.slice(9).trim();
      try {
        const [generalResults, newsResults] = await Promise.all([
          webSearch(target),
          webSearch(`${target} news 2025 2026`),
        ]);
        const allResults = [...generalResults, ...newsResults];
        const research = await synthesizeResearch(target, allResults);
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: `RESEARCH: ${target}\n\n${research}`,
          entry_type: "note", importance: 8, tags: ["research", "intelligence"],
          classification_status: "skip",
        });
        await logUsage(supabase, "research", true, Date.now() - start, channel);
        return earlyReturn(` -  Research: ${target}\n\n${research}`);
      } catch (err: any) {
        await logUsage(supabase, "research", false, Date.now() - start, channel);
        return earlyReturn(` -  Research failed: ${err.message}`);
      }
    }

    // ================================================================
    // ABILITY 7: COMPETITIVE RESEARCH
    // ================================================================
    if (msgLower.startsWith("competitors:")) {
      const start = Date.now();
      const market = message.slice(12).trim();
      try {
        const results = await webSearch(`${market} competitors alternatives 2025`);
        const analysis = await competitiveAnalysis(market, results);
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: `COMPETITIVE ANALYSIS: ${market}\n\n${analysis}`,
          entry_type: "note", importance: 7, tags: ["research", "competitive"],
          classification_status: "skip",
        });
        await logUsage(supabase, "competitors", true, Date.now() - start, channel);
        return earlyReturn(` -  Competitive Analysis: ${market}\n\n${analysis}`);
      } catch (err: any) {
        await logUsage(supabase, "competitors", false, Date.now() - start, channel);
        return earlyReturn(` -  Competitive analysis failed: ${err.message}`);
      }
    }

    // ================================================================
    // ABILITY 8: CLIENT REPORT
    // ================================================================
    if (msgLower.startsWith("report:")) {
      const start = Date.now();
      const clientName = message.slice(7).trim();
      try {
        const { data: client } = await supabase
          .from("clients")
          .select("*, client_context(*), va_assignments(*)")
          .ilike("name", `%${clientName}%`)
          .order("created_at", { ascending: false })
          .limit(1).maybeSingle();
        if (!client) return earlyReturn(` -  Client "${clientName}" not found.`);
        const [{ data: recentEntries }, { data: openTasks }] = await Promise.all([
          supabase.from("entries").select("content, entry_type, created_at, role")
            .eq("client_id", client.id).order("created_at", { ascending: false }).limit(30),
          supabase.from("entries").select("content, created_at")
            .eq("client_id", client.id).eq("task_status", "open"),
        ]);
        const report = await generateClientReport(client, recentEntries || [], openTasks || []);
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: `CLIENT REPORT: ${client.name}\n\n${report}`,
          entry_type: "note", importance: 8, tags: ["report", "client"],
          client_id: client.id,
          classification_status: "skip",
        });
        await logUsage(supabase, "report", true, Date.now() - start, channel);
        return earlyReturn(` -  Client Report: ${client.name}\n\n${report}`);
      } catch (err: any) {
        await logUsage(supabase, "report", false, Date.now() - start, channel);
        return earlyReturn(` -  Report failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 1: CLIENT SNAPSHOT
    // ================================================================
    if (msgLower.startsWith("client snapshot:")) {
      const start = Date.now();
      const clientName = message.slice(16).trim();
      try {
        const { data: client } = await supabase
          .from("clients")
          .select("*, client_context(*), va_assignments(*)")
          .ilike("name", `%${clientName}%`)
          .order("created_at", { ascending: false })
          .limit(1).maybeSingle();

        if (!client) return earlyReturn(` -  Client "${clientName}" not found.`);

        const [{ data: leads }, { data: openTasks }, { data: recentCalls }, { data: recentEntries }] = await Promise.all([
          supabase.from("leads").select("status").eq("client_id", client.id),
          supabase.from("entries").select("content, created_at").eq("client_id", client.id).eq("task_status", "open"),
          supabase.from("call_logs").select("outcome, logged_at").eq("client_id", client.id).order("logged_at", { ascending: false }).limit(10),
          supabase.from("entries").select("content, created_at, role").eq("client_id", client.id).order("created_at", { ascending: false }).limit(5),
        ]);

        const ctx = client.client_context?.[0];
        const activeVA = client.va_assignments?.find((v: any) => v.status === "active");
        const leadStats = (leads || []).reduce((acc: any, l: any) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {});
        const callStats = (recentCalls || []).reduce((acc: any, c: any) => { acc[c.outcome] = (acc[c.outcome] || 0) + 1; return acc; }, {});

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 600,
            messages: [{ role: "user", content: `Generate a concise client snapshot for ${client.name}.

CLIENT:
- Deal: ${client.deal_type || "not set"} | Fee: ${client.monthly_fee ? `$${client.monthly_fee}/mo` : "N/A"} | Rev share: ${client.rev_share_pct ? `${client.rev_share_pct}%` : "N/A"}
- VA: ${activeVA?.va_name || "none assigned"}
- Offer: ${ctx?.core_offer || "not set"}
- Goals: ${ctx?.goals || "not set"}
- Site: ${client.site_url || "not provisioned"}

LEAD PIPELINE: ${JSON.stringify(leadStats)}
RECENT CALLS: ${JSON.stringify(callStats)}
OPEN TASKS: ${(openTasks || []).map((t: any) => t.content.slice(0, 80)).join("; ") || "none"}
RECENT ACTIVITY: ${(recentEntries || []).map((e: any) => `[${e.role}] ${e.content.slice(0, 100)}`).join("\n") || "none"}

Format as:
 -  SNAPSHOT: ${client.name}
Status: [one line overall status]
Pipeline: [lead stats]
VA Activity: [call summary]
Open Tasks: [list]
Next Move: [single most important action]

Be specific. Reference actual numbers.` }],
          }),
        });
        const data = await res.json();
        const snapshot = data?.content?.[0]?.text || "Could not generate snapshot.";

        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `SNAPSHOT: ${client.name}\n\n${snapshot}`, entry_type: "note", importance: 8, tags: ["snapshot"], client_id: client.id, classification_status: "skip" });
        await logUsage(supabase, "client snapshot", true, Date.now() - start, channel);
        return earlyReturn(snapshot);
      } catch (err: any) {
        await logUsage(supabase, "client snapshot", false, Date.now() - start, channel);
        return earlyReturn(` -  Snapshot failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 1: PRIORITIZE TASKS
    // ================================================================
    if (msgLower === "prioritize tasks" || msgLower === "prioritize") {
      const start = Date.now();
      try {
        const { data: openTasks } = await supabase
          .from("entries")
          .select("id, content, created_at, project_names, people_names, client_id")
          .eq("task_status", "open")
          .order("created_at", { ascending: true });

        if (!openTasks?.length) return earlyReturn(" -  No open tasks  -  you're clear.");

        const { data: clients } = await supabase.from("clients").select("id, name, deal_type");

        const taskList = openTasks.map((t: any, i: number) => {
          const client = clients?.find((c: any) => c.id === t.client_id);
          return `${i+1}. ${t.content.slice(0, 120)} ${client ? `[${client.name}]` : ""} (created: ${new Date(t.created_at).toLocaleDateString()})`;
        }).join("\n");

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 800,
            messages: [{ role: "user", content: `You are Zach's Chief of Staff. Prioritize these open tasks by urgency and business impact.\n\nTASKS:\n${taskList}\n\nReturn a prioritized list with this format:\n -  URGENT (do today):\n1. [task]  -  [why urgent]\n\n -  IMPORTANT (this week):\n2. [task]  -  [why important]\n\n -  QUEUE (when time allows):\n3. [task]  -  [reasoning]\n\nBe direct. Explain your reasoning briefly.` }],
          }),
        });
        const data = await res.json();
        const prioritized = data?.content?.[0]?.text || "Could not prioritize.";

        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `PRIORITIZED TASKS\n\n${prioritized}`, entry_type: "meta", importance: 8, tags: ["tasks", "priority"], classification_status: "skip" });
        await logUsage(supabase, "prioritize tasks", true, Date.now() - start, channel);
        return earlyReturn(` -  TASK PRIORITY\n\n${prioritized}`);
      } catch (err: any) {
        await logUsage(supabase, "prioritize tasks", false, Date.now() - start, channel);
        return earlyReturn(` -  Prioritization failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 1: TASK ESTIMATE
    // ================================================================
    if (msgLower.startsWith("task estimate:")) {
      const start = Date.now();
      const task = message.slice(14).trim();
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 400,
            messages: [{ role: "user", content: `Give a realistic time and effort estimate for this task from the perspective of Zach Curtis, a multi-venture entrepreneur with AI tools and VAs available.\n\nTASK: ${task}\n\nFormat:\n -  Time estimate: [X hours/days]\n -  Effort: [low/medium/high]\n -  Steps: [3-5 concrete steps]\n -  Risks: [what could slow this down]\n -  Shortcut: [how to do this faster with AI or VA delegation]` }],
          }),
        });
        const data = await res.json();
        const estimate = data?.content?.[0]?.text || "Could not estimate.";
        await logUsage(supabase, "task estimate", true, Date.now() - start, channel);
        return earlyReturn(` -  ESTIMATE: ${task}\n\n${estimate}`);
      } catch (err: any) {
        await logUsage(supabase, "task estimate", false, Date.now() - start, channel);
        return earlyReturn(` -  Estimate failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 1: SPRINT PLAN
    // ================================================================
    if (msgLower.startsWith("sprint plan:")) {
      const start = Date.now();
      const timeframe = message.slice(12).trim();
      try {
        const [{ data: openTasks }, { data: clients }, { data: improvements }] = await Promise.all([
          supabase.from("entries").select("content, created_at, client_id").eq("task_status", "open").order("created_at", { ascending: true }),
          supabase.from("clients").select("id, name, deal_type, status").eq("status", "active"),
          supabase.from("nexus_improvements").select("title, priority, estimated_minutes").eq("status", "pending").order("priority").limit(3),
        ]);

        const taskList = (openTasks || []).map((t: any) => t.content.slice(0, 100)).join("\n");
        const clientList = (clients || []).map((c: any) => `${c.name} (${c.deal_type})`).join(", ");
        const improvementList = (improvements || []).map((i: any) => `${i.title} (~${i.estimated_minutes}min)`).join("\n");

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 1000,
            messages: [{ role: "user", content: `Create a focused sprint plan for: ${timeframe}\n\nACTIVE CLIENTS: ${clientList}\nOPEN TASKS:\n${taskList}\nNEXUS IMPROVEMENTS QUEUED:\n${improvementList}\n\nGenerate a realistic sprint plan. Format:\n -  SPRINT: ${timeframe}\nGoal: [one sentence  -  what winning looks like]\n\nDAY BY DAY:\n[Day 1]: [3-4 specific actions]\n[Day 2]: [3-4 specific actions]\n...\n\nDELEGATE TO VA:\n[tasks VAs should handle]\n\nDELEGATE TO NEXUS:\n[tasks Nexus auto-handles]\n\nNOT THIS SPRINT:\n[what's intentionally deferred]\n\nBe specific and realistic. Zach works in focused bursts.` }],
          }),
        });
        const data = await res.json();
        const plan = data?.content?.[0]?.text || "Could not generate plan.";

        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `SPRINT PLAN: ${timeframe}\n\n${plan}`, entry_type: "decision", importance: 9, tags: ["sprint", "planning"], classification_status: "skip" });
        await logUsage(supabase, "sprint plan", true, Date.now() - start, channel);
        return earlyReturn(` -  SPRINT PLAN\n\n${plan}`);
      } catch (err: any) {
        await logUsage(supabase, "sprint plan", false, Date.now() - start, channel);
        return earlyReturn(` -  Sprint plan failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 2: GENERATE INVOICE
    // ================================================================
    if (msgLower.startsWith("generate invoice:")) {
      const start = Date.now();
      const parts = message.slice(17).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const forWork = parts.find((p: string) => p.toLowerCase().startsWith("for:"))?.slice(4).trim() || "Services rendered";
      const amount = parts.find((p: string) => p.toLowerCase().startsWith("amount:"))?.slice(7).trim() || "TBD";
      try {
        const [{ data: client }, { data: seqData }] = await Promise.all([
          supabase.from("clients").select("*, client_context(*)").ilike("name", `%${clientName}%`).limit(1).maybeSingle(),
          supabase.from("invoice_sequence").select("last_number").eq("id", 1).single(),
        ]);

        const nextNum = (seqData?.last_number || 1000) + 1;
        await supabase.from("invoice_sequence").update({ last_number: nextNum }).eq("id", 1);
        const year = new Date().getFullYear();
        const invoiceNum = `INV-${year}-${nextNum}`;

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 800,
            messages: [{ role: "user", content: `Generate a professional invoice.\n\nFROM: Zach Curtis / Nexus ZC\nTO: ${clientName}\nFOR: ${forWork}\nAMOUNT: ${amount}\nDATE: ${new Date().toLocaleDateString()}\nINVOICE #: ${invoiceNum}\nDUE: Net 15\n\nWrite a clean, professional invoice in plain text format. Include: invoice header, line items, subtotal, total, payment instructions (Zach@nexuszc.com via Zelle/wire). Keep it professional and complete.` }],
          }),
        });
        const data = await res.json();
        const invoice = data?.content?.[0]?.text || "Could not generate invoice.";

        await supabase.from("generated_docs").insert({ doc_type: "invoice", client_id: client?.id || null, title: `Invoice  -  ${clientName}  -  ${amount}`, content: invoice });
        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `INVOICE: ${clientName}\n\n${invoice}`, entry_type: "note", importance: 9, tags: ["invoice", "billing"], client_id: client?.id || null, classification_status: "skip" });
        await logUsage(supabase, "generate invoice", true, Date.now() - start, channel);
        return earlyReturn(` -  INVOICE GENERATED\n\n${invoice}`);
      } catch (err: any) {
        await logUsage(supabase, "generate invoice", false, Date.now() - start, channel);
        return earlyReturn(` -  Invoice failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 2: GENERATE CONTRACT
    // ================================================================
    if (msgLower.startsWith("generate contract:")) {
      const start = Date.now();
      const parts = message.slice(18).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const forServices = parts.find((p: string) => p.toLowerCase().startsWith("for:"))?.slice(4).trim() || "Professional services";
      const amount = parts.find((p: string) => p.toLowerCase().startsWith("amount:"))?.slice(7).trim() || "TBD";
      try {
        const { data: client } = await supabase.from("clients").select("*").ilike("name", `%${clientName}%`).limit(1).maybeSingle();

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 1500,
            messages: [{ role: "user", content: `Generate a professional service agreement.\n\nSERVICE PROVIDER: Zach Curtis / Nexus ZC (zach@nexuszc.com)\nCLIENT: ${clientName}\nSERVICES: ${forServices}\nCOMPENSATION: ${amount}\nEFFECTIVE DATE: ${new Date().toLocaleDateString()}\n\nWrite a clean, professional service agreement covering: scope of work, compensation and payment terms, term and termination (30 days notice), confidentiality, ownership of work product (client owns deliverables), limitation of liability, governing law (Colorado). Plain English, not legalese. Professional but readable. Include signature blocks at the end.` }],
          }),
        });
        const data = await res.json();
        const contract = data?.content?.[0]?.text || "Could not generate contract.";

        await supabase.from("generated_docs").insert({ doc_type: "contract", client_id: client?.id || null, title: `Contract  -  ${clientName}  -  ${forServices}`, content: contract });
        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `CONTRACT: ${clientName}\n\n${contract}`, entry_type: "decision", importance: 9, tags: ["contract", "legal"], client_id: client?.id || null, classification_status: "skip" });
        await logUsage(supabase, "generate contract", true, Date.now() - start, channel);
        return earlyReturn(` -  CONTRACT GENERATED\n\n${contract}`);
      } catch (err: any) {
        await logUsage(supabase, "generate contract", false, Date.now() - start, channel);
        return earlyReturn(` -  Contract failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 2: SMART FOLLOW UP
    // ================================================================
    if (msgLower.startsWith("follow up:")) {
      const start = Date.now();
      const target = message.slice(10).trim();
      try {
        const [{ data: recentEntries }, { data: client }] = await Promise.all([
          supabase.from("entries").select("content, role, created_at, entry_type").or(`people_names.cs.{"${target}"},content.ilike.%${target}%`).order("created_at", { ascending: false }).limit(10),
          supabase.from("clients").select("*, client_context(*)").ilike("name", `%${target}%`).limit(1).maybeSingle(),
        ]);

        const history = (recentEntries || []).map((e: any) => `[${e.role}, ${new Date(e.created_at).toLocaleDateString()}] ${e.content.slice(0, 150)}`).join("\n");
        const ctx = client?.client_context?.[0];

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 600,
            messages: [{ role: "user", content: `Generate a smart follow-up message for ${target}.\n\nCONTEXT FROM NEXUS MEMORY:\n${history || "No history found"}\n\nCLIENT CONTEXT: ${ctx ? `${ctx.core_offer || ""} | Goals: ${ctx.goals || ""}` : "N/A"}\n\nWrite a natural, specific follow-up message. Reference actual context from memory. Not generic. Format:\n\nSUBJECT: [if email]\nMESSAGE:\n[the follow-up]\n\nSEND VIA: [recommended channel  -  text/email/call]\nBEST TIME: [recommended time]\nKEY POINT: [what you most need from this follow-up]` }],
          }),
        });
        const data = await res.json();
        const followUp = data?.content?.[0]?.text || "Could not generate follow-up.";

        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `FOLLOW UP: ${target}\n\n${followUp}`, entry_type: "note", importance: 8, tags: ["follow-up", "communication"], client_id: client?.id || null, classification_status: "skip" });
        await logUsage(supabase, "follow up", true, Date.now() - start, channel);
        return earlyReturn(` -  FOLLOW UP: ${target}\n\n${followUp}`);
      } catch (err: any) {
        await logUsage(supabase, "follow up", false, Date.now() - start, channel);
        return earlyReturn(` -  Follow-up failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 2: WEEKLY DIGEST
    // ================================================================
    if (msgLower.startsWith("weekly digest:")) {
      const start = Date.now();
      const clientName = message.slice(14).trim();
      try {
        const { data: client } = await supabase.from("clients").select("*, client_context(*), va_assignments(*)").ilike("name", `%${clientName}%`).limit(1).maybeSingle();
        if (!client) return earlyReturn(` -  Client "${clientName}" not found.`);

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const [{ data: entries }, { data: calls }, { data: leads }] = await Promise.all([
          supabase.from("entries").select("content, entry_type, created_at, role").eq("client_id", client.id).gt("created_at", sevenDaysAgo).order("created_at", { ascending: false }),
          supabase.from("call_logs").select("outcome, notes, lead_name, logged_at").eq("client_id", client.id).gt("logged_at", sevenDaysAgo),
          supabase.from("leads").select("status, name").eq("client_id", client.id),
        ]);

        const callSummary = (calls || []).reduce((acc: any, c: any) => { acc[c.outcome] = (acc[c.outcome] || 0) + 1; return acc; }, {});
        const leadSummary = (leads || []).reduce((acc: any, l: any) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {});

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 800,
            messages: [{ role: "user", content: `Generate a weekly progress digest for ${client.name} to send to the client.\n\nThis week's activity:\n- Calls: ${JSON.stringify(callSummary)}\n- Lead pipeline: ${JSON.stringify(leadSummary)}\n- VA: ${client.va_assignments?.find((v: any) => v.status === "active")?.va_name || "none"}\n- Key entries: ${(entries || []).slice(0, 5).map((e: any) => e.content.slice(0, 100)).join("; ")}\n\nWrite a professional weekly update FROM Zach/Nexus ZC TO the client. Highlight wins, show activity, preview next week. Keep it positive and professional. They should feel well-served.\n\nFormat:\nSubject: Weekly Update  -  ${client.name}  -  Week of ${new Date().toLocaleDateString()}\n\n[email body]` }],
          }),
        });
        const data = await res.json();
        const digest = data?.content?.[0]?.text || "Could not generate digest.";

        await supabase.from("generated_docs").insert({ doc_type: "weekly_digest", client_id: client.id, title: `Weekly Digest  -  ${client.name}`, content: digest });
        await logUsage(supabase, "weekly digest", true, Date.now() - start, channel);
        return earlyReturn(` -  WEEKLY DIGEST: ${client.name}\n\n${digest}`);
      } catch (err: any) {
        await logUsage(supabase, "weekly digest", false, Date.now() - start, channel);
        return earlyReturn(` -  Digest failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 2: STATUS UPDATE
    // ================================================================
    if (msgLower.startsWith("status update:")) {
      const start = Date.now();
      const subject = message.slice(14).trim();
      try {
        const [{ data: client }, { data: recentEntries }] = await Promise.all([
          supabase.from("clients").select("*, client_context(*), va_assignments(*)")
            .ilike("name", `%${subject}%`).limit(1).maybeSingle(),
          supabase.from("entries").select("content, entry_type, created_at")
            .or(`content.ilike.%${subject}%,project_names.cs.{"${subject}"}`)
            .order("created_at", { ascending: false }).limit(10),
        ]);

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 600,
            messages: [{ role: "user", content: `Generate a concise project status update for: ${subject}\n\nCONTEXT:\n${(recentEntries || []).map((e: any) => e.content.slice(0, 100)).join("\n")}\nCLIENT: ${client ? `${client.name}  -  ${client.deal_type}` : "N/A"}\n\nFormat:\n -  STATUS: ${subject}\nAs of: ${new Date().toLocaleDateString()}\n\nWHAT'S DONE: [completed items]\nIN PROGRESS: [active work]\nBLOCKERS: [what's stuck]\nNEXT: [immediate next steps]\nOVERALL: [one sentence health assessment]` }],
          }),
        });
        const data = await res.json();
        const update = data?.content?.[0]?.text || "Could not generate status update.";

        await supabase.from("generated_docs").insert({
          doc_type: "status_update", client_id: client?.id || null,
          title: `Status Update  -  ${subject}  -  ${new Date().toLocaleDateString()}`,
          content: update,
        });
        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `STATUS: ${subject}\n\n${update}`, entry_type: "note", importance: 7, tags: ["status", "project"], classification_status: "skip" });
        await logUsage(supabase, "status update", true, Date.now() - start, channel);
        return earlyReturn(` -  STATUS UPDATE\n\n${update}`);
      } catch (err: any) {
        await logUsage(supabase, "status update", false, Date.now() - start, channel);
        return earlyReturn(` -  Status update failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 2: GENERATE SOP
    // ================================================================
    if (msgLower.startsWith("generate sop:")) {
      const start = Date.now();
      const process = message.slice(13).trim();
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 1200,
            messages: [{ role: "user", content: `Create a Standard Operating Procedure for: ${process}\n\nContext: This is for Nexus ZC, a multi-venture AI-powered business operation run by Zach Curtis. VAs and AI tools are available.\n\nFormat:\nSOP: ${process}\nVersion: 1.0 | Date: ${new Date().toLocaleDateString()}\nOwner: Zach Curtis\n\n1. PURPOSE\n[Why this process exists]\n\n2. SCOPE\n[Who follows this and when]\n\n3. TOOLS REQUIRED\n[List tools/access needed]\n\n4. STEP-BY-STEP PROCESS\n[Numbered steps, specific and actionable]\n\n5. QUALITY CHECKS\n[How to verify it was done correctly]\n\n6. COMMON ISSUES & FIXES\n[What goes wrong and how to handle it]\n\n7. ESCALATION\n[When to involve Zach vs handle independently]` }],
          }),
        });
        const data = await res.json();
        const sop = data?.content?.[0]?.text || "Could not generate SOP.";

        await supabase.from("generated_docs").insert({ doc_type: "sop", client_id: null, title: `SOP  -  ${process}`, content: sop });
        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `SOP: ${process}\n\n${sop}`, entry_type: "note", importance: 7, tags: ["sop", "process"], classification_status: "skip" });
        await logUsage(supabase, "generate sop", true, Date.now() - start, channel);
        return earlyReturn(` -  SOP: ${process}\n\n${sop}`);
      } catch (err: any) {
        await logUsage(supabase, "generate sop", false, Date.now() - start, channel);
        return earlyReturn(` -  SOP failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 3: GENERATE PITCH
    // ================================================================
    if (msgLower.startsWith("generate pitch:")) {
      const start = Date.now();
      const parts = message.slice(15).split("|").map((p: string) => p.trim());
      const target = parts[0];
      const forService = parts.find((p: string) => p.toLowerCase().startsWith("for:"))?.slice(4).trim() || "Nexus VA + AI services";
      try {
        const { data: client } = await supabase.from("clients").select("*, client_context(*)").ilike("name", `%${target}%`).limit(1).maybeSingle();
        const ctx = client?.client_context?.[0];

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 1000,
            messages: [{ role: "user", content: `Write a compelling sales pitch for ${target}.\n\nSERVICE: ${forService}\nCLIENT CONTEXT: ${ctx ? `Business: ${ctx.core_offer || "unknown"} | Pain points: ${ctx.pain_points || "unknown"} | Goals: ${ctx.goals || "unknown"}` : "Research required"}\n\nWrite a punchy, specific pitch. Not generic.\n\nFormat:\n -  PITCH: ${target}\n\nOPENER (hook  -  2 sentences max):\n[Start with their pain or opportunity]\n\nWHAT WE DO:\n[Specific to their situation]\n\nWHY IT WORKS:\n[Proof points  -  results, process, differentiation]\n\nWHAT YOU GET:\n[Concrete deliverables]\n\nINVESTMENT:\n[Pricing range or structure]\n\nNEXT STEP:\n[Single clear CTA]\n\nBe confident. Be specific. Avoid fluff.` }],
          }),
        });
        const data = await res.json();
        const pitch = data?.content?.[0]?.text || "Could not generate pitch.";

        await supabase.from("generated_docs").insert({ doc_type: "pitch", client_id: client?.id || null, title: `Pitch  -  ${target}  -  ${forService}`, content: pitch });
        await logUsage(supabase, "generate pitch", true, Date.now() - start, channel);
        return earlyReturn(pitch);
      } catch (err: any) {
        await logUsage(supabase, "generate pitch", false, Date.now() - start, channel);
        return earlyReturn(` -  Pitch failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 3: GENERATE CASE STUDY
    // ================================================================
    if (msgLower.startsWith("generate case study:")) {
      const start = Date.now();
      const clientName = message.slice(20).trim();
      try {
        const { data: client } = await supabase.from("clients").select("*, client_context(*), va_assignments(*)").ilike("name", `%${clientName}%`).limit(1).maybeSingle();
        if (!client) return earlyReturn(` -  Client "${clientName}" not found.`);

        const [{ data: calls }, { data: leads }] = await Promise.all([
          supabase.from("call_logs").select("outcome, notes").eq("client_id", client.id),
          supabase.from("leads").select("status").eq("client_id", client.id),
        ]);

        const callStats = (calls || []).reduce((acc: any, c: any) => { acc[c.outcome] = (acc[c.outcome] || 0) + 1; return acc; }, {});
        const leadStats = (leads || []).reduce((acc: any, l: any) => { acc[l.status] = (acc[l.status] || 0) + 1; return acc; }, {});
        const ctx = client.client_context?.[0];

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 1000,
            messages: [{ role: "user", content: `Write a results-focused case study for ${client.name}.\n\nCLIENT: ${client.name} | Deal: ${client.deal_type} | Offer: ${ctx?.core_offer || "unknown"}\nCALL RESULTS: ${JSON.stringify(callStats)}\nLEAD PIPELINE: ${JSON.stringify(leadStats)}\nVA ASSIGNED: ${client.va_assignments?.find((v: any) => v.status === "active")?.va_name || "none"}\n\nWrite a compelling case study. Use placeholder metrics if real ones aren't available yet (mark with [TBD]).\n\nFormat:\n -  CASE STUDY: ${client.name}\n\nTHE CHALLENGE:\n[What they were struggling with before]\n\nTHE SOLUTION:\n[What Nexus ZC implemented]\n\nTHE RESULTS:\n[Specific outcomes  -  calls made, leads generated, etc]\n\nWHAT THEY SAY:\n["[Testimonial placeholder  -  update with real quote]"]\n\nKEY TAKEAWAYS:\n[3 bullet points]\n\nReady to achieve similar results? Contact zach@nexuszc.com` }],
          }),
        });
        const data = await res.json();
        const caseStudy = data?.content?.[0]?.text || "Could not generate case study.";

        await supabase.from("generated_docs").insert({ doc_type: "case_study", client_id: client.id, title: `Case Study  -  ${client.name}`, content: caseStudy });
        await logUsage(supabase, "generate case study", true, Date.now() - start, channel);
        return earlyReturn(caseStudy);
      } catch (err: any) {
        await logUsage(supabase, "generate case study", false, Date.now() - start, channel);
        return earlyReturn(` -  Case study failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 3: GENERATE AD COPY
    // ================================================================
    if (msgLower.startsWith("generate ad copy:")) {
      const start = Date.now();
      const parts = message.slice(17).split("|").map((p: string) => p.trim());
      const service = parts[0];
      const platform = parts.find((p: string) => p.toLowerCase().startsWith("platform:"))?.slice(9).trim() || "Facebook/Instagram";
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 800,
            messages: [{ role: "user", content: `Write high-converting ad copy for: ${service}\nPLATFORM: ${platform}\n\nWrite 3 ad variations:\n\nAD 1  -  Pain-focused:\nHEADLINE: [max 40 chars]\nBODY: [max 125 chars]\nCTA: [action button text]\n\nAD 2  -  Results-focused:\nHEADLINE: [max 40 chars]\nBODY: [max 125 chars]\nCTA: [action button text]\n\nAD 3  -  Curiosity/hook:\nHEADLINE: [max 40 chars]\nBODY: [max 125 chars]\nCTA: [action button text]\n\nKeep it punchy. No fluff. Speak to the target audience's real pain.` }],
          }),
        });
        const data = await res.json();
        const adCopy = data?.content?.[0]?.text || "Could not generate ad copy.";

        await supabase.from("generated_docs").insert({ doc_type: "ad_copy", client_id: null, title: `Ad Copy  -  ${service}  -  ${platform}`, content: adCopy });
        await logUsage(supabase, "generate ad copy", true, Date.now() - start, channel);
        return earlyReturn(` -  AD COPY: ${service} (${platform})\n\n${adCopy}`);
      } catch (err: any) {
        await logUsage(supabase, "generate ad copy", false, Date.now() - start, channel);
        return earlyReturn(` -  Ad copy failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 3: CALCULATE ROI
    // ================================================================
    if (msgLower.startsWith("calculate roi:")) {
      const start = Date.now();
      const parts = message.slice(14).split("|").map((p: string) => p.trim());
      const project = parts[0];
      const revenue = parts.find((p: string) => p.toLowerCase().startsWith("revenue:"))?.slice(8).trim() || "0";
      const cost = parts.find((p: string) => p.toLowerCase().startsWith("cost:"))?.slice(5).trim() || "0";
      try {
        const revenueNum = parseFloat(revenue.replace(/[$,]/g, "")) || 0;
        const costNum = parseFloat(cost.replace(/[$,]/g, "")) || 0;
        const roi = costNum > 0 ? (((revenueNum - costNum) / costNum) * 100).toFixed(1) : "N/A";
        const profit = (revenueNum - costNum).toFixed(2);
        const margin = revenueNum > 0 ? (((revenueNum - costNum) / revenueNum) * 100).toFixed(1) : "0";

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 400,
            messages: [{ role: "user", content: `Analyze the ROI for: ${project}\nRevenue: $${revenueNum} | Cost: $${costNum} | ROI: ${roi}% | Profit: $${profit} | Margin: ${margin}%\n\nProvide a brief business analysis:\n -  ROI ANALYSIS: ${project}\n- Revenue: $${revenueNum.toLocaleString()}\n- Cost: $${costNum.toLocaleString()}\n- Profit: $${parseFloat(profit).toLocaleString()}\n- ROI: ${roi}%\n- Margin: ${margin}%\n\nVERDICT: [Good/Marginal/Poor investment and why in 2 sentences]\nOPTIMIZE: [One specific way to improve these numbers]\nSCALE: [What this looks like at 5x revenue]` }],
          }),
        });
        const data = await res.json();
        const analysis = data?.content?.[0]?.text || `ROI: ${roi}% | Profit: $${profit} | Margin: ${margin}%`;

        await logUsage(supabase, "calculate roi", true, Date.now() - start, channel);
        return earlyReturn(analysis);
      } catch (err: any) {
        await logUsage(supabase, "calculate roi", false, Date.now() - start, channel);
        return earlyReturn(` -  ROI calc failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 3: PRICING CALCULATOR
    // ================================================================
    if (msgLower.startsWith("pricing calculator:")) {
      const start = Date.now();
      const parts = message.slice(19).split("|").map((p: string) => p.trim());
      const service = parts[0];
      const market = parts.find((p: string) => p.toLowerCase().startsWith("market:"))?.slice(7).trim() || "general market";
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 600,
            messages: [{ role: "user", content: `Generate a pricing analysis for: ${service}\nMARKET: ${market}\n\nProvide a pricing strategy with 3 tiers:\n\n -  PRICING: ${service}\n\nMARKET RATE: [what competitors charge]\n\nTIER 1  -  Entry: $[price]\n[What's included, who it's for]\n\nTIER 2  -  Standard: $[price]\n[What's included, who it's for]\n\nTIER 3  -  Premium: $[price]\n[What's included, who it's for]\n\nRECOMMENDATION:\n[Which tier to lead with and why]\n\nANCHORING TIP:\n[How to present pricing to maximize closes]` }],
          }),
        });
        const data = await res.json();
        const pricing = data?.content?.[0]?.text || "Could not generate pricing.";

        await logUsage(supabase, "pricing calculator", true, Date.now() - start, channel);
        return earlyReturn(pricing);
      } catch (err: any) {
        await logUsage(supabase, "pricing calculator", false, Date.now() - start, channel);
        return earlyReturn(` -  Pricing calc failed: ${err.message}`);
      }
    }

    // ================================================================
    // TIER 4: KNOWLEDGE BASE
    // ================================================================
    if (msgLower.startsWith("save knowledge:")) {
      const start = Date.now();
      const rest = message.slice(15).trim();
      const pipeIdx = rest.indexOf("|");
      const topic = pipeIdx > -1 ? rest.slice(0, pipeIdx).trim() : rest;
      const content = pipeIdx > -1 ? rest.slice(pipeIdx + 1).trim() : rest;
      try {
        await supabase.from("knowledge_base").insert({ topic, content, source: "manual", tags: [] });
        await logUsage(supabase, "save knowledge", true, Date.now() - start, channel);
        return earlyReturn(` -  Knowledge saved: "${topic}"`);
      } catch (err: any) {
        await logUsage(supabase, "save knowledge", false, Date.now() - start, channel);
        return earlyReturn(` -  Save failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("recall knowledge:")) {
      const start = Date.now();
      const topic = message.slice(17).trim();
      try {
        const { data: results } = await supabase
          .from("knowledge_base")
          .select("topic, content, created_at")
          .or(`topic.ilike.%${topic}%,content.ilike.%${topic}%`)
          .order("created_at", { ascending: false })
          .limit(5);

        if (!results?.length) return earlyReturn(` -  No knowledge found for "${topic}"`);

        const knowledge = results.map((r: any, i: number) => `${i+1}. ${r.topic}\n${r.content.slice(0, 300)}`).join("\n\n");
        await logUsage(supabase, "recall knowledge", true, Date.now() - start, channel);
        return earlyReturn(` -  KNOWLEDGE: ${topic}\n\n${knowledge}`);
      } catch (err: any) {
        await logUsage(supabase, "recall knowledge", false, Date.now() - start, channel);
        return earlyReturn(` -  Recall failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("learn from:")) {
      const start = Date.now();
      const url = message.slice(11).trim();
      try {
        const pageRes = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Nexus/1.0)" } });
        const html = await pageRes.text();
        const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 8000);

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5", max_tokens: 600,
            messages: [{ role: "user", content: `Extract the key knowledge from this webpage for Zach's brain.\n\nURL: ${url}\nCONTENT: ${text}\n\nReturn:\nTOPIC: [short topic name]\nKEY INSIGHTS:\n[5-8 bullet points of the most important information]\nACTIONABLE TAKEAWAY:\n[What Zach should do with this knowledge]` }],
          }),
        });
        const data = await res.json();
        const learned = data?.content?.[0]?.text || "";

        const topicMatch = learned.match(/TOPIC:\s*(.+)/);
        const topic = topicMatch?.[1]?.trim() || url;

        await supabase.from("knowledge_base").insert({ topic, content: learned, source: "url", tags: [url] });
        await logUsage(supabase, "learn from", true, Date.now() - start, channel);
        return earlyReturn(` -  LEARNED: ${topic}\n\n${learned}`);
      } catch (err: any) {
        await logUsage(supabase, "learn from", false, Date.now() - start, channel);
        return earlyReturn(` -  Learn failed: ${err.message}`);
      }
    }

    if (msgLower === "nexus brain dump" || msgLower === "brain dump") {
      const start = Date.now();
      try {
        const [{ data: knowledge }, { data: clients }, { data: openTasks }, { data: docs }, { data: improvements }] = await Promise.all([
          supabase.from("knowledge_base").select("topic, created_at").order("created_at", { ascending: false }).limit(20),
          supabase.from("clients").select("name, deal_type, status, provision_status"),
          supabase.from("entries").select("content").eq("task_status", "open"),
          supabase.from("generated_docs").select("doc_type, title, created_at").order("created_at", { ascending: false }).limit(10),
          supabase.from("nexus_improvements").select("title, status").eq("status", "pending").order("priority").limit(5),
        ]);

        const fullDump = [
          `NEXUS BRAIN DUMP - ${new Date().toLocaleString()}`,
          "",
          `KNOWLEDGE BASE (${knowledge?.length || 0} items):`,
          ...(knowledge || []).map((k: any) => `- ${k.topic}`),
          "",
          `ACTIVE CLIENTS (${clients?.length || 0}):`,
          ...(clients || []).map((c: any) => `- ${c.name} | ${c.deal_type || "no deal"} | ${c.status} | site: ${c.provision_status}`),
          "",
          `OPEN TASKS (${openTasks?.length || 0}):`,
          ...(openTasks || []).map((t: any) => `- ${t.content.slice(0, 100)}`),
          "",
          `GENERATED DOCS (${docs?.length || 0} recent):`,
          ...(docs || []).map((d: any) => `- [${d.doc_type}] ${d.title}`),
          "",
          `NEXUS IMPROVEMENT QUEUE:`,
          ...(improvements || []).map((i: any) => `- ${i.title}`),
        ].join("\n");

        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: fullDump, entry_type: "meta", importance: 9,
          tags: ["brain-dump"], classification_status: "skip",
        });

        const summary = [
          "NEXUS BRAIN DUMP",
          "",
          `Knowledge: ${knowledge?.length || 0} topics`,
          `Clients: ${clients?.length || 0} active`,
          `Open tasks: ${openTasks?.length || 0}`,
          `Recent docs: ${docs?.length || 0}`,
          `Improvements queued: ${improvements?.length || 0}`,
          "",
          "TOP KNOWLEDGE:",
          ...(knowledge || []).slice(0, 5).map((k: any) => `- ${k.topic}`),
          "",
          "OPEN TASKS:",
          ...(openTasks || []).slice(0, 5).map((t: any) => `- ${t.content.slice(0, 80)}`),
          "",
          'Full dump saved to Nexus memory. Send "recall knowledge: [topic]" to pull specifics.',
        ].join("\n");

        await logUsage(supabase, "brain_dump", true, Date.now() - start, channel);
        return earlyReturn(summary);
      } catch (err: any) {
        await logUsage(supabase, "brain_dump", false, Date.now() - start, channel);
        return earlyReturn(`Brain dump failed: ${err.message}`);
      }
    }

    // ================================================================
    // ROOFING COMMANDS
    // ================================================================
    if (msgLower === "roofing jobs" || msgLower === "roofing summary") {
      const start = Date.now();
      try {
        const { data: jobs } = await supabase
          .from("roofing_jobs")
          .select("id, homeowner_name, property_address, status, contract_amount, job_type, clients(name, brand_name)")
          .order("created_at", { ascending: false });

        if (msgLower === "roofing summary") {
          const total = jobs?.length || 0;
          const active = jobs?.filter((j: any) => !["paid", "cancelled"].includes(j.status)).length || 0;
          const value = jobs?.reduce((acc: number, j: any) => acc + (j.contract_amount || 0), 0) || 0;
          const byStatus = (jobs || []).reduce((acc: any, j: any) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});
          const statusLines = Object.entries(byStatus).map(([s, c]) => ` -  ${s.replace(/_/g, " ")}: ${c}`).join("\n");
          await logUsage(supabase, "roofing_summary", true, Date.now() - start, channel);
          return earlyReturn(` -  ROOFING OS SUMMARY\n\nTotal jobs: ${total}\nActive: ${active}\nContract value: $${value.toLocaleString()}\n\nPIPELINE:\n${statusLines || "No jobs yet"}`);
        }

        const active = (jobs || []).filter((j: any) => !["paid", "cancelled"].includes(j.status));
        const lines = active.map((j: any) =>
          ` -  ${j.homeowner_name}  -  ${j.property_address}\n  ${j.status.replace(/_/g, " ")}${j.contract_amount ? `  -  $${j.contract_amount.toLocaleString()}` : ""}\n  ID: ${j.id.slice(0, 8)}`
        ).join("\n\n");
        await logUsage(supabase, "roofing_jobs", true, Date.now() - start, channel);
        return earlyReturn(` -  ACTIVE ROOFING JOBS (${active.length})\n\n${lines || "No active jobs"}`);
      } catch (err: any) {
        await logUsage(supabase, "roofing_jobs", false, Date.now() - start, channel);
        return earlyReturn(` -  Roofing jobs failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("roofing job:")) {
      const start = Date.now();
      const jobId = message.slice(12).trim();
      try {
        const { data: job } = await supabase
          .from("roofing_jobs")
          .select("*, clients(name, brand_name)")
          .or(`id.eq.${jobId},id.ilike.${jobId}%`)
          .single();
        if (!job) return earlyReturn(` -  Job not found: ${jobId}`);
        const msg =
          ` -  JOB: ${job.homeowner_name}\n` +
          `Address: ${job.property_address}\n` +
          `Status: ${job.status.replace(/_/g, " ")}\n` +
          `Type: ${job.job_type?.replace(/_/g, " ")}\n` +
          `Contract: ${job.contract_amount ? `$${job.contract_amount.toLocaleString()}` : "not set"}\n` +
          `Start: ${job.estimated_start_date || "TBD"}\n` +
          `Insurance: ${job.insurance_claim ? `Claim ${job.claim_number || "filed"}` : "No"}\n` +
          `Portal: app.nexuszc.com/roofing/portal/${job.portal_token}`;
        await logUsage(supabase, "roofing_job", true, Date.now() - start, channel);
        return earlyReturn(msg);
      } catch (err: any) {
        await logUsage(supabase, "roofing_job", false, Date.now() - start, channel);
        return earlyReturn(` -  Job lookup failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("roofing new:")) {
      const start = Date.now();
      const parts = message.slice(12).split("|").map((p: string) => p.trim());
      const homeownerName = parts[0];
      const address = parts.find((p: string) => p.toLowerCase().startsWith("address:"))?.slice(8).trim() || "";
      const contractorName = parts.find((p: string) => p.toLowerCase().startsWith("contractor:"))?.slice(11).trim() || "";
      try {
        const { data: client } = await supabase
          .from("clients").select("id, name").ilike("name", `%${contractorName}%`).limit(1).maybeSingle();
        const { data: job } = await supabase.from("roofing_jobs").insert({
          homeowner_name: homeownerName,
          property_address: address || "Address TBD",
          client_id: client?.id || null,
        }).select().single();
        await logUsage(supabase, "roofing_new", true, Date.now() - start, channel);
        return earlyReturn(` -  Roofing job created\n\nHomeowner: ${homeownerName}\nAddress: ${address || "TBD"}\nContractor: ${client?.name || "unassigned"}\nID: ${job.id}\nPortal: app.nexuszc.com/roofing/portal/${job.portal_token}`);
      } catch (err: any) {
        await logUsage(supabase, "roofing_new", false, Date.now() - start, channel);
        return earlyReturn(` -  Job creation failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("roofing status:")) {
      const start = Date.now();
      const rest = message.slice(15);
      const jobIdPart = rest.split("|")[0].trim();
      const newStatus = rest.split("|").find((p: string) => p.toLowerCase().includes("status:"))?.split(":").slice(1).join(":").trim() || "";
      try {
        const { data: job } = await supabase
          .from("roofing_jobs").select("id, homeowner_name").or(`id.eq.${jobIdPart},id.ilike.${jobIdPart}%`).single();
        if (!job) return earlyReturn(` -  Job not found: ${jobIdPart}`);
        if (!newStatus) return earlyReturn(` -  Format: roofing status: [job_id] | status: [new_status]`);
        await supabase.from("roofing_jobs").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", job.id);
        await logUsage(supabase, "roofing_status", true, Date.now() - start, channel);
        return earlyReturn(` -  ${job.homeowner_name}  -  ${newStatus.replace(/_/g, " ")}`);
      } catch (err: any) {
        await logUsage(supabase, "roofing_status", false, Date.now() - start, channel);
        return earlyReturn(` -  Status update failed: ${err.message}`);
      }
    }

    //  -  FOCUS  - 
    if (msgLower === "focus" || msgLower === "what should i focus on" || msgLower === "focus now") {
      const start = Date.now();
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-coo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ action: "focus" }),
        });
        const data = await res.json();
        await logUsage(supabase, "focus", true, Date.now() - start, channel);
        return earlyReturn(data.response || "Could not generate focus list.");
      } catch (err: any) {
        await logUsage(supabase, "focus", false, Date.now() - start, channel);
        return earlyReturn(` -  Focus failed: ${err.message}`);
      }
    }

    //  -  STALE CHECK  - 
    if (msgLower === "stale check" || msgLower === "who needs attention") {
      const start = Date.now();
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-coo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ action: "stale_check" }),
        });
        const data = await res.json();
        await logUsage(supabase, "stale_check", true, Date.now() - start, channel);
        return earlyReturn(data.stale_count === 0 ? " -  All clients are active. No stale relationships." : ` -  Found ${data.stale_count} stale client(s). Alert sent.`);
      } catch (err: any) {
        await logUsage(supabase, "stale_check", false, Date.now() - start, channel);
        return earlyReturn(` -  Stale check failed: ${err.message}`);
      }
    }

    //  -  MOMENTUM  - 
    if (msgLower === "momentum" || msgLower === "project momentum") {
      const start = Date.now();
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-coo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ action: "momentum_check" }),
        });
        const data = await res.json();
        await logUsage(supabase, "momentum_check", true, Date.now() - start, channel);
        return earlyReturn(data.stale_projects === 0 ? " -  All projects have recent activity." : ` -  ${data.stale_projects} project(s) going stale. Alert sent.`);
      } catch (err: any) {
        await logUsage(supabase, "momentum_check", false, Date.now() - start, channel);
        return earlyReturn(` -  Momentum check failed: ${err.message}`);
      }
    }

    //  -  HEALTH SCORES  - 
    if (msgLower === "health scores" || msgLower === "client health") {
      const start = Date.now();
      try {
        const { data: clients } = await supabase
          .from("clients")
          .select("name, health_score, last_activity_at")
          .eq("status", "active")
          .order("health_score", { ascending: true });

        if (!clients || clients.length === 0) {
          await logUsage(supabase, "health_scores", true, Date.now() - start, channel);
          return earlyReturn("No active clients found.");
        }

        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-coo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ action: "health_score" }),
        });

        const scoreEmoji = (score: number) => score >= 70 ? " - " : score >= 40 ? " - " : " - ";
        const reply =
          `*Client Health Scores*\n\n` +
          clients.map((c: any) => `${scoreEmoji(c.health_score || 50)} *${c.name}*  -  ${c.health_score || 50}/100`).join("\n") +
          `\n\n_Scores updating in background..._`;

        await logUsage(supabase, "health_scores", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "health_scores", false, Date.now() - start, channel);
        return earlyReturn(` -  Health scores failed: ${err.message}`);
      }
    }

    //  -  PROJECT UPDATE  - 
    if (msgLower.startsWith("project update:") || msgLower.startsWith("update project:")) {
      const start = Date.now();
      try {
        const parts = message.split("|").map((p: string) => p.trim());
        const projectName = parts[0].replace(/^(project update:|update project:)/i, "").trim();
        const milestone = parts[1] || null;

        const { data: project } = await supabase
          .from("projects")
          .select("id, name")
          .ilike("name", `%${projectName}%`)
          .single();

        if (!project) {
          await logUsage(supabase, "project_update", false, Date.now() - start, channel);
          return earlyReturn(`Project "${projectName}" not found.`);
        }

        await supabase.from("projects").update({
          last_update_at: new Date().toISOString(),
          momentum_status: "active",
          ...(milestone ? { next_milestone: milestone } : {}),
        }).eq("id", project.id);

        await logUsage(supabase, "project_update", true, Date.now() - start, channel);
        return earlyReturn(` -  *${project.name}* momentum updated.${milestone ? `\nNext milestone: ${milestone}` : ""}`);
      } catch (err: any) {
        await logUsage(supabase, "project_update", false, Date.now() - start, channel);
        return earlyReturn(` -  Project update failed: ${err.message}`);
      }
    }

    //  -  CONTRADICTIONS  - 
    if (msgLower === "contradictions" || msgLower === "show contradictions") {
      const start = Date.now();
      try {
        const { data: contradictions } = await supabase
          .from("contradiction_log")
          .select("*")
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(5);

        if (!contradictions || contradictions.length === 0) {
          await logUsage(supabase, "contradictions", true, Date.now() - start, channel);
          return earlyReturn(" -  No unresolved contradictions in your memory.");
        }

        const reply =
          `*Unresolved contradictions (${contradictions.length}):*\n\n` +
          contradictions.map((c: any, i: number) =>
            `${i + 1}. *${c.topic}*\nBefore: "${c.existing_claim}"\nNow: "${c.new_claim}"`
          ).join("\n\n");

        await logUsage(supabase, "contradictions", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "contradictions", false, Date.now() - start, channel);
        return earlyReturn(` -  Contradictions failed: ${err.message}`);
      }
    }

    //  -  APPROVE QUEUED ACTION  - 
    //  -  APPROVE ALL  - 
    if (msgLower === "approve all") {
      const start = Date.now();
      try {
        const ABILITY_CAP = 5;
        const now = new Date().toISOString();

        const [{ data: actions }, { data: proposed }, { data: testing }] = await Promise.all([
          supabase.from("nexus_action_queue").select("id, action_summary").eq("status", "pending"),
          supabase.from("nexus_ability_proposals").select("id, ability_name").eq("status", "proposed").order("created_at", { ascending: true }),
          supabase.from("nexus_ability_proposals").select("id, ability_name").eq("status", "testing").order("created_at", { ascending: true }),
        ]);

        const actionIds = (actions || []).map((a: { id: string }) => a.id);
        const allToBuild = proposed || [];
        const allToDeploy = testing || [];
        const toBuild = allToBuild.slice(0, ABILITY_CAP);
        const toDeploy = allToDeploy.slice(0, Math.max(0, ABILITY_CAP - toBuild.length));
        const remainingCount = (allToBuild.length - toBuild.length) + (allToDeploy.length - toDeploy.length);

        if (actionIds.length > 0) {
          await supabase.from("nexus_action_queue")
            .update({ status: "approved", approved_at: now })
            .in("id", actionIds);
        }

        for (const ability of toBuild) {
          await supabase.from("nexus_ability_proposals")
            .update({ status: "approved", approved_at: now })
            .eq("id", ability.id);
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ proposal_id: ability.id, action: "build" }),
          });
        }

        for (const ability of toDeploy) {
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ proposal_id: ability.id, action: "deploy" }),
          });
        }

        await logUsage(supabase, "approve_all", true, Date.now() - start, channel);
        const lines: string[] = [];
        if (actionIds.length > 0) lines.push(`✅ Approved ${actionIds.length} action${actionIds.length > 1 ? "s" : ""}`);
        if (toBuild.length > 0) lines.push(`🔨 Building ${toBuild.length}: ${toBuild.map((a: { ability_name: string }) => a.ability_name).join(", ")}`);
        if (toDeploy.length > 0) lines.push(`🚀 Deploying ${toDeploy.length}: ${toDeploy.map((a: { ability_name: string }) => a.ability_name).join(", ")}`);
        if (remainingCount > 0) lines.push(`_(${remainingCount} more queued — run \`approve all\` again to continue)_`);
        if (lines.length === 0) lines.push("Nothing pending to approve.");
        return earlyReturn(lines.join("\n"));
      } catch (err: any) {
        await logUsage(supabase, "approve_all", false, Date.now() - start, channel);
        return earlyReturn(`❌ Failed: ${err.message}`);
      }
    }

    if (msgLower === "approve abilities") {
      const start = Date.now();
      try {
        const now = new Date().toISOString();
        const { data: abilities } = await supabase
          .from("nexus_ability_proposals")
          .select("id, ability_name")
          .eq("status", "proposed");

        const abilityRows = abilities || [];
        if (abilityRows.length === 0) {
          await logUsage(supabase, "approve_abilities", true, Date.now() - start, channel);
          return earlyReturn("No proposed abilities to approve.");
        }

        for (const ability of abilityRows) {
          await supabase.from("nexus_ability_proposals")
            .update({ status: "approved", approved_at: now })
            .eq("id", ability.id);
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ proposal_id: ability.id, action: "build" }),
          });
        }

        await logUsage(supabase, "approve_abilities", true, Date.now() - start, channel);
        return earlyReturn(` -  Building ${abilityRows.length} abilit${abilityRows.length > 1 ? "ies" : "y"}:\n${abilityRows.map((a: { ability_name: string }) => ` -  ${a.ability_name}`).join("\n")}\n\nYou'll get a Telegram notification for each one when it's ready to test.`);
      } catch (err: any) {
        await logUsage(supabase, "approve_abilities", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("approve action ") || msgLower.startsWith("exec ")) {
      const start = Date.now();
      try {
        const actionId = message.split(" ").pop()?.trim();
        if (!actionId) return earlyReturn("Specify action ID. Reply `pending` to see pending actions.");

        const { data: queuedAction } = await supabase
          .from("nexus_action_queue")
          .select("*")
          .filter("id::text", "ilike", `${actionId}%`)
          .eq("status", "pending")
          .maybeSingle();

        if (!queuedAction) return earlyReturn(`No pending action found matching: ${actionId}`);

        await supabase.from("nexus_action_queue")
          .update({ status: "approved", approved_at: new Date().toISOString() })
          .eq("id", queuedAction.id);

        await supabase.from("nexus_audit_log").insert({
          engine: "chat",
          action_type: "action_approved",
          action_detail: `Approved: ${queuedAction.action_summary}`,
          approval_required: true,
          approved_at: new Date().toISOString(),
          outcome: "success",
        });

        await logUsage(supabase, "approve_action", true, Date.now() - start, channel);
        return earlyReturn(` -  Approved: *${queuedAction.action_summary}*\nExecuting...`);
      } catch (err: any) {
        await logUsage(supabase, "approve_action", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    //  -  REJECT QUEUED ACTION  - 
    if (msgLower.startsWith("reject action ")) {
      const start = Date.now();
      try {
        const actionId = message.split(" ").pop()?.trim();
        const { data: queuedAction } = await supabase
          .from("nexus_action_queue")
          .select("*")
          .filter("id::text", "ilike", `${actionId}%`)
          .eq("status", "pending")
          .maybeSingle();

        if (!queuedAction) return earlyReturn(`No pending action found: ${actionId}`);

        await supabase.from("nexus_action_queue").update({ status: "rejected" }).eq("id", queuedAction.id);
        await logUsage(supabase, "reject_action", true, Date.now() - start, channel);
        return earlyReturn(` -  Rejected: *${queuedAction.action_summary}*`);
      } catch (err: any) {
        await logUsage(supabase, "reject_action", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    //  -  APPROVE ABILITY BUILD  - 
    if (msgLower.startsWith("approve ability")) {
      const start = Date.now();
      try {
        const parts = message.split(" ");
        const abilityId = parts[parts.length - 1]?.trim();

        const { data: proposals } = await supabase
          .from("nexus_ability_proposals")
          .select("*")
          .filter("id::text", "ilike", `${abilityId}%`)
          .in("status", ["proposed", "testing"])
          .limit(1);

        const proposal = proposals?.[0];
        if (!proposal) return earlyReturn(`No pending ability proposal found matching: ${abilityId}`);

        // Log decision to judgment log
        await supabase.from("nexus_judgment_log").insert({
          proposal_id: proposal.id,
          proposal_name: proposal.ability_name,
          proposal_type: "ability",
          decision: "approved",
          decision_reason: "Approved by Zach via chat",
        });

        if (proposal.status === "testing") {
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ proposal_id: proposal.id, action: "deploy" }),
          });
          await logUsage(supabase, "approve_ability_deploy", true, Date.now() - start, channel);
          return earlyReturn(` -  Deploying *${proposal.ability_name}* to production...`);
        } else {
          await supabase.from("nexus_ability_proposals")
            .update({ status: "approved", approved_at: new Date().toISOString() })
            .eq("id", proposal.id);

          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ proposal_id: proposal.id, action: "build" }),
          });

          await logUsage(supabase, "approve_ability_build", true, Date.now() - start, channel);
          return earlyReturn(` -  Building *${proposal.ability_name}*...\nI'll notify you when it's ready to test.`);
        }
      } catch (err: any) {
        await logUsage(supabase, "approve_ability", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    //  -  REJECT ABILITY  -
    if (msgLower.startsWith("reject ability")) {
      const start = Date.now();
      try {
        const parts = message.split(" ");
        const abilityId = parts[parts.length - 1]?.trim();

        // Fetch proposal first to get its name for the judgment log
        const { data: rejectProposals } = await supabase
          .from("nexus_ability_proposals")
          .select("id, ability_name, proposal_type")
          .filter("id::text", "ilike", `${abilityId}%`)
          .limit(1);

        const rejectProposal = rejectProposals?.[0];

        await supabase.from("nexus_ability_proposals")
          .update({ status: "rejected" })
          .filter("id::text", "ilike", `${abilityId}%`);

        // Log decision to judgment log
        if (rejectProposal) {
          await supabase.from("nexus_judgment_log").insert({
            proposal_id: rejectProposal.id,
            proposal_name: rejectProposal.ability_name,
            proposal_type: "ability",
            decision: "rejected",
            decision_reason: "Rejected by Zach via chat",
          });
        }

        await logUsage(supabase, "reject_ability", true, Date.now() - start, channel);
        return earlyReturn(` -  Ability rejected and removed from queue.`);
      } catch (err: any) {
        await logUsage(supabase, "reject_ability", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    //  -  PENDING ACTIONS  - 
    if (msgLower === "pending" || msgLower === "pending actions" || msgLower === "queue") {
      const start = Date.now();
      try {
        const [{ data: actions }, { data: abilities }] = await Promise.all([
          supabase.from("nexus_action_queue").select("*").eq("status", "pending")
            .order("priority", { ascending: false }).limit(10),
          supabase.from("nexus_ability_proposals").select("*").eq("status", "proposed")
            .order("created_at", { ascending: false }).limit(5),
        ]);

        let reply = "*Pending approvals:*\n\n";

        if (actions && actions.length > 0) {
          reply += `*Actions (${actions.length}):*\n`;
          reply += actions.map((a: any) =>
            ` -  [${a.id.slice(0, 8)}] P${a.priority}  -  ${a.action_summary}\n  Approve: \`approve action ${a.id.slice(0, 8)}\``
          ).join("\n") + "\n\n";
        }

        if (abilities && abilities.length > 0) {
          reply += `*New abilities to build (${abilities.length}):*\n`;
          reply += abilities.map((a: any) =>
            ` -  [${a.id.slice(0, 8)}] *${a.ability_name}*  -  ${a.description?.slice(0, 80)}\n  Build: \`approve ability ${a.id.slice(0, 8)}\``
          ).join("\n");
        }

        if ((!actions || actions.length === 0) && (!abilities || abilities.length === 0)) {
          reply = " -  No pending approvals. Nexus is fully caught up.";
        }

        await logUsage(supabase, "pending_actions", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "pending_actions", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    //  -  AUDIT LOG  - 
    if (msgLower === "audit" || msgLower === "audit log" || msgLower.startsWith("audit last")) {
      const start = Date.now();
      try {
        const limit = msgLower.includes("last")
          ? Math.min(parseInt(msgLower.split(" ").pop() || "10"), 20)
          : 10;

        const { data: logs } = await supabase
          .from("nexus_audit_log")
          .select("engine, action_type, action_detail, outcome, created_at")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (!logs || logs.length === 0) return earlyReturn("No audit log entries yet.");

        const reply = `*Nexus Audit Log (last ${logs.length}):*\n\n` +
          logs.map((l: any) => {
            const time = new Date(l.created_at).toLocaleTimeString("en-US", {
              timeZone: "America/Denver", hour: "2-digit", minute: "2-digit",
            });
            const emoji = l.outcome === "success" ? " - " : l.outcome === "failure" ? " - " : " - ";
            return `${emoji} [${time}] *${l.engine}*  -  ${l.action_detail.slice(0, 80)}`;
          }).join("\n");

        await logUsage(supabase, "audit_log", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "audit_log", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    //  -  RESEARCH NOW  - 
    if (msgLower === "research now" || msgLower === "nexus research") {
      const start = Date.now();
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({}),
      });
      await logUsage(supabase, "research_now", true, Date.now() - start, channel);
      return earlyReturn(" -  Research cycle started. I'll report back with findings in a few minutes.");
    }

    //  -  AGENT NOW  - 
    // ── NEXUS EXECUTE (natural language build)  - 
    if (msgLower.startsWith("build:") || msgLower.startsWith("nexus build:")) {
      const start = Date.now();
      const instruction = message.replace(/^nexus build:/i, "").replace(/^build:/i, "").trim();
      if (!instruction) {
        return earlyReturn("What should I build? Example: `build: a command that summarizes my week in plain English`");
      }
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ instruction, source: "telegram" }),
      });
      await logUsage(supabase, "nexus_build", true, Date.now() - start, channel);
      return earlyReturn(`Building: *${instruction}*\n\nCreating manifest and building... I'll notify you when it's ready for review.`);
    }

    if (msgLower.startsWith("deploy build ")) {
      const start = Date.now();
      const manifestId = message.trim().split(" ").pop()?.trim();
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ action: "deploy", manifest_id: manifestId }),
      });
      await logUsage(supabase, "deploy_build", true, Date.now() - start, channel);
      return earlyReturn(`Deploying build \`${manifestId?.slice(0, 8)}\`... Live in ~60 seconds.`);
    }

    if (msgLower.startsWith("discard build ")) {
      const start = Date.now();
      const manifestId = message.trim().split(" ").pop()?.trim();
      await supabase.from("nexus_build_manifests")
        .update({ status: "discarded" })
        .or(`id.eq.${manifestId},id.ilike.${manifestId}%`);
      await logUsage(supabase, "discard_build", true, Date.now() - start, channel);
      return earlyReturn(`Build \`${manifestId?.slice(0, 8)}\` discarded.`);
    }

    //  -  ROLLBACK DEPLOYED BUILD  -
    if (msgLower.startsWith("rollback build ") || msgLower.startsWith("rollback ")) {
      const start = Date.now();
      try {
        const parts = message.trim().split(" ");
        const manifestId = parts[parts.length - 1]?.trim();
        if (!manifestId || manifestId.length < 4) {
          return earlyReturn("Specify a build ID. Send `builds` to see recent builds.");
        }

        const { data: manifests } = await supabase
          .from("nexus_build_manifests")
          .select("id, goal, status, pre_deploy_shas")
          .filter("id::text", "ilike", `${manifestId}%`)
          .limit(1);

        const manifest = manifests?.[0];
        if (!manifest) return earlyReturn(`No build found matching: ${manifestId}`);
        if (manifest.status !== "deployed") {
          return earlyReturn(`Cannot rollback — build status is "${manifest.status}" (only deployed builds can be rolled back).`);
        }

        const preDeployShas = manifest.pre_deploy_shas || {};
        if (Object.keys(preDeployShas).length === 0) {
          return earlyReturn(`No pre-deploy snapshot for this build. Restore manually from git history.\nBuild: ${manifest.goal}`);
        }

        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ action: "rollback", manifest_id: manifest.id }),
        });

        await logUsage(supabase, "rollback_build", true, Date.now() - start, channel);
        return earlyReturn(`Rolling back *${manifest.goal}*...\nRestoring ${Object.keys(preDeployShas).length} file(s) to pre-deploy state.\nLive in ~60 seconds.`);
      } catch (err: any) {
        await logUsage(supabase, "rollback_build", false, Date.now() - start, channel);
        return earlyReturn(`Rollback failed: ${err.message}`);
      }
    }

    if (msgLower === "builds" || msgLower === "build status") {
      const start = Date.now();
      try {
        const { data: builds } = await supabase
          .from("nexus_build_manifests")
          .select("id, goal, status, tests_passed, tests_failed, created_at")
          .order("created_at", { ascending: false })
          .limit(5);

        if (!builds?.length) {
          await logUsage(supabase, "builds_status", true, Date.now() - start, channel);
          return earlyReturn("No builds yet. Send `build: [what to build]` to start.");
        }

        const reply = `*Recent builds:*\n\n` +
          builds.map((b: any) =>
            `*${(b.goal || "").slice(0, 60)}*\n` +
            `Status: ${b.status} | Tests: ${b.tests_passed || 0} passed, ${b.tests_failed || 0} failed\n` +
            (b.status === "staged" ? `Deploy: \`deploy build ${b.id.slice(0, 8)}\`` :
              b.status === "deployed" ? `Rollback: \`rollback build ${b.id.slice(0, 8)}\`` : "")
          ).join("\n\n");

        await logUsage(supabase, "builds_status", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "builds_status", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    if (msgLower === "improvements" || msgLower === "self improvements") {
      const start = Date.now();
      try {
        const { data: improvements } = await supabase
          .from("nexus_self_improvements")
          .select("id, title, problem, complexity, status, directive_priority")
          .in("status", ["proposed", "building", "live"])
          .order("directive_priority")
          .limit(10);

        if (!improvements?.length) {
          await logUsage(supabase, "self_improvements", true, Date.now() - start, channel);
          return earlyReturn("No improvements identified yet. Send `core now` to run a cycle.");
        }

        const reply = `*Self-improvements identified:*\n\n` +
          improvements.map((i: any) =>
            `*${i.title}* (${i.complexity}, directive ${i.directive_priority})\n` +
            `${(i.problem || "").slice(0, 80)}\n` +
            (i.status === "proposed" ? `Build: \`build: ${i.title}\`` : `Status: ${i.status}`)
          ).join("\n\n");

        await logUsage(supabase, "self_improvements", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "self_improvements", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    if (msgLower === "core now" || msgLower === "nexus core") {
      const start = Date.now();
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-core`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ source: "manual" }),
      });
      await logUsage(supabase, "core_now", true, Date.now() - start, channel);
      return earlyReturn("Nexus Core cycle triggered. Running observation, thinking, and action cycle...");
    }

    if (msgLower === "reflections" || msgLower === "what did you learn") {
      const start = Date.now();
      try {
        const { data: reflections } = await supabase
          .from("nexus_reflections")
          .select("observation, learned, created_at")
          .order("created_at", { ascending: false })
          .limit(5);

        if (!reflections?.length) {
          await logUsage(supabase, "reflections", true, Date.now() - start, channel);
          return earlyReturn("No reflections yet. Give it a few cycles.");
        }

        const reply = `*What Nexus has learned:*\n\n` +
          reflections.map((r: any) =>
            `*${new Date(r.created_at).toLocaleTimeString("en-US", { timeZone: "America/Denver" })} MT*\n${r.learned || r.observation}`
          ).join("\n\n");

        await logUsage(supabase, "reflections", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "reflections", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    if (msgLower === "agent now" || msgLower === "nexus agent" || msgLower === "run agent") {
      const start = Date.now();
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-core`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ source: "manual" }),
      });
      await logUsage(supabase, "agent_now", true, Date.now() - start, channel);
      return earlyReturn("Nexus Core cycle triggered. Observing, thinking, acting...");
    }

    //  -  ABILITIES  - 
    if (msgLower === "abilities" || msgLower === "my abilities" || msgLower === "show abilities") {
      const start = Date.now();
      try {
        const [{ data: liveAbilities }, { data: proposedAbilities }] = await Promise.all([
          supabase.from("nexus_ability_proposals").select("ability_name, trigger_command, usage_count, deployed_at")
            .eq("status", "live").order("usage_count", { ascending: false }),
          supabase.from("nexus_ability_proposals").select("ability_name, status")
            .in("status", ["proposed", "approved", "building", "testing"]),
        ]);

        let reply = "*Nexus Self-Built Abilities:*\n\n";

        if (liveAbilities && liveAbilities.length > 0) {
          reply += `*Live (${liveAbilities.length}):*\n`;
          reply += liveAbilities.map((a: any) =>
            ` -  *${a.ability_name}*  -  \`${a.trigger_command}\` (used ${a.usage_count}x)`
          ).join("\n") + "\n\n";
        }

        if (proposedAbilities && proposedAbilities.length > 0) {
          reply += `*In progress (${proposedAbilities.length}):*\n`;
          reply += proposedAbilities.map((a: any) =>
            `${a.status === "proposed" ? " - " : a.status === "building" ? " - " : " - "} *${a.ability_name}* (${a.status})`
          ).join("\n");
        }

        if ((!liveAbilities || liveAbilities.length === 0) && (!proposedAbilities || proposedAbilities.length === 0)) {
          reply = " -  No self-built abilities yet. Nexus is still identifying gaps. Check back after the first research cycle.";
        }

        await logUsage(supabase, "show_abilities", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "show_abilities", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }


    // ── ROOFING PIPELINE ─────────────────────────────────────────────────────────
    if (msgLower === 'roofing pipeline' || msgLower === 'roofing sales') {
      const start = Date.now();
      try {
        const { data: prospects } = await supabase
          .from('roofing_prospects')
          .select('status, lead_score, company_name')
          .order('lead_score', { ascending: false })
          .limit(50);

        const byStatus = prospects?.reduce((acc: Record<string, number>, p: {status: string}) => {
          acc[p.status] = (acc[p.status] || 0) + 1;
          return acc;
        }, {}) || {};

        const hot = prospects?.filter((p: {status: string}) => p.status === 'hot') || [];

        const reply = `*🏠 Roofing OS Pipeline*\n\n` +
          `*Status breakdown:*\n` +
          Object.entries(byStatus).map(([s, c]) => `• ${s}: ${c}`).join('\n') +
          (hot.length > 0 ? `\n\n*🔥 Hot leads:*\n${hot.slice(0, 5).map((p: {company_name: string}) => `• ${p.company_name}`).join('\n')}` : '') +
          `\n\n_Reply \`roofing prospect now\` to run prospector immediately._`;

        await logUsage(supabase, 'roofing_pipeline', true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, 'roofing_pipeline', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    // ── ROOFING PROSPECT NOW ──────────────────────────────────────────────────────
    if (msgLower === 'roofing prospect now' || msgLower === 'find roofers') {
      const start = Date.now();
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-prospector`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({})
      });
      await logUsage(supabase, 'roofing_prospect_now', true, Date.now() - start, channel);
      return earlyReturn('🔍 Prospector running — finding roofers now. I\'ll report back in a few minutes.');
    }

    // ── ROOFING OUTREACH NOW ──────────────────────────────────────────────────────
    if (msgLower === 'roofing outreach now' || msgLower === 'send roofing emails') {
      const start = Date.now();
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({})
      });
      await logUsage(supabase, 'roofing_outreach_now', true, Date.now() - start, channel);
      return earlyReturn('📧 Sending outreach emails now. Check back in a few minutes.');
    }

    // ── ROOFING IMPROVEMENTS ──────────────────────────────────────────────────────
    if (msgLower === 'roofing improvements' || msgLower === 'product improvements') {
      const start = Date.now();
      try {
        const { data: improvements } = await supabase
          .from('roofing_improvements')
          .select('id, title, category, priority, impact_estimate, status')
          .eq('status', 'proposed')
          .order('priority', { ascending: false })
          .limit(8);

        if (!improvements || improvements.length === 0) {
          await logUsage(supabase, 'roofing_improvements', true, Date.now() - start, channel);
          return earlyReturn('✅ No pending Roofing OS improvements. Product is healthy.');
        }

        const categoryEmoji: Record<string, string> = {
          bug_fix: '🐛', portal_ux: '🎨', contractor_dashboard: '📊',
          email_notifications: '📧', payments: '💳', onboarding: '🚀',
          new_feature: '✨', competitive_response: '⚔️'
        };

        const reply = `*🏠 Roofing OS Improvement Queue (${improvements.length}):*\n\n` +
          improvements.map((i: any) =>
            `${categoryEmoji[i.category] || '💡'} [${i.id.slice(0, 8)}] P${i.priority} — *${i.title}*\n` +
            `  Impact: ${i.impact_estimate} | Build: \`approve roofing improvement ${i.id.slice(0, 8)}\``
          ).join('\n\n');

        await logUsage(supabase, 'roofing_improvements', true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, 'roofing_improvements', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    // ── APPROVE ROOFING IMPROVEMENT ───────────────────────────────────────────────
    if (msgLower.startsWith('approve roofing improvement')) {
      const start = Date.now();
      try {
        const improvementId = message.split(' ').pop()?.trim();

        const { data: improvements } = await supabase
          .from('roofing_improvements')
          .select('*')
          .or(`id.eq.${improvementId},id.ilike.${improvementId}%`)
          .eq('status', 'proposed')
          .limit(1);

        const improvement = improvements?.[0];
        if (!improvement) {
          await logUsage(supabase, 'approve_roofing_improvement', false, Date.now() - start, channel);
          return earlyReturn(`No pending improvement found: ${improvementId}`);
        }

        await supabase.from('roofing_improvements')
          .update({ status: 'approved', approved_at: new Date().toISOString() })
          .eq('id', improvement.id);

        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            improvement_id: improvement.id,
            title: improvement.title,
            problem: improvement.problem,
            solution: improvement.proposed_solution,
            implementation_plan: improvement.implementation_plan,
            source: 'roofing_improvement'
          })
        });

        await logUsage(supabase, 'approve_roofing_improvement', true, Date.now() - start, channel);
        return earlyReturn(`🔨 Building: *${improvement.title}*\nI'll notify you when it's ready to test.`);
      } catch (err: any) {
        await logUsage(supabase, 'approve_roofing_improvement', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    // ── ROOFING HEALTH ────────────────────────────────────────────────────────────
    if (msgLower === 'roofing health' || msgLower === 'product health') {
      const start = Date.now();
      try {
        const { data: latest } = await supabase
          .from('roofing_health_snapshots')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (!latest) {
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-product-monitor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({})
          });
          await logUsage(supabase, 'roofing_health', true, Date.now() - start, channel);
          return earlyReturn('Running product health check now — check back in 30 seconds.');
        }

        const healthEmoji = latest.product_health_score >= 70 ? '🟢' : latest.product_health_score >= 40 ? '🟡' : '🔴';

        const reply = `*🏠 Roofing OS Health*\n\n` +
          `${healthEmoji} *Score: ${latest.product_health_score}/100*\n\n` +
          `*Product:*\n` +
          `• Contractors: ${latest.total_contractors} active, ${latest.onboarded_contractors} onboarded\n` +
          `• Jobs: ${latest.total_jobs} total, ${latest.jobs_with_portal_sent} with portal\n` +
          `• Messages: ${latest.total_homeowner_messages} homeowner messages\n` +
          `• Documents: ${latest.total_documents_generated} generated\n` +
          `• Errors (24h): ${latest.portal_errors_24h}\n\n` +
          `*Sales Pipeline:*\n` +
          `• Prospects: ${latest.total_prospects}\n` +
          `• Active outreach: ${latest.active_outreach}\n` +
          `• Hot leads: ${latest.hot_leads}\n` +
          `• Closed/won: ${latest.closed_won}`;

        await logUsage(supabase, 'roofing_health', true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, 'roofing_health', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    // ── COMPETITOR INTEL ──────────────────────────────────────────────────────────
    if (msgLower === 'competitor intel' || msgLower === 'competitors') {
      const start = Date.now();
      try {
        const { data: intel } = await supabase
          .from('competitor_intel')
          .select('competitor_name, feature_found, relevance, already_have_this, found_at')
          .eq('relevance', 'high')
          .eq('already_have_this', false)
          .order('found_at', { ascending: false })
          .limit(10);

        if (!intel || intel.length === 0) {
          await logUsage(supabase, 'competitor_intel', true, Date.now() - start, channel);
          return earlyReturn('No high-relevance competitor intel yet. Run `roofing health` to trigger a check.');
        }

        const reply = `*⚔️ Competitor Intel (high relevance, we don\'t have):*\n\n` +
          intel.map((i: any) =>
            `• *${i.competitor_name}*: ${i.feature_found.slice(0, 100)}`
          ).join('\n');

        await logUsage(supabase, 'competitor_intel', true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, 'competitor_intel', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    // ================================================================
    // NEXUS AUTONOMOUS OS COMMANDS
    // ================================================================

    if (msgLower === "nexus pipeline") {
      const start = Date.now();
      try {
        const { data: counts } = await supabase
          .from("nexus_diagnostics")
          .select("routing_model, nexus_score")
          .not("routing_model", "is", null);
        const byModel: Record<string, number[]> = {};
        for (const r of counts || []) {
          if (!byModel[r.routing_model]) byModel[r.routing_model] = [];
          byModel[r.routing_model].push(r.nexus_score || 0);
        }
        const lines = Object.entries(byModel).map(([model, scores]) => {
          const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
          return `• *${model}* — ${scores.length} leads, avg score ${avg}`;
        });
        await logUsage(supabase, 'nexus_pipeline', true, Date.now() - start, channel);
        return earlyReturn(`*📊 Nexus Pipeline*\n\n${lines.join('\n') || 'No routed diagnostics yet.'}\n\n_Reply \`nexus leads\` for recent list._`);
      } catch (err: any) {
        await logUsage(supabase, 'nexus_pipeline', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "nexus leads") {
      const start = Date.now();
      try {
        const { data: leads } = await supabase
          .from("nexus_diagnostics")
          .select("business_name, business_url, nexus_score, routing_model, created_at, slug")
          .order("created_at", { ascending: false })
          .limit(10);
        if (!leads || leads.length === 0) {
          await logUsage(supabase, 'nexus_leads', true, Date.now() - start, channel);
          return earlyReturn("No diagnostics run yet. Share nexuszc.com to get leads.");
        }
        const lines = leads.map((d: any) =>
          `• *${d.business_name || d.business_url}* — score ${d.nexus_score || '?'} | ${d.routing_model || 'unrouted'}`
        );
        await logUsage(supabase, 'nexus_leads', true, Date.now() - start, channel);
        return earlyReturn(`*🔬 Recent Nexus Leads*\n\n${lines.join('\n')}`);
      } catch (err: any) {
        await logUsage(supabase, 'nexus_leads', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("diagnose:")) {
      const start = Date.now();
      try {
        const url = message.slice(9).trim();
        if (!url) return earlyReturn("Format: `diagnose: https://example.com`");
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-quick-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ url, force: true })
        });
        const data = await res.json();
        await logUsage(supabase, 'diagnose', true, Date.now() - start, channel);
        if (data.skipped) return earlyReturn(`Skipped: ${data.reason}`);
        return earlyReturn(`🔬 Quick scan started for ${url}\nScore: ${data.score || '?'}/100\nFull diagnostic running in background — I'll alert you when complete.`);
      } catch (err: any) {
        await logUsage(supabase, 'diagnose', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("send report:")) {
      const start = Date.now();
      try {
        const slug = message.slice(12).trim();
        if (!slug) return earlyReturn("Format: `send report: [slug]`");
        const { data: diag } = await supabase
          .from("nexus_diagnostics")
          .select("business_name, slug, business_name, email")
          .eq("slug", slug)
          .maybeSingle();
        if (!diag) return earlyReturn(`No diagnostic found for slug: ${slug}`);
        const password = (diag.business_name || "nexus").replace(/[^a-zA-Z]/g, "").slice(0, 3).toLowerCase() || "nex";
        await logUsage(supabase, 'send_report', true, Date.now() - start, channel);
        return earlyReturn(`*📋 Report for ${diag.business_name}*\n\nURL: https://nexuszc.com/report/${slug}\nPassword: \`${password}000\`\n\nSend this to: ${diag.email || 'no email on file'}`);
      } catch (err: any) {
        await logUsage(supabase, 'send_report', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("call:")) {
      const start = Date.now();
      try {
        const target = message.slice(5).trim();
        if (!target) return earlyReturn("Format: `call: [business name or slug]`");
        const { data: diagnostics } = await supabase
          .from("nexus_diagnostics")
          .select("id, business_name, owner_phone, nexus_score")
          .or(`slug.ilike.%${target}%,business_name.ilike.%${target}%`)
          .not("owner_phone", "is", null)
          .limit(1);
        const diagnostic = diagnostics?.[0];
        if (!diagnostic) return earlyReturn(`No diagnostic with phone found for: ${target}`);
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-voice-engine`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ diagnostic_id: diagnostic.id })
        }).catch(() => {});
        await logUsage(supabase, 'voice_call_manual', true, Date.now() - start, channel);
        return earlyReturn(
          `📞 *Initiating call to ${diagnostic.business_name}*\n` +
          `Score: ${diagnostic.nexus_score}/100\n` +
          `Watch Telegram for the call outcome.`
        );
      } catch (err: any) {
        await logUsage(supabase, 'voice_call_manual', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "acquisition targets") {
      const start = Date.now();
      try {
        const { data: targets } = await supabase
          .from("nexus_acquisition_targets")
          .select("business_name, industry, acquisition_score, estimated_value_min, estimated_value_max, status")
          .order("acquisition_score", { ascending: false })
          .limit(10);
        if (!targets || targets.length === 0) {
          await logUsage(supabase, 'acquisition_targets', true, Date.now() - start, channel);
          return earlyReturn("No acquisition targets identified yet.");
        }
        const lines = targets.map((t: any) =>
          `• *${t.business_name}* (${t.industry}) — score ${t.acquisition_score} | $${(t.estimated_value_min / 1000).toFixed(0)}K–$${(t.estimated_value_max / 1000).toFixed(0)}K | ${t.status}`
        );
        await logUsage(supabase, 'acquisition_targets', true, Date.now() - start, channel);
        return earlyReturn(`*🎯 Acquisition Targets*\n\n${lines.join('\n')}`);
      } catch (err: any) {
        await logUsage(supabase, 'acquisition_targets', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "verticals") {
      const start = Date.now();
      try {
        const { data: proposals } = await supabase
          .from("nexus_vertical_proposals")
          .select("industry, status, diagnostic_count, evidence_count, created_at")
          .order("diagnostic_count", { ascending: false });
        if (!proposals || proposals.length === 0) {
          await logUsage(supabase, 'verticals', true, Date.now() - start, channel);
          return earlyReturn("No vertical proposals yet. Need 5+ diagnostics in the same industry to trigger detection.");
        }
        const lines = proposals.map((v: any) =>
          `• *${v.industry}* — ${v.diagnostic_count} diagnostics | ${v.status}${v.status === 'threshold_met' ? ' ← ready to approve' : ''}`
        );
        await logUsage(supabase, 'verticals', true, Date.now() - start, channel);
        return earlyReturn(`*🏗️ Vertical Proposals*\n\n${lines.join('\n')}\n\n_Reply \`approve vertical: [industry]\` to greenlight one._`);
      } catch (err: any) {
        await logUsage(supabase, 'verticals', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("approve vertical:")) {
      const start = Date.now();
      try {
        const industry = message.slice(17).trim();
        if (!industry) return earlyReturn("Format: `approve vertical: [industry]`");
        const { error } = await supabase
          .from("nexus_vertical_proposals")
          .update({ status: "approved", approved_at: new Date().toISOString() })
          .ilike("industry", `%${industry}%`);
        if (error) throw error;
        await logUsage(supabase, 'approve_vertical', true, Date.now() - start, channel);
        return earlyReturn(`✅ Vertical approved: *${industry}*\nNexus will begin building a dedicated OS for this vertical. I'll update you on progress.`);
      } catch (err: any) {
        await logUsage(supabase, 'approve_vertical', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "referral stats") {
      const start = Date.now();
      try {
        const { data: refs } = await supabase
          .from("nexus_referrals")
          .select("referrer_email, status, credit_amount_cents")
          .order("created_at", { ascending: false });
        const total = refs?.length || 0;
        const paid = refs?.filter((r: any) => r.status === "paid").reduce((sum: number, r: any) => sum + (r.credit_amount_cents || 0), 0) || 0;
        const pending = refs?.filter((r: any) => r.status === "pending").length || 0;
        await logUsage(supabase, 'referral_stats', true, Date.now() - start, channel);
        return earlyReturn(`*🔗 Referral Stats*\n\nTotal referrals: ${total}\nPending: ${pending}\nTotal paid out: $${(paid / 100).toFixed(2)}`);
      } catch (err: any) {
        await logUsage(supabase, 'referral_stats', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "nexus revenue") {
      const start = Date.now();
      try {
        const { data: diags } = await supabase
          .from("nexus_diagnostics")
          .select("routing_model, created_at");
        const total = diags?.length || 0;
        const enterprise = diags?.filter((d: any) => d.routing_model === "custom_enterprise").length || 0;
        const growth = diags?.filter((d: any) => d.routing_model === "custom_growth").length || 0;
        const starter = diags?.filter((d: any) => d.routing_model === "custom_starter").length || 0;
        const acq = diags?.filter((d: any) => d.routing_model === "acquisition").length || 0;
        const pipeline = enterprise * 5000 + growth * 2500 + starter * 1000 + acq * 500;
        await logUsage(supabase, 'nexus_revenue', true, Date.now() - start, channel);
        return earlyReturn(
          `*💰 Nexus Revenue Pipeline*\n\n` +
          `Total diagnostics: ${total}\n` +
          `Enterprise (${enterprise}) × $5K = $${(enterprise * 5000).toLocaleString()}\n` +
          `Growth (${growth}) × $2.5K = $${(growth * 2500).toLocaleString()}\n` +
          `Starter (${starter}) × $1K = $${(starter * 1000).toLocaleString()}\n` +
          `Acquisition (${acq}) × $500 = $${(acq * 500).toLocaleString()}\n\n` +
          `*Estimated pipeline: $${pipeline.toLocaleString()}*`
        );
      } catch (err: any) {
        await logUsage(supabase, 'nexus_revenue', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "diagnostic stats") {
      const start = Date.now();
      try {
        const { count: totalDiags } = await supabase
          .from("nexus_diagnostics").select("*", { count: "exact", head: true });
        const { data: scored } = await supabase
          .from("nexus_diagnostics").select("nexus_score").not("nexus_score", "is", null);
        const avgScore = scored?.length
          ? Math.round(scored.reduce((s: number, d: any) => s + (d.nexus_score || 0), 0) / scored.length)
          : 0;
        const { count: withReport } = await supabase
          .from("nexus_diagnostics").select("*", { count: "exact", head: true }).not("client_report", "is", null);
        await logUsage(supabase, 'diagnostic_stats', true, Date.now() - start, channel);
        return earlyReturn(
          `*🔬 Diagnostic Stats*\n\n` +
          `Total run: ${totalDiags || 0}\n` +
          `With full report: ${withReport || 0}\n` +
          `Avg Nexus Score: ${avgScore}/100`
        );
      } catch (err: any) {
        await logUsage(supabase, 'diagnostic_stats', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("unsubscribe:")) {
      const start = Date.now();
      try {
        const email = message.slice(12).trim();
        if (!email) return earlyReturn("Format: `unsubscribe: email@example.com`");
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nexus-unsubscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({ email, channel: "all" })
        });
        await logUsage(supabase, 'unsubscribe', true, Date.now() - start, channel);
        return earlyReturn(`✅ Unsubscribed ${email} from all Nexus communications.`);
      } catch (err: any) {
        await logUsage(supabase, 'unsubscribe', false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    // ================================================================
    // VOICE ENGINE COMMANDS
    // ================================================================

    if (msgLower === "voice stats" || msgLower === "voice metrics") {
      const start = Date.now();
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: calls } = await supabase
          .from("voice_calls")
          .select("outcome, answered, revenue_generated")
          .gt("created_at", sevenDaysAgo);
        if (!calls?.length) {
          await logUsage(supabase, "voice_stats", true, Date.now() - start, channel);
          return earlyReturn("No calls made in the last 7 days.");
        }
        const answered = calls.filter((c: any) => c.answered).length;
        const booked = calls.filter((c: any) => c.outcome === "booked").length;
        const paid = calls.filter((c: any) => c.outcome === "paid").length;
        const revenue = calls.reduce((s: number, c: any) => s + (c.revenue_generated || 0), 0);
        await logUsage(supabase, "voice_stats", true, Date.now() - start, channel);
        return earlyReturn(
          `📞 *Voice Stats — Last 7 Days*\n\n` +
          `Calls made: ${calls.length}\n` +
          `Answered: ${answered} (${Math.round(answered / calls.length * 100)}%)\n` +
          `Booked: ${booked}\nPaid: ${paid}\n` +
          `Revenue: $${revenue.toLocaleString()}`
        );
      } catch (err: any) {
        await logUsage(supabase, "voice_stats", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "voice calls today" || msgLower === "calls today") {
      const start = Date.now();
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { data: calls } = await supabase
          .from("voice_calls")
          .select("business_name, outcome, duration_seconds, created_at")
          .gt("created_at", today.toISOString())
          .order("created_at", { ascending: false });
        if (!calls?.length) {
          await logUsage(supabase, "voice_calls_today", true, Date.now() - start, channel);
          return earlyReturn("No calls made today yet.");
        }
        const list = calls.map((c: any) =>
          `• ${c.business_name}: ${c.outcome || "in progress"} (${c.duration_seconds || 0}s)`
        ).join("\n");
        await logUsage(supabase, "voice_calls_today", true, Date.now() - start, channel);
        return earlyReturn(`📞 *Calls Today (${calls.length}):*\n\n${list}`);
      } catch (err: any) {
        await logUsage(supabase, "voice_calls_today", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "voice pause") {
      const start = Date.now();
      try {
        await supabase.from("nexus_preferences").upsert({ key: "voice_paused", value: "true" });
        await logUsage(supabase, "voice_pause", true, Date.now() - start, channel);
        return earlyReturn("⏸ Voice calls paused. Send `voice resume` to restart.");
      } catch (err: any) {
        await logUsage(supabase, "voice_pause", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "voice resume") {
      const start = Date.now();
      try {
        await supabase.from("nexus_preferences").upsert({ key: "voice_paused", value: "false" });
        await logUsage(supabase, "voice_resume", true, Date.now() - start, channel);
        return earlyReturn("▶️ Voice calls resumed.");
      } catch (err: any) {
        await logUsage(supabase, "voice_resume", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "voice scripts") {
      const start = Date.now();
      try {
        const { data: scripts } = await supabase
          .from("voice_scripts")
          .select("name, module_type, conversion_rate, times_used, status, is_champion")
          .eq("status", "active")
          .order("conversion_rate", { ascending: false });
        if (!scripts?.length) {
          await logUsage(supabase, "voice_scripts", true, Date.now() - start, channel);
          return earlyReturn("No active scripts found.");
        }
        const list = scripts.map((s: any) =>
          `${s.is_champion ? "👑" : "•"} *${s.name}* (${s.module_type})\n` +
          `  ${Math.round((s.conversion_rate || 0) * 100)}% conversion | ${s.times_used} uses`
        ).join("\n\n");
        await logUsage(supabase, "voice_scripts", true, Date.now() - start, channel);
        return earlyReturn(`📋 *Active Voice Scripts:*\n\n${list}`);
      } catch (err: any) {
        await logUsage(supabase, "voice_scripts", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "voice learning") {
      const start = Date.now();
      try {
        const { data: report } = await supabase
          .from("voice_learning")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!report) {
          await logUsage(supabase, "voice_learning", true, Date.now() - start, channel);
          return earlyReturn("No learning report yet. Run more calls first.");
        }
        await logUsage(supabase, "voice_learning", true, Date.now() - start, channel);
        return earlyReturn(
          `📊 *Latest Voice Learning Report*\n\n` +
          `Week of: ${report.week_start}\n` +
          `Calls: ${report.calls_made} | Answer rate: ${Math.round((report.answer_rate || 0) * 100)}%\n` +
          `Revenue: $${(report.revenue_generated || 0).toLocaleString()}\n` +
          `Best opener: ${report.best_opener || "none yet"}\n` +
          `Best time: ${report.best_call_time || "unknown"}`
        );
      } catch (err: any) {
        await logUsage(supabase, "voice_learning", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("brief:")) {
      const start = Date.now();
      try {
        const target = message.slice(6).trim();
        if (!target) return earlyReturn("Format: `brief: [business name or slug]`");
        const { data: diagnostics } = await supabase
          .from("nexus_diagnostics")
          .select("*")
          .or(`slug.ilike.%${target}%,business_name.ilike.%${target}%`)
          .limit(1);
        const diagnostic = diagnostics?.[0];
        if (!diagnostic) return earlyReturn(`No diagnostic found for: ${target}`);
        const internal = (diagnostic.internal_report || {}) as Record<string, unknown>;
        const concerns = (internal.call_prep_top_3_concerns as unknown[]) || [];
        const reply =
          `🎯 *Call Brief — ${diagnostic.business_name}*\n\n` +
          `Score: ${diagnostic.nexus_score}/100\n` +
          `Leakage: $${(diagnostic.estimated_revenue_leakage || 0).toLocaleString()}/year\n` +
          `Package: ${diagnostic.recommended_model || "TBD"}\n\n` +
          `*Open with:*\n${(internal.opening_line as string) || "Reference their score and top gap"}\n\n` +
          `*Top concern:* ${concerns[0] ? JSON.stringify(concerns[0]).slice(0, 200) : "See full report"}\n\n` +
          `[Full report: app.nexuszc.com/diagnostic/${diagnostic.slug}]`;
        await logUsage(supabase, "voice_brief", true, Date.now() - start, channel);
        return earlyReturn(reply);
      } catch (err: any) {
        await logUsage(supabase, "voice_brief", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    // ================================================================
    // HOMEOWNER PORTAL COMMANDS
    // ================================================================

    if (msgLower.startsWith("portal:") || msgLower.startsWith("portal ")) {
      const sub = msgLower.replace(/^portal:?\s*/, "").trim();

      // portal stats
      if (sub === "stats" || sub === "analytics") {
        const start = Date.now();
        try {
          const { data: sessions } = await supabase.from("homeowner_sessions").select("last_accessed_at, access_count, homeowner_name, job_id");
          const { data: messages } = await supabase.from("portal_messages").select("sender_type, created_at").eq("sender_type", "homeowner");
          const { data: sigs } = await supabase.from("portal_documents").select("status").eq("status", "signed");
          const { data: refs } = await supabase.from("portal_referrals").select("status");
          const active = (sessions || []).filter((s: any) => s.last_accessed_at && new Date(s.last_accessed_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length;
          const totalAccess = (sessions || []).reduce((s: number, p: any) => s + (p.access_count || 0), 0);
          await logUsage(supabase, "portal_stats", true, Date.now() - start, channel);
          return earlyReturn(
            `🏠 *Portal Stats*\n\n` +
            `Active portals: ${(sessions || []).length}\n` +
            `Active last 7d: ${active}\n` +
            `Total views: ${totalAccess}\n` +
            `Homeowner messages: ${(messages || []).length}\n` +
            `Documents signed: ${(sigs || []).length}\n` +
            `Referrals submitted: ${(refs || []).length}`
          );
        } catch (err: any) {
          await logUsage(supabase, "portal_stats", false, Date.now() - start, channel);
          return earlyReturn(` -  Failed: ${err.message}`);
        }
      }

      // portal activity: [job_id] [activity_type]
      if (sub.startsWith("activity:")) {
        const start = Date.now();
        try {
          const parts = sub.replace("activity:", "").trim().split(" ");
          const activityType = parts.pop() || "";
          const jobSearch = parts.join(" ").trim();
          if (!activityType || !jobSearch) {
            return earlyReturn("Format: `portal activity: [job id or homeowner name] [activity_type]`\n\nActivity types: `contract_signed` `materials_ordered` `permit_approved` `installation_started` `installation_complete` `supplement_submitted` `project_complete`");
          }
          const { data: jobs } = await supabase.from("roofing_jobs").select("id, homeowner_name, property_address").or(`id.eq.${jobSearch},homeowner_name.ilike.%${jobSearch}%,property_address.ilike.%${jobSearch}%`).limit(1);
          const job = jobs?.[0];
          if (!job) return earlyReturn(`No job found for: ${jobSearch}`);
          const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/portal-activity-generator`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: job.id, activity_type: activityType })
          });
          const result = await res.json();
          if (!result.ok) return earlyReturn(` -  Activity failed: ${result.error}`);
          await logUsage(supabase, "portal_activity", true, Date.now() - start, channel);
          return earlyReturn(`✅ Activity \`${activityType}\` sent to ${job.homeowner_name}'s portal. Notification dispatched.`);
        } catch (err: any) {
          await logUsage(supabase, "portal_activity", false, Date.now() - start, channel);
          return earlyReturn(` -  Failed: ${err.message}`);
        }
      }

      // portal view: [token]
      if (sub.startsWith("view:")) {
        const start = Date.now();
        try {
          const tok = sub.replace("view:", "").trim();
          const { data: session } = await supabase.from("homeowner_sessions").select("*, roofing_jobs(homeowner_name,property_address,status)").eq("magic_link_token", tok).maybeSingle();
          if (!session) return earlyReturn("No portal found for that token.");
          const job = (session.roofing_jobs as any);
          const { data: activities } = await supabase.from("portal_activities").select("title,created_at").eq("job_id", session.job_id).order("created_at", { ascending: false }).limit(3);
          await logUsage(supabase, "portal_view", true, Date.now() - start, channel);
          return earlyReturn(
            `🏠 *Portal: ${job?.homeowner_name || "Unknown"}*\n` +
            `Address: ${job?.property_address || "Unknown"}\n` +
            `Status: ${job?.status || "unknown"}\n` +
            `Last viewed: ${session.last_accessed_at ? new Date(session.last_accessed_at).toLocaleString() : "Never"}\n` +
            `Total views: ${session.access_count || 0}\n` +
            `Language: ${session.preferred_language || "en"}\n\n` +
            `*Recent activity:*\n${(activities || []).map((a: any) => `• ${a.title}`).join("\n") || "None yet"}\n\n` +
            `Portal: https://roofingos.dev/portal/${tok}`
          );
        } catch (err: any) {
          await logUsage(supabase, "portal_view", false, Date.now() - start, channel);
          return earlyReturn(` -  Failed: ${err.message}`);
        }
      }

      // portal: [job_id or homeowner name] — send/get portal link
      {
        const start = Date.now();
        try {
          const { data: jobs } = await supabase.from("roofing_jobs").select("id, homeowner_name, homeowner_email, homeowner_phone, property_address").or(`id.eq.${sub},homeowner_name.ilike.%${sub}%,property_address.ilike.%${sub}%`).limit(1);
          const job = jobs?.[0];
          if (!job) return earlyReturn(`No job found for: ${sub}\n\nFormat: \`portal: [homeowner name or job ID]\``);
          const { data: existing } = await supabase.from("homeowner_sessions").select("magic_link_token, last_accessed_at, access_count").eq("job_id", job.id).maybeSingle();
          if (existing) {
            await logUsage(supabase, "portal_link", true, Date.now() - start, channel);
            return earlyReturn(
              `🔗 *Portal exists for ${job.homeowner_name}*\n\n` +
              `https://roofingos.dev/portal/${existing.magic_link_token}\n\n` +
              `Last accessed: ${existing.last_accessed_at ? new Date(existing.last_accessed_at).toLocaleString() : "Never"}\n` +
              `Views: ${existing.access_count || 0}`
            );
          }
          const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/portal-magic-link`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: job.id, homeowner_email: job.homeowner_email, homeowner_name: job.homeowner_name, homeowner_phone: job.homeowner_phone, contractor_name: "Roofing OS" })
          });
          const result = await res.json();
          if (!result.ok) return earlyReturn(` -  Portal creation failed: ${result.error}`);
          await logUsage(supabase, "portal_create", true, Date.now() - start, channel);
          return earlyReturn(
            `✅ *Portal created for ${job.homeowner_name}*\n\n` +
            `https://roofingos.dev/portal/${result.token}\n\n` +
            `Link sent via SMS${job.homeowner_phone ? ` to ${job.homeowner_phone}` : " (no phone on file)"} and email.`
          );
        } catch (err: any) {
          await logUsage(supabase, "portal_create", false, Date.now() - start, channel);
          return earlyReturn(` -  Failed: ${err.message}`);
        }
      }
    }

    // ================================================================
    // ROOFING ARIA COMMANDS
    // ================================================================

    if (msgLower.startsWith("aria storm:")) {
      const start = Date.now();
      try {
        const parts = message.slice(11).trim().split(" ");
        const hailSize = parseFloat(parts.pop() || "1.5") || 1.5;
        const zipCodes = parts.filter(p => /^\d{5}$/.test(p));
        if (!zipCodes.length) return earlyReturn("Format: `aria storm: [zip codes] [hail size in inches]`\nExample: `aria storm: 80202 80204 1.75`");
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-aria-storm-trigger`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ zip_codes: zipCodes, hail_size: hailSize, storm_date: new Date().toISOString() })
        });
        const result = await res.json();
        await logUsage(supabase, "aria_storm", true, Date.now() - start, channel);
        return earlyReturn(`⛈️ Storm alert fired!\nZip codes: ${zipCodes.join(", ")}\nHail size: ${hailSize}"\nCalls queued: ${result.calls_queued || 0} of ${result.total_found || 0} previous customers`);
      } catch (err: any) {
        await logUsage(supabase, "aria_storm", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("aria call:")) {
      const start = Date.now();
      try {
        const parts = message.slice(10).trim().split(" ");
        const callType = parts.pop() || "lead_followup";
        const phone = parts[0];
        if (!phone) return earlyReturn("Format: `aria call: [phone] [call_type]`\nCall types: `storm_alert` `lead_followup` `review_request` `adjuster`");
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-aria-engine`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ call_type: callType, contact_phone: phone, contact_type: "unknown", metadata: { contractor_name: "Roofing OS" } })
        });
        const result = await res.json();
        await logUsage(supabase, "aria_call", true, Date.now() - start, channel);
        if (!result.ok) return earlyReturn(` -  Call blocked: ${result.reason || result.error}`);
        return earlyReturn(`📞 Aria call initiated\nPhone: ${phone}\nType: ${callType}\nCall ID: ${result.call_id}`);
      } catch (err: any) {
        await logUsage(supabase, "aria_call", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "aria stats" || msgLower === "roofing aria stats") {
      const start = Date.now();
      try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: calls } = await supabase.from("roofing_aria_calls").select("call_type, outcome, answered, revenue_generated").gt("created_at", sevenDaysAgo);
        if (!calls?.length) {
          await logUsage(supabase, "aria_stats", true, Date.now() - start, channel);
          return earlyReturn("No Roofing Aria calls in the last 7 days.");
        }
        const answered = calls.filter((c: any) => c.answered).length;
        const booked = calls.filter((c: any) => c.outcome === "appointment_booked").length;
        const byType: Record<string, number> = {};
        for (const c of calls) byType[c.call_type] = (byType[c.call_type] || 0) + 1;
        const typeBreakdown = Object.entries(byType).map(([t, n]) => `  ${t}: ${n}`).join("\n");
        await logUsage(supabase, "aria_stats", true, Date.now() - start, channel);
        return earlyReturn(
          `📞 *Roofing Aria — Last 7 Days*\n\n` +
          `Total calls: ${calls.length}\nAnswered: ${answered} (${Math.round(answered / calls.length * 100)}%)\nAppointments booked: ${booked}\n\n*By type:*\n${typeBreakdown}`
        );
      } catch (err: any) {
        await logUsage(supabase, "aria_stats", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "aria calls today") {
      const start = Date.now();
      try {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const { data: calls } = await supabase.from("roofing_aria_calls").select("contact_name, contact_phone, call_type, outcome, duration_seconds, created_at").gt("created_at", today.toISOString()).order("created_at", { ascending: false });
        if (!calls?.length) {
          await logUsage(supabase, "aria_calls_today", true, Date.now() - start, channel);
          return earlyReturn("No Roofing Aria calls today yet.");
        }
        const list = calls.map((c: any) => `• ${c.contact_name || c.contact_phone} (${c.call_type}): ${c.outcome || "in progress"}`).join("\n");
        await logUsage(supabase, "aria_calls_today", true, Date.now() - start, channel);
        return earlyReturn(`📞 *Roofing Aria Calls Today (${calls.length}):*\n\n${list}`);
      } catch (err: any) {
        await logUsage(supabase, "aria_calls_today", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "aria learning") {
      const start = Date.now();
      try {
        const { data: reports } = await supabase.from("roofing_aria_learning").select("*").order("created_at", { ascending: false }).limit(5);
        if (!reports?.length) {
          await logUsage(supabase, "aria_learning", true, Date.now() - start, channel);
          return earlyReturn("No Roofing Aria learning reports yet. Runs weekly.");
        }
        const latest = reports[0];
        const list = reports.map((r: any) => `• *${r.call_type}*: ${r.calls_made} calls, ${Math.round((r.conversion_rate || 0) * 100)}% conversion`).join("\n");
        await logUsage(supabase, "aria_learning", true, Date.now() - start, channel);
        return earlyReturn(`📊 *Roofing Aria Learning*\nWeek of ${latest.week_start}\n\n${list}`);
      } catch (err: any) {
        await logUsage(supabase, "aria_learning", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "aria pause") {
      const start = Date.now();
      try {
        await supabase.from("nexus_preferences").upsert({ key: "roofing_aria_paused", value: "true" });
        await logUsage(supabase, "aria_pause", true, Date.now() - start, channel);
        return earlyReturn("⏸ Roofing Aria calls paused. Send `aria resume` to restart.");
      } catch (err: any) {
        await logUsage(supabase, "aria_pause", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "aria resume") {
      const start = Date.now();
      try {
        await supabase.from("nexus_preferences").upsert({ key: "roofing_aria_paused", value: "false" });
        await logUsage(supabase, "aria_resume", true, Date.now() - start, channel);
        return earlyReturn("▶️ Roofing Aria calls resumed.");
      } catch (err: any) {
        await logUsage(supabase, "aria_resume", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    if (msgLower === "aria scripts") {
      const start = Date.now();
      try {
        const { data: scripts } = await supabase.from("roofing_aria_scripts").select("name, call_type, language, conversion_rate, times_used, is_champion, status").eq("status", "active").order("conversion_rate", { ascending: false });
        if (!scripts?.length) {
          await logUsage(supabase, "aria_scripts", true, Date.now() - start, channel);
          return earlyReturn("No active Roofing Aria scripts found.");
        }
        const list = scripts.map((s: any) =>
          `${s.is_champion ? "👑" : "•"} *${s.name}* [${s.call_type}/${s.language}]\n  ${Math.round((s.conversion_rate || 0) * 100)}% conversion | ${s.times_used} uses`
        ).join("\n\n");
        await logUsage(supabase, "aria_scripts", true, Date.now() - start, channel);
        return earlyReturn(`📋 *Roofing Aria Scripts:*\n\n${list}`);
      } catch (err: any) {
        await logUsage(supabase, "aria_scripts", false, Date.now() - start, channel);
        return earlyReturn(` -  Failed: ${err.message}`);
      }
    }

    // ================================================================
    // ROOFING SUPPLEMENT COMMANDS
    // ================================================================

    if (msgLower.startsWith("supplement:")) {
      const start = Date.now();
      try {
        const jobRef = msg.slice("supplement:".length).trim();
        if (!jobRef) return earlyReturn("Format: `supplement: [job address or ID]`");
        // Look up job by address or id
        const isUuid = /^[0-9a-f-]{36}$/i.test(jobRef);
        const { data: jobs } = isUuid
          ? await supabase.from("roofing_jobs").select("id, property_address, status").eq("id", jobRef)
          : await supabase.from("roofing_jobs").select("id, property_address, status").ilike("property_address", `%${jobRef}%`).limit(1);
        const job = jobs?.[0];
        if (!job) {
          await logUsage(supabase, "supplement_generate", false, Date.now() - start, channel);
          return earlyReturn(`No job found matching "${jobRef}"`);
        }
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-supplement-generator`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: job.id })
        });
        const data = await res.json();
        await logUsage(supabase, "supplement_generate", true, Date.now() - start, channel);
        return earlyReturn(
          `📋 *Supplement Package Generating*\n` +
          `Job: ${job.property_address}\n` +
          (data.ok ? `Package ID: \`${(data.package_id || "").slice(0, 8)}\`\nItems found: ${data.line_items}\nRequested: $${(data.total_requested || 0).toLocaleString()}\nStatus: VA review` : `Error: ${data.error || "Failed"}`)
        );
      } catch (err: any) {
        await logUsage(supabase, "supplement_generate", false, Date.now() - start, channel);
        return earlyReturn(`Supplement generation failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("review supplement:")) {
      const start = Date.now();
      try {
        const pkgRef = msg.slice("review supplement:".length).trim();
        const { data: pkgs } = await supabase
          .from("supplement_packages")
          .select("id, carrier_name, status, supplement_requested_amount, line_items, adjuster_name, claim_number, created_at")
          .or(`id.eq.${pkgRef},id.ilike.${pkgRef}%`)
          .limit(1);
        const pkg = pkgs?.[0];
        if (!pkg) {
          await logUsage(supabase, "review_supplement", false, Date.now() - start, channel);
          return earlyReturn(`No supplement package found with ID starting with "${pkgRef}"`);
        }
        const lineItems = (pkg.line_items as any[]) || [];
        const topItems = lineItems.slice(0, 8).map((i: any) =>
          `• *${i.xactimate_code || ""}* ${i.description}: $${(i.total || 0).toLocaleString()} (${i.category})`
        ).join("\n");
        await logUsage(supabase, "review_supplement", true, Date.now() - start, channel);
        return earlyReturn(
          `📋 *Supplement Package Review*\n` +
          `ID: \`${pkg.id.slice(0, 8)}\`\n` +
          `Carrier: ${pkg.carrier_name}\n` +
          `Claim: ${pkg.claim_number || "TBD"}\n` +
          `Adjuster: ${pkg.adjuster_name || "TBD"}\n` +
          `Status: ${pkg.status}\n` +
          `Requested: $${((pkg.supplement_requested_amount || 0) / 100).toLocaleString()}\n` +
          `Items: ${lineItems.length}\n\n` +
          `*Top line items:*\n${topItems || "None"}\n\n` +
          `Reply \`approve supplement: ${pkg.id.slice(0, 8)}\` to mark ready for submission.`
        );
      } catch (err: any) {
        await logUsage(supabase, "review_supplement", false, Date.now() - start, channel);
        return earlyReturn(`Review failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("approve supplement:")) {
      const start = Date.now();
      try {
        const pkgRef = msg.slice("approve supplement:".length).trim();
        const { data: pkgs } = await supabase.from("supplement_packages").select("id, carrier_name, supplement_requested_amount").or(`id.eq.${pkgRef},id.ilike.${pkgRef}%`).limit(1);
        const pkg = pkgs?.[0];
        if (!pkg) {
          await logUsage(supabase, "approve_supplement", false, Date.now() - start, channel);
          return earlyReturn(`No package found with ID starting with "${pkgRef}"`);
        }
        await supabase.from("supplement_packages").update({ status: "submitted", submitted_to_adjuster_at: new Date().toISOString(), va_reviewed_at: new Date().toISOString() }).eq("id", pkg.id);
        await logUsage(supabase, "approve_supplement", true, Date.now() - start, channel);
        return earlyReturn(
          `✅ *Supplement Approved*\n` +
          `Package \`${pkg.id.slice(0, 8)}\` marked as submitted.\n` +
          `Carrier: ${pkg.carrier_name}\n` +
          `Amount: $${((pkg.supplement_requested_amount || 0) / 100).toLocaleString()}\n` +
          `Status: Submitted — awaiting adjuster response.`
        );
      } catch (err: any) {
        await logUsage(supabase, "approve_supplement", false, Date.now() - start, channel);
        return earlyReturn(`Approve failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("rebuttal:")) {
      const start = Date.now();
      try {
        const parts = msg.slice("rebuttal:".length).trim().split(/\s+/);
        const pkgRef = parts[0];
        const deniedItem = parts.slice(1).join(" ");
        if (!pkgRef || !deniedItem) return earlyReturn("Format: `rebuttal: [package-id] [denied line item]`\nExample: `rebuttal: abc123 overhead and profit`");
        const { data: pkgs } = await supabase.from("supplement_packages").select("id, carrier_name").or(`id.eq.${pkgRef},id.ilike.${pkgRef}%`).limit(1);
        const pkg = pkgs?.[0];
        if (!pkg) {
          await logUsage(supabase, "rebuttal_generate", false, Date.now() - start, channel);
          return earlyReturn(`No package found with ID starting with "${pkgRef}"`);
        }
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-supplement-rebuttal`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ supplement_package_id: pkg.id, denied_items: [{ line_item: deniedItem, reason: "Carrier denial", amount: 0 }] })
        });
        const data = await res.json();
        await logUsage(supabase, "rebuttal_generate", true, Date.now() - start, channel);
        return earlyReturn(data.ok ? `⚖️ Rebuttal generated for "${deniedItem}" — ${data.rebuttals_generated} document(s) ready for VA review.` : `Rebuttal failed: ${data.error}`);
      } catch (err: any) {
        await logUsage(supabase, "rebuttal_generate", false, Date.now() - start, channel);
        return earlyReturn(`Rebuttal failed: ${err.message}`);
      }
    }

    if (msgLower === "supplement stats") {
      const start = Date.now();
      try {
        const [{ data: all }, { data: byCarrier }, { data: released }] = await Promise.all([
          supabase.from("supplement_packages").select("status, supplement_requested_amount, supplement_approved_amount"),
          supabase.from("supplement_packages").select("carrier_name, status, supplement_approved_amount").order("carrier_name"),
          supabase.from("depreciation_tracking").select("total_depreciation_held, depreciation_released, status")
        ]);
        const total = all?.length || 0;
        const approved = all?.filter(p => ["approved","partial_approved"].includes(p.status)).length || 0;
        const totalRequested = (all || []).reduce((s, p) => s + (p.supplement_requested_amount || 0), 0);
        const totalApproved = (all || []).reduce((s, p) => s + (p.supplement_approved_amount || 0), 0);
        const totalDepr = (released || []).reduce((s, p) => s + (p.total_depreciation_held || 0), 0);
        const releasedDepr = (released || []).reduce((s, p) => s + (p.depreciation_released || 0), 0);
        // Carrier breakdown
        const carrierMap: Record<string, {total:number;approved:number}> = {};
        for (const p of byCarrier || []) {
          if (!carrierMap[p.carrier_name]) carrierMap[p.carrier_name] = {total:0,approved:0};
          carrierMap[p.carrier_name].total++;
          if (["approved","partial_approved"].includes(p.status)) carrierMap[p.carrier_name].approved++;
        }
        const carrierLines = Object.entries(carrierMap).map(([name, s]) =>
          `  ${name}: ${s.approved}/${s.total} (${s.total > 0 ? Math.round(s.approved/s.total*100) : 0}%)`
        ).join("\n");
        await logUsage(supabase, "supplement_stats", true, Date.now() - start, channel);
        return earlyReturn(
          `📊 *Supplement Stats*\n\n` +
          `Total packages: ${total}\n` +
          `Approval rate: ${total > 0 ? Math.round(approved/total*100) : 0}%\n` +
          `Requested: $${(totalRequested/100).toLocaleString()}\n` +
          `Approved: $${(totalApproved/100).toLocaleString()}\n\n` +
          `*By Carrier:*\n${carrierLines || "None yet"}\n\n` +
          `*Depreciation:*\n` +
          `Held: $${(totalDepr/100).toLocaleString()}\n` +
          `Released: $${(releasedDepr/100).toLocaleString()}`
        );
      } catch (err: any) {
        await logUsage(supabase, "supplement_stats", false, Date.now() - start, channel);
        return earlyReturn(`Stats failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("carrier intel:")) {
      const start = Date.now();
      try {
        const carrierInput = msg.slice("carrier intel:".length).trim().toLowerCase();
        const { data: carriers } = await supabase.from("carrier_intelligence").select("*").ilike("carrier_name", `%${carrierInput}%`).limit(1);
        const carrier = carriers?.[0];
        if (!carrier) {
          await logUsage(supabase, "carrier_intel", false, Date.now() - start, channel);
          return earlyReturn(`No carrier found matching "${carrierInput}"`);
        }
        const tips = (carrier.tips as string[] || []).slice(0, 5).map((t: string) => `• ${t}`).join("\n");
        const denials = (carrier.common_denials as string[] || []).join(", ");
        const easy = (carrier.easy_approvals as string[] || []).join(", ");
        await logUsage(supabase, "carrier_intel", true, Date.now() - start, channel);
        return earlyReturn(
          `🏢 *${carrier.carrier_name} Intelligence*\n\n` +
          `Approval rate: ${Math.round((carrier.supplement_approval_rate || 0) * 100)}%\n` +
          `O&P rate: ${Math.round((carrier.op_approval_rate || 0) * 100)}%\n` +
          `Avg approval time: ${carrier.typical_approval_time_days} days\n\n` +
          `✅ Easy approvals: ${easy || "N/A"}\n` +
          `❌ Common denials: ${denials || "N/A"}\n\n` +
          `*Tips:*\n${tips || "No tips recorded yet"}`
        );
      } catch (err: any) {
        await logUsage(supabase, "carrier_intel", false, Date.now() - start, channel);
        return earlyReturn(`Carrier intel failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("codes:")) {
      const start = Date.now();
      try {
        const zipOrState = msg.slice("codes:".length).trim() || "CO";
        const { data: codes } = await supabase
          .from("roofing_codes")
          .select("code_type, code_section, requirement, xactimate_line_item")
          .or(`state.eq.CO,zip_code.eq.${zipOrState}`)
          .order("code_type");
        if (!codes?.length) {
          await logUsage(supabase, "codes_lookup", false, Date.now() - start, channel);
          return earlyReturn(`No codes found for "${zipOrState}"`);
        }
        const codeLines = codes.map(c =>
          `• *${c.code_type}* (${c.xactimate_line_item || ""})\n  ${c.requirement.slice(0, 100)}\n  _${c.code_section}_`
        ).join("\n\n");
        await logUsage(supabase, "codes_lookup", true, Date.now() - start, channel);
        return earlyReturn(`🏗️ *Building Codes — Colorado*\n\n${codeLines}`);
      } catch (err: any) {
        await logUsage(supabase, "codes_lookup", false, Date.now() - start, channel);
        return earlyReturn(`Codes lookup failed: ${err.message}`);
      }
    }

    if (msgLower === "depreciation scan") {
      const start = Date.now();
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-depreciation-tracker`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "scan" })
        });
        const data = await res.json();
        await logUsage(supabase, "depreciation_scan", true, Date.now() - start, channel);
        return earlyReturn(`💵 Depreciation scan complete. Actions triggered: ${data.actions_triggered ?? 0}`);
      } catch (err: any) {
        await logUsage(supabase, "depreciation_scan", false, Date.now() - start, channel);
        return earlyReturn(`Depreciation scan failed: ${err.message}`);
      }
    }

    if (msgLower === "pending supplements") {
      const start = Date.now();
      try {
        const { data: pending } = await supabase
          .from("supplement_packages")
          .select("id, carrier_name, status, supplement_requested_amount, submitted_to_adjuster_at, adjuster_name, roofing_jobs(property_address)")
          .in("status", ["va_review", "submitted", "partial_approved"])
          .order("created_at", { ascending: false })
          .limit(15);
        if (!pending?.length) {
          await logUsage(supabase, "pending_supplements", true, Date.now() - start, channel);
          return earlyReturn("No pending supplements. All caught up! ✅");
        }
        const lines = pending.map(p => {
          const addr = (p.roofing_jobs as any)?.property_address || "Unknown";
          const days = p.submitted_to_adjuster_at
            ? Math.round((Date.now() - new Date(p.submitted_to_adjuster_at).getTime()) / 86400000)
            : null;
          return `• \`${p.id.slice(0, 8)}\` ${addr} — ${p.carrier_name} — $${((p.supplement_requested_amount||0)/100).toLocaleString()} — *${p.status}*${days !== null ? ` (${days}d ago)` : ""}`;
        }).join("\n");
        await logUsage(supabase, "pending_supplements", true, Date.now() - start, channel);
        return earlyReturn(`📋 *Pending Supplements (${pending.length})*\n\n${lines}`);
      } catch (err: any) {
        await logUsage(supabase, "pending_supplements", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("supplement history:")) {
      const start = Date.now();
      try {
        const carrierInput = msg.slice("supplement history:".length).trim();
        const { data: history } = await supabase
          .from("supplement_packages")
          .select("id, status, supplement_requested_amount, supplement_approved_amount, created_at, claim_number")
          .ilike("carrier_name", `%${carrierInput}%`)
          .order("created_at", { ascending: false })
          .limit(10);
        if (!history?.length) {
          await logUsage(supabase, "supplement_history", false, Date.now() - start, channel);
          return earlyReturn(`No supplement history found for "${carrierInput}"`);
        }
        const lines = history.map(h => {
          const date = new Date(h.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          return `• ${date} — $${((h.supplement_requested_amount||0)/100).toLocaleString()} req / $${((h.supplement_approved_amount||0)/100).toLocaleString()} appvd — *${h.status}*`;
        }).join("\n");
        const approved = history.filter(h => ["approved","partial_approved"].includes(h.status)).length;
        await logUsage(supabase, "supplement_history", true, Date.now() - start, channel);
        return earlyReturn(
          `📊 *${carrierInput} Supplement History*\n` +
          `${history.length} packages — ${Math.round(approved/history.length*100)}% approval rate\n\n${lines}`
        );
      } catch (err: any) {
        await logUsage(supabase, "supplement_history", false, Date.now() - start, channel);
        return earlyReturn(`History failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("add carrier intel:")) {
      const start = Date.now();
      try {
        const rest = msg.slice("add carrier intel:".length).trim();
        const spaceIdx = rest.indexOf(" ");
        if (spaceIdx === -1) return earlyReturn("Format: `add carrier intel: [carrier name] [tip or insight]`");
        const carrierName = rest.slice(0, spaceIdx).replace(/_/g, " ");
        const tip = rest.slice(spaceIdx + 1).trim();
        const { data: carrier } = await supabase.from("carrier_intelligence").select("id, tips, carrier_name").ilike("carrier_name", `%${carrierName}%`).maybeSingle();
        if (!carrier) {
          await logUsage(supabase, "add_carrier_intel", false, Date.now() - start, channel);
          return earlyReturn(`Carrier "${carrierName}" not found. Known carriers: State Farm, Allstate, Liberty Mutual, Travelers, USAA, Nationwide`);
        }
        const existingTips = (carrier.tips as string[]) || [];
        await supabase.from("carrier_intelligence").update({ tips: [...existingTips, tip], last_updated: new Date().toISOString() }).eq("id", carrier.id);
        await logUsage(supabase, "add_carrier_intel", true, Date.now() - start, channel);
        return earlyReturn(`✅ Tip added to ${carrier.carrier_name} intelligence:\n"${tip}"`);
      } catch (err: any) {
        await logUsage(supabase, "add_carrier_intel", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("follow up supplement:")) {
      const start = Date.now();
      try {
        const pkgRef = msg.slice("follow up supplement:".length).trim();
        const { data: pkgs } = await supabase.from("supplement_packages").select("id, carrier_name, adjuster_name, adjuster_email, supplement_requested_amount, claim_number, submitted_to_adjuster_at").or(`id.eq.${pkgRef},id.ilike.${pkgRef}%`).limit(1);
        const pkg = pkgs?.[0];
        if (!pkg) {
          await logUsage(supabase, "follow_up_supplement", false, Date.now() - start, channel);
          return earlyReturn(`No package found with ID starting with "${pkgRef}"`);
        }
        const daysPending = pkg.submitted_to_adjuster_at
          ? Math.round((Date.now() - new Date(pkg.submitted_to_adjuster_at).getTime()) / 86400000)
          : 0;
        await logUsage(supabase, "follow_up_supplement", true, Date.now() - start, channel);
        return earlyReturn(
          `📞 *Supplement Follow-up*\n\n` +
          `Carrier: ${pkg.carrier_name}\n` +
          `Adjuster: ${pkg.adjuster_name || "Unknown"}\n` +
          `Email: ${pkg.adjuster_email || "Not on file"}\n` +
          `Claim #: ${pkg.claim_number || "TBD"}\n` +
          `Amount: $${((pkg.supplement_requested_amount||0)/100).toLocaleString()}\n` +
          `Days pending: ${daysPending}\n\n` +
          `_Script:_ "Hi ${pkg.adjuster_name || "there"}, this is [your name] following up on supplement package for claim ${pkg.claim_number || "on file"}. We submitted ${daysPending} days ago and wanted to check on status. Can you give me an ETA?"`
        );
      } catch (err: any) {
        await logUsage(supabase, "follow_up_supplement", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    // ================================================================
    // ROOFING OPERATIONS COMMANDS
    // ================================================================

    if (msgLower.startsWith("job:")) {
      const start = Date.now();
      try {
        const jobRef = msg.slice("job:".length).trim();
        const isUuid = /^[0-9a-f-]{36}$/i.test(jobRef);
        const { data: jobs } = isUuid
          ? await supabase.from("roofing_jobs").select("*, insurance_claims(carrier_name, claim_number, status), roofing_permits(status, permit_number, municipality), job_financials(contract_amount, gross_margin, total_collected, amount_outstanding)").eq("id", jobRef).limit(1)
          : await supabase.from("roofing_jobs").select("*, insurance_claims(carrier_name, claim_number, status), roofing_permits(status, permit_number, municipality), job_financials(contract_amount, gross_margin, total_collected, amount_outstanding)").ilike("property_address", `%${jobRef}%`).limit(1);
        const job = jobs?.[0];
        if (!job) {
          await logUsage(supabase, "job_lookup", false, Date.now() - start, channel);
          return earlyReturn(`No job found matching "${jobRef}"`);
        }
        const fin = Array.isArray(job.job_financials) ? job.job_financials[0] : job.job_financials;
        const permit = Array.isArray(job.roofing_permits) ? job.roofing_permits[0] : job.roofing_permits;
        await logUsage(supabase, "job_lookup", true, Date.now() - start, channel);
        return earlyReturn(
          `🏠 *${job.property_address}*\n` +
          `Status: *${job.status}*\n` +
          `Type: ${job.job_type || "insurance"}\n` +
          `Homeowner: ${job.homeowner_name || "Unknown"} ${job.homeowner_phone ? `— ${job.homeowner_phone}` : ""}\n` +
          `Material: ${job.material_type || "TBD"}\n` +
          (job.insurance_carrier || job.claim_number ? `Carrier: ${job.insurance_carrier || ""} | Claim: ${job.claim_number || "TBD"}\n` : "") +
          (permit ? `Permit: ${permit.status} ${permit.permit_number ? `(#${permit.permit_number})` : ""}\n` : "") +
          (fin ? `Contract: $${((fin.contract_amount || 0) / 100).toLocaleString()} | Margin: ${Math.round((fin.gross_margin || 0) * 100)}%\n` : "") +
          (fin?.amount_outstanding ? `Outstanding: $${((fin.amount_outstanding || 0) / 100).toLocaleString()}\n` : "") +
          `Created: ${new Date(job.created_at).toLocaleDateString()}\n` +
          `ID: \`${job.id.slice(0, 8)}\``
        );
      } catch (err: any) {
        await logUsage(supabase, "job_lookup", false, Date.now() - start, channel);
        return earlyReturn(`Job lookup failed: ${err.message}`);
      }
    }

    if (msgLower === "jobs today") {
      const start = Date.now();
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data: schedules } = await supabase
          .from("crew_schedules")
          .select("job_id, scheduled_date, status, roofing_jobs(property_address, status), roofing_crew(name, role)")
          .eq("scheduled_date", today)
          .order("start_time");
        if (!schedules?.length) {
          await logUsage(supabase, "jobs_today", true, Date.now() - start, channel);
          return earlyReturn("No jobs scheduled for today.");
        }
        const seen = new Map<string, string[]>();
        for (const s of schedules) {
          const addr = (s.roofing_jobs as any)?.property_address || s.job_id;
          if (!seen.has(addr)) seen.set(addr, []);
          const crew = s.roofing_crew as any;
          if (crew?.name) seen.get(addr)!.push(crew.name);
        }
        const lines = Array.from(seen.entries()).map(([addr, crew]) =>
          `• *${addr}*\n  Crew: ${crew.join(", ") || "TBD"}`
        ).join("\n\n");
        await logUsage(supabase, "jobs_today", true, Date.now() - start, channel);
        return earlyReturn(`📅 *Jobs Today (${seen.size})*\n\n${lines}`);
      } catch (err: any) {
        await logUsage(supabase, "jobs_today", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    if (msgLower === "pipeline" || msgLower === "roofing pipeline") {
      const start = Date.now();
      try {
        const { data: jobs } = await supabase
          .from("roofing_jobs")
          .select("status, property_address, contract_amount, scheduled_start")
          .not("status", "in", '("cancelled","paid")')
          .order("created_at", { ascending: false });
        if (!jobs?.length) {
          await logUsage(supabase, "pipeline", true, Date.now() - start, channel);
          return earlyReturn("No active jobs in pipeline.");
        }
        const byStatus: Record<string, any[]> = {};
        for (const j of jobs) {
          if (!byStatus[j.status]) byStatus[j.status] = [];
          byStatus[j.status].push(j);
        }
        const statusOrder = ["lead","assessed","contracted","materials_ordered","permit_pending","permit_approved","scheduled","in_progress","complete","invoiced"];
        const lines = statusOrder.filter(s => byStatus[s]?.length).map(s => {
          const items = byStatus[s];
          const total = items.reduce((sum: number, j: any) => sum + Math.round((j.contract_amount || 0) * 100), 0);
          return `*${s}* (${items.length}) — $${(total/100).toLocaleString()}\n` +
            items.slice(0, 3).map((j: any) => `  • ${j.property_address}`).join("\n") +
            (items.length > 3 ? `\n  _+${items.length - 3} more_` : "");
        }).join("\n\n");
        await logUsage(supabase, "pipeline", true, Date.now() - start, channel);
        return earlyReturn(`🏗️ *Roofing Pipeline (${jobs.length} jobs)*\n\n${lines}`);
      } catch (err: any) {
        await logUsage(supabase, "pipeline", false, Date.now() - start, channel);
        return earlyReturn(`Pipeline failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("schedule:")) {
      const start = Date.now();
      try {
        const rest = msg.slice("schedule:".length).trim();
        // Format: schedule: [job-ref] [date YYYY-MM-DD] [crew ids...]
        const parts = rest.split(/\s+/);
        if (parts.length < 2) return earlyReturn("Format: `schedule: [job address/ID] [YYYY-MM-DD] [crew member IDs...]`");
        const jobRef = parts[0];
        const scheduledDate = parts[1];
        const crewIds = parts.slice(2);
        const isUuid = /^[0-9a-f-]{36}$/i.test(jobRef);
        const { data: jobs } = isUuid
          ? await supabase.from("roofing_jobs").select("id, property_address").eq("id", jobRef).limit(1)
          : await supabase.from("roofing_jobs").select("id, property_address").ilike("property_address", `%${jobRef}%`).limit(1);
        const job = jobs?.[0];
        if (!job) {
          await logUsage(supabase, "schedule_crew", false, Date.now() - start, channel);
          return earlyReturn(`No job found matching "${jobRef}"`);
        }
        if (!crewIds.length) {
          // Just update job scheduled date
          await supabase.from("roofing_jobs").update({ scheduled_start: scheduledDate, status: "scheduled" }).eq("id", job.id);
          await logUsage(supabase, "schedule_crew", true, Date.now() - start, channel);
          return earlyReturn(`✅ ${job.property_address} scheduled for ${scheduledDate}`);
        }
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-crew-manager`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "schedule", job_id: job.id, crew_member_ids: crewIds, scheduled_date: scheduledDate })
        });
        const data = await res.json();
        await logUsage(supabase, "schedule_crew", true, Date.now() - start, channel);
        return earlyReturn(`✅ Scheduled: ${job.property_address}\nDate: ${scheduledDate}\nCrew notified: ${data.scheduled || 0}`);
      } catch (err: any) {
        await logUsage(supabase, "schedule_crew", false, Date.now() - start, channel);
        return earlyReturn(`Schedule failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("order materials:")) {
      const start = Date.now();
      try {
        const jobRef = msg.slice("order materials:".length).trim();
        const isUuid = /^[0-9a-f-]{36}$/i.test(jobRef);
        const { data: jobs } = isUuid
          ? await supabase.from("roofing_jobs").select("id, property_address, material_type, roof_squares, roof_size_squares").eq("id", jobRef).limit(1)
          : await supabase.from("roofing_jobs").select("id, property_address, material_type, roof_squares, roof_size_squares").ilike("property_address", `%${jobRef}%`).limit(1);
        const job = jobs?.[0];
        if (!job) {
          await logUsage(supabase, "order_materials", false, Date.now() - start, channel);
          return earlyReturn(`No job found matching "${jobRef}"`);
        }
        const squares = job.roof_squares || job.roof_size_squares || 0;
        await logUsage(supabase, "order_materials", true, Date.now() - start, channel);
        return earlyReturn(
          `📦 *Material Order — ${job.property_address}*\n\n` +
          `Job ID: \`${job.id.slice(0, 8)}\`\n` +
          `Material: ${job.material_type || "TBD"}\n` +
          `Squares: ${squares || "TBD"}\n\n` +
          `To create order, call the API:\n` +
          `POST roofing-material-order\n` +
          `{\n  "action": "create_order",\n  "job_id": "${job.id}",\n  "supplier": "abc_supply",\n  "items": [...],\n  "delivery_date": "YYYY-MM-DD"\n}`
        );
      } catch (err: any) {
        await logUsage(supabase, "order_materials", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("permit:")) {
      const start = Date.now();
      try {
        const jobRef = msg.slice("permit:".length).trim();
        const isUuid = /^[0-9a-f-]{36}$/i.test(jobRef);
        const { data: jobs } = isUuid
          ? await supabase.from("roofing_jobs").select("id, property_address").eq("id", jobRef).limit(1)
          : await supabase.from("roofing_jobs").select("id, property_address").ilike("property_address", `%${jobRef}%`).limit(1);
        const job = jobs?.[0];
        if (!job) {
          await logUsage(supabase, "permit_lookup", false, Date.now() - start, channel);
          return earlyReturn(`No job found matching "${jobRef}"`);
        }
        const { data: permits } = await supabase.from("roofing_permits").select("*").eq("job_id", job.id);
        if (!permits?.length) {
          await logUsage(supabase, "permit_lookup", true, Date.now() - start, channel);
          return earlyReturn(`No permit records for ${job.property_address}. Contract not yet signed?`);
        }
        const p = permits[0];
        const days = p.application_submitted_at
          ? Math.round((Date.now() - new Date(p.application_submitted_at).getTime()) / 86400000)
          : null;
        await logUsage(supabase, "permit_lookup", true, Date.now() - start, channel);
        return earlyReturn(
          `🏗️ *Permit — ${job.property_address}*\n\n` +
          `Municipality: ${p.municipality}\n` +
          `Status: *${p.status}*\n` +
          (p.permit_number ? `Permit #: ${p.permit_number}\n` : "") +
          (p.application_submitted_at ? `Submitted: ${new Date(p.application_submitted_at).toLocaleDateString()} (${days}d ago)\n` : "") +
          (p.approved_at ? `Approved: ${new Date(p.approved_at).toLocaleDateString()}\n` : "") +
          `\nPermit ID: \`${p.id.slice(0, 8)}\``
        );
      } catch (err: any) {
        await logUsage(supabase, "permit_lookup", false, Date.now() - start, channel);
        return earlyReturn(`Permit lookup failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("permit approved:")) {
      const start = Date.now();
      try {
        const rest = msg.slice("permit approved:".length).trim().split(/\s+/);
        const permitRef = rest[0];
        const permitNumber = rest.slice(1).join(" ");
        if (!permitRef) return earlyReturn("Format: `permit approved: [permit-id] [permit number]`");
        const { data: permits } = await supabase.from("roofing_permits").select("id").or(`id.eq.${permitRef},id.ilike.${permitRef}%`).limit(1);
        const permit = permits?.[0];
        if (!permit) {
          await logUsage(supabase, "permit_approved", false, Date.now() - start, channel);
          return earlyReturn(`No permit found with ID starting with "${permitRef}"`);
        }
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-permit-tracker`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approved", permit_id: permit.id, permit_number: permitNumber || null })
        });
        const data = await res.json();
        await logUsage(supabase, "permit_approved", true, Date.now() - start, channel);
        return earlyReturn(data.ok ? `✅ Permit approved! ${permitNumber ? `#${permitNumber}` : ""}\nJob status updated to permit_approved.` : `Failed: ${data.error}`);
      } catch (err: any) {
        await logUsage(supabase, "permit_approved", false, Date.now() - start, channel);
        return earlyReturn(`Failed: ${err.message}`);
      }
    }

    if (msgLower === "financial dashboard" || msgLower === "financials") {
      const start = Date.now();
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-financial`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dashboard" })
        });
        const d = await res.json();
        await logUsage(supabase, "financial_dashboard", true, Date.now() - start, channel);
        return earlyReturn(
          `💰 *Financial Dashboard (30 days)*\n\n` +
          `Revenue: $${((d.revenue || 0) / 100).toLocaleString()}\n` +
          `Profit: $${((d.profit || 0) / 100).toLocaleString()}\n` +
          `Avg margin: ${d.avg_margin || 0}%\n` +
          `Collected: $${((d.collected || 0) / 100).toLocaleString()}\n` +
          `Outstanding: $${((d.outstanding || 0) / 100).toLocaleString()}\n` +
          `Supplement revenue: $${((d.supplement_revenue || 0) / 100).toLocaleString()}\n` +
          `Pipeline value: $${((d.pipeline || 0) / 100).toLocaleString()}\n` +
          `Active jobs: ${d.active_jobs || 0} | Paid: ${d.paid_jobs || 0}`
        );
      } catch (err: any) {
        await logUsage(supabase, "financial_dashboard", false, Date.now() - start, channel);
        return earlyReturn(`Financial dashboard failed: ${err.message}`);
      }
    }

    if (msgLower === "cash flow") {
      const start = Date.now();
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-financial`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cash_flow" })
        });
        const d = await res.json();
        const proj = d.projection as Record<string, number> || {};
        const lines = Object.entries(proj).sort().map(([month, amt]) =>
          `${month}: $${(amt / 100).toLocaleString()}`
        ).join("\n");
        await logUsage(supabase, "cash_flow", true, Date.now() - start, channel);
        return earlyReturn(
          `📈 *Cash Flow Projection*\n\n` +
          (lines || "No active jobs in pipeline") +
          `\n\n*Total projected:* $${((d.total_projected || 0) / 100).toLocaleString()}\n` +
          `Jobs in pipeline: ${d.jobs_in_pipeline || 0}`
        );
      } catch (err: any) {
        await logUsage(supabase, "cash_flow", false, Date.now() - start, channel);
        return earlyReturn(`Cash flow failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("pay sub:")) {
      const start = Date.now();
      try {
        const parts = msg.slice("pay sub:".length).trim().split(/\s+/);
        const assignmentRef = parts[0];
        const amountStr = parts[1];
        if (!assignmentRef || !amountStr) return earlyReturn("Format: `pay sub: [assignment-id] [amount in dollars]`\nExample: `pay sub: abc12345 2500`");
        const amount = Math.round(parseFloat(amountStr) * 100);
        if (isNaN(amount)) return earlyReturn("Invalid amount. Use dollars: `pay sub: abc12345 2500`");
        const { data: assignments } = await supabase.from("sub_assignments").select("id").or(`id.eq.${assignmentRef},id.ilike.${assignmentRef}%`).limit(1);
        const assignment = assignments?.[0];
        if (!assignment) {
          await logUsage(supabase, "pay_sub", false, Date.now() - start, channel);
          return earlyReturn(`No sub assignment found with ID starting with "${assignmentRef}"`);
        }
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-financial`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pay_sub", sub_assignment_id: assignment.id, amount })
        });
        const data = await res.json();
        await logUsage(supabase, "pay_sub", true, Date.now() - start, channel);
        return earlyReturn(data.ok ? `✅ Sub payment recorded: $${(amount / 100).toLocaleString()}` : `Failed: ${data.error}`);
      } catch (err: any) {
        await logUsage(supabase, "pay_sub", false, Date.now() - start, channel);
        return earlyReturn(`Pay sub failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("job complete:")) {
      const start = Date.now();
      try {
        const jobRef = msg.slice("job complete:".length).trim();
        const isUuid = /^[0-9a-f-]{36}$/i.test(jobRef);
        const { data: jobs } = isUuid
          ? await supabase.from("roofing_jobs").select("id, property_address").eq("id", jobRef).limit(1)
          : await supabase.from("roofing_jobs").select("id, property_address").ilike("property_address", `%${jobRef}%`).limit(1);
        const job = jobs?.[0];
        if (!job) {
          await logUsage(supabase, "job_complete", false, Date.now() - start, channel);
          return earlyReturn(`No job found matching "${jobRef}"`);
        }
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-job-pipeline`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: job.id, new_status: "complete" })
        });
        const data = await res.json();
        await logUsage(supabase, "job_complete", true, Date.now() - start, channel);
        return earlyReturn(
          data.ok
            ? `🏠 *Job marked complete:* ${job.property_address}\n` +
              `Post-install supplement generating.\n` +
              `Review request scheduled for tomorrow.\n` +
              `Depreciation release processing.`
            : `Failed: ${data.error}`
        );
      } catch (err: any) {
        await logUsage(supabase, "job_complete", false, Date.now() - start, channel);
        return earlyReturn(`Job complete failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("job status:")) {
      const start = Date.now();
      try {
        const rest = msg.slice("job status:".length).trim().split(/\s+/);
        const jobRef = rest[0];
        const newStatus = rest.slice(1).join("_").toLowerCase();
        if (!jobRef || !newStatus) return earlyReturn("Format: `job status: [job address/ID] [new status]`");
        const isUuid = /^[0-9a-f-]{36}$/i.test(jobRef);
        const { data: jobs } = isUuid
          ? await supabase.from("roofing_jobs").select("id, property_address").eq("id", jobRef).limit(1)
          : await supabase.from("roofing_jobs").select("id, property_address").ilike("property_address", `%${jobRef}%`).limit(1);
        const job = jobs?.[0];
        if (!job) {
          await logUsage(supabase, "job_status", false, Date.now() - start, channel);
          return earlyReturn(`No job found matching "${jobRef}"`);
        }
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/roofing-job-pipeline`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: job.id, new_status: newStatus })
        });
        const data = await res.json();
        await logUsage(supabase, "job_status", true, Date.now() - start, channel);
        return earlyReturn(data.ok ? `✅ ${job.property_address}: ${data.previous_status} → ${data.new_status}` : `Failed: ${data.error}`);
      } catch (err: any) {
        await logUsage(supabase, "job_status", false, Date.now() - start, channel);
        return earlyReturn(`Job status failed: ${err.message}`);
      }
    }

    // ================================================================
    // ROOFING INTELLIGENCE COMMANDS
    // ================================================================

    // rep performance
    if (msgLower === "rep performance") {
      const start = Date.now();
      try {
        await logUsage(supabase, "rep_performance", true, Date.now() - start, channel);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-analytics`, {
          method: "POST", headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rep_performance" })
        });
        const data = await res.json();
        if (!data.reps?.length) return earlyReturn("No rep data found for last 30 days.");
        const lines = data.reps.slice(0, 5).map((r: any) =>
          `*${r.name}*: ${r.signed} signed | $${(r.total_revenue || 0).toLocaleString()} rev | ${r.close_rate}% close`
        ).join("\n");
        return earlyReturn(`📊 *Rep Performance (30d)*\n\n${lines}`);
      } catch (err: any) { return earlyReturn(`Rep performance failed: ${err.message}`); }
    }

    // rep: [name or id]
    if (msgLower.startsWith("rep:")) {
      const start = Date.now();
      try {
        const repName = message.slice(4).trim();
        await logUsage(supabase, "rep_detail", true, Date.now() - start, channel);
        const { data: analytics } = await supabase.from("rep_analytics")
          .select("*").order("created_at", { ascending: false }).limit(5);
        if (!analytics?.length) return earlyReturn(`No analytics found for "${repName}".`);
        const latest = analytics[0];
        return earlyReturn(
          `📈 *Rep: ${repName}*\n` +
          `Contracts: ${latest.contracts_signed}\nClose rate: ${Math.round((latest.close_rate || 0) * 100)}%\n` +
          `Avg job: $${(latest.avg_job_value || 0).toLocaleString()}\nRevenue: $${(latest.total_revenue || 0).toLocaleString()}`
        );
      } catch (err: any) { return earlyReturn(`Rep lookup failed: ${err.message}`); }
    }

    // market: [zip code]
    if (msgLower.startsWith("market:")) {
      const start = Date.now();
      try {
        const zip = message.slice(7).trim();
        await logUsage(supabase, "market_intel", true, Date.now() - start, channel);
        const { data: intel } = await supabase.from("market_intelligence")
          .select("*").eq("zip_code", zip).maybeSingle();
        if (!intel) return earlyReturn(`No market data for zip ${zip}. Run market penetration analysis first.`);
        return earlyReturn(
          `🗺️ *Market: ${zip}*\n` +
          `Jobs completed: ${intel.jobs_completed}\nAvg job value: $${(intel.avg_job_value || 0).toLocaleString()}\n` +
          `Opportunity score: ${intel.opportunity_score || "N/A"}\nLast storm: ${intel.last_storm_date || "None"}`
        );
      } catch (err: any) { return earlyReturn(`Market lookup failed: ${err.message}`); }
    }

    // patterns
    if (msgLower === "patterns") {
      const start = Date.now();
      try {
        await logUsage(supabase, "patterns", true, Date.now() - start, channel);
        const { data: patterns } = await supabase.from("roofing_patterns")
          .select("*").eq("applied", false).order("confidence_score", { ascending: false }).limit(5);
        if (!patterns?.length) return earlyReturn("No pending patterns. Run `self improve` to detect new ones.");
        const lines = patterns.map((p: any) =>
          `*${p.pattern_type}* (${Math.round((p.confidence_score || 0) * 100)}% confidence)\n${p.recommendation}`
        ).join("\n\n");
        return earlyReturn(`🧠 *Unapplied Patterns*\n\n${lines}`);
      } catch (err: any) { return earlyReturn(`Patterns lookup failed: ${err.message}`); }
    }

    // apply patterns
    if (msgLower === "apply patterns") {
      const start = Date.now();
      try {
        await logUsage(supabase, "apply_patterns", true, Date.now() - start, channel);
        const { data: patterns } = await supabase.from("roofing_patterns")
          .select("id, pattern_type, recommendation").eq("applied", false);
        if (!patterns?.length) return earlyReturn("No unapplied patterns found.");
        await supabase.from("roofing_patterns").update({ applied: true, applied_at: new Date().toISOString() })
          .eq("applied", false);
        return earlyReturn(`✅ Marked ${patterns.length} pattern${patterns.length > 1 ? "s" : ""} as applied.`);
      } catch (err: any) { return earlyReturn(`Apply patterns failed: ${err.message}`); }
    }

    // weekly report
    if (msgLower === "weekly report") {
      const start = Date.now();
      try {
        await logUsage(supabase, "weekly_report", true, Date.now() - start, channel);
        fetch(`${SUPABASE_URL}/functions/v1/roofing-weekly-report`, {
          method: "POST", headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({})
        }).catch(() => {});
        return earlyReturn("📊 Generating weekly intelligence report — will arrive in Telegram shortly.");
      } catch (err: any) { return earlyReturn(`Weekly report failed: ${err.message}`); }
    }

    // qa run
    if (msgLower === "qa run") {
      const start = Date.now();
      try {
        await logUsage(supabase, "qa_run", true, Date.now() - start, channel);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-qa-bot`, {
          method: "POST", headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const data = await res.json();
        return earlyReturn(`🔬 *QA Results*\n${data.passed}/${data.total} tests passed${data.failed > 0 ? `\n⚠️ ${data.failed} failures — check Telegram for details` : "\n✅ All clear"}`);
      } catch (err: any) { return earlyReturn(`QA run failed: ${err.message}`); }
    }

    // supplement performance
    if (msgLower === "supplement performance") {
      const start = Date.now();
      try {
        await logUsage(supabase, "supplement_performance", true, Date.now() - start, channel);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-analytics`, {
          method: "POST", headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "supplement_performance" })
        });
        const data = await res.json();
        const carriers = Object.entries(data.by_carrier || {});
        if (!carriers.length) return earlyReturn("No supplement data yet.");
        const lines = carriers.map(([name, stats]: [string, any]) => {
          const rate = stats.submitted > 0 ? Math.round((stats.approved / stats.submitted) * 100) : 0;
          return `*${name}*: ${rate}% approval (${stats.approved}/${stats.submitted})`;
        }).join("\n");
        return earlyReturn(`📋 *Supplement Performance by Carrier*\n\n${lines}`);
      } catch (err: any) { return earlyReturn(`Supplement performance failed: ${err.message}`); }
    }

    // pricing analysis
    if (msgLower === "pricing analysis") {
      const start = Date.now();
      try {
        await logUsage(supabase, "pricing_analysis", true, Date.now() - start, channel);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-analytics`, {
          method: "POST", headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pricing_analysis" })
        });
        const data = await res.json();
        const dist = Object.entries(data.price_distribution || {})
          .sort((a: any, b: any) => b[1].count - a[1].count).slice(0, 5)
          .map(([range, stats]: [string, any]) => `${range}: ${stats.count} jobs`).join("\n");
        return earlyReturn(
          `💰 *Pricing Analysis*\n\n` +
          `Avg contract: $${(data.avg_contract || 0).toLocaleString()}\n\n` +
          `*Distribution:*\n${dist}`
        );
      } catch (err: any) { return earlyReturn(`Pricing analysis failed: ${err.message}`); }
    }

    // self improve
    if (msgLower === "self improve") {
      const start = Date.now();
      try {
        await logUsage(supabase, "self_improve", true, Date.now() - start, channel);
        const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-self-improve`, {
          method: "POST", headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const data = await res.json();
        return earlyReturn(
          data.patterns_detected > 0
            ? `🧠 *Self-Improve Complete*\n${data.patterns_detected} pattern${data.patterns_detected > 1 ? "s" : ""} detected. Check Telegram for recommendations.`
            : "🧠 Self-improve ran — no new patterns detected this cycle."
        );
      } catch (err: any) { return earlyReturn(`Self improve failed: ${err.message}`); }
    }

    // ================================================================
    // FETCH CONTEXT + CLASSIFY
    // ================================================================
    const { data: projectsList } = await supabase
      .from("projects").select("name, category").neq("category", "archived");
    const { data: peopleList } = await supabase.from("people").select("name");

    const establishedNames = (projectsList || []).filter((p: any) => p.category !== "idea").map((p: any) => p.name);
    const ideaNames = (projectsList || []).filter((p: any) => p.category === "idea").map((p: any) => p.name);
    const allProjectNames = [...establishedNames, ...ideaNames];
    const peopleNames = (peopleList || []).map((p: any) => p.name);

    const classification = await classifyEntry(message, establishedNames, ideaNames, peopleNames);

    for (const name of classification.projects || []) {
      const exists = allProjectNames.some((p: string) => p.toLowerCase() === name.toLowerCase());
      if (!exists) await supabase.from("projects").insert({ name, category: "idea" }).select();
    }
    for (const name of classification.people || []) {
      const exists = peopleNames.some((p: string) => p.toLowerCase() === name.toLowerCase());
      if (!exists) await supabase.from("people").insert({ name }).select();
    }

    // ================================================================
    // LAYERED RETRIEVAL
    // ================================================================
    const [recentEntries, projectEntries, peopleEntries, semanticEntries] = await Promise.all([
      supabase.from("entries").select("role, content, created_at")
        .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20),
      classification.projects?.length
        ? supabase.from("entries").select("role, content, created_at, entry_type, importance, project_names")
            .overlaps("project_names", classification.projects)
            .order("created_at", { ascending: false }).limit(15)
        : Promise.resolve({ data: [] }),
      classification.people?.length
        ? supabase.from("entries").select("role, content, created_at, entry_type, people_names")
            .overlaps("people_names", classification.people)
            .order("created_at", { ascending: false }).limit(10)
        : Promise.resolve({ data: [] }),
      semanticSearch(supabase, message, 8),
    ]);

    const contextBlock = buildContext({
      recent: recentEntries.data || [],
      projects: projectEntries.data || [],
      people: peopleEntries.data || [],
      semantic: semanticEntries || [],
    });

    // ================================================================
    // GENERATE RESPONSE + SAVE
    // ================================================================
    const reply = await callClaude(message, contextBlock, establishedNames, ideaNames);
    const taskStatus = classification.type === "task" ? "open" : null;

    const { data: userEntry } = await supabase.from("entries").insert({
      conversation_id: conversationId, source: channel, role: "user", content: message,
      entry_type: classification.type, importance: classification.importance,
      tags: classification.tags || [], project_names: classification.projects || [],
      people_names: classification.people || [], classification_status: "complete",
      task_status: taskStatus,
    }).select().single();

    if (userEntry) await embedEntry(supabase, userEntry.id, message);

    if (userEntry?.id) {
      const SUPABASE_URL_VAL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE_ROLE_KEY_VAL = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      fetch(`${SUPABASE_URL_VAL}/functions/v1/nexus-coo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY_VAL}` },
        body: JSON.stringify({ action: "contradiction_check", entry_id: userEntry.id, content: message }),
      }).catch(() => {});

      if (source === "voice_memo" && voice_file_id) {
        supabase.from("voice_memos").insert({
          telegram_file_id: voice_file_id,
          transcript: message,
          classified_as: classification?.type || "note",
          entry_id: userEntry.id,
          duration_seconds: duration_seconds || null,
        }).then(() => {}).catch(() => {});
      }
    }

    const { data: assistantEntry } = await supabase.from("entries").insert({
      conversation_id: conversationId, source: channel, role: "assistant", content: reply,
      classification_status: "skip",
    }).select().single();

    if (assistantEntry) await embedEntry(supabase, assistantEntry.id, reply);

    if (tgChatId && TELEGRAM_BOT_TOKEN) await sendTelegramWithRetry(TELEGRAM_BOT_TOKEN, tgChatId, reply);

    return new Response(JSON.stringify({ reply, classification }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Chat error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

// ================================================================
// GITHUB HELPERS
// ================================================================

async function mergeDevToMain(commitMessage: string): Promise<{ ok: boolean; error?: string }> {
  const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
  const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "nexuszc/nexus-zc";

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: improvement } = await supabase
      .from("nexus_improvements")
      .select("files_changed")
      .eq("status", "in_dev")
      .order("identified_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const filesToMerge: string[] = improvement?.files_changed || [];

    if (filesToMerge.length === 0) {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/merges`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          base: "main",
          head: "dev",
          commit_message: `Nexus self-improvement: ${commitMessage}`,
        }),
      });
      if (res.status === 204 || res.ok) return { ok: true };
      const err = await res.json();
      return { ok: false, error: err.message };
    }

    for (const filePath of filesToMerge) {
      const readRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=dev`,
        { headers: { "Authorization": `Bearer ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json" } }
      );
      if (!readRes.ok) throw new Error(`Could not read ${filePath} from dev`);
      const devFile = await readRes.json();
      const content = devFile.content;

      const mainRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}?ref=main`,
        { headers: { "Authorization": `Bearer ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json" } }
      );
      let mainSha: string | undefined;
      if (mainRes.ok) {
        const mainFile = await mainRes.json();
        mainSha = mainFile.sha;
      }

      const body: any = { message: `Nexus self-improvement: ${commitMessage}`, content, branch: "main" };
      if (mainSha) body.sha = mainSha;

      const writeRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`,
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

      if (!writeRes.ok) {
        const err = await writeRes.json();
        throw new Error(`Failed to write ${filePath} to main: ${JSON.stringify(err)}`);
      }
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function resetDevToMain(): Promise<void> {
  const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
  const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "nexuszc/nexus-zc";
  const mainRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`, {
    headers: { "Authorization": `Bearer ${GITHUB_TOKEN}`, "Accept": "application/vnd.github.v3+json" },
  });
  const mainData = await mainRes.json();
  const mainSha = mainData.object?.sha;
  if (!mainSha) return;
  await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/dev`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sha: mainSha, force: true }),
  });
}

// ================================================================
// ABILITY HELPERS
// ================================================================

async function webSearch(query: string): Promise<any[]> {
  const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY");
  if (!SERPER_API_KEY) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    const data = await res.json();
    return data.organic || [];
  } catch (err) {
    console.error("Search error:", err);
    return [];
  }
}

async function summarizeSearchResults(query: string, results: any[]): Promise<string> {
  if (!results.length) return "No results found. (SERPER_API_KEY not configured  -  add it to Supabase secrets to enable web search)";
  const context = results.map((r: any, i: number) =>
    `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`
  ).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 800,
      messages: [{ role: "user", content: `Summarize these search results for the query "${query}". Be direct and extract the most useful information. Format clearly.\n\n${context}` }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not summarize results.";
}

async function summarizeUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Nexus/1.0)" } });
    const html = await res.text();
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 8000);
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5", max_tokens: 600,
        messages: [{ role: "user", content: `Summarize this webpage content. Extract: what they do, who they serve, key offerings, anything notable. Be concise.\n\n${text}` }],
      }),
    });
    const data = await claudeRes.json();
    return data?.content?.[0]?.text || "Could not summarize page.";
  } catch (err) {
    return `Could not fetch URL: ${(err as Error).message}`;
  }
}

async function draftEmail(to: string, subject: string, about: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 600,
      messages: [{ role: "user", content: `Draft a professional email from Zach Curtis (zach@nexuszc.com) to ${to}.\nSubject: ${subject}\nAbout: ${about}\n\nWrite only the email body. No subject line. Keep it concise, direct, and warm. Sound like a real person, not a template.` }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not draft email.";
}

async function sendGmail(to: string, subject: string, emailBody: string): Promise<boolean> {
  try {
    const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
    const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
    const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN")!;
    const GMAIL_FROM = Deno.env.get("GMAIL_FROM_EMAIL") || "zach@nexuszc.com";
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN, grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) return false;
    const email = [`From: Zach Curtis <${GMAIL_FROM}>`, `To: ${to}`, `Subject: ${subject}`, "", emailBody].join("\n");
    const encoded = btoa(unescape(encodeURIComponent(email))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded }),
    });
    return sendRes.ok;
  } catch (err) {
    console.error("Gmail send error:", err);
    return false;
  }
}

async function generateDocument(type: string, subject: string, details: string, clientData: any): Promise<string> {
  const clientContext = clientData?.client_context?.[0];
  const contextStr = clientContext
    ? `Client: ${clientData.name}\nOffer: ${clientContext.core_offer || "not set"}\nGoals: ${clientContext.goals || "not set"}\nAudience: ${clientContext.target_audience || "not set"}`
    : `Subject: ${subject}`;
  const prompts: Record<string, string> = {
    proposal: `Write a professional business proposal for ${subject}. ${details}\n\nContext:\n${contextStr}\n\nInclude: executive summary, problem, solution, deliverables, timeline, investment. Keep it tight and compelling.`,
    script: `Write a call script for ${subject}. ${details}\n\nContext:\n${contextStr}\n\nInclude: opener, value prop, qualifying questions, objection handlers, close. Make it conversational not robotic.`,
    report: `Generate a status report for ${subject}. ${details}\n\nContext:\n${contextStr}\n\nInclude: current status, what's been done, what's next, blockers, recommendations.`,
    onepager: `Write a one-pager about ${subject}. ${details}\n\nContext:\n${contextStr}\n\nInclude: headline, problem, solution, how it works, why us, call to action. Make it punchy.`,
  };
  const prompt = prompts[type] || `Generate a ${type} document about ${subject}. ${details}\n\n${contextStr}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not generate document.";
}

function parseReminderTime(timePart: string): Date | null {
  const now = new Date();
  const lower = timePart.toLowerCase();
  if (lower.startsWith("in:")) {
    const spec = lower.slice(3).trim();
    const match = spec.match(/(\d+)\s*(minute|hour|day|week)s?/);
    if (!match) return null;
    const n = parseInt(match[1]);
    const unit = match[2] as "minute" | "hour" | "day" | "week";
    const ms = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 }[unit] || 0;
    return new Date(now.getTime() + n * ms);
  }
  if (lower.startsWith("at:")) {
    const spec = lower.slice(3).trim();
    if (spec.includes("tomorrow")) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      const timeMatch = spec.match(/(\d+)(am|pm)/);
      if (timeMatch) {
        let h = parseInt(timeMatch[1]);
        if (timeMatch[2] === "pm" && h !== 12) h += 12;
        d.setHours(h, 0, 0, 0);
      }
      return d;
    }
  }
  return null;
}

async function synthesizeResearch(target: string, results: any[]): Promise<string> {
  if (!results.length) return "No results found. (SERPER_API_KEY not configured  -  add it to Supabase secrets to enable web search)";
  const context = results.slice(0, 8).map((r: any, i: number) =>
    `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`
  ).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 1000,
      messages: [{ role: "user", content: `You are researching "${target}" for Zach Curtis, a business operator evaluating opportunities.\n\nSearch results:\n${context}\n\nProvide a structured intelligence brief:\n- Who/what they are\n- Key facts and numbers\n- Recent activity or news\n- Opportunities or risks\n- Recommended next step for Zach\n\nBe direct and specific. Flag anything notable.` }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not synthesize research.";
}

async function competitiveAnalysis(market: string, results: any[]): Promise<string> {
  const context = results.slice(0, 6).map((r: any) => `${r.title}: ${r.snippet}`).join("\n\n");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 800,
      messages: [{ role: "user", content: `Analyze the competitive landscape for "${market}".\n\nSearch data:\n${context || "(no search data  -  SERPER_API_KEY not configured)"}\n\nProvide:\n- Top 5 competitors with one-line description\n- Market positioning gaps (opportunities)\n- What differentiates the best players\n- Where a new entrant could win\n\nBe specific and actionable.` }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not analyze competition.";
}

async function generateClientReport(client: any, entries: any[], openTasks: any[]): Promise<string> {
  const ctx = client.client_context?.[0];
  const va = client.va_assignments?.find((v: any) => v.status === "active");
  const entrySummary = entries.slice(0, 10).map((e: any) => `[${e.role}] ${e.content.slice(0, 150)}`).join("\n");
  const taskList = openTasks.map((t: any) => `- ${t.content.slice(0, 100)}`).join("\n") || "None";
  const prompt = `Generate a client status report for ${client.name}.

CLIENT INFO:
- Deal type: ${client.deal_type || "not set"}
- Monthly fee: ${client.monthly_fee ? `$${client.monthly_fee}` : "N/A"}
- Rev share: ${client.rev_share_pct ? `${client.rev_share_pct}%` : "N/A"}
- Assigned VA: ${va?.va_name || "none"}
- Core offer: ${ctx?.core_offer || "not set"}
- Goals: ${ctx?.goals || "not set"}

RECENT ACTIVITY:
${entrySummary || "No activity yet"}

OPEN TASKS:
${taskList}

Write a concise report covering: current status, what's been done, what's next, blockers or risks, recommended action this week.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text || "Could not generate report.";
}

// ================================================================
// CORE HELPERS (classification, Claude, embeddings, retrieval)
// ================================================================

// Strip null bytes and ASCII control chars (keep \n \r \t) to prevent Anthropic 400 errors
function sanitize(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str.replace(/\0/g, "").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

async function classifyEntry(message: string, ventures: string[], ideas: string[], people: string[]) {
  const safeMessage = sanitize(message).slice(0, 3000);
  const establishedList = ventures.length ? ventures.join(", ") : "(none yet)";
  const ideasList = ideas.length ? ideas.join(", ") : "(none yet)";
  const peopleList = people.length ? people.join(", ") : "(none yet)";
  const classifyPrompt = `You are a classifier for Zach's personal brain system. Analyze this entry and return ONLY valid JSON.

ESTABLISHED PROJECTS (platform, vertical, personal, external): ${establishedList}
LOOSE IDEAS (not yet committed): ${ideasList}
KNOWN PEOPLE: ${peopleList}

ENTRY: """${safeMessage}"""

CRITICAL RULES:
1. **Use exact existing names.** Match any reference to an existing project/person to the exact name in the lists above.
2. **Catch naming events.** "let's call this X", "new idea X", "create a project called X"  -  extract as NEW project name.
3. **Multi-tag when multiple ventures/ideas appear.** Tag ALL of them.
4. **People are first-class.** Extract every named person, even if just mentioned in passing.
5. **Don't create projects from generic nouns.** A project needs a name or a clear venture/initiative.
6. **Task prefix detection.** If the message starts with "task:" or "TODO:"  -  always classify type as "task".

Return JSON:
{
  "type": "idea" | "task" | "note" | "decision" | "question" | "observation" | "meta" | "other",
  "importance": 1-10,
  "tags": ["short", "lowercase", "tags"],
  "people": ["Name1", "Name2"],
  "projects": ["Project Name 1", "Project Name 2"]
}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: classifyPrompt }] }),
    });
    if (!res.ok) {
      console.error("classifyEntry API error:", res.status);
      return { type: "note", importance: 5, tags: [], people: [], projects: [] };
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    try { return jsonMatch ? JSON.parse(jsonMatch[0]) : {}; }
    catch { return { type: "note", importance: 5, tags: [], people: [], projects: [] }; }
  } catch {
    return { type: "note", importance: 5, tags: [], people: [], projects: [] };
  }
}

async function callClaude(message: string, context: string, ventures: string[], ideas: string[]) {
  const safeMessage = sanitize(message).slice(0, 4000);
  const systemPrompt = `You are Nexus, Zach's personal Chief of Staff and AI operator.

CURRENT VENTURES: ${ventures.map(sanitize).join(", ") || "(none)"}
CURRENT IDEAS: ${ideas.map(sanitize).join(", ") || "(none)"}

${context}

ABILITIES YOU HAVE (suggest these when relevant):
- search: [query]  -  search the web
- summarize: [url]  -  summarize any webpage
- research: [name]  -  deep research on a person or company
- competitors: [market]  -  competitive analysis
- draft email: [to] | subject: [x] | about: [x]  -  draft an email
- send email: [to] | subject: [x] | body: [x]  -  send an email
- generate proposal: [client] | for: [details]
- generate script: [client] | objective: [x]
- generate report: [client] | for: [details]
- generate onepager: [topic]
- remind me: [what] | in: [2 hours / 3 days]
- task: [what]  -  track a task
- report: [client]  -  full client status report
- client snapshot: [name]  -  instant status: pipeline, calls, tasks, next move
- prioritize tasks  -  AI-sorted task list by urgency/impact
- task estimate: [task]  -  time/effort estimate with shortcuts
- sprint plan: [timeframe]  -  achievable sprint plan
- generate invoice: [client] | for: [work] | amount: [x]
- generate contract: [client] | for: [services] | amount: [x]
- follow up: [name]  -  smart follow-up based on Nexus memory
- weekly digest: [client]  -  weekly update to send to client
- status update: [project]  -  project status report
- generate sop: [process]  -  standard operating procedure
- generate pitch: [client] | for: [service]  -  custom sales pitch
- generate case study: [client]  -  results-focused case study
- generate ad copy: [service] | platform: [x]  -  ad copy in 3 variants
- calculate roi: [project] | revenue: [x] | cost: [x]
- pricing calculator: [service] | market: [x]
- save knowledge: [topic] | [details]  -  build knowledge library
- recall knowledge: [topic]  -  pull from knowledge base
- learn from: [url]  -  ingest and remember webpage
- nexus brain dump  -  export full knowledge snapshot
- nexus status  -  see system health and improvement queue
- approve / reject  -  approve or reject pending dev improvements

Behavioral rules:
- If memory contains the answer, ANSWER IT directly.
- Be concise. Fast, useful responses only.
- When Zach asks for something an ability can handle, suggest the exact command.
- Reference specific past entries when relevant.
- Match Zach's energy. If he's grinding, get sharp.

Task rules:
- task: or TODO: prefix  -  respond ONLY with: " -  Task logged: [task]. I'll track this until you mark it done."
- done: prefix  -  respond ONLY with: " -  Done: [what was marked complete]."
- done all  -  respond ONLY with: " -  All tasks cleared."`;
  try {
    const data = await callAnthropicWithRetry({
      model: "claude-sonnet-4-5", max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: safeMessage }],
    });
    return data?.content?.[0]?.text || "(no reply)";
  } catch (err: any) {
    console.error("callClaude error:", err.message);
    return "I'm having trouble reaching my AI backend right now. Please try again in a moment.";
  }
}

async function semanticSearch(supabase: any, query: string, limit = 8) {
  try {
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
    });
    const embedData = await embedRes.json();
    const queryEmbedding = embedData?.data?.[0]?.embedding;
    if (!queryEmbedding) return [];
    const { data } = await supabase.rpc("match_entries", { query_embedding: queryEmbedding, match_threshold: 0.3, match_count: limit });
    return data || [];
  } catch (err) {
    console.error("Semantic search error:", err);
    return [];
  }
}

async function embedEntry(supabase: any, entryId: string, content: string) {
  try {
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: content }),
    });
    const embedData = await embedRes.json();
    const embedding = embedData?.data?.[0]?.embedding;
    if (embedding) await supabase.from("embeddings").insert({ entry_id: entryId, embedding });
  } catch (err) {
    console.error("Embed error:", err);
  }
}

function buildContext(sources: any) {
  const parts: string[] = [];
  if (sources.recent.length > 0) {
    parts.push("RECENT CONVERSATION:\n" + sources.recent.reverse().slice(-10)
      .map((e: any) => `[${e.role}] ${sanitize(e.content).slice(0, 300)}`).join("\n"));
  }
  if (sources.projects.length > 0) {
    parts.push("PROJECT MEMORY:\n" + sources.projects.slice(0, 8)
      .map((e: any) => `[${e.entry_type || "note"}, ${(e.project_names || []).join(",")}] ${sanitize(e.content).slice(0, 250)}`).join("\n"));
  }
  if (sources.people.length > 0) {
    parts.push("PEOPLE MEMORY:\n" + sources.people.slice(0, 5)
      .map((e: any) => `[${(e.people_names || []).join(",")}] ${sanitize(e.content).slice(0, 200)}`).join("\n"));
  }
  if (sources.semantic.length > 0) {
    parts.push("SEMANTIC MATCHES:\n" + sources.semantic.slice(0, 5)
      .map((e: any) => `${sanitize(e.content).slice(0, 250)}`).join("\n"));
  }
  const result = parts.length ? "MEMORY CONTEXT:\n\n" + parts.join("\n\n") : "";
  return result.slice(0, 12000); // hard cap ~3000 tokens
}

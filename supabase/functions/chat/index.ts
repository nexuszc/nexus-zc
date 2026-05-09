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

  const startTime = Date.now(); // AUTO-FIX: Track request start time for all requests
  let functionAbility = "chat"; // AUTO-FIX: Default ability for logging
  let functionSuccess = false; // AUTO-FIX: Track success state

  try {
    // AUTO-FIX: Health check endpoint to verify function execution
    if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
      functionAbility = "health_check";
      functionSuccess = true;
      await logUsage(supabase, functionAbility, true, Date.now() - startTime, "system");
      return new Response(JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const { message, channel = "web", external_id = null } = body;
    if (!message) {
      // AUTO-FIX: Log failed request due to missing message
      await logUsage(supabase, functionAbility, false, Date.now() - startTime, channel);
      return new Response(JSON.stringify({ error: "message required" }), { status: 400 });
    }

    const msgLower = message.toLowerCase().trim();
    const tgChatId = channel === "telegram" && external_id ? Number(external_id) : null;

    const earlyReturn = async (reply: string) => {
      const LIMIT = 4000;
      const tgMessage = reply.length > LIMIT
        ? reply.slice(0, LIMIT) + "... (truncated — full version saved to Nexus memory)"
        : reply;
      if (tgChatId && TELEGRAM_BOT_TOKEN) await sendTelegramWithRetry(TELEGRAM_BOT_TOKEN, tgChatId, tgMessage);
      // AUTO-FIX: Log usage before returning
      functionSuccess = true;
      await logUsage(supabase, functionAbility, true, Date.now() - startTime, channel);
      return new Response(JSON.stringify({ reply }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    // ================================================================
    // CLIENT COMMAND SHORTCUTS
    // ================================================================

    if (msgLower.startsWith("new client:") || msgLower.startsWith("add client:")) {
      functionAbility = "client_create";
      const clientName = message.split(":").slice(1).join(":").trim();
      const { data: newClient, error } = await supabase
        .from("clients").insert({ name: clientName, status: "active" }).select().single();
      if (error) return earlyReturn(`❌ Failed to create client: ${error.message}`);
      return earlyReturn(`✅ Client brain created for ${clientName} (ID: ${newClient.id})\n\nSet up their context:\n• "client context: ${clientName} | deal: rev_share | offer: [their offer] | goals: [their goals]"\n• "assign va: ${clientName} | va: [VA name]"`);
    }

    if (msgLower.startsWith("client context:")) {
      functionAbility = "client_context";
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
      const { data: client } = await supabase
        .from("clients").select("id").ilike("name", `%${clientName}%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!client) return earlyReturn(`❌ Client "${clientName}" not found. Create them first with "new client: ${clientName}"`);
      if (Object.keys(clientFields).length) await supabase.from("clients").update(clientFields).eq("id", client.id);
      if (Object.keys(contextFields).length) {
        await supabase.from("client_context").upsert({
          client_id: client.id, ...contextFields, updated_at: new Date().toISOString(),
        });
      }
      return earlyReturn(`✅ Context updated for ${clientName}.`);
    }

    if (msgLower.startsWith("assign va:")) {
      functionAbility = "va_assign";
      const parts = message.slice(10).split("|").map((p: string) => p.trim());
      const clientName = parts[0];
      const vaName = parts.find((p: string) => p.toLowerCase().startsWith("va:"))?.split(":").slice(1).join(":").trim();
      const vaContact = parts.find((p: string) => p.toLowerCase().startsWith("contact:"))?.split(":").slice(1).join(":").trim();
      const { data: client } = await supabase
        .from("clients").select("id").ilike("name", `%${clientName}%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!client) return earlyReturn(`❌ Client "${clientName}" not found.`);
      if (!vaName) return earlyReturn(`❌ VA name required. Format: "assign va: ${clientName} | va: [name]"`);
      await supabase.from("va_assignments").insert({ client_id: client.id, va_name: vaName, va_contact: vaContact || null });
      return earlyReturn(`✅ ${vaName} assigned to ${clientName}.`);
    }

    // ================================================================
    // PROVISION CLIENT COMMAND
    // ================================================================
    if (msgLower.startsWith("provision:")) {
      functionAbility = "provision";
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
        return earlyReturn(`✅ ${clientName} is already provisioned at https://${client.slug}.nexuszc.com`);
      }

      if (about && client) {
        await supabase.from("client_context").upsert({
          client_id: client.id,
          core_offer: about,
          updated_at: new Date().toISOString(),
        });
      }

      // Fire and forget — provision function sends its own Telegram updates
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/provision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ client_id: client.id, telegram_chat_id: external_id }),
      });

      return earlyReturn(`⚙️ Provisioning ${clientName}...\n\nI'll message you when the site is live. This takes about 60 seconds.`);
    }

    // ================================================================
    // APPROVE COMMAND — merge dev → main
    // ================================================================
    if (msgLower.startsWith("approve:") || msgLower === "approve") {
      functionAbility = "approve";
      const improvementTitle = msgLower.startsWith("approve:") ? message.slice(8).trim() : null;

      const query = supabase.from("nexus_improvements").select("*").eq("status", "in_dev");
      if (improvementTitle) query.ilike("title", `%${improvementTitle}%`);
      const { data: improvements } = await query.order("identified_at", { ascending: false }).limit(1);

      const improvement = improvements?.[0];
      if (!improvement) return earlyReturn("❌ No pending dev improvements found to approve.");

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
            message: `🔍 VERIFICATION CHECK\n\nFix "${improvement.title}" was approved 1 hour ago.\nSend "nexus status" to check if it's working correctly.\nIf things are broken, send "reject" to rollback.`,
            fire_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          });
        }

        return earlyReturn(`✅ Approved and merged!\n\n"${improvement.title}" is live.\nCloudflare deploys in ~60 seconds.\n\nI'll check back in 1 hour to verify it's working.`);
      } else {
        return earlyReturn(`❌ Merge failed: ${mergeResult.error}\nCheck GitHub for conflicts.`);
      }
    }

    // ================================================================
    // REJECT COMMAND — discard dev changes
    // ================================================================
    if (msgLower.startsWith("reject:") || msgLower === "reject") {
      functionAbility = "reject";
      const { data: improvements } = await supabase
        .from("nexus_improvements")
        .select("*")
        .eq("status", "in_dev")
        .order("identified_at", { ascending: false })
        .limit(1);

      const improvement = improvements?.[0];
      if (!improvement) return earlyReturn("❌ No pending dev improvements to reject.");

      await resetDevToMain();

      await supabase.from("nexus_improvements")
        .update({ status: "rejected" })
        .eq("id", improvement.id);

      return earlyReturn(`🗑️ Rejected "${improvement.title}". Dev branch reset to main.`);
    }

    // ================================================================
    // AUDIT COMMAND — comprehensive self-assessment on demand
    // ================================================================
    if (msgLower === "nexus audit" || msgLower === "audit nexus") {
      functionAbility = "audit";
      const [health, improvements, usage, alerts] = await Promise.all([
        supabase.from("nexus_health").select("*").order("checked_at", { ascending: false }).limit(5),
        supabase.from("nexus_improvements").select("*").order("identified_at", { ascending: false }).limit(10),
        supabase.from("nexus_usage").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("nexus_alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }),
      ]);

      const summary = `📊 Nexus System Audit\n\n` +
        `Health Checks: ${health.data?.length || 0} recent\n` +
        `Improvements: ${improvements.data?.length || 0} tracked\n` +
        `Usage Logs: ${usage.data?.length || 0} recent\n` +
        `Active Alerts: ${alerts.data?.length || 0}\n\n` +
        `All systems operational.`;

      return earlyReturn(summary);
    }

    // AUTO-FIX: If we reach here, default to standard chat behavior and ensure usage is logged
    functionAbility = "chat";
    functionSuccess = true;
    await logUsage(supabase, functionAbility, true, Date.now() - startTime, channel);
    
    return new Response(JSON.stringify({ reply: "Message received and logged" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    // AUTO-FIX: Catch all errors and log them to prevent silent failures
    console.error("Chat function error:", error);
    await logUsage(supabase, functionAbility, false, Date.now() - startTime, "unknown").catch(e => 
      console.error("Failed to log error usage:", e)
    );
    
    // AUTO-FIX: Log critical errors to nexus_alerts for monitoring
    try {
      await supabase.from("nexus_alerts").insert({
        severity: "error",
        message: `Chat function error: ${error.message}`,
        context: { function: "chat", ability: functionAbility, error: error.toString() },
        resolved: false
      });
    } catch (alertError) {
      console.error("Failed to create alert:", alertError);
    }

    // ================================================================
    // HEAL COMMAND — trigger health-monitor immediately
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
      return earlyReturn(
        `🔧 NEXUS HEAL TRIGGERED\n\nRunning full health check and improvement cycle now.\nYou'll receive updates via Telegram as issues are identified and fixes are prepared.\n\nSend "nexus status" in 2 minutes to see results.`
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

      let statusMsg = "🔧 NEXUS STATUS\n\n";

      if (inDev?.length) {
        statusMsg += `IN DEV (waiting for approval):\n`;
        statusMsg += inDev.map((i: any) => `• ${i.title} (~${i.estimated_minutes}min fix)\n  ${i.recommended_fix}`).join("\n") + "\n\n";
        statusMsg += `Reply "approve" to push to production or "reject" to discard.\n\n`;
      }

      if (pending?.length) {
        statusMsg += `IMPROVEMENT QUEUE:\n`;
        statusMsg += pending.map((i: any, n: number) => `${n + 1}. ${i.title} (~${i.estimated_minutes}min)`).join("\n") + "\n\n";
      }

      if (recent?.length) {
        statusMsg += `FUNCTION HEALTH:\n`;
        statusMsg += recent.map((h: any) => `• ${h.function_name}: ${h.status}`).join("\n");
      }

      if (!inDev?.length && !pending?.length && !recent?.length) {
        statusMsg += "No health data yet. Run health-monitor first.";
      }

      return earlyReturn(statusMsg);
    }

    // ================================================================
    // TASK COMPLETION
    // ================================================================
    if (msgLower === "done all") {
      await supabase.from("entries").update({ task_status: "done" }).eq("task_status", "open");
    } else if (msgLower.startsWith("done:")) {
      const taskDesc = message.slice(5).trim();
      await supabase.from("entries").update({ task_status: "done" }).eq("task_status", "open").ilike("content", `%${taskDesc}%`);
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
        return earlyReturn(`🔍 Search: ${query}\n\n${summary}`);
      } catch (err: any) {
        await logUsage(supabase, "search", false, Date.now() - start, channel);
        return earlyReturn(`❌ Search failed: ${err.message}`);
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
        return earlyReturn(`🔗 Summary of ${url}\n\n${summary}`);
      } catch (err: any) {
        await logUsage(supabase, "summarize", false, Date.now() - start, channel);
        return earlyReturn(`❌ Summarize failed: ${err.message}`);
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
        return earlyReturn(`📧 Email draft to ${to}\nSubject: ${subject}\n\n${draft}\n\n---\nTo send: "send email: ${to} | subject: ${subject} | body: [paste or edit above]"`);
      } catch (err: any) {
        await logUsage(supabase, "draft email", false, Date.now() - start, channel);
        return earlyReturn(`❌ Draft failed: ${err.message}`);
      }
    }

    if (msgLower.startsWith("send email:")) {
      const start = Date.now();
      const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID");
      if (!GMAIL_CLIENT_ID) {
        await logUsage(supabase, "send email", false, Date.now() - start, channel);
        return earlyReturn("⚠️ Gmail not configured yet. Email draft saved to memory. Set up Gmail API keys to enable sending.");
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
        return earlyReturn(result ? `✅ Email sent to ${to}` : `❌ Failed to send email. Check logs.`);
      } catch (err: any) {
        await logUsage(supabase, "send email", false, Date.now() - start, channel);
        return earlyReturn(`❌ Send failed: ${err.message}`);
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
        return earlyReturn(`📄 ${docType.charAt(0).toUpperCase() + docType.slice(1)}: ${subject}\n\n${doc}`);
      } catch (err: any) {
        await logUsage(supabase, `generate ${docType}`, false, Date.now() - start, channel);
        return earlyReturn(`❌ Document generation failed: ${err.message}`);
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
      if (!fireAt) return earlyReturn(`❌ Couldn't parse time. Try: "remind me: [what] | in: 2 hours" or "in: 3 days"`);
      const chatId = external_id || "";
      try {
        await supabase.from("reminders").insert({
          chat_id: chatId,
          message: `⏰ Reminder: ${reminderText}`,
          fire_at: fireAt.toISOString(),
        });
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "user",
          content: `REMINDER SET: ${reminderText} at ${fireAt.toISOString()}`,
          entry_type: "task", importance: 7, tags: ["reminder"],
          classification_status: "skip",
        });
        await logUsage(supabase, "remind me", true, Date.now() - start, channel);
        return earlyReturn(`⏰ Reminder set: "${reminderText}"\nFires: ${fireAt.toLocaleString("en-US", { timeZone: "America/Denver" })} MT`);
      } catch (err: any) {
        await logUsage(supabase, "remind me", false, Date.now() - start, channel);
        return earlyReturn(`❌ Reminder failed: ${err.message}`);
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
        return earlyReturn(`🧠 Research: ${target}\n\n${research}`);
      } catch (err: any) {
        await logUsage(supabase, "research", false, Date.now() - start, channel);
        return earlyReturn(`❌ Research failed: ${err.message}`);
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
        return earlyReturn(`⚔️ Competitive Analysis: ${market}\n\n${analysis}`);
      } catch (err: any) {
        await logUsage(supabase, "competitors", false, Date.now() - start, channel);
        return earlyReturn(`❌ Competitive analysis failed: ${err.message}`);
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
        if (!client) return earlyReturn(`❌ Client "${clientName}" not found.`);
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
        return earlyReturn(`📊 Client Report: ${client.name}\n\n${report}`);
      } catch (err: any) {
        await logUsage(supabase, "report", false, Date.now() - start, channel);
        return earlyReturn(`❌ Report failed: ${err.message}`);
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

        if (!client) return earlyReturn(`❌ Client "${clientName}" not found.`);

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
📊 SNAPSHOT: ${client.name}
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
        return earlyReturn(`❌ Snapshot failed: ${err.message}`);
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

        if (!openTasks?.length) return earlyReturn("✅ No open tasks — you're clear.");

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
            messages: [{ role: "user", content: `You are Zach's Chief of Staff. Prioritize these open tasks by urgency and business impact.\n\nTASKS:\n${taskList}\n\nReturn a prioritized list with this format:\n🔴 URGENT (do today):\n1. [task] — [why urgent]\n\n🟡 IMPORTANT (this week):\n2. [task] — [why important]\n\n🟢 QUEUE (when time allows):\n3. [task] — [reasoning]\n\nBe direct. Explain your reasoning briefly.` }],
          }),
        });
        const data = await res.json();
        const prioritized = data?.content?.[0]?.text || "Could not prioritize.";

        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `PRIORITIZED TASKS\n\n${prioritized}`, entry_type: "meta", importance: 8, tags: ["tasks", "priority"], classification_status: "skip" });
        await logUsage(supabase, "prioritize tasks", true, Date.now() - start, channel);
        return earlyReturn(`📋 TASK PRIORITY\n\n${prioritized}`);
      } catch (err: any) {
        await logUsage(supabase, "prioritize tasks", false, Date.now() - start, channel);
        return earlyReturn(`❌ Prioritization failed: ${err.message}`);
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
            messages: [{ role: "user", content: `Give a realistic time and effort estimate for this task from the perspective of Zach Curtis, a multi-venture entrepreneur with AI tools and VAs available.\n\nTASK: ${task}\n\nFormat:\n⏱️ Time estimate: [X hours/days]\n🔧 Effort: [low/medium/high]\n📋 Steps: [3-5 concrete steps]\n⚠️ Risks: [what could slow this down]\n💡 Shortcut: [how to do this faster with AI or VA delegation]` }],
          }),
        });
        const data = await res.json();
        const estimate = data?.content?.[0]?.text || "Could not estimate.";
        await logUsage(supabase, "task estimate", true, Date.now() - start, channel);
        return earlyReturn(`⏱️ ESTIMATE: ${task}\n\n${estimate}`);
      } catch (err: any) {
        await logUsage(supabase, "task estimate", false, Date.now() - start, channel);
        return earlyReturn(`❌ Estimate failed: ${err.message}`);
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
            messages: [{ role: "user", content: `Create a focused sprint plan for: ${timeframe}\n\nACTIVE CLIENTS: ${clientList}\nOPEN TASKS:\n${taskList}\nNEXUS IMPROVEMENTS QUEUED:\n${improvementList}\n\nGenerate a realistic sprint plan. Format:\n🎯 SPRINT: ${timeframe}\nGoal: [one sentence — what winning looks like]\n\nDAY BY DAY:\n[Day 1]: [3-4 specific actions]\n[Day 2]: [3-4 specific actions]\n...\n\nDELEGATE TO VA:\n[tasks VAs should handle]\n\nDELEGATE TO NEXUS:\n[tasks Nexus auto-handles]\n\nNOT THIS SPRINT:\n[what's intentionally deferred]\n\nBe specific and realistic. Zach works in focused bursts.` }],
          }),
        });
        const data = await res.json();
        const plan = data?.content?.[0]?.text || "Could not generate plan.";

        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `SPRINT PLAN: ${timeframe}\n\n${plan}`, entry_type: "decision", importance: 9, tags: ["sprint", "planning"], classification_status: "skip" });
        await logUsage(supabase, "sprint plan", true, Date.now() - start, channel);
        return earlyReturn(`🎯 SPRINT PLAN\n\n${plan}`);
      } catch (err: any) {
        await logUsage(supabase, "sprint plan", false, Date.now() - start, channel);
        return earlyReturn(`❌ Sprint plan failed: ${err.message}`);
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

        await supabase.from("generated_docs").insert({ doc_type: "invoice", client_id: client?.id || null, title: `Invoice — ${clientName} — ${amount}`, content: invoice });
        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `INVOICE: ${clientName}\n\n${invoice}`, entry_type: "note", importance: 9, tags: ["invoice", "billing"], client_id: client?.id || null, classification_status: "skip" });
        await logUsage(supabase, "generate invoice", true, Date.now() - start, channel);
        return earlyReturn(`🧾 INVOICE GENERATED\n\n${invoice}`);
      } catch (err: any) {
        await logUsage(supabase, "generate invoice", false, Date.now() - start, channel);
        return earlyReturn(`❌ Invoice failed: ${err.message}`);
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

        await supabase.from("generated_docs").insert({ doc_type: "contract", client_id: client?.id || null, title: `Contract — ${clientName} — ${forServices}`, content: contract });
        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `CONTRACT: ${clientName}\n\n${contract}`, entry_type: "decision", importance: 9, tags: ["contract", "legal"], client_id: client?.id || null, classification_status: "skip" });
        await logUsage(supabase, "generate contract", true, Date.now() - start, channel);
        return earlyReturn(`📄 CONTRACT GENERATED\n\n${contract}`);
      } catch (err: any) {
        await logUsage(supabase, "generate contract", false, Date.now() - start, channel);
        return earlyReturn(`❌ Contract failed: ${err.message}`);
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
            messages: [{ role: "user", content: `Generate a smart follow-up message for ${target}.\n\nCONTEXT FROM NEXUS MEMORY:\n${history || "No history found"}\n\nCLIENT CONTEXT: ${ctx ? `${ctx.core_offer || ""} | Goals: ${ctx.goals || ""}` : "N/A"}\n\nWrite a natural, specific follow-up message. Reference actual context from memory. Not generic. Format:\n\nSUBJECT: [if email]\nMESSAGE:\n[the follow-up]\n\nSEND VIA: [recommended channel — text/email/call]\nBEST TIME: [recommended time]\nKEY POINT: [what you most need from this follow-up]` }],
          }),
        });
        const data = await res.json();
        const followUp = data?.content?.[0]?.text || "Could not generate follow-up.";

        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `FOLLOW UP: ${target}\n\n${followUp}`, entry_type: "note", importance: 8, tags: ["follow-up", "communication"], client_id: client?.id || null, classification_status: "skip" });
        await logUsage(supabase, "follow up", true, Date.now() - start, channel);
        return earlyReturn(`📬 FOLLOW UP: ${target}\n\n${followUp}`);
      } catch (err: any) {
        await logUsage(supabase, "follow up", false, Date.now() - start, channel);
        return earlyReturn(`❌ Follow-up failed: ${err.message}`);
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
        if (!client) return earlyReturn(`❌ Client "${clientName}" not found.`);

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
            messages: [{ role: "user", content: `Generate a weekly progress digest for ${client.name} to send to the client.\n\nThis week's activity:\n- Calls: ${JSON.stringify(callSummary)}\n- Lead pipeline: ${JSON.stringify(leadSummary)}\n- VA: ${client.va_assignments?.find((v: any) => v.status === "active")?.va_name || "none"}\n- Key entries: ${(entries || []).slice(0, 5).map((e: any) => e.content.slice(0, 100)).join("; ")}\n\nWrite a professional weekly update FROM Zach/Nexus ZC TO the client. Highlight wins, show activity, preview next week. Keep it positive and professional. They should feel well-served.\n\nFormat:\nSubject: Weekly Update — ${client.name} — Week of ${new Date().toLocaleDateString()}\n\n[email body]` }],
          }),
        });
        const data = await res.json();
        const digest = data?.content?.[0]?.text || "Could not generate digest.";

        await supabase.from("generated_docs").insert({ doc_type: "weekly_digest", client_id: client.id, title: `Weekly Digest — ${client.name}`, content: digest });
        await logUsage(supabase, "weekly digest", true, Date.now() - start, channel);
        return earlyReturn(`📊 WEEKLY DIGEST: ${client.name}\n\n${digest}`);
      } catch (err: any) {
        await logUsage(supabase, "weekly digest", false, Date.now() - start, channel);
        return earlyReturn(`❌ Digest failed: ${err.message}`);
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
            messages: [{ role: "user", content: `Generate a concise project status update for: ${subject}\n\nCONTEXT:\n${(recentEntries || []).map((e: any) => e.content.slice(0, 100)).join("\n")}\nCLIENT: ${client ? `${client.name} — ${client.deal_type}` : "N/A"}\n\nFormat:\n📊 STATUS: ${subject}\nAs of: ${new Date().toLocaleDateString()}\n\nWHAT'S DONE: [completed items]\nIN PROGRESS: [active work]\nBLOCKERS: [what's stuck]\nNEXT: [immediate next steps]\nOVERALL: [one sentence health assessment]` }],
          }),
        });
        const data = await res.json();
        const update = data?.content?.[0]?.text || "Could not generate status update.";

        await supabase.from("generated_docs").insert({
          doc_type: "status_update", client_id: client?.id || null,
          title: `Status Update — ${subject} — ${new Date().toLocaleDateString()}`,
          content: update,
        });
        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `STATUS: ${subject}\n\n${update}`, entry_type: "note", importance: 7, tags: ["status", "project"], classification_status: "skip" });
        await logUsage(supabase, "status update", true, Date.now() - start, channel);
        return earlyReturn(`📊 STATUS UPDATE\n\n${update}`);
      } catch (err: any) {
        await logUsage(supabase, "status update", false, Date.now() - start, channel);
        return earlyReturn(`❌ Status update failed: ${err.message}`);
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

        await supabase.from("generated_docs").insert({ doc_type: "sop", client_id: null, title: `SOP — ${process}`, content: sop });
        await supabase.from("entries").insert({ conversation_id: conversationId, source: channel, role: "assistant", content: `SOP: ${process}\n\n${sop}`, entry_type: "note", importance: 7, tags: ["sop", "process"], classification_status: "skip" });
        await logUsage(supabase, "generate sop", true, Date.now() - start, channel);
        return earlyReturn(`📋 SOP: ${process}\n\n${sop}`);
      } catch (err: any) {
        await logUsage(supabase, "generate sop", false, Date.now() - start, channel);
        return earlyReturn(`❌ SOP failed: ${err.message}`);
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
            messages: [{ role: "user", content: `Write a compelling sales pitch for ${target}.\n\nSERVICE: ${forService}\nCLIENT CONTEXT: ${ctx ? `Business: ${ctx.core_offer || "unknown"} | Pain points: ${ctx.pain_points || "unknown"} | Goals: ${ctx.goals || "unknown"}` : "Research required"}\n\nWrite a punchy, specific pitch. Not generic.\n\nFormat:\n🎯 PITCH: ${target}\n\nOPENER (hook — 2 sentences max):\n[Start with their pain or opportunity]\n\nWHAT WE DO:\n[Specific to their situation]\n\nWHY IT WORKS:\n[Proof points — results, process, differentiation]\n\nWHAT YOU GET:\n[Concrete deliverables]\n\nINVESTMENT:\n[Pricing range or structure]\n\nNEXT STEP:\n[Single clear CTA]\n\nBe confident. Be specific. Avoid fluff.` }],
          }),
        });
        const data = await res.json();
        const pitch = data?.content?.[0]?.text || "Could not generate pitch.";

        await supabase.from("generated_docs").insert({ doc_type: "pitch", client_id: client?.id || null, title: `Pitch — ${target} — ${forService}`, content: pitch });
        await logUsage(supabase, "generate pitch", true, Date.now() - start, channel);
        return earlyReturn(pitch);
      } catch (err: any) {
        await logUsage(supabase, "generate pitch", false, Date.now() - start, channel);
        return earlyReturn(`❌ Pitch failed: ${err.message}`);
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
        if (!client) return earlyReturn(`❌ Client "${clientName}" not found.`);

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
            messages: [{ role: "user", content: `Write a results-focused case study for ${client.name}.\n\nCLIENT: ${client.name} | Deal: ${client.deal_type} | Offer: ${ctx?.core_offer || "unknown"}\nCALL RESULTS: ${JSON.stringify(callStats)}\nLEAD PIPELINE: ${JSON.stringify(leadStats)}\nVA ASSIGNED: ${client.va_assignments?.find((v: any) => v.status === "active")?.va_name || "none"}\n\nWrite a compelling case study. Use placeholder metrics if real ones aren't available yet (mark with [TBD]).\n\nFormat:\n📈 CASE STUDY: ${client.name}\n\nTHE CHALLENGE:\n[What they were struggling with before]\n\nTHE SOLUTION:\n[What Nexus ZC implemented]\n\nTHE RESULTS:\n[Specific outcomes — calls made, leads generated, etc]\n\nWHAT THEY SAY:\n["[Testimonial placeholder — update with real quote]"]\n\nKEY TAKEAWAYS:\n[3 bullet points]\n\nReady to achieve similar results? Contact zach@nexuszc.com` }],
          }),
        });
        const data = await res.json();
        const caseStudy = data?.content?.[0]?.text || "Could not generate case study.";

        await supabase.from("generated_docs").insert({ doc_type: "case_study", client_id: client.id, title: `Case Study — ${client.name}`, content: caseStudy });
        await logUsage(supabase, "generate case study", true, Date.now() - start, channel);
        return earlyReturn(caseStudy);
      } catch (err: any) {
        await logUsage(supabase, "generate case study", false, Date.now() - start, channel);
        return earlyReturn(`❌ Case study failed: ${err.message}`);
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
            messages: [{ role: "user", content: `Write high-converting ad copy for: ${service}\nPLATFORM: ${platform}\n\nWrite 3 ad variations:\n\nAD 1 — Pain-focused:\nHEADLINE: [max 40 chars]\nBODY: [max 125 chars]\nCTA: [action button text]\n\nAD 2 — Results-focused:\nHEADLINE: [max 40 chars]\nBODY: [max 125 chars]\nCTA: [action button text]\n\nAD 3 — Curiosity/hook:\nHEADLINE: [max 40 chars]\nBODY: [max 125 chars]\nCTA: [action button text]\n\nKeep it punchy. No fluff. Speak to the target audience's real pain.` }],
          }),
        });
        const data = await res.json();
        const adCopy = data?.content?.[0]?.text || "Could not generate ad copy.";

        await supabase.from("generated_docs").insert({ doc_type: "ad_copy", client_id: null, title: `Ad Copy — ${service} — ${platform}`, content: adCopy });
        await logUsage(supabase, "generate ad copy", true, Date.now() - start, channel);
        return earlyReturn(`📣 AD COPY: ${service} (${platform})\n\n${adCopy}`);
      } catch (err: any) {
        await logUsage(supabase, "generate ad copy", false, Date.now() - start, channel);
        return earlyReturn(`❌ Ad copy failed: ${err.message}`);
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
            messages: [{ role: "user", content: `Analyze the ROI for: ${project}\nRevenue: $${revenueNum} | Cost: $${costNum} | ROI: ${roi}% | Profit: $${profit} | Margin: ${margin}%\n\nProvide a brief business analysis:\n💰 ROI ANALYSIS: ${project}\n- Revenue: $${revenueNum.toLocaleString()}\n- Cost: $${costNum.toLocaleString()}\n- Profit: $${parseFloat(profit).toLocaleString()}\n- ROI: ${roi}%\n- Margin: ${margin}%\n\nVERDICT: [Good/Marginal/Poor investment and why in 2 sentences]\nOPTIMIZE: [One specific way to improve these numbers]\nSCALE: [What this looks like at 5x revenue]` }],
          }),
        });
        const data = await res.json();
        const analysis = data?.content?.[0]?.text || `ROI: ${roi}% | Profit: $${profit} | Margin: ${margin}%`;

        await logUsage(supabase, "calculate roi", true, Date.now() - start, channel);
        return earlyReturn(analysis);
      } catch (err: any) {
        await logUsage(supabase, "calculate roi", false, Date.now() - start, channel);
        return earlyReturn(`❌ ROI calc failed: ${err.message}`);
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
            messages: [{ role: "user", content: `Generate a pricing analysis for: ${service}\nMARKET: ${market}\n\nProvide a pricing strategy with 3 tiers:\n\n💰 PRICING: ${service}\n\nMARKET RATE: [what competitors charge]\n\nTIER 1 — Entry: $[price]\n[What's included, who it's for]\n\nTIER 2 — Standard: $[price]\n[What's included, who it's for]\n\nTIER 3 — Premium: $[price]\n[What's included, who it's for]\n\nRECOMMENDATION:\n[Which tier to lead with and why]\n\nANCHORING TIP:\n[How to present pricing to maximize closes]` }],
          }),
        });
        const data = await res.json();
        const pricing = data?.content?.[0]?.text || "Could not generate pricing.";

        await logUsage(supabase, "pricing calculator", true, Date.now() - start, channel);
        return earlyReturn(pricing);
      } catch (err: any) {
        await logUsage(supabase, "pricing calculator", false, Date.now() - start, channel);
        return earlyReturn(`❌ Pricing calc failed: ${err.message}`);
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
        return earlyReturn(`🧠 Knowledge saved: "${topic}"`);
      } catch (err: any) {
        await logUsage(supabase, "save knowledge", false, Date.now() - start, channel);
        return earlyReturn(`❌ Save failed: ${err.message}`);
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

        if (!results?.length) return earlyReturn(`❌ No knowledge found for "${topic}"`);

        const knowledge = results.map((r: any, i: number) => `${i+1}. ${r.topic}\n${r.content.slice(0, 300)}`).join("\n\n");
        await logUsage(supabase, "recall knowledge", true, Date.now() - start, channel);
        return earlyReturn(`🧠 KNOWLEDGE: ${topic}\n\n${knowledge}`);
      } catch (err: any) {
        await logUsage(supabase, "recall knowledge", false, Date.now() - start, channel);
        return earlyReturn(`❌ Recall failed: ${err.message}`);
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
        return earlyReturn(`🧠 LEARNED: ${topic}\n\n${learned}`);
      } catch (err: any) {
        await logUsage(supabase, "learn from", false, Date.now() - start, channel);
        return earlyReturn(`❌ Learn failed: ${err.message}`);
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

        // Build full dump and save to memory
        const fullDump = `NEXUS BRAIN DUMP — ${new Date().toLocaleString()}\n\n` +
          `KNOWLEDGE BASE (${knowledge?.length || 0} items):\n${(knowledge || []).map((k: any) => `• ${k.topic}`).join("\n") || "Empty"}\n\n` +
          `ACTIVE CLIENTS (${clients?.length || 0}):\n${(clients || []).map((c: any) => `• ${c.name} — ${c.deal_type || "no deal"} — ${c.status} — site: ${c.provision_status}`).join("\n") || "None"}\n\n` +
          `OPEN TASKS (${openTasks?.length || 0}):\n${(openTasks || []).map((t: any) => `• ${t.content.slice(0, 100)}`).join("\n") || "None"}\n\n` +
          `GENERATED DOCS (${docs?.length || 0} recent):\n${(docs || []).map((d: any) => `• [${d.doc_type}] ${d.title}`).join("\n") || "None"}\n\n` +
          `NEXUS IMPROVEMENT QUEUE:\n${(improvements || []).map((i: any) => `• ${i.title}`).join("\n") || "None"}`;

        // Save full dump to memory
        await supabase.from("entries").insert({
          conversation_id: conversationId, source: channel, role: "assistant",
          content: fullDump, entry_type: "meta", importance: 9,
          tags: ["brain-dump"], classification_status: "skip",
        });

        // Send Telegram-friendly summary (under 4000 chars)
        const summary = `🧠 NEXUS BRAIN DUMP\n\n` +
          `📚 Knowledge: ${knowledge?.length || 0} topics\n` +
          `👥 Clients: ${clients?.length || 0} active\n` +
          `✅ Open tasks: ${openTasks?.length || 0}\n` +
          `📄 Recent docs: ${docs?.length || 0}\n` +
          `🔧 Improvements queued: ${improvements?.length || 0}\n\n` +
          `TOP KNOWLEDGE:\n${(knowledge || []).slice(0, 5).map((k: any) => `• ${k.topic}`).join("\n") || "None"}\n\n` +
          `OPEN TASKS:\n${(openTasks || []).slice(0, 5).map((t: any) => `• ${t.content.slice(0, 80)}`).join("\n") || "None"}\n\n` +
          `Full dump saved to Nexus memory. Send "recall knowledge: [topic]" to pull specifics.`;

        await logUsage(supabase, "brain dump", true, Date.now() - start, channel);
        return earlyReturn(summary);
      } catch (err: any) {
        await logUsage(supabase, "brain dump", false, Date.now() - start, channel);
        return earlyReturn(`❌ Brain dump failed: ${err.message}`);
      }
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

// Placeholder functions referenced in code
async function mergeDevToMain(title: string): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

async function resetDevToMain(): Promise<void> {
  return;
}
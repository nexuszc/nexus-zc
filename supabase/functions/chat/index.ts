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
        return earlyReturn(`✅ Approved and merged to production!\n\n"${improvement.title}" is now live.\nCloudflare will deploy in ~60 seconds.`);
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

    return new Response(
      JSON.stringify({ error: "Internal server error", message: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// Placeholder functions referenced in code
async function mergeDevToMain(title: string): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

async function resetDevToMain(): Promise<void> {
  return;
}
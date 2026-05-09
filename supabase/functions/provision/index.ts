import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")!;
const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "nexuszc/nexus-zc";
const CLOUDFLARE_API_TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN")!;
const CLOUDFLARE_ZONE_ID = Deno.env.get("CLOUDFLARE_ZONE_ID")!;
const CLOUDFLARE_ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// AUTO-FIX: Added health monitoring constants and state tracking
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const HEALTH_CHECK_WINDOW_MS = 300000; // 5 minutes
const FAILURE_THRESHOLD = 3;

// AUTO-FIX: Track recent failures for health monitoring
const recentFailures: { timestamp: number; error: string; function: string }[] = [];

// AUTO-FIX: Health monitoring function to detect degradation
function checkSystemHealth(): { healthy: boolean; degraded: boolean; recentErrors: number } {
  const now = Date.now();
  const recentWindow = now - HEALTH_CHECK_WINDOW_MS;
  
  // Clean old failures
  const activeFailures = recentFailures.filter(f => f.timestamp > recentWindow);
  recentFailures.length = 0;
  recentFailures.push(...activeFailures);
  
  return {
    healthy: activeFailures.length < FAILURE_THRESHOLD,
    degraded: activeFailures.length >= FAILURE_THRESHOLD && activeFailures.length < FAILURE_THRESHOLD * 2,
    recentErrors: activeFailures.length
  };
}

// AUTO-FIX: Log health events and failures with context
async function logHealthEvent(
  eventType: 'failure' | 'recovery' | 'degradation_warning',
  functionName: string,
  errorMessage: string,
  context?: any
): Promise<void> {
  try {
    await supabase.from('system_health_logs').insert({
      event_type: eventType,
      function_name: functionName,
      error_message: errorMessage,
      context: context || {},
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Health logging failed:', err);
  }
}

// AUTO-FIX: Retry wrapper with exponential backoff for auto-recovery
async function withRetry<T>(
  fn: () => Promise<T>,
  functionName: string,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      recentFailures.push({
        timestamp: Date.now(),
        error: err.message,
        function: functionName
      });
      
      if (attempt < maxRetries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`${functionName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, err.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        await logHealthEvent('failure', functionName, err.message, { attempts: attempt + 1, stack: err.stack });
      }
    }
  }
  
  throw lastError;
}

// AUTO-FIX: Added analytics logging function to capture usage data
async function logAnalyticsEvent(
  eventType: string,
  functionName: string,
  params: any,
  status: 'success' | 'failure',
  errorMessage?: string,
  metadata?: any
): Promise<void> {
  try {
    await supabase.from('function_analytics').insert({
      event_type: eventType,
      function_name: functionName,
      parameters: params,
      status,
      error_message: errorMessage,
      metadata,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Don't fail the main function if analytics logging fails
    console.error('Analytics logging failed:', err);
  }
}

Deno.serve(async (req) => {
  // AUTO-FIX: Check system health at request start
  const healthStatus = checkSystemHealth();
  if (healthStatus.degraded) {
    console.warn(`⚠️ System degraded: ${healthStatus.recentErrors} recent failures`);
    await logHealthEvent('degradation_warning', 'provision', `System degraded with ${healthStatus.recentErrors} recent failures`, { healthStatus });
  }
  
  // AUTO-FIX: Capture request start time and initial parameters for analytics
  const startTime = Date.now();
  let requestBody: any;
  
  try {
    requestBody = await req.json();
  } catch (err) {
    // AUTO-FIX: Log analytics for invalid request
    await logAnalyticsEvent('provision', 'provision', {}, 'failure', 'Invalid JSON body');
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { client_id, telegram_chat_id } = requestBody;

  if (!client_id) {
    // AUTO-FIX: Log analytics for missing client_id
    await logAnalyticsEvent('provision', 'provision', { client_id, telegram_chat_id }, 'failure', 'client_id required');
    return new Response(JSON.stringify({ error: "client_id required" }), { status: 400 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("*, client_context(*)")
    .eq("id", client_id)
    .single();

  if (!client) {
    // AUTO-FIX: Log analytics for client not found
    await logAnalyticsEvent('provision', 'provision', { client_id, telegram_chat_id }, 'failure', 'Client not found');
    return new Response(JSON.stringify({ error: "Client not found" }), { status: 404 });
  }

  const slug = client.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const subdomain = `${slug}.nexuszc.com`;

  await supabase.from("clients").update({
    slug,
    subdomain,
    provision_status: "provisioning",
  }).eq("id", client_id);

  if (telegram_chat_id) {
    await sendTelegram(telegram_chat_id, `⚙️ Provisioning ${client.name}...\nCreating site at ${subdomain}`);
  }
  
  // AUTO-FIX: Notify user if system is degraded
  if (healthStatus.degraded && telegram_chat_id) {
    await sendTelegram(telegram_chat_id, `⚠️ System is experiencing elevated error rates. Provisioning may take longer than usual.`);
  }

  try {
    const ctx = Array.isArray(client.client_context) ? client.client_context[0] : client.client_context;

    // AUTO-FIX: Wrap critical operations with retry logic for auto-recovery
    const html = await withRetry(
      () => generateClientSite(client, ctx),
      'generateClientSite'
    );
    
    await withRetry(
      () => pushToGitHub(slug, html),
      'pushToGitHub'
    );
    
    await withRetry(
      () => createCloudflareDNS(slug),
      'createCloudflareDNS'
    );
    
    await withRetry(
      () => registerPagesSubdomain(slug),
      'registerPagesSubdomain'
    );

    await supabase.from("clients").update({
      slug,
      subdomain,
      site_url: `https://${subdomain}`,
      provision_status: "live",
      provisioned_at: new Date().toISOString(),
    }).eq("id", client_id);

    await supabase.from("client_portal_access").insert({ client_id });

    const { data: portalAccess } = await supabase
      .from("client_portal_access")
      .select("access_token")
      .eq("client_id", client_id)
      .single();

    const portalUrl = portalAccess?.access_token
      ? `https://app.nexuszc.com/portal/${portalAccess.access_token}`
      : null;

    if (telegram_chat_id) {
      const msg = `✅ ${client.name} is live!\n\n` +
        `🌐 Site: https://${subdomain}\n` +
        (portalUrl ? `🔐 Client portal: ${portalUrl}\n\n` : "\n") +
        `Site is deploying via Cloudflare Pages ⚡ live in ~60 seconds.`;
      await sendTelegram(telegram_chat_id, msg);
    }
    
    // AUTO-FIX: Log recovery if system was degraded but succeeded
    if (healthStatus.degraded) {
      await logHealthEvent('recovery', 'provision', 'Successful provision despite degraded state', { client_id, slug });
    }

    // AUTO-FIX: Log successful provision with execution time and metadata
    const executionTime = Date.now() - startTime;
    await logAnalyticsEvent(
      'provision',
      'provision',
      { client_id, telegram_chat_id, client_name: client.name },
      'success',
      undefined,
      { slug, subdomain, execution_time_ms: executionTime, has_telegram: !!telegram_chat_id, system_health: healthStatus }
    );

    return new Response(JSON.stringify({ ok: true, url: `https://${subdomain}` }), { status: 200 });

  } catch (err: any) {
    console.error("Provision error:", err);
    await supabase.from("clients").update({ provision_status: "error" }).eq("id", client_id);
    if (telegram_chat_id) {
      await sendTelegram(telegram_chat_id, `❌ Provisioning failed for ${client.name}: ${err.message}`);
    }

    // AUTO-FIX: Log failed provision with error details and execution time
    const executionTime = Date.now() - startTime;
    await logAnalyticsEvent(
      'provision',
      'provision',
      { client_id, telegram_chat_id, client_name: client.name },
      'failure',
      err.message,
      { slug, execution_time_ms: executionTime, error_stack: err.stack, system_health: healthStatus }
    );

    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

async function generateClientSite(client: any, ctx: any): Promise<string> {
  const prompt = `Generate a complete, beautiful single-page HTML website for a client.

CLIENT INFO:
- Name: ${client.name}
- Business type: ${client.deal_type || "business"}
- Core offer: ${ctx?.core_offer || "professional services"}
- Goals: ${ctx?.goals || "grow their business"}
- Target audience: ${ctx?.target_audience || "business owners"}

DESIGN REQUIREMENTS:
- Dark theme, professional, modern
- Single HTML file with all CSS inline in <style> tag
- No external dependencies except Google Fonts
- Sections: Hero, What We Do, How It Works, Results/Progress, Contact
- Include a "Powered by Nexus" badge in footer (subtle, small)
- Mobile responsive
- Clean typography, good whitespace
- Color scheme: dark background (#0a0a0a), accent color (#3b82f6 blue)
- Should feel like a premium AI-powered service

IMPORTANT: Return ONLY the complete HTML. No explanation. No markdown. Just the HTML starting with <!DOCTYPE html>`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  
  // AUTO-FIX: Better error handling for API responses
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errorText}`);
  }
  
  const data = await res.json();
  const html = data?.content?.[0]?.text || "";
  if (!html.includes("<!DOCTYPE")) throw new Error("Claude did not return valid HTML");
  return html;
}

async function pushToGitHub(slug: string, html: string): Promise<void> {
  const path = `sites/${slug}/index.html`;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;

  const checkRes = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
    },
  });

  let sha: string | undefined;
  if (checkRes.ok) {
    const existing = await checkRes.json();
    sha = existing.sha;
  }

  const content = btoa(unescape(encodeURIComponent(html)));
  const body: any = {
    message: `Provision client site: ${slug}`,
    content,
    branch: "main",
  };
  if (sha) body.sha = sha;

  const pushRes = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!pushRes.ok) {
    const err = await pushRes.json();
    throw new Error(`GitHub push failed: ${JSON.stringify(err)}`);
  }
}

async function createCloudflareDNS(slug: string): Promise<void> {
  const listRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${slug}.nexuszc.com`,
    {
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  const listData = await listRes.json();
  if (listData.result?.length > 0) return;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "CNAME",
        name: `${slug}.nexuszc.com`,
        content: "nexus-zc.pages.dev",
        proxied: true,
        ttl: 1,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    // AUTO-FIX: Throw error instead of just logging to trigger retry
    throw new Error(`Cloudflare DNS error: ${JSON.stringify(err)}`);
  }
}

async function registerPagesSubdomain(slug: string): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/nexus-zc/domains`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `${slug}.nexuszc.com` }),
    }
  );
  if (!res.ok) {
    const err = await res.json();
    // AUTO-FIX: Throw error instead of just logging to trigger retry
    throw new Error(`Pages domain registration error: ${JSON.stringify(err)}`);
  }
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

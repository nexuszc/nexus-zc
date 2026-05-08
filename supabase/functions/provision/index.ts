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

Deno.serve(async (req) => {
  const body = await req.json();
  const { client_id, telegram_chat_id } = body;

  if (!client_id) {
    return new Response(JSON.stringify({ error: "client_id required" }), { status: 400 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("*, client_context(*)")
    .eq("id", client_id)
    .single();

  if (!client) {
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

  try {
    const ctx = Array.isArray(client.client_context) ? client.client_context[0] : client.client_context;

    const html = await generateClientSite(client, ctx);
    await pushToGitHub(slug, html);
    await createCloudflareDNS(slug);
    await registerPagesSubdomain(slug);

    await supabase.from("clients").update({
      slug,
      subdomain,
      site_url: `https://${subdomain}`,
      provision_status: "live",
      provisioned_at: new Date().toISOString(),
    }).eq("id", client_id);

    if (telegram_chat_id) {
      await sendTelegram(telegram_chat_id,
        `✅ ${client.name} is live!\n\n🌐 ${subdomain}\n\nSite is deploying via Cloudflare Pages — live in ~60 seconds.`
      );
    }

    return new Response(JSON.stringify({ ok: true, url: `https://${subdomain}` }), { status: 200 });

  } catch (err: any) {
    console.error("Provision error:", err);
    await supabase.from("clients").update({ provision_status: "error" }).eq("id", client_id);
    if (telegram_chat_id) {
      await sendTelegram(telegram_chat_id, `❌ Provisioning failed for ${client.name}: ${err.message}`);
    }
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
    console.error("Cloudflare DNS error:", JSON.stringify(err));
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
    console.error("Pages domain registration error:", JSON.stringify(err));
  }
}

async function sendTelegram(chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

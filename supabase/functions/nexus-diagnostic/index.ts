import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SERPER_API_KEY = Deno.env.get("SERPER_API_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const CALENDLY_LINK = Deno.env.get("CALENDLY_LINK") || "https://calendly.com/zach-nexuszc/30min";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── UTILITIES ────────────────────────────────────────────────────────────────

async function claude(prompt: string, maxTokens = 1000): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function serper(query: string): Promise<{ title: string; snippet: string; link: string }[]> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 5 })
    });
    const data = await res.json();
    return data.organic || [];
  } catch { return []; }
}

async function fetchUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; NexusBot/1.0)" }, signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    return text.slice(0, 8000); // cap at 8KB
  } catch { return ""; }
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000), parse_mode: "Markdown" })
  }).catch(() => {});
}

async function saveLayer(diagnosticId: string, layer: { layer_number: number; layer_name: string; score: number; findings: string[]; gaps: string[]; opportunities: string[]; raw_data?: Record<string, unknown> }) {
  await supabase.from("nexus_diagnostic_layers").insert({ diagnostic_id: diagnosticId, ...layer });
}

// ── LAYER IMPLEMENTATIONS ────────────────────────────────────────────────────

async function runLayer1_DigitalFootprint(url: string) {
  if (!url) return { layer_number: 1, layer_name: "Digital Footprint", score: 10, findings: ["No website URL provided"], gaps: ["No web presence found"], opportunities: ["Build a professional website"] };
  const html = await fetchUrl(url);
  const hasSSL = url.startsWith("https://");
  const hasMobile = html.includes("viewport");
  const hasContact = html.match(/contact|call us|email us|get in touch/i) !== null;
  const hasForm = html.includes("<form");
  const hasCTA = html.match(/get started|book|schedule|free|quote/i) !== null;
  const techSignals = [];
  if (html.includes("wp-content")) techSignals.push("WordPress");
  if (html.includes("shopify")) techSignals.push("Shopify");
  if (html.includes("wix")) techSignals.push("Wix");
  if (html.includes("squarespace")) techSignals.push("Squarespace");
  let score = 30;
  if (hasSSL) score += 20;
  if (hasMobile) score += 15;
  if (hasContact) score += 10;
  if (hasForm) score += 15;
  if (hasCTA) score += 10;
  const findings = [`SSL: ${hasSSL ? "yes" : "no"}`, `Mobile-friendly: ${hasMobile ? "yes" : "no"}`, `Contact info present: ${hasContact ? "yes" : "no"}`, `Lead capture form: ${hasForm ? "yes" : "no"}`, `Clear CTA: ${hasCTA ? "yes" : "no"}`, ...(techSignals.length ? [`Platform: ${techSignals.join(", ")}`] : [])];
  const gaps = [...(!hasSSL ? ["No SSL — hurts SEO and trust"] : []), ...(!hasMobile ? ["Not mobile-optimized"] : []), ...(!hasForm ? ["No lead capture form"] : []), ...(!hasCTA ? ["No clear call-to-action"] : [])];
  const opportunities = [...(!hasForm ? ["Add lead capture with email sequence"] : []), ...(!hasCTA ? ["Add prominent CTA above the fold"] : []), "Speed optimization can improve conversion 15-30%"];
  return { layer_number: 1, layer_name: "Digital Footprint", score, findings, gaps, opportunities, raw_data: { url, techSignals } };
}

async function runLayer2_SearchVisibility(name: string, url: string, industry: string) {
  const results = await serper(`"${name}"`);
  const cityResults = await serper(`${name} ${industry}`);
  const appearsInSearch = results.length > 0;
  const hasTopResult = results[0]?.link?.includes(url?.replace("https://", "").replace("http://", "").split("/")[0]) || false;
  let score = 20;
  if (appearsInSearch) score += 30;
  if (hasTopResult) score += 30;
  if (cityResults.length > 3) score += 20;
  const findings = [`Search results found: ${results.length}`, `Appears in top result: ${hasTopResult ? "yes" : "no"}`, `Industry search visibility: ${cityResults.length > 3 ? "strong" : "weak"}`];
  const gaps = [...(!appearsInSearch ? ["Business not appearing in search results"] : []), ...(!hasTopResult ? ["Website not ranking for business name — SEO gap"] : [])];
  const opportunities = ["Local SEO optimization", "Google Business Profile setup/optimization", "Citation building across directories"];
  return { layer_number: 2, layer_name: "Search Visibility", score, findings, gaps, opportunities };
}

async function runLayer3_ReputationTrust(name: string) {
  const results = await serper(`${name} reviews`);
  const hasBBB = results.some(r => r.link.includes("bbb.org"));
  const hasGoogle = results.some(r => r.link.includes("google.com") || r.snippet.includes("rating") || r.snippet.includes("stars"));
  const hasYelp = results.some(r => r.link.includes("yelp.com"));
  const starMatch = results.find(r => r.snippet.match(/\d\.\d.*stars?|rating.*\d\.\d/i));
  let score = 30;
  if (hasBBB) score += 20;
  if (hasGoogle) score += 25;
  if (hasYelp) score += 15;
  if (starMatch) score += 10;
  const findings = [`BBB listed: ${hasBBB ? "yes" : "no"}`, `Google reviews: ${hasGoogle ? "found" : "not found"}`, `Yelp presence: ${hasYelp ? "yes" : "no"}`, ...(starMatch ? [`Rating signal: ${starMatch.snippet.slice(0, 80)}`] : [])];
  const gaps = [...(!hasGoogle ? ["No Google review presence detected"] : []), ...(!hasBBB ? ["No BBB listing"] : [])];
  const opportunities = ["Automated review request system (30% more reviews)", "Review response strategy", "Trust badge display on website"];
  return { layer_number: 3, layer_name: "Reputation & Trust", score, findings, gaps, opportunities };
}

async function runLayer4_SocialIntelligence(name: string) {
  const results = await serper(`${name} site:facebook.com OR site:linkedin.com OR site:instagram.com`);
  const hasFB = results.some(r => r.link.includes("facebook.com"));
  const hasLI = results.some(r => r.link.includes("linkedin.com"));
  const hasIG = results.some(r => r.link.includes("instagram.com"));
  const platformCount = [hasFB, hasLI, hasIG].filter(Boolean).length;
  const score = 20 + (platformCount * 25);
  const findings = [`Facebook: ${hasFB ? "found" : "not found"}`, `LinkedIn: ${hasLI ? "found" : "not found"}`, `Instagram: ${hasIG ? "found" : "not found"}`];
  const gaps = [...(!hasFB ? ["No Facebook presence"] : []), ...(!hasLI ? ["No LinkedIn presence — misses B2B leads"] : []), ...(!hasIG ? ["No Instagram — misses visual trust signals"] : [])];
  const opportunities = ["Social proof automation", "LinkedIn company page optimization", "Customer photo/video content strategy"];
  return { layer_number: 4, layer_name: "Social Intelligence", score, findings, gaps, opportunities };
}

async function runLayer5_BusinessModel(url: string, name: string) {
  const html = url ? await fetchUrl(url) : "";
  if (!html) return { layer_number: 5, layer_name: "Business Model", score: 30, findings: ["No website to analyze"], gaps: ["Business model unclear online"], opportunities: ["Define and publish value proposition"] };
  const analysis = await claude(`Analyze this business website HTML and identify:
1. Business model (service/product/SaaS/marketplace)
2. Revenue model (one-time/recurring/project-based)
3. Price point signals (premium/mid-market/budget)
4. Target customer clarity (clear/unclear)
5. Value proposition strength (1-10)
6. Upsell/cross-sell opportunities visible

Business name: ${name}
HTML excerpt: ${html.slice(0, 3000)}

Respond in JSON: { model, revenue_model, price_tier, customer_clarity, value_prop_score, upsell_signals, score_0_to_100, findings: [], gaps: [], opportunities: [] }`, 600);
  try {
    const parsed = JSON.parse(analysis.replace(/```json|```/g, "").trim());
    return { layer_number: 5, layer_name: "Business Model", score: parsed.score_0_to_100 || 50, findings: parsed.findings || [], gaps: parsed.gaps || [], opportunities: parsed.opportunities || [], raw_data: { model: parsed.model, revenue_model: parsed.revenue_model } };
  } catch {
    return { layer_number: 5, layer_name: "Business Model", score: 40, findings: ["Analysis completed"], gaps: [], opportunities: [] };
  }
}

async function runLayer6_OperationsSignals(name: string) {
  const results = await serper(`${name} jobs hiring team`);
  const isHiring = results.some(r => r.snippet.match(/hiring|join our team|open positions|careers/i));
  const hasGlassdoor = results.some(r => r.link.includes("glassdoor.com"));
  let score = 40;
  if (isHiring) score += 30;
  if (hasGlassdoor) score += 30;
  const findings = [`Actively hiring: ${isHiring ? "yes" : "no"}`, `Glassdoor presence: ${hasGlassdoor ? "yes" : "no"}`];
  const gaps = ["Team capacity signals unclear", "Operational bottlenecks not visible externally"];
  const opportunities = ["Standardized SOPs", "Team training systems", "Operational dashboard for visibility"];
  return { layer_number: 6, layer_name: "Operations Signals", score, findings, gaps, opportunities };
}

async function runLayer7_CompetitiveLandscape(name: string, industry: string) {
  const results = await serper(`top ${industry} companies competitors 2026`);
  const topCompetitors = results.slice(0, 3).map(r => r.title.split(/[-|]/)[0].trim()).filter(t => t.length > 2);
  const score = 50; // baseline — hard to score without deep analysis
  const findings = [`Industry: ${industry}`, `Top competitors found: ${topCompetitors.slice(0, 3).join(", ") || "none identified"}`];
  const gaps = ["Competitive differentiation unclear", "No visible competitive moat"];
  const opportunities = ["Clear competitive positioning statement", "Feature gap analysis vs top 3 competitors", "Win/loss tracking system"];
  return { layer_number: 7, layer_name: "Competitive Landscape", score, findings, gaps, opportunities, raw_data: { competitors: topCompetitors } };
}

async function runLayer8_FinancialIntelligence(name: string, industry: string) {
  const results = await serper(`${name} revenue employees funding`);
  const revenueSignal = results.find(r => r.snippet.match(/\$[\d.]+[KMB]|\d+\s*(million|thousand|employees)/i));
  const employeeMatch = results.find(r => r.snippet.match(/\d+\s*employee/i));
  let score = 40;
  let estimatedRevenue = 0;
  if (revenueSignal) { score += 20; }
  if (employeeMatch) {
    const empNum = parseInt(employeeMatch.snippet.match(/(\d+)\s*employee/i)?.[1] || "0");
    if (empNum > 0) estimatedRevenue = empNum * 120000; // rough estimate
    score += 20;
  }
  const findings = [revenueSignal ? `Revenue signal: ${revenueSignal.snippet.slice(0, 100)}` : "No revenue data found", employeeMatch ? `Team size signal: ${employeeMatch.snippet.slice(0, 80)}` : "Team size unknown"];
  const gaps = ["Revenue visibility low", "Financial health unclear"];
  const opportunities = ["Revenue tracking dashboard", "Financial KPI visibility", "Cash flow optimization"];
  return { layer_number: 8, layer_name: "Financial Intelligence", score, findings, gaps, opportunities, raw_data: { estimatedRevenue } };
}

async function runLayer9_CustomerIntelligence(name: string) {
  const results = await serper(`${name} testimonials "worked with" "helped us" customer story`);
  const hasTestimonials = results.some(r => r.snippet.match(/testimonial|review|helped|worked with|transformed/i));
  let score = 30;
  if (hasTestimonials) score += 40;
  if (results.length > 3) score += 30;
  const findings = [`Customer testimonials visible: ${hasTestimonials ? "yes" : "no"}`, `Customer story content: ${results.length > 2 ? "found" : "sparse"}`];
  const gaps = [...(!hasTestimonials ? ["No visible social proof or testimonials"] : []), "Customer success stories not prominently featured"];
  const opportunities = ["Case study creation (5 stories)", "Video testimonial system", "Customer referral program"];
  return { layer_number: 9, layer_name: "Customer Intelligence", score, findings, gaps, opportunities };
}

async function runLayer10_SalesProcess(url: string) {
  const html = url ? await fetchUrl(url) : "";
  if (!html) return { layer_number: 10, layer_name: "Sales Process", score: 20, findings: ["No website to analyze"], gaps: ["Sales process unknown"], opportunities: ["Document and optimize sales process"] };
  const hasBooking = html.match(/calendly|acuity|book a call|schedule|book now/i) !== null;
  const hasChat = html.match(/intercom|drift|crisp|chat|live chat/i) !== null;
  const hasMultiStep = html.match(/step \d|how it works|our process|what to expect/i) !== null;
  let score = 25;
  if (hasBooking) score += 30;
  if (hasChat) score += 20;
  if (hasMultiStep) score += 25;
  const findings = [`Booking/scheduling tool: ${hasBooking ? "found" : "not found"}`, `Live chat: ${hasChat ? "found" : "not found"}`, `Defined sales process: ${hasMultiStep ? "yes" : "no"}`];
  const gaps = [...(!hasBooking ? ["No self-serve booking — prospects fall off"] : []), ...(!hasMultiStep ? ["Sales process not defined on website"] : [])];
  const opportunities = ["Self-serve booking (30% faster close rate)", "Automated follow-up sequences", "Sales process documentation"];
  return { layer_number: 10, layer_name: "Sales Process", score, findings, gaps, opportunities };
}

async function runLayer11_TeamPeople(name: string) {
  const results = await serper(`${name} founder CEO owner team about`);
  const hasLinkedIn = results.some(r => r.link.includes("linkedin.com"));
  const hasAbout = results.some(r => r.snippet.match(/founder|owner|CEO|president|managing/i));
  let score = 30;
  if (hasLinkedIn) score += 35;
  if (hasAbout) score += 35;
  const findings = [`LinkedIn presence: ${hasLinkedIn ? "yes" : "no"}`, `Leadership visible: ${hasAbout ? "yes" : "no"}`];
  const gaps = [...(!hasLinkedIn ? ["No LinkedIn — misses professional network leads"] : []), ...(!hasAbout ? ["Leadership not visible — reduces trust"] : [])];
  const opportunities = ["LinkedIn personal brand for owner", "Thought leadership content", "Team page with bios"];
  return { layer_number: 11, layer_name: "Team & People", score, findings, gaps, opportunities };
}

async function runLayer12_SystemsAutomation(url: string) {
  const html = url ? await fetchUrl(url) : "";
  const hasCRM = html.match(/hubspot|salesforce|pipedrive|zoho|crm/i) !== null;
  const hasEmail = html.match(/mailchimp|klaviyo|activecampaign|constantcontact/i) !== null;
  const hasAnalytics = html.match(/google-analytics|ga\.js|gtag|analytics/i) !== null;
  const hasChatbot = html.match(/intercom|drift|crisp|chatbot|zendesk/i) !== null;
  const toolCount = [hasCRM, hasEmail, hasAnalytics, hasChatbot].filter(Boolean).length;
  const score = 20 + (toolCount * 20);
  const findings = [`CRM detected: ${hasCRM ? "yes" : "no"}`, `Email automation: ${hasEmail ? "yes" : "no"}`, `Analytics: ${hasAnalytics ? "yes" : "no"}`, `Chat tool: ${hasChatbot ? "yes" : "no"}`];
  const gaps = [...(!hasCRM ? ["No CRM detected — leads falling through cracks"] : []), ...(!hasEmail ? ["No email automation"] : []), ...(!hasAnalytics ? ["No analytics tracking"] : [])];
  const opportunities = ["CRM implementation saves 5+ hours/week", "Email automation sequences", "Full analytics stack setup"];
  return { layer_number: 12, layer_name: "Systems & Automation", score, findings, gaps, opportunities };
}

async function runLayer13_TechnologyStack(url: string) {
  if (!url) return { layer_number: 13, layer_name: "Technology Stack", score: 20, findings: ["No URL provided"], gaps: ["Tech stack unknown"], opportunities: [] };
  let headers: Record<string, string> = {};
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    res.headers.forEach((v, k) => { headers[k] = v; });
  } catch { /* ignore */ }
  const html = await fetchUrl(url);
  const server = headers["server"] || headers["x-powered-by"] || "unknown";
  const isWordPress = html.includes("wp-content");
  const isShopify = html.includes("shopify");
  const isReact = html.includes("_react") || html.includes("data-reactroot");
  const findings = [`Server: ${server}`, `WordPress: ${isWordPress}`, `Shopify: ${isShopify}`, `React: ${isReact}`];
  const score = isWordPress || isShopify || isReact ? 60 : 40;
  const gaps = ["Technology stack modernization potential"];
  const opportunities = ["Performance optimization", "Tech debt assessment", "Integration opportunities"];
  return { layer_number: 13, layer_name: "Technology Stack", score, findings, gaps, opportunities, raw_data: { server, isWordPress, isShopify } };
}

async function runLayer14_LegalCompliance(url: string) {
  const html = url ? await fetchUrl(url) : "";
  const hasPrivacy = html.match(/privacy policy|privacy-policy/i) !== null;
  const hasTerms = html.match(/terms of service|terms-of-service|terms of use/i) !== null;
  const hasCookies = html.match(/cookie|gdpr|consent/i) !== null;
  const hasAddress = html.match(/\d+\s+\w+\s+(street|st|avenue|ave|blvd|road|rd)/i) !== null;
  let score = 20;
  if (hasPrivacy) score += 25;
  if (hasTerms) score += 25;
  if (hasCookies) score += 15;
  if (hasAddress) score += 15;
  const findings = [`Privacy policy: ${hasPrivacy ? "yes" : "no"}`, `Terms of service: ${hasTerms ? "yes" : "no"}`, `Cookie consent: ${hasCookies ? "yes" : "no"}`, `Physical address visible: ${hasAddress ? "yes" : "no"}`];
  const gaps = [...(!hasPrivacy ? ["No privacy policy — legal risk"] : []), ...(!hasTerms ? ["No terms of service"] : []), ...(!hasAddress ? ["No physical address — reduces trust"] : [])];
  const opportunities = ["Legal page audit", "GDPR/CCPA compliance check", "Trust signal additions"];
  return { layer_number: 14, layer_name: "Legal & Compliance", score, findings, gaps, opportunities };
}

async function runLayer15_BrandPositioning(url: string, name: string) {
  const html = url ? await fetchUrl(url) : "";
  if (!html) return { layer_number: 15, layer_name: "Brand Positioning", score: 30, findings: ["No website"], gaps: ["Brand positioning not established online"], opportunities: ["Define clear brand identity"] };
  const analysis = await claude(`Analyze this business website and rate their brand positioning:
1. Headline clarity (1-10): does the headline instantly communicate what they do?
2. Unique value proposition: is it clear? (yes/no)
3. Target audience: is it specific? (yes/no)
4. Brand voice: (professional/casual/unclear)
5. Overall positioning score (0-100)

Business: ${name}
HTML: ${html.slice(0, 2000)}

Respond in JSON: { headline_score, has_uvp, specific_audience, brand_voice, score, findings: [], gaps: [], opportunities: [] }`, 400);
  try {
    const parsed = JSON.parse(analysis.replace(/```json|```/g, "").trim());
    return { layer_number: 15, layer_name: "Brand Positioning", score: parsed.score || 40, findings: parsed.findings || [], gaps: parsed.gaps || [], opportunities: parsed.opportunities || [] };
  } catch {
    return { layer_number: 15, layer_name: "Brand Positioning", score: 40, findings: ["Brand present but positioning unclear"], gaps: ["Value proposition not differentiated"], opportunities: ["Brand clarity audit", "Positioning statement workshop"] };
  }
}

async function runLayer16_CustomerJourney(url: string) {
  const html = url ? await fetchUrl(url) : "";
  const hasAwareness = html.match(/blog|content|learn|resources|guide/i) !== null;
  const hasConsideration = html.match(/how it works|features|why us|compare|about/i) !== null;
  const hasDecision = html.match(/pricing|buy|get started|sign up|contact/i) !== null;
  const hasRetention = html.match(/support|help|faq|community|login|portal/i) !== null;
  const stages = [hasAwareness, hasConsideration, hasDecision, hasRetention].filter(Boolean).length;
  const score = 20 + (stages * 20);
  const findings = [`Awareness stage content: ${hasAwareness ? "yes" : "no"}`, `Consideration content: ${hasConsideration ? "yes" : "no"}`, `Decision stage: ${hasDecision ? "yes" : "no"}`, `Retention/support: ${hasRetention ? "yes" : "no"}`];
  const gaps = [...(!hasAwareness ? ["No top-of-funnel content"] : []), ...(!hasDecision ? ["No clear path to purchase"] : []), ...(!hasRetention ? ["No customer portal or support resources"] : [])];
  const opportunities = ["Full funnel content strategy", "Customer portal for retention", "Onboarding sequence to reduce churn"];
  return { layer_number: 16, layer_name: "Customer Journey", score, findings, gaps, opportunities };
}

async function runLayer17_GrowthStrategy(name: string) {
  const results = await serper(`${name} blog content marketing social media ads`);
  const hasContent = results.some(r => r.snippet.match(/blog|article|guide|content/i));
  const hasAds = results.some(r => r.snippet.match(/sponsored|ad|advertis/i));
  let score = 30;
  if (hasContent) score += 35;
  if (hasAds) score += 35;
  const findings = [`Content marketing: ${hasContent ? "active" : "none found"}`, `Paid advertising: ${hasAds ? "found" : "not detected"}`];
  const gaps = [...(!hasContent ? ["No content marketing — missing organic growth"] : []), ...(!hasAds ? ["No visible paid acquisition"] : [])];
  const opportunities = ["Content strategy (SEO + thought leadership)", "Paid ad testing", "Partnership/referral program"];
  return { layer_number: 17, layer_name: "Growth Strategy", score, findings, gaps, opportunities };
}

async function runLayer18_OwnerLeadership(name: string) {
  const results = await serper(`${name} founder CEO owner speaker author media`);
  const hasMedia = results.some(r => r.snippet.match(/interview|speaker|author|featured|podcast/i));
  const hasThought = results.some(r => r.snippet.match(/expert|thought leader|article by|written by/i));
  let score = 30;
  if (hasMedia) score += 35;
  if (hasThought) score += 35;
  const findings = [`Media/speaking presence: ${hasMedia ? "yes" : "no"}`, `Thought leadership: ${hasThought ? "yes" : "no"}`];
  const gaps = [...(!hasMedia ? ["Owner not visible as industry expert"] : [])];
  const opportunities = ["Personal brand development", "Podcast appearances", "Industry association involvement"];
  return { layer_number: 18, layer_name: "Owner & Leadership", score, findings, gaps, opportunities };
}

// ── SYNTHESIS LAYERS ─────────────────────────────────────────────────────────

async function runLayer19_OpportunityScoring(layers: Record<string, unknown>[]) {
  const allGaps = layers.flatMap((l: any) => l.gaps || []);
  const allOpportunities = layers.flatMap((l: any) => l.opportunities || []);
  const avgScore = Math.round(layers.reduce((sum: number, l: any) => sum + (l.score || 0), 0) / layers.length);

  const analysis = await claude(`You have completed 18 layers of business analysis.
Total gaps found: ${allGaps.length}
Average layer score: ${avgScore}/100

Top gaps: ${allGaps.slice(0, 15).join("; ")}
Top opportunities: ${allOpportunities.slice(0, 15).join("; ")}

Synthesize these into:
1. Top 5 highest-impact opportunities with revenue impact estimates
2. Overall Nexus Score (0-100, based on how much Nexus can improve this business)
3. Revenue leakage estimate (conservative dollar amount per year)
4. Estimated quick win value (things achievable in 30 days)

Respond in JSON: {
  nexus_score: number,
  revenue_leakage: number,
  quick_win_value: number,
  top_opportunities: [{ title, description, estimated_value, effort: "quick|medium|complex", priority: 1-5 }]
}`, 800);

  try {
    const parsed = JSON.parse(analysis.replace(/```json|```/g, "").trim());
    return { layer_number: 19, layer_name: "Opportunity Scoring", score: parsed.nexus_score, findings: [`Nexus Score: ${parsed.nexus_score}/100`, `Revenue leakage: $${(parsed.revenue_leakage || 0).toLocaleString()}/year`], gaps: allGaps.slice(0, 5), opportunities: (parsed.top_opportunities || []).map((o: any) => o.title), raw_data: parsed };
  } catch {
    return { layer_number: 19, layer_name: "Opportunity Scoring", score: avgScore, findings: [`Average score: ${avgScore}/100`], gaps: [], opportunities: [] };
  }
}

async function runLayer20_NexusRoadmap(allLayers: Record<string, unknown>[], layer19: Record<string, unknown>, diagnostic: Record<string, unknown>) {
  const prompt = await claude(`Create a 90-day roadmap for ${diagnostic.business_name} (${diagnostic.industry} business).

Their Nexus Score: ${(layer19.raw_data as any)?.nexus_score || 50}/100
Their biggest problem: ${diagnostic.intake_biggest_fix || "not specified"}
Their goal: ${diagnostic.intake_revenue_goal || "not specified"}
Top opportunities: ${JSON.stringify((layer19.raw_data as any)?.top_opportunities?.slice(0, 5) || [])}

Create a practical, specific roadmap:
- Week 1-2: Quick wins (things they can do immediately)
- Week 3-4: Foundation building
- Month 2: Growth systems
- Month 3: Scale and optimize

Respond in JSON: {
  week_1_2: { title, actions: string[], expected_outcome },
  week_3_4: { title, actions: string[], expected_outcome },
  month_2: { title, actions: string[], expected_outcome },
  month_3: { title, actions: string[], expected_outcome }
}`, 800);

  try {
    const parsed = JSON.parse(prompt.replace(/```json|```/g, "").trim());
    return { layer_number: 20, layer_name: "90-Day Nexus Roadmap", score: 100, findings: ["Roadmap generated"], gaps: [], opportunities: [], raw_data: parsed };
  } catch {
    return { layer_number: 20, layer_name: "90-Day Nexus Roadmap", score: 100, findings: ["Roadmap generation failed"], gaps: [], opportunities: [], raw_data: {} };
  }
}

async function runLayer21_Benchmarking(industry: string, allLayers: Record<string, unknown>[]) {
  const avgScore = Math.round(allLayers.reduce((sum: number, l: any) => sum + (l.score || 0), 0) / allLayers.length);
  const { data: benchmarks } = await supabase.from("nexus_benchmarks").select("*").eq("industry", industry);
  const industryAvg = benchmarks?.find((b: any) => b.metric_name === "avg_nexus_score")?.metric_value || 45;
  const vsIndustry = avgScore - industryAvg;
  const findings = [`This business score: ${avgScore}/100`, `Industry average (${industry}): ${industryAvg}/100`, `vs. peers: ${vsIndustry > 0 ? "+" : ""}${vsIndustry} points`];
  return { layer_number: 21, layer_name: "Industry Benchmarking", score: avgScore, findings, gaps: [], opportunities: [`${industry} industry avg is ${industryAvg} — ${vsIndustry > 0 ? "above average" : "below average"}`], raw_data: { avgScore, industryAvg, vsIndustry } };
}

async function runLayer22_AcquisitionPotential(allLayers: Record<string, unknown>[], diagnostic: Record<string, unknown>) {
  const financialLayer = allLayers.find((l: any) => l.layer_number === 8) as any;
  const estimatedRevenue = (financialLayer?.raw_data as any)?.estimatedRevenue || 250000;
  const currentMultiple = 2.5;
  const nexusMultiple = 4.5;
  const currentValue = Math.round(estimatedRevenue * currentMultiple);
  const postNexusValue = Math.round(estimatedRevenue * nexusMultiple);
  const valueGap = postNexusValue - currentValue;
  const exitReadiness = allLayers.reduce((sum: number, l: any) => sum + (l.score || 0), 0) / allLayers.length > 60 ? 7 : 4;
  const acquisitionScore = exitReadiness * 10;
  return { layer_number: 22, layer_name: "Acquisition Potential", score: acquisitionScore, findings: [`Estimated current value: $${currentValue.toLocaleString()}`, `Post-Nexus potential value: $${postNexusValue.toLocaleString()}`, `Value gap Nexus can unlock: $${valueGap.toLocaleString()}`, `Exit readiness score: ${exitReadiness}/10`], gaps: [], opportunities: [`$${valueGap.toLocaleString()} value creation opportunity`], raw_data: { currentValue, postNexusValue, valueGap, exitReadiness, estimatedRevenue } };
}

async function runLayer23_NetworkFit(industry: string) {
  const { data: existingOS } = await supabase.from("projects").select("id, name").eq("category", "vertical").ilike("name", `%${industry}%`).maybeSingle();
  const { data: proposals } = await supabase.from("nexus_vertical_proposals").select("status, evidence_count").eq("industry", industry).maybeSingle();
  const findings = [`Existing vertical OS: ${existingOS ? existingOS.name : "none"}`, `Vertical proposal status: ${proposals?.status || "none"}`, `Evidence count: ${proposals?.evidence_count || 0}`];
  const score = existingOS ? 90 : (proposals?.evidence_count || 0) > 5 ? 60 : 30;
  return { layer_number: 23, layer_name: "Network & Vertical Fit", score, findings, gaps: [], opportunities: existingOS ? [`Eligible for ${existingOS.name} product`] : ["Custom Nexus implementation"], raw_data: { existingOS, proposals } };
}

async function runLayer24_FitScore(allLayers: Record<string, unknown>[], layer19: Record<string, unknown>, layer22: Record<string, unknown>, layer23: Record<string, unknown>, diagnostic: Record<string, unknown>) {
  const nexusScore = (layer19.raw_data as any)?.nexus_score || 50;
  const acqData = layer22.raw_data as any;
  const netData = layer23.raw_data as any;

  // Routing scores
  const verticalOsFit = netData?.existingOS ? 85 : 20;
  const acquisitionFit = acqData?.exitReadiness >= 7 ? 75 : 35;
  const avgLayerScore = Math.round(allLayers.reduce((sum: number, l: any) => sum + (l.score || 0), 0) / allLayers.length);
  const customFit = avgLayerScore > 60 ? 80 : avgLayerScore > 40 ? 55 : 30;
  const builderFit = (allLayers.filter((l: any) => l.score < 40).length > 8) ? 70 : 30;

  return {
    layer_number: 24, layer_name: "Nexus Fit Score & Routing",
    score: nexusScore,
    findings: [`Nexus Score: ${nexusScore}/100`, `Custom fit: ${customFit}/100`, `Vertical OS fit: ${verticalOsFit}/100`, `Acquisition fit: ${acquisitionFit}/100`],
    gaps: [],
    opportunities: [`Recommended model: ${verticalOsFit > 70 ? "vertical_os" : customFit > 70 ? "custom" : acquisitionFit > 60 ? "acquisition" : "nurture"}`],
    raw_data: { nexus_score: nexusScore, custom_fit_score: customFit, vertical_os_fit_score: verticalOsFit, acquisition_fit_score: acquisitionFit, builder_fit_score: builderFit, estimated_revenue: acqData?.estimatedRevenue || 0, revenue_leakage: (layer19.raw_data as any)?.revenue_leakage || 0, quick_win_value: (layer19.raw_data as any)?.quick_win_value || 0 }
  };
}

// ── REPORT SYNTHESIS ─────────────────────────────────────────────────────────

async function synthesizeReports(diagnostic: Record<string, unknown>, allLayers: Record<string, unknown>[], layer19: Record<string, unknown>, layer20: Record<string, unknown>, layer21: Record<string, unknown>, layer22: Record<string, unknown>, layer24: Record<string, unknown>) {
  const l24 = layer24.raw_data as any;
  const l19 = layer19.raw_data as any;
  const l20 = layer20.raw_data as any;

  const internalReport = await claude(`You are Nexus. Generate a complete INTERNAL report for Zach (the closer) on this business.

Business: ${diagnostic.business_name}
Industry: ${diagnostic.industry}
Nexus Score: ${l24?.nexus_score}/100
Owner email: ${diagnostic.owner_email}

Owner context:
- Biggest fix: ${diagnostic.intake_biggest_fix}
- Goal: ${diagnostic.intake_revenue_goal}
- Bottleneck: ${diagnostic.intake_bottleneck}
- Failed before: ${diagnostic.intake_tried_before}
- Cost of inaction: ${diagnostic.intake_urgency}

Top opportunities: ${JSON.stringify(l19?.top_opportunities || [])}
Revenue leakage: $${(l19?.revenue_leakage || 0).toLocaleString()}
90-day roadmap: ${JSON.stringify(l20 || {})}
Acquisition potential: ${JSON.stringify(layer22.raw_data || {})}
Recommended model: ${l24?.custom_fit_score > 70 ? "custom" : l24?.vertical_os_fit_score > 70 ? "vertical_os" : "nurture"}

Generate internal report with:
1. Executive summary (3 sentences)
2. Top 10 gaps with severity 1-10 and revenue impact
3. Recommended package with price justification
4. Call prep: top 3 things this owner cares most about
5. Likely objections + exact responses
6. Opening line for the sales call
7. Red flags if any

Respond in JSON.`, 2000);

  const clientReport = await claude(`You are Nexus. Generate a CLIENT-FACING diagnostic report for ${diagnostic.business_name}.

Nexus Score: ${l24?.nexus_score}/100
Revenue leakage: $${(l19?.revenue_leakage || 0).toLocaleString()}/year
Quick wins available: $${(l19?.quick_win_value || 0).toLocaleString()}
Industry: ${diagnostic.industry}
Top opportunities: ${JSON.stringify(l19?.top_opportunities?.slice(0, 5) || [])}
90-day roadmap: ${JSON.stringify(l20 || {})}
Report slug for link: ${diagnostic.slug}
Calendly: ${CALENDLY_LINK}

Generate a compelling, honest client report that:
1. Makes them feel deeply understood
2. Shows Nexus Score with context (what it means)
3. Revenue being left on table
4. Top 5 gaps (most impactful only, with severity)
5. Top 3 quick wins they can do THIS WEEK
6. 90-day path
7. Recommended Nexus path with clear next step
8. CTA: book a free strategy call

Tone: trusted advisor, not salesy. Forward-looking.
Include disclaimer: "AI-generated diagnostic for informational purposes only."

Respond in JSON: { score, score_context, revenue_leakage, top_gaps: [{title, description, severity: 1-5, revenue_impact}], quick_wins: [{title, action, expected_result}], roadmap: {}, nexus_path: {package, price, benefits, next_step}, cta_url, disclaimer }`, 2000);

  let internalParsed = {};
  let clientParsed = {};
  try { internalParsed = JSON.parse(internalReport.replace(/```json|```/g, "").trim()); } catch { internalParsed = { raw: internalReport }; }
  try { clientParsed = JSON.parse(clientReport.replace(/```json|```/g, "").trim()); } catch { clientParsed = { raw: clientReport }; }

  return { internalReport: internalParsed, clientReport: clientParsed };
}

// ── MAIN ENGINE ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));

  // Test mode
  if (body.test) return Response.json({ ok: true, test: true });

  const { diagnostic_id } = body;
  if (!diagnostic_id) return Response.json({ error: "diagnostic_id required" }, { status: 400 });

  const { data: diagnostic } = await supabase.from("nexus_diagnostics").select("*").eq("id", diagnostic_id).single();
  if (!diagnostic) return Response.json({ error: "Diagnostic not found" }, { status: 404 });

  try {
    await supabase.from("nexus_diagnostics").update({ status: "running" }).eq("id", diagnostic_id);

    const url = diagnostic.business_url || "";
    const name = diagnostic.business_name;
    const industry = diagnostic.industry || "general";

    // Wave 1: parallel Serper + URL analysis (layers 1-18)
    const [
      layer1, layer2, layer3, layer4,
      layer5, layer6, layer7, layer8,
      layer9, layer10, layer11, layer12,
      layer13, layer14, layer15, layer16,
      layer17, layer18
    ] = await Promise.all([
      runLayer1_DigitalFootprint(url),
      runLayer2_SearchVisibility(name, url, industry),
      runLayer3_ReputationTrust(name),
      runLayer4_SocialIntelligence(name),
      runLayer5_BusinessModel(url, name),
      runLayer6_OperationsSignals(name),
      runLayer7_CompetitiveLandscape(name, industry),
      runLayer8_FinancialIntelligence(name, industry),
      runLayer9_CustomerIntelligence(name),
      runLayer10_SalesProcess(url),
      runLayer11_TeamPeople(name),
      runLayer12_SystemsAutomation(url),
      runLayer13_TechnologyStack(url),
      runLayer14_LegalCompliance(url),
      runLayer15_BrandPositioning(url, name),
      runLayer16_CustomerJourney(url),
      runLayer17_GrowthStrategy(name),
      runLayer18_OwnerLeadership(name),
    ]);

    const earlyLayers = [layer1, layer2, layer3, layer4, layer5, layer6, layer7, layer8, layer9, layer10, layer11, layer12, layer13, layer14, layer15, layer16, layer17, layer18];

    // Save layers 1-18 in parallel
    await Promise.all(earlyLayers.map(l => saveLayer(diagnostic_id, l)));

    // Wave 2: synthesis layers (sequential, depend on wave 1)
    const layer19 = await runLayer19_OpportunityScoring(earlyLayers);
    const layer20 = await runLayer20_NexusRoadmap(earlyLayers, layer19, diagnostic);
    const layer21 = await runLayer21_Benchmarking(industry, earlyLayers);
    const layer22 = await runLayer22_AcquisitionPotential(earlyLayers, diagnostic);
    const layer23 = await runLayer23_NetworkFit(industry);
    const layer24 = await runLayer24_FitScore(earlyLayers, layer19, layer22, layer23, diagnostic);

    await Promise.all([
      saveLayer(diagnostic_id, layer19),
      saveLayer(diagnostic_id, layer20),
      saveLayer(diagnostic_id, layer21),
      saveLayer(diagnostic_id, layer22),
      saveLayer(diagnostic_id, layer23),
      saveLayer(diagnostic_id, layer24),
    ]);

    // Synthesize reports
    const { internalReport, clientReport } = await synthesizeReports(diagnostic, earlyLayers, layer19, layer20, layer21, layer22, layer24);

    const l24data = layer24.raw_data as any;
    const l19data = layer19.raw_data as any;

    // Update diagnostic with scores + reports
    await supabase.from("nexus_diagnostics").update({
      nexus_score: l24data?.nexus_score || 0,
      custom_fit_score: l24data?.custom_fit_score || 0,
      vertical_os_fit_score: l24data?.vertical_os_fit_score || 0,
      acquisition_fit_score: l24data?.acquisition_fit_score || 0,
      builder_fit_score: l24data?.builder_fit_score || 0,
      estimated_revenue_leakage: l19data?.revenue_leakage || 0,
      estimated_quick_win_value: l19data?.quick_win_value || 0,
      pre_nexus_value_estimate: (layer22.raw_data as any)?.currentValue || 0,
      post_nexus_value_estimate: (layer22.raw_data as any)?.postNexusValue || 0,
      internal_report: internalReport,
      client_report: clientReport,
      status: "report_ready",
      updated_at: new Date().toISOString()
    }).eq("id", diagnostic_id);

    // Update benchmarks
    const { data: existingBench } = await supabase.from("nexus_benchmarks").select("*").eq("industry", industry).eq("metric_name", "avg_nexus_score").maybeSingle();
    if (existingBench) {
      const newAvg = (existingBench.metric_value * existingBench.sample_size + (l24data?.nexus_score || 0)) / (existingBench.sample_size + 1);
      await supabase.from("nexus_benchmarks").update({ metric_value: newAvg, sample_size: existingBench.sample_size + 1, last_updated: new Date().toISOString() }).eq("id", existingBench.id);
    } else {
      await supabase.from("nexus_benchmarks").insert({ industry, metric_name: "avg_nexus_score", metric_value: l24data?.nexus_score || 0, sample_size: 1 }).catch(() => {});
    }

    // Route the diagnostic
    fetch(`${SUPABASE_URL}/functions/v1/nexus-router`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ diagnostic_id })
    }).catch(() => {});

    return Response.json({ ok: true, diagnostic_id, nexus_score: l24data?.nexus_score, status: "report_ready" });

  } catch (err) {
    await supabase.from("nexus_diagnostics").update({ status: "error" }).eq("id", diagnostic_id);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});

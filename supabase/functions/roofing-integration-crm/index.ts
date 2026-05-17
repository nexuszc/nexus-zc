import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface NormalizedJob {
  external_id: string;
  homeowner_name?: string;
  homeowner_email?: string;
  homeowner_phone?: string;
  property_address?: string;
  city?: string;
  state?: string;
  status?: string;
  job_type?: string;
  insurance_carrier?: string;
  notes?: string;
  scheduled_start?: string;
  measurement_data?: Record<string, unknown>;
  estimate_data?: Record<string, unknown>;
}

interface CrmAdapter {
  verify(creds: Record<string, unknown>): Promise<{ ok: boolean; error?: string }>;
  getJobs(creds: Record<string, unknown>): Promise<NormalizedJob[]>;
}

// ─── DATA VALIDATION ─────────────────────────────────────────────────────────

function validateJobData(raw: Record<string, unknown>): NormalizedJob | null {
  if (!raw.external_id) return null;

  const phone = raw.homeowner_phone as string || "";
  const email = raw.homeowner_email as string || "";

  return {
    external_id: String(raw.external_id),
    homeowner_name: raw.homeowner_name as string || undefined,
    homeowner_email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    homeowner_phone: phone && /^\+?[\d\s\-().]{7,}$/.test(phone) ? phone.replace(/[^\d+]/g, "") : undefined,
    property_address: raw.property_address as string || undefined,
    city: raw.city as string || undefined,
    state: raw.state as string || undefined,
    status: raw.status as string || undefined,
    job_type: raw.job_type as string || undefined,
    insurance_carrier: raw.insurance_carrier as string || undefined,
    notes: raw.notes as string || undefined,
    scheduled_start: raw.scheduled_start as string || undefined,
    measurement_data: raw.measurement_data as Record<string, unknown> || undefined,
    estimate_data: raw.estimate_data as Record<string, unknown> || undefined,
  };
}

function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

async function findMatchingJob(
  contractorId: string,
  job: NormalizedJob
): Promise<string | null> {
  // Match by external_id first
  const { data: byExternal } = await supabase
    .from("roofing_jobs")
    .select("id")
    .eq("contractor_id", contractorId)
    .eq("external_id", job.external_id)
    .maybeSingle();

  if (byExternal) return byExternal.id;

  // Match by address
  if (job.property_address) {
    const { data: allJobs } = await supabase
      .from("roofing_jobs")
      .select("id, property_address, homeowner_name")
      .eq("contractor_id", contractorId)
      .in("status", ["active", "in_progress", "pending"]);

    const norm = normalizeAddress(job.property_address);
    const match = (allJobs || []).find((j) => {
      if (!j.property_address) return false;
      const jNorm = normalizeAddress(j.property_address);
      const addrParts = norm.split(" ").slice(0, 3).join(" ");
      const jParts = jNorm.split(" ").slice(0, 3).join(" ");
      return addrParts.length > 3 && addrParts === jParts;
    });

    if (match) return match.id;
  }

  return null;
}

async function syncJobToPortal(
  contractorId: string,
  jobId: string,
  job: NormalizedJob,
  integrationSource: string
): Promise<"updated" | "skipped"> {
  const updates: Record<string, unknown> = {
    external_id: job.external_id,
    external_source: integrationSource,
    last_crm_sync_at: new Date().toISOString(),
  };

  if (job.measurement_data) updates.measurement_data = job.measurement_data;
  if (job.estimate_data) updates.estimate_data = job.estimate_data;
  if (job.homeowner_email) updates.homeowner_email = job.homeowner_email;
  if (job.homeowner_phone) updates.homeowner_phone = job.homeowner_phone;
  if (job.insurance_carrier) updates.insurance_carrier = job.insurance_carrier;
  if (job.scheduled_start) updates.scheduled_start = job.scheduled_start;
  if (job.notes) updates.notes = job.notes;

  const { error } = await supabase
    .from("roofing_jobs")
    .update(updates)
    .eq("id", jobId)
    .eq("contractor_id", contractorId);

  return error ? "skipped" : "updated";
}

// ─── ADAPTERS ─────────────────────────────────────────────────────────────────

// AccuLynx
const acculynxAdapter: CrmAdapter = {
  async verify(creds) {
    const res = await fetch("https://api.acculynx.com/api/v1/jobs?limit=1", {
      headers: { Authorization: `Bearer ${creds.api_key}`, Accept: "application/json" },
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `AccuLynx: ${res.status}` };
  },
  async getJobs(creds) {
    const jobs: NormalizedJob[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`https://api.acculynx.com/api/v1/jobs?limit=100&page=${page}`, {
        headers: { Authorization: `Bearer ${creds.api_key}`, Accept: "application/json" },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items: Record<string, unknown>[] = data.items || data.jobs || data || [];
      if (!items.length) break;

      for (const item of items) {
        const contact = (item.contact || item.customer || {}) as Record<string, unknown>;
        const addr = (item.address || item.property_address || {}) as Record<string, unknown>;
        const validated = validateJobData({
          external_id: item.id || item.jobId,
          homeowner_name: contact.name || contact.fullName || `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
          homeowner_email: contact.email,
          homeowner_phone: contact.phone || contact.mobilePhone,
          property_address: addr.street || addr.address1 || item.propertyAddress,
          city: addr.city,
          state: addr.state,
          status: item.status || item.jobStatus,
          insurance_carrier: item.insurance_carrier || item.insuranceCarrier || item.insuranceName,
          notes: item.notes,
        });
        if (validated) jobs.push(validated);
      }

      if (items.length < 100) break;
      page++;
      if (page > 50) break;
    }
    return jobs;
  },
};

// JobNimbus
const jobnimbusAdapter: CrmAdapter = {
  async verify(creds) {
    const res = await fetch("https://app.jobnimbus.com/api1/jobs?size=1", {
      headers: { Authorization: `Token ${creds.api_key}`, Accept: "application/json" },
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `JobNimbus: ${res.status}` };
  },
  async getJobs(creds) {
    const jobs: NormalizedJob[] = [];
    let from = 0;
    while (true) {
      const res = await fetch(`https://app.jobnimbus.com/api1/jobs?size=100&from=${from}`, {
        headers: { Authorization: `Token ${creds.api_key}`, Accept: "application/json" },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items: Record<string, unknown>[] = data.results || data.items || [];
      if (!items.length) break;

      for (const item of items) {
        const validated = validateJobData({
          external_id: item.jnid || item.id,
          homeowner_name: item.name || `${item.first_name || ""} ${item.last_name || ""}`.trim(),
          homeowner_email: item.email,
          homeowner_phone: item.phone || item.mobile,
          property_address: item.address_line1 || item.address,
          city: item.city,
          state: item.state_text || item.state,
          status: item.status,
          insurance_carrier: item.insurance_company || item.insurance,
          notes: item.description || item.notes,
        });
        if (validated) jobs.push(validated);
      }

      if (items.length < 100) break;
      from += 100;
      if (from > 5000) break;
    }
    return jobs;
  },
};

// Leap
const leapAdapter: CrmAdapter = {
  async verify(creds) {
    const res = await fetch("https://api.leaptodigital.com/v1/jobs?per_page=1", {
      headers: { Authorization: `Bearer ${creds.api_key}`, Accept: "application/json" },
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Leap: ${res.status}` };
  },
  async getJobs(creds) {
    const jobs: NormalizedJob[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`https://api.leaptodigital.com/v1/jobs?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${creds.api_key}`, Accept: "application/json" },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items: Record<string, unknown>[] = data.data || data.jobs || data || [];
      if (!items.length) break;

      for (const item of items) {
        const customer = (item.customer || item.contact || {}) as Record<string, unknown>;
        const validated = validateJobData({
          external_id: item.id,
          homeowner_name: customer.name || `${customer.first_name || ""} ${customer.last_name || ""}`.trim(),
          homeowner_email: customer.email,
          homeowner_phone: customer.phone,
          property_address: item.job_site_address || item.address,
          city: item.job_site_city || item.city,
          state: item.job_site_state || item.state,
          status: item.status,
          insurance_carrier: item.insurance_company,
          estimate_data: item.estimate ? { amount: item.estimate, currency: "USD" } : undefined,
          notes: item.notes,
        });
        if (validated) jobs.push(validated);
      }

      if (items.length < 100) break;
      page++;
      if (page > 50) break;
    }
    return jobs;
  },
};

// Roofr
const roofrAdapter: CrmAdapter = {
  async verify(creds) {
    const res = await fetch("https://api.roofr.com/v1/quotes?limit=1", {
      headers: { "X-API-Key": creds.api_key as string, Accept: "application/json" },
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Roofr: ${res.status}` };
  },
  async getJobs(creds) {
    const jobs: NormalizedJob[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`https://api.roofr.com/v1/quotes?limit=100&page=${page}`, {
        headers: { "X-API-Key": creds.api_key as string, Accept: "application/json" },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items: Record<string, unknown>[] = data.data || data.quotes || data || [];
      if (!items.length) break;

      for (const item of items) {
        const customer = (item.customer || {}) as Record<string, unknown>;
        const validated = validateJobData({
          external_id: item.id,
          homeowner_name: customer.full_name || customer.name,
          homeowner_email: customer.email,
          homeowner_phone: customer.phone,
          property_address: item.address || item.property_address,
          city: item.city,
          state: item.state,
          status: item.status,
          measurement_data: item.measurements
            ? { total_squares: item.measurements, source: "roofr" }
            : undefined,
          estimate_data: item.total_price
            ? { amount: item.total_price, currency: "USD" }
            : undefined,
          notes: item.notes,
        });
        if (validated) jobs.push(validated);
      }

      if (items.length < 100) break;
      page++;
      if (page > 50) break;
    }
    return jobs;
  },
};

// Improveit360
const improveit360Adapter: CrmAdapter = {
  async verify(creds) {
    const res = await fetch("https://api.improveit360.com/v1/jobs?pageSize=1", {
      headers: {
        Authorization: `Basic ${btoa(`${creds.api_key}:${creds.api_secret}`)}`,
        Accept: "application/json",
      },
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Improveit360: ${res.status}` };
  },
  async getJobs(creds) {
    const jobs: NormalizedJob[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`https://api.improveit360.com/v1/jobs?pageSize=100&page=${page}`, {
        headers: {
          Authorization: `Basic ${btoa(`${creds.api_key}:${creds.api_secret}`)}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) break;
      const data = await res.json();
      const items: Record<string, unknown>[] = data.results || data.items || data || [];
      if (!items.length) break;

      for (const item of items) {
        const lead = (item.lead || item.contact || {}) as Record<string, unknown>;
        const validated = validateJobData({
          external_id: item.id,
          homeowner_name: lead.fullName || `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
          homeowner_email: lead.email,
          homeowner_phone: lead.phoneNumber || lead.phone,
          property_address: item.projectAddress || item.address,
          city: item.city,
          state: item.state,
          status: item.status,
          notes: item.notes,
        });
        if (validated) jobs.push(validated);
      }

      if (items.length < 100) break;
      page++;
      if (page > 50) break;
    }
    return jobs;
  },
};

// Salesforce (generic REST — contractor provides instance URL)
const salesforceAdapter: CrmAdapter = {
  async verify(creds) {
    const instanceUrl = creds.webhook_url as string; // reuse field for SF instance URL
    if (!instanceUrl || !creds.access_token) return { ok: false, error: "instance_url and access_token required" };
    const res = await fetch(`${instanceUrl}/services/data/v57.0/query?q=SELECT+Id+FROM+Opportunity+LIMIT+1`, {
      headers: { Authorization: `Bearer ${creds.access_token}`, Accept: "application/json" },
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `Salesforce: ${res.status}` };
  },
  async getJobs(creds) {
    const instanceUrl = creds.webhook_url as string;
    if (!instanceUrl || !creds.access_token) return [];

    const jobs: NormalizedJob[] = [];
    const soql = "SELECT+Id,Name,Account.Name,Account.PersonEmail,Account.PersonMobilePhone,BillingStreet,BillingCity,BillingState,StageName,Description+FROM+Opportunity+LIMIT+2000";
    const res = await fetch(`${instanceUrl}/services/data/v57.0/query?q=${soql}`, {
      headers: { Authorization: `Bearer ${creds.access_token}`, Accept: "application/json" },
    });
    if (!res.ok) return [];

    const data = await res.json();
    for (const item of (data.records || []) as Record<string, unknown>[]) {
      const acct = (item.Account || {}) as Record<string, unknown>;
      const validated = validateJobData({
        external_id: item.Id,
        homeowner_name: acct.Name || item.Name,
        homeowner_email: acct.PersonEmail,
        homeowner_phone: acct.PersonMobilePhone,
        property_address: item.BillingStreet,
        city: item.BillingCity,
        state: item.BillingState,
        status: item.StageName,
        notes: item.Description,
      });
      if (validated) jobs.push(validated);
    }
    return jobs;
  },
};

const ADAPTERS: Record<string, CrmAdapter> = {
  acculynx: acculynxAdapter,
  jobnimbus: jobnimbusAdapter,
  leap: leapAdapter,
  roofr: roofrAdapter,
  improveit360: improveit360Adapter,
  salesforce: salesforceAdapter,
};

// ─── HANDLER ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-integration-crm ready", supported: Object.keys(ADAPTERS) });

  const { action, session_token, contractor_id, crm_type, api_key, api_secret, access_token, webhook_url } = body;

  // Resolve contractor
  let resolvedContractorId = contractor_id as string;

  if (session_token && !resolvedContractorId) {
    const { data: session } = await supabase
      .from("contractor_sessions")
      .select("contractor_id, expires_at")
      .eq("token", session_token)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      return Response.json({ ok: false, error: "Invalid or expired session" }, { status: 401, headers: corsHeaders });
    }
    resolvedContractorId = session.contractor_id;
  }

  if (!resolvedContractorId) {
    return Response.json({ ok: false, error: "session_token or contractor_id required" }, { status: 400, headers: corsHeaders });
  }

  const adapter = ADAPTERS[crm_type as string];
  if (!adapter && action !== "list") {
    return Response.json({
      ok: false,
      error: `Unknown crm_type. Supported: ${Object.keys(ADAPTERS).join(", ")}`,
    }, { status: 400, headers: corsHeaders });
  }

  // LIST — return connected CRM integrations for this contractor
  if (action === "list") {
    const { data: integrations } = await supabase
      .from("contractor_integrations")
      .select("integration_type, status, last_sync_at, total_records_synced, last_sync_error")
      .eq("contractor_id", resolvedContractorId)
      .in("integration_type", Object.keys(ADAPTERS));
    return Response.json({ ok: true, integrations: integrations || [] }, { headers: corsHeaders });
  }

  // CONNECT — store credentials and verify
  if (action === "connect") {
    if (!api_key && !access_token) {
      return Response.json({ ok: false, error: "api_key or access_token required" }, { status: 400, headers: corsHeaders });
    }

    const creds = { api_key, api_secret, access_token, webhook_url };
    const verifyResult = await adapter.verify(creds);

    if (!verifyResult.ok) {
      return Response.json({ ok: false, error: verifyResult.error }, { status: 400, headers: corsHeaders });
    }

    const { error } = await supabase.from("contractor_integrations").upsert({
      contractor_id: resolvedContractorId,
      integration_type: crm_type,
      status: "active",
      api_key: api_key || null,
      api_secret: api_secret || null,
      access_token: access_token || null,
      webhook_url: webhook_url || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "contractor_id,integration_type" });

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders });
    return Response.json({ ok: true, status: "active", crm_type }, { headers: corsHeaders });
  }

  // VERIFY — test existing credentials
  if (action === "verify") {
    const { data: integration } = await supabase
      .from("contractor_integrations")
      .select("api_key, api_secret, access_token, webhook_url")
      .eq("contractor_id", resolvedContractorId)
      .eq("integration_type", crm_type)
      .single();

    if (!integration) return Response.json({ ok: false, error: "not connected" }, { status: 404, headers: corsHeaders });

    const result = await adapter.verify(integration as Record<string, unknown>);
    return Response.json(result, { headers: corsHeaders });
  }

  // SYNC — pull jobs, match to portal, enrich
  if (action === "sync") {
    const { data: integration } = await supabase
      .from("contractor_integrations")
      .select("*")
      .eq("contractor_id", resolvedContractorId)
      .eq("integration_type", crm_type)
      .single();

    if (!integration || integration.status !== "active") {
      return Response.json({ ok: false, error: `${crm_type} not connected` }, { status: 400, headers: corsHeaders });
    }

    const started = Date.now();
    let updated = 0;
    let skipped = 0;
    let errorMsg: string | null = null;

    try {
      const crmJobs = await adapter.getJobs(integration as Record<string, unknown>);

      for (const job of crmJobs) {
        const matchedJobId = await findMatchingJob(resolvedContractorId, job);
        if (!matchedJobId) { skipped++; continue; }

        const outcome = await syncJobToPortal(resolvedContractorId, matchedJobId, job, crm_type);
        if (outcome === "updated") updated++;
        else skipped++;
      }

      await supabase.from("contractor_integrations")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "success",
          last_sync_error: null,
          total_records_synced: (integration.total_records_synced || 0) + updated,
          updated_at: new Date().toISOString(),
        })
        .eq("contractor_id", resolvedContractorId)
        .eq("integration_type", crm_type);

    } catch (e) {
      errorMsg = (e as Error).message;
      await supabase.from("contractor_integrations")
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_status: "error",
          last_sync_error: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("contractor_id", resolvedContractorId)
        .eq("integration_type", crm_type);
    }

    await supabase.from("integration_sync_log").insert({
      contractor_id: resolvedContractorId,
      integration_type: crm_type,
      sync_type: "jobs",
      status: errorMsg ? "error" : "success",
      records_updated: updated,
      records_skipped: skipped,
      error_message: errorMsg,
      duration_ms: Date.now() - started,
      completed_at: new Date().toISOString(),
    });

    if (errorMsg) return Response.json({ ok: false, error: errorMsg }, { status: 500, headers: corsHeaders });
    return Response.json({ ok: true, jobs_updated: updated, jobs_skipped: skipped }, { headers: corsHeaders });
  }

  // DISCONNECT
  if (action === "disconnect") {
    await supabase.from("contractor_integrations")
      .delete()
      .eq("contractor_id", resolvedContractorId)
      .eq("integration_type", crm_type);
    return Response.json({ ok: true, disconnected: true }, { headers: corsHeaders });
  }

  return Response.json({ ok: false, error: "action required: connect | verify | sync | disconnect | list" }, { status: 400, headers: corsHeaders });
});

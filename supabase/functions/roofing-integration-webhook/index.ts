import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Webhook-Key",
};

// ─── VALIDATION (same logic as CRM function) ─────────────────────────────────

function validateJobData(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (!raw.external_id && !raw.id) return null;

  const phone = (raw.homeowner_phone || raw.phone || raw.customer_phone || "") as string;
  const email = (raw.homeowner_email || raw.email || raw.customer_email || "") as string;

  return {
    external_id: String(raw.external_id || raw.id),
    homeowner_name: raw.homeowner_name || raw.customer_name || raw.name || undefined,
    homeowner_email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    homeowner_phone: phone && /^\+?[\d\s\-().]{7,}$/.test(phone)
      ? phone.replace(/[^\d+]/g, "") : undefined,
    property_address: raw.property_address || raw.address || raw.job_address || undefined,
    city: raw.city || undefined,
    state: raw.state || undefined,
    status: raw.status || undefined,
    job_type: raw.job_type || raw.type || undefined,
    insurance_carrier: raw.insurance_carrier || raw.insurance || undefined,
    notes: raw.notes || raw.description || undefined,
    scheduled_start: raw.scheduled_start || raw.start_date || undefined,
    estimate_data: raw.estimate_data || raw.estimate
      ? { amount: raw.estimate_data || raw.estimate, currency: "USD" }
      : undefined,
    measurement_data: raw.measurement_data || raw.measurements || undefined,
  };
}

function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

async function findMatchingJob(contractorId: string, externalId: string, address?: string): Promise<string | null> {
  const { data: byExternal } = await supabase
    .from("roofing_jobs")
    .select("id")
    .eq("contractor_id", contractorId)
    .eq("external_id", externalId)
    .maybeSingle();

  if (byExternal) return byExternal.id;

  if (address) {
    const { data: allJobs } = await supabase
      .from("roofing_jobs")
      .select("id, property_address")
      .eq("contractor_id", contractorId)
      .in("status", ["active", "in_progress", "pending"]);

    const norm = normalizeAddress(address);
    const match = (allJobs || []).find((j) => {
      if (!j.property_address) return false;
      const p1 = norm.split(" ").slice(0, 3).join(" ");
      const p2 = normalizeAddress(j.property_address).split(" ").slice(0, 3).join(" ");
      return p1.length > 3 && p1 === p2;
    });

    if (match) return match.id;
  }

  return null;
}

// Apply custom field map from integration config
function applyCustomFieldMap(
  payload: Record<string, unknown>,
  fieldMap: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [ourField, theirField] of Object.entries(fieldMap)) {
    if (payload[theirField] !== undefined) {
      result[ourField] = payload[theirField];
    }
  }
  // Common field fallbacks (always try)
  const fallbacks: Record<string, string[]> = {
    external_id: ["id", "jobId", "job_id", "opportunityId", "recordId"],
    homeowner_name: ["name", "customer_name", "contact_name", "full_name", "homeowner"],
    homeowner_email: ["email", "customer_email", "contact_email"],
    homeowner_phone: ["phone", "mobile", "cell", "customer_phone"],
    property_address: ["address", "job_address", "property", "street"],
    city: ["city", "job_city"],
    state: ["state", "job_state"],
    status: ["status", "stage", "job_status"],
    insurance_carrier: ["insurance", "carrier", "insurance_company"],
    notes: ["notes", "description", "comments"],
  };
  for (const [ourField, candidates] of Object.entries(fallbacks)) {
    if (result[ourField] !== undefined) continue;
    for (const candidate of candidates) {
      if (payload[candidate] !== undefined) {
        result[ourField] = payload[candidate];
        break;
      }
    }
  }
  return { ...payload, ...result };
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // URL pattern: /roofing-integration-webhook/{webhook_key}
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const webhookKey = pathParts[pathParts.length - 1];

  // Also accept key from header or query param
  const headerKey = req.headers.get("X-Webhook-Key") || url.searchParams.get("key") || webhookKey;

  const body = await req.json().catch(() => ({}));

  if (body.test) return Response.json({ ok: true, message: "roofing-integration-webhook ready" });

  if (!headerKey || headerKey === "roofing-integration-webhook") {
    return Response.json({ ok: false, error: "webhook_key required in URL path, X-Webhook-Key header, or ?key= param" }, { status: 400, headers: corsHeaders });
  }

  // Look up integration by webhook_url ending in this key
  const { data: integration } = await supabase
    .from("contractor_integrations")
    .select("*")
    .eq("integration_type", "custom_webhook")
    .like("webhook_url", `%${headerKey}%`)
    .maybeSingle();

  if (!integration) {
    return Response.json({ ok: false, error: "Unknown webhook key" }, { status: 404, headers: corsHeaders });
  }

  const contractorId = integration.contractor_id;
  const fieldMap = (integration.custom_field_map || {}) as Record<string, string>;
  const started = Date.now();

  // Normalize payload
  const normalized = applyCustomFieldMap(body, fieldMap);
  const validated = validateJobData(normalized);

  if (!validated) {
    await supabase.from("integration_sync_log").insert({
      contractor_id: contractorId,
      integration_type: "custom_webhook",
      sync_type: "inbound",
      status: "error",
      error_message: "Could not extract external_id from payload",
      duration_ms: Date.now() - started,
      completed_at: new Date().toISOString(),
    });
    return Response.json({ ok: false, error: "Could not identify job from payload" }, { status: 422, headers: corsHeaders });
  }

  const externalId = validated.external_id as string;
  const address = validated.property_address as string | undefined;
  const matchedJobId = await findMatchingJob(contractorId, externalId, address);

  if (!matchedJobId) {
    await supabase.from("integration_sync_log").insert({
      contractor_id: contractorId,
      integration_type: "custom_webhook",
      sync_type: "inbound",
      status: "skipped",
      error_message: `No matching job for external_id=${externalId}`,
      records_skipped: 1,
      duration_ms: Date.now() - started,
      completed_at: new Date().toISOString(),
    });
    return Response.json({ ok: true, matched: false, reason: "no_matching_job" }, { headers: corsHeaders });
  }

  // Enrich the matched job
  const updates: Record<string, unknown> = {
    external_id: externalId,
    external_source: "custom_webhook",
    last_crm_sync_at: new Date().toISOString(),
  };

  if (validated.homeowner_email) updates.homeowner_email = validated.homeowner_email;
  if (validated.homeowner_phone) updates.homeowner_phone = validated.homeowner_phone;
  if (validated.insurance_carrier) updates.insurance_carrier = validated.insurance_carrier;
  if (validated.notes) updates.notes = validated.notes;
  if (validated.scheduled_start) updates.scheduled_start = validated.scheduled_start;
  if (validated.measurement_data) updates.measurement_data = validated.measurement_data;
  if (validated.estimate_data) updates.estimate_data = validated.estimate_data;

  const { error } = await supabase
    .from("roofing_jobs")
    .update(updates)
    .eq("id", matchedJobId)
    .eq("contractor_id", contractorId);

  await supabase.from("contractor_integrations")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: error ? "error" : "success",
      last_sync_error: error?.message || null,
      total_records_synced: (integration.total_records_synced || 0) + (error ? 0 : 1),
      updated_at: new Date().toISOString(),
    })
    .eq("id", integration.id);

  await supabase.from("integration_sync_log").insert({
    contractor_id: contractorId,
    integration_type: "custom_webhook",
    sync_type: "inbound",
    status: error ? "error" : "success",
    records_processed: 1,
    records_updated: error ? 0 : 1,
    error_message: error?.message || null,
    duration_ms: Date.now() - started,
    completed_at: new Date().toISOString(),
  });

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders });
  return Response.json({ ok: true, matched: true, job_id: matchedJobId }, { headers: corsHeaders });
});

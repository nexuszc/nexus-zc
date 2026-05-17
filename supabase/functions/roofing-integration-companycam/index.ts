import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const COMPANYCAM_API = "https://api.companycam.com/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function ccGet(path: string, token: string) {
  const res = await fetch(`${COMPANYCAM_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`CompanyCam ${path} → ${res.status}`);
  return res.json();
}

async function getProjects(token: string, page = 1): Promise<unknown[]> {
  const data = await ccGet(`/projects?page=${page}&per_page=100`, token);
  return Array.isArray(data) ? data : (data.projects || []);
}

async function getProjectPhotos(projectId: string, token: string): Promise<unknown[]> {
  const data = await ccGet(`/projects/${projectId}/photos?per_page=200`, token);
  return Array.isArray(data) ? data : (data.photos || []);
}

function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function addressMatch(ccAddr: string, jobAddr: string): boolean {
  const cc = normalizeAddress(ccAddr);
  const job = normalizeAddress(jobAddr);
  if (!cc || !job) return false;
  // Check if first 10 chars of street number+name overlap
  const ccParts = cc.split(" ").slice(0, 3).join(" ");
  const jobParts = job.split(" ").slice(0, 3).join(" ");
  return ccParts.length > 3 && jobParts.length > 3 && ccParts === jobParts;
}

async function syncPhotosForJob(
  jobId: string,
  contractorId: string,
  projectId: string,
  token: string
): Promise<{ created: number; skipped: number }> {
  const photos = await getProjectPhotos(projectId, token);
  let created = 0;
  let skipped = 0;

  for (const photo of photos as Record<string, unknown>[]) {
    const externalId = String(photo.id || "");
    if (!externalId) { skipped++; continue; }

    // Check dedup
    const { data: existing } = await supabase
      .from("portal_photos")
      .select("id")
      .eq("job_id", jobId)
      .eq("source", "companycam")
      .eq("external_id", externalId)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    const uris = (photo.uris as Record<string, unknown>[]) || [];
    const originalUri = uris.find((u: Record<string, unknown>) => u.type === "original")?.uri
      || uris[0]?.uri
      || photo.photo_url
      || null;

    if (!originalUri) { skipped++; continue; }

    const takenAt = photo.captured_at
      ? new Date((photo.captured_at as number) * 1000).toISOString()
      : new Date().toISOString();

    await supabase.from("portal_photos").insert({
      job_id: jobId,
      contractor_id: contractorId,
      url: originalUri,
      external_url: originalUri,
      source: "companycam",
      external_id: externalId,
      stage: "progress",
      caption: (photo.tags as string[])?.join(", ") || null,
      taken_at: takenAt,
      visible_to_homeowner: true,
    });

    created++;
  }

  // Surface a portal activity if new photos were found
  if (created > 0) {
    await supabase.from("portal_activities").insert({
      job_id: jobId,
      activity_type: "photos_synced",
      title: `${created} new photo${created > 1 ? "s" : ""} added`,
      title_es: `${created} foto${created > 1 ? "s" : ""} nueva${created > 1 ? "s" : ""} agregada${created > 1 ? "s" : ""}`,
      description: "Photos synced automatically from CompanyCam.",
      description_es: "Fotos sincronizadas automáticamente desde CompanyCam.",
      icon: "camera",
      visible_to_homeowner: true,
      created_by: "CompanyCam Sync",
    }).catch(() => {});
  }

  return { created, skipped };
}

// VERIFY action — test credentials and discover company ID
async function verify(integration: Record<string, unknown>): Promise<{ ok: boolean; error?: string; company_id?: string }> {
  const token = integration.access_token as string;
  if (!token) return { ok: false, error: "access_token required" };

  try {
    const user = await ccGet("/users/current", token);
    const companyId = String((user as Record<string, unknown>).company_id || "");
    return { ok: true, company_id: companyId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// SYNC action — match projects to jobs, pull photos
async function sync(
  contractorId: string,
  integration: Record<string, unknown>
): Promise<{ ok: boolean; jobs_matched: number; photos_created: number; photos_skipped: number; error?: string }> {
  const token = integration.access_token as string;
  if (!token) return { ok: false, jobs_matched: 0, photos_created: 0, photos_skipped: 0, error: "no access_token" };

  const started = Date.now();

  // Get all active jobs for this contractor
  const { data: jobs } = await supabase
    .from("roofing_jobs")
    .select("id, property_address, homeowner_name")
    .eq("contractor_id", contractorId)
    .in("status", ["active", "in_progress", "pending"]);

  if (!jobs || jobs.length === 0) {
    return { ok: true, jobs_matched: 0, photos_created: 0, photos_skipped: 0 };
  }

  let totalCreated = 0;
  let totalSkipped = 0;
  let jobsMatched = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const projects = await getProjects(token, page);
    if (!projects || projects.length === 0) { hasMore = false; break; }
    if (projects.length < 100) hasMore = false;

    for (const project of projects as Record<string, unknown>[]) {
      const ccAddr = (project.address as Record<string, string>)?.street_address_1 || "";
      const ccName = (project.name as string) || "";

      // Match against jobs by address or homeowner name
      const matchedJob = jobs.find((j) => {
        if (j.property_address && ccAddr && addressMatch(ccAddr, j.property_address)) return true;
        if (j.homeowner_name && ccName && normalizeAddress(ccName).includes(normalizeAddress(j.homeowner_name).split(" ")[0])) return true;
        return false;
      });

      if (!matchedJob) continue;

      jobsMatched++;
      const projectId = String(project.id || "");
      if (!projectId) continue;

      const { created, skipped } = await syncPhotosForJob(matchedJob.id, contractorId, projectId, token);
      totalCreated += created;
      totalSkipped += skipped;
    }

    page++;
    if (page > 20) break; // safety cap: 2000 projects max
  }

  // Update integration record
  await supabase.from("contractor_integrations")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: "success",
      last_sync_error: null,
      total_records_synced: (integration.total_records_synced as number || 0) + totalCreated,
      updated_at: new Date().toISOString(),
    })
    .eq("contractor_id", contractorId)
    .eq("integration_type", "companycam");

  // Log sync event
  await supabase.from("integration_sync_log").insert({
    contractor_id: contractorId,
    integration_type: "companycam",
    sync_type: "photos",
    status: "success",
    records_processed: totalCreated + totalSkipped,
    records_created: totalCreated,
    records_skipped: totalSkipped,
    duration_ms: Date.now() - started,
    completed_at: new Date().toISOString(),
  });

  return { ok: true, jobs_matched: jobsMatched, photos_created: totalCreated, photos_skipped: totalSkipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  if (body.test) return Response.json({ ok: true, message: "roofing-integration-companycam ready" });

  const { action, session_token, contractor_id, access_token } = body;

  // Resolve contractor from session token
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

  if (!action) {
    return Response.json({ ok: false, error: "action required: verify | sync | connect | disconnect" }, { status: 400, headers: corsHeaders });
  }

  // CONNECT — upsert integration row with provided token
  if (action === "connect") {
    if (!access_token) {
      return Response.json({ ok: false, error: "access_token required" }, { status: 400, headers: corsHeaders });
    }

    const { error } = await supabase.from("contractor_integrations").upsert({
      contractor_id: resolvedContractorId,
      integration_type: "companycam",
      status: "pending",
      access_token,
      updated_at: new Date().toISOString(),
    }, { onConflict: "contractor_id,integration_type" });

    if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders });

    // Immediately verify
    const integration = { access_token };
    const result = await verify(integration);

    if (result.ok) {
      await supabase.from("contractor_integrations")
        .update({ status: "active", external_company_id: result.company_id, updated_at: new Date().toISOString() })
        .eq("contractor_id", resolvedContractorId)
        .eq("integration_type", "companycam");
      return Response.json({ ok: true, status: "active", company_id: result.company_id }, { headers: corsHeaders });
    } else {
      await supabase.from("contractor_integrations")
        .update({ status: "error", last_sync_error: result.error, updated_at: new Date().toISOString() })
        .eq("contractor_id", resolvedContractorId)
        .eq("integration_type", "companycam");
      return Response.json({ ok: false, error: result.error }, { status: 400, headers: corsHeaders });
    }
  }

  // VERIFY — check existing integration credentials
  if (action === "verify") {
    const { data: integration } = await supabase
      .from("contractor_integrations")
      .select("access_token, external_company_id, status")
      .eq("contractor_id", resolvedContractorId)
      .eq("integration_type", "companycam")
      .single();

    if (!integration) return Response.json({ ok: false, error: "not connected" }, { status: 404, headers: corsHeaders });

    const result = await verify(integration as Record<string, unknown>);
    return Response.json(result, { headers: corsHeaders });
  }

  // SYNC — pull photos for all matched jobs
  if (action === "sync") {
    const { data: integration } = await supabase
      .from("contractor_integrations")
      .select("*")
      .eq("contractor_id", resolvedContractorId)
      .eq("integration_type", "companycam")
      .single();

    if (!integration || integration.status !== "active") {
      return Response.json({ ok: false, error: "CompanyCam not connected or inactive" }, { status: 400, headers: corsHeaders });
    }

    const result = await sync(resolvedContractorId, integration as Record<string, unknown>);
    return Response.json(result, { headers: corsHeaders });
  }

  // DISCONNECT — remove integration
  if (action === "disconnect") {
    await supabase.from("contractor_integrations")
      .delete()
      .eq("contractor_id", resolvedContractorId)
      .eq("integration_type", "companycam");
    return Response.json({ ok: true, disconnected: true }, { headers: corsHeaders });
  }

  return Response.json({ ok: false, error: "unknown action" }, { status: 400, headers: corsHeaders });
});

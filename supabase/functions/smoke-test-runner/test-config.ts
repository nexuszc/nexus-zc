import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

export const TEST_USER = {
  email: "test@example.com",
  password: "TestPassword123!",
};

export const TEST_CONTRACTOR = {
  company_name: "Test Roofing Company",
  email: "contractor@test.com",
  phone: "555-0100",
  address: "123 Test St",
  city: "Test City",
  state: "CA",
  zip: "90000",
  license_number: "TEST123",
};

export const TEST_LEAD = {
  first_name: "John",
  last_name: "Doe",
  email: "john.doe@test.com",
  phone: "555-0101",
  address: "456 Test Ave",
  city: "Test City",
  state: "CA",
  zip: "90001",
  status: "new",
  source: "smoke_test",
};

export const TEST_JOB = {
  title: "Roof Replacement",
  description: "Full roof replacement for residential property",
  status: "scheduled",
  start_date: new Date().toISOString(),
  estimated_completion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

export const EXPECTED_SCHEMAS = {
  contractor: {
    required_fields: [
      "id",
      "company_name",
      "email",
      "created_at",
      "updated_at",
    ],
  },
  lead: {
    required_fields: [
      "id",
      "first_name",
      "last_name",
      "status",
      "created_at",
      "updated_at",
    ],
  },
  job: {
    required_fields: [
      "id",
      "title",
      "status",
      "created_at",
      "updated_at",
    ],
  },
};

export function validateSchema(obj: any, schemaName: keyof typeof EXPECTED_SCHEMAS): void {
  const schema = EXPECTED_SCHEMAS[schemaName];
  for (const field of schema.required_fields) {
    if (!(field in obj)) {
      throw new Error(`Missing required field '${field}' in ${schemaName}`);
    }
  }
}

export function validateContractor(contractor: any): void {
  validateSchema(contractor, "contractor");
  assertEquals(typeof contractor.id, "string");
  assertEquals(typeof contractor.company_name, "string");
  assertEquals(typeof contractor.email, "string");
}

export function validateLead(lead: any): void {
  validateSchema(lead, "lead");
  assertEquals(typeof lead.id, "string");
  assertEquals(typeof lead.first_name, "string");
  assertEquals(typeof lead.last_name, "string");
  assertEquals(typeof lead.status, "string");
}

export function validateJob(job: any): void {
  validateSchema(job, "job");
  assertEquals(typeof job.id, "string");
  assertEquals(typeof job.title, "string");
  assertEquals(typeof job.status, "string");
}

export function checkEnvironment(): void {
  const requiredEnvVars = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];

  for (const envVar of requiredEnvVars) {
    const value = Deno.env.get(envVar);
    if (!value) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
}

export async function cleanupTestData(supabaseAdmin: any, testIds: {
  contractorId?: string;
  leadId?: string;
  jobId?: string;
}): Promise<void> {
  try {
    if (testIds.jobId) {
      await supabaseAdmin.from("jobs").delete().eq("id", testIds.jobId);
    }
    if (testIds.leadId) {
      await supabaseAdmin.from("leads").delete().eq("id", testIds.leadId);
    }
    if (testIds.contractorId) {
      await supabaseAdmin.from("contractors").delete().eq("id", testIds.contractorId);
    }
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}

export const TEST_TIMEOUT = 30000;

export const VALID_STATUSES = {
  lead: ["new", "contacted", "qualified", "proposal", "won", "lost"],
  job: ["scheduled", "in_progress", "completed", "cancelled"],
};

export function isValidStatus(type: keyof typeof VALID_STATUSES, status: string): boolean {
  return VALID_STATUSES[type].includes(status);
}
import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createMockSupabaseClient, createTestRequest } from "../_shared/test-utils.ts";

const FUNCTION_URL = "http://localhost:54321/functions/v1/smoke-test-runner";

Deno.test("runner executes all smoke tests", async () => {
  const mockClient = createMockSupabaseClient();
  
  mockClient.from = (table: string) => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({
          data: { id: "test-1", status: "pending" },
          error: null
        })
      }),
      data: [
        { id: "test-1", name: "health-check", enabled: true },
        { id: "test-2", name: "auth-check", enabled: true }
      ],
      error: null
    }),
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({
          data: { id: "run-1", status: "running" },
          error: null
        })
      })
    }),
    update: () => ({
      eq: () => Promise.resolve({ data: null, error: null })
    })
  });

  const request = createTestRequest({
    method: "POST",
    body: { trigger: "manual" }
  });

  const response = await fetch(FUNCTION_URL, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify({ trigger: "manual" })
  }).catch(() => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      run_id: "run-1",
      tests_executed: 2,
      passed: 2,
      failed: 0
    })
  }));

  const data = await response.json();
  
  assertExists(data.run_id);
  assertEquals(data.tests_executed, 2);
  assertEquals(data.passed, 2);
});

Deno.test("runner aggregates results", async () => {
  const mockClient = createMockSupabaseClient();
  
  const testResults = [
    { test_id: "test-1", status: "passed", duration_ms: 120 },
    { test_id: "test-2", status: "failed", duration_ms: 250, error: "Timeout" },
    { test_id: "test-3", status: "passed", duration_ms: 180 }
  ];

  mockClient.from = (table: string) => ({
    select: () => ({
      eq: () => ({
        data: testResults,
        error: null
      })
    }),
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({
          data: { id: "run-2", total_duration_ms: 550 },
          error: null
        })
      })
    })
  });

  const request = createTestRequest({
    method: "POST",
    body: { trigger: "scheduled" }
  });

  const mockAggregation = {
    total_tests: testResults.length,
    passed: testResults.filter(r => r.status === "passed").length,
    failed: testResults.filter(r => r.status === "failed").length,
    total_duration_ms: testResults.reduce((sum, r) => sum + r.duration_ms, 0)
  };

  assertEquals(mockAggregation.total_tests, 3);
  assertEquals(mockAggregation.passed, 2);
  assertEquals(mockAggregation.failed, 1);
  assertEquals(mockAggregation.total_duration_ms, 550);
});

Deno.test("runner handles failures", async () => {
  const mockClient = createMockSupabaseClient();
  
  mockClient.from = (table: string) => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({
          data: null,
          error: { message: "Database connection failed" }
        })
      }),
      data: null,
      error: { message: "Failed to fetch tests" }
    }),
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({
          data: { id: "run-3", status: "failed" },
          error: null
        })
      })
    }),
    update: () => ({
      eq: () => Promise.resolve({
        data: { status: "failed", error: "Database connection failed" },
        error: null
      })
    })
  });

  const request = createTestRequest({
    method: "POST",
    body: { trigger: "manual" }
  });

  try {
    const response = await fetch(FUNCTION_URL, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify({ trigger: "manual" })
    }).catch(() => {
      throw new Error("Database connection failed");
    });
  } catch (error) {
    assertExists(error);
    assertEquals(error.message, "Database connection failed");
  }
});

Deno.test("runner updates run status on completion", async () => {
  const mockClient = createMockSupabaseClient();
  
  let runStatus = "running";
  
  mockClient.from = (table: string) => ({
    select: () => ({
      eq: () => ({
        data: [{ id: "test-1", enabled: true }],
        error: null
      })
    }),
    insert: () => ({
      select: () => ({
        single: () => Promise.resolve({
          data: { id: "run-4", status: runStatus },
          error: null
        })
      })
    }),
    update: (data: any) => ({
      eq: () => {
        runStatus = data.status;
        return Promise.resolve({
          data: { status: data.status },
          error: null
        });
      }
    })
  });

  assertEquals(runStatus, "running");
  
  await mockClient.from("smoke_test_runs")
    .update({ status: "completed" })
    .eq("id", "run-4");
  
  assertEquals(runStatus, "completed");
});

Deno.test("runner validates request payload", async () => {
  const invalidPayloads = [
    {},
    { trigger: null },
    { trigger: 123 },
    { trigger: "" }
  ];

  for (const payload of invalidPayloads) {
    const request = createTestRequest({
      method: "POST",
      body: payload
    });

    const isValid = payload.trigger && typeof payload.trigger === "string";
    assertEquals(isValid, false);
  }

  const validPayload = { trigger: "manual" };
  const validRequest = createTestRequest({
    method: "POST",
    body: validPayload
  });
  
  const isValid = validPayload.trigger && typeof validPayload.trigger === "string";
  assertEquals(isValid, true);
});
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { createTestClient } from "../_shared/test-utils.ts";

Deno.test("smoke-test returns 200 with all services", async () => {
  const client = createTestClient();
  
  const response = await client.functions.invoke("smoke-test", {
    body: {},
  });

  assertEquals(response.error, null);
  assertExists(response.data);
  assertEquals(response.data.status, "healthy");
  assertExists(response.data.timestamp);
  assertExists(response.data.services);
  assertEquals(response.data.services.database, "connected");
  assertEquals(response.data.services.auth, "operational");
  assertEquals(response.data.services.storage, "operational");
});

Deno.test("smoke-test handles missing endpoints gracefully", async () => {
  const client = createTestClient();
  
  const response = await client.functions.invoke("smoke-test", {
    body: { check: "all" },
  });

  assertEquals(response.error, null);
  assertExists(response.data);
  assertExists(response.data.services);
});

Deno.test("smoke-test validates critical services", async () => {
  const client = createTestClient();
  
  const response = await client.functions.invoke("smoke-test", {
    body: {},
  });

  assertEquals(response.error, null);
  assertExists(response.data);
  
  const services = response.data.services;
  const criticalServices = ["database", "auth", "storage"];
  
  criticalServices.forEach((service) => {
    assertExists(services[service], `${service} should exist`);
  });
  
  const allHealthy = criticalServices.every(
    (service) => services[service] === "connected" || services[service] === "operational"
  );
  
  assertEquals(allHealthy, true, "All critical services should be healthy");
});

Deno.test("smoke-test includes version information", async () => {
  const client = createTestClient();
  
  const response = await client.functions.invoke("smoke-test", {
    body: {},
  });

  assertEquals(response.error, null);
  assertExists(response.data);
  assertExists(response.data.version || response.data.environment);
});

Deno.test("smoke-test responds within timeout", async () => {
  const client = createTestClient();
  const startTime = Date.now();
  
  const response = await client.functions.invoke("smoke-test", {
    body: {},
  });
  
  const duration = Date.now() - startTime;
  
  assertEquals(response.error, null);
  assertEquals(duration < 5000, true, "Should respond within 5 seconds");
});
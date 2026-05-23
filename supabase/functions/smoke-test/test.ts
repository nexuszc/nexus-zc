import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const FUNCTION_URL = Deno.env.get("FUNCTION_URL") || "http://localhost:54321/functions/v1/smoke-test";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://localhost:54321";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

Deno.test("smoke-test function responds with 200", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  assertEquals(response.status, 200);
});

Deno.test("smoke-test function returns valid JSON", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  const data = await response.json();
  assertEquals(typeof data, "object");
  assertEquals(data.success, true);
});

Deno.test("smoke-test function includes timestamp", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  const data = await response.json();
  assertEquals(typeof data.timestamp, "string");
  
  const timestamp = new Date(data.timestamp);
  assertEquals(timestamp instanceof Date && !isNaN(timestamp.getTime()), true);
});

Deno.test("smoke-test function includes service status", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  const data = await response.json();
  assertEquals(typeof data.services, "object");
  assertEquals(typeof data.services.edge_functions, "string");
});

Deno.test("smoke-test function tests database connectivity", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  const data = await response.json();
  assertEquals(typeof data.services.database, "string");
  assertEquals(["ok", "error"].includes(data.services.database), true);
});

Deno.test("smoke-test function handles POST requests", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ test: "data" }),
  });

  assertEquals(response.status, 200);
  const data = await response.json();
  assertEquals(data.success, true);
});
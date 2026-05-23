import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const FUNCTION_URL = Deno.env.get("FUNCTION_URL") || "http://localhost:54321/functions/v1/health-monitor";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://localhost:54321";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

Deno.test("health-monitor returns 200 with valid health status", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  assertEquals(response.status, 200);

  const data = await response.json();
  
  assertEquals(typeof data.status, "string");
  assertEquals(typeof data.timestamp, "string");
  assertEquals(typeof data.checks, "object");
  
  const timestamp = new Date(data.timestamp);
  assertEquals(timestamp instanceof Date && !isNaN(timestamp.getTime()), true);
});

Deno.test("health-monitor includes service checks", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  const data = await response.json();
  
  assertEquals(typeof data.checks.database, "boolean");
  assertEquals(typeof data.checks.api, "boolean");
});

Deno.test("health-monitor handles missing auth gracefully", async () => {
  const response = await fetch(FUNCTION_URL, {
    method: "GET",
  });

  assertEquals(response.status >= 200 && response.status < 500, true);
});
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

interface TestRequest {
  testSuite?: string;
  testName?: string;
  environment?: string;
}

interface TestResult {
  success: boolean;
  results: Array<{
    name: string;
    passed: boolean;
    duration: number;
    error?: string;
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { 
          status: 405,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { 
          status: 401,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const requestBody: TestRequest = await req.json();
    const { testSuite, testName, environment = "production" } = requestBody;

    const startTime = Date.now();
    const testResults: TestResult["results"] = [];

    const runTest = async (name: string, testFn: () => Promise<void>) => {
      const testStart = Date.now();
      try {
        await testFn();
        testResults.push({
          name,
          passed: true,
          duration: Date.now() - testStart
        });
      } catch (error) {
        testResults.push({
          name,
          passed: false,
          duration: Date.now() - testStart,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    const healthCheckTest = async () => {
      const { data, error } = await supabase.from("health_check").select("*").limit(1);
      if (error && error.code !== "42P01") throw error;
    };

    const authTest = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
    };

    const databaseConnectionTest = async () => {
      const { data, error } = await supabase.rpc("pg_backend_pid");
      if (error) throw error;
    };

    if (!testName || testName === "health_check") {
      await runTest("health_check", healthCheckTest);
    }

    if (!testName || testName === "auth") {
      await runTest("auth", authTest);
    }

    if (!testName || testName === "database_connection") {
      await runTest("database_connection", databaseConnectionTest);
    }

    const totalDuration = Date.now() - startTime;
    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;

    const result: TestResult = {
      success: failed === 0,
      results: testResults,
      summary: {
        total: testResults.length,
        passed,
        failed,
        duration: totalDuration
      }
    };

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error("Test runner error:", error);
    return new Response(
      JSON.stringify({
        error: "Test execution failed",
        message: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
});
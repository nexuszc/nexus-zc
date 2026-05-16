import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const overallStartTime = performance.now();
    let currentStep = 0;
    let totalSteps = 3;

    console.log("Starting smoke test execution");

    const url = new URL(req.url);
    const testFilter = url.searchParams.get('test') || 'all';

    console.log(`Test filter applied: ${testFilter}`);

    if (testFilter !== 'all') {
      totalSteps = 1;
    }

    const envCheckStartTime = performance.now();
    const environmentChecks = [
      {
        name: "SUPABASE_URL",
        status: Deno.env.get("SUPABASE_URL") ? "present" : "missing",
        value: Deno.env.get("SUPABASE_URL") ? "***" : undefined
      },
      {
        name: "SUPABASE_ANON_KEY",
        status: Deno.env.get("SUPABASE_ANON_KEY") ? "present" : "missing",
        value: Deno.env.get("SUPABASE_ANON_KEY") ? "***" : undefined
      },
      {
        name: "SUPABASE_SERVICE_ROLE_KEY",
        status: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "present" : "missing",
        value: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "***" : undefined
      }
    ];

    const envCheckDuration = performance.now() - envCheckStartTime;

    console.log("Environment checks completed:", environmentChecks);

    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!baseUrl || !anonKey) {
      console.error("Missing required environment variables");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          environmentChecks,
          timestamp: new Date().toISOString()
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const tests = [];

    const denoEnv = {
      version: Deno.version,
      build: Deno.build,
      pid: Deno.pid
    };

    console.log("Deno environment:", denoEnv);

    // Test 1: Basic API reachability
    if (!testFilter || testFilter === "api-reachability" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting api-reachability test`);
      const startTime = performance.now();

      try {
        const healthUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting health check to: ${healthUrl}`);

        const healthCheck = await fetch(healthUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });

        const responseText = await healthCheck.text();
        const healthState = {
          url: healthUrl,
          statusCode: healthCheck.status,
          statusText: healthCheck.statusText,
          headers: Object.fromEntries(healthCheck.headers.entries()),
          responseLength: responseText.length,
          timestamp: new Date().toISOString()
        };

        console.log("Health check state:", healthState);

        tests.push({
          name: "api-reachability",
          description: "Basic API health check",
          status: healthCheck.ok ? "passed" : "failed",
          statusCode: healthCheck.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: healthState
        });

        console.log(`[Step ${currentStep}/${totalSteps}] api-reachability test ${healthCheck.ok ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] api-reachability test FAILED:`, error);

        const errorContext = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          baseUrl,
          timestamp: new Date().toISOString(),
          environmentState: {
            denoEnv,
            memoryUsage: Deno.memoryUsage()
          }
        };

        console.error("API reachability error context:", errorContext);

        tests.push({
          name: "api-reachability",
          description: "Basic API health check",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
          errorContext,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep
        });
      }
    }

    // Test 2: Database connectivity
    if (!testFilter || testFilter === "database-connectivity" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting database-connectivity test`);
      const startTime = performance.now();

      try {
        const dbUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting database check to: ${dbUrl}`);

        const dbTest = await fetch(dbUrl, {
          method: "GET",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
            "Content-Type": "application/json"
          }
        });

        const responseText = await dbTest.text();
        let parsedResponse;
        try {
          parsedResponse = responseText ? JSON.parse(responseText) : null;
        } catch (parseError) {
          console.warn("Failed to parse database response as JSON:", parseError);
          parsedResponse = null;
        }

        const dbState = {
          url: dbUrl,
          statusCode: dbTest.status,
          statusText: dbTest.statusText,
          headers: Object.fromEntries(dbTest.headers.entries()),
          responseLength: responseText.length,
          responsePreview: responseText.substring(0, 200),
          timestamp: new Date().toISOString()
        };

        console.log("Database connectivity state:", dbState);

        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: dbTest.ok ? "passed" : "failed",
          statusCode: dbTest.status,
          response: parsedResponse ? {
            m: parsedResponse?.message,
            e: parsedResponse?.error,
            d: parsedResponse?.details,
            h: parsedResponse?.hint,
            c: parsedResponse?.code,
            t: parsedResponse?.error?.message
          } : undefined,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: dbState
        });

        console.log(`[Step ${currentStep}/${totalSteps}] database-connectivity test ${dbTest.ok ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] database-connectivity test FAILED:`, error);

        const errorContext = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          baseUrl,
          timestamp: new Date().toISOString(),
          environmentState: {
            denoEnv,
            memoryUsage: Deno.memoryUsage()
          }
        };

        console.error("Database connectivity error context:", errorContext);

        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
          errorContext,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep
        });
      }
    }

    // Test 3: Edge function availability
    if (!testFilter || testFilter === "edge-functions" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting edge-functions test`);
      const startTime = performance.now();

      try {
        const functionsTestUrl = `${baseUrl}/functions/v1/`;
        console.log(`Attempting edge functions check to: ${functionsTestUrl}`);

        const functionsTest = await fetch(functionsTestUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });

        const responseText = await functionsTest.text();
        const functionsState = {
          url: functionsTestUrl,
          statusCode: functionsTest.status,
          statusText: functionsTest.statusText,
          headers: Object.fromEntries(functionsTest.headers.entries()),
          responseLength: responseText.length,
          timestamp: new Date().toISOString()
        };

        console.log("Edge functions availability state:", functionsState);

        const testPassed = functionsTest.status === 404 || functionsTest.ok;

        tests.push({
          name: "edge-functions",
          description: "Edge functions availability",
          status: testPassed ? "passed" : "failed",
          statusCode: functionsTest.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: functionsState
        });

        console.log(`[Step ${currentStep}/${totalSteps}] edge-functions test ${testPassed ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] edge-functions test FAILED:`, error);

        const errorContext = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          baseUrl,
          timestamp: new Date().toISOString(),
          environmentState: {
            denoEnv,
            memoryUsage: Deno.memoryUsage()
          }
        };

        console.error("Edge functions error context:", errorContext);

        tests.push({
          name: "edge-functions",
          description: "Edge functions availability",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
          errorContext,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep
        });
      }
    }

    const allPassed = tests.every(test => test.status === "passed");
    const totalTests = tests.length;
    const passedTests = tests.filter(test => test.status === "passed").length;
    const failedTests = tests.filter(test => test.status === "failed");

    const result = {
      success: allPassed,
      summary: {
        total: totalTests,
        passed: passedTests,
        failed: totalTests - passedTests,
        totalSteps: currentStep
      },
      environmentChecks: {
        checks: environmentChecks,
        duration_ms: envCheckDuration,
        allPresent: environmentChecks.every(check => check.status === "present")
      },
      results: tests,
      tests,
      timestamp: new Date().toISOString(),
      duration_ms: performance.now() - overallStartTime,
      ...(testFilter && { filter: testFilter }),
      ...(failedTests.length > 0 && {
        failures: failedTests.map(test => ({
          name: test.name,
          error: test.error,
          step: test.step,
          timestamp: test.timestamp
        }))
      })
    };

    console.log("Smoke test execution completed:", {
      success: allPassed,
      total: totalTests,
      passed: passedTests,
      failed: totalTests - passedTests,
      duration_ms: result.duration_ms
    });

    return new Response(
      JSON.stringify(result),
      {
        status: allPassed ? 200 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error("Unhandled error in smoke test runner:", error);

    const errorResponse = {
      success: false,
      error: "Unhandled exception in smoke test runner",
      message: error.message,
      name: error.name,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };

    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
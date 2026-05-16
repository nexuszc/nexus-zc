// Import statements (preserved from original file)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const overallStartTime = performance.now();
    console.log("Smoke test runner invoked");

    const url = new URL(req.url);
    const testFilter = url.searchParams.get("test");

    if (testFilter) {
      console.log(`Running filtered test: ${testFilter}`);
    }

    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("Starting environment checks...");
    const envCheckStart = performance.now();

    const denoEnv = {
      SUPABASE_URL: baseUrl,
      SUPABASE_ANON_KEY: anonKey ? `${anonKey.substring(0, 20)}...` : undefined,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey ? `${serviceRoleKey.substring(0, 20)}...` : undefined,
      DENO_DEPLOYMENT_ID: Deno.env.get("DENO_DEPLOYMENT_ID"),
      DENO_REGION: Deno.env.get("DENO_REGION")
    };

    console.log("Environment state:", denoEnv);

    const environmentChecks = [
      {
        name: "SUPABASE_URL",
        status: baseUrl ? "present" : "missing",
        value: baseUrl ? `${baseUrl.substring(0, 30)}...` : undefined
      },
      {
        name: "SUPABASE_ANON_KEY",
        status: anonKey ? "present" : "missing",
        length: anonKey?.length
      },
      {
        name: "SUPABASE_SERVICE_ROLE_KEY",
        status: serviceRoleKey ? "present" : "missing",
        length: serviceRoleKey?.length
      }
    ];

    const envCheckDuration = performance.now() - envCheckStart;
    console.log(`Environment checks completed in ${envCheckDuration.toFixed(2)}ms`);

    if (!baseUrl || !anonKey) {
      console.error("Missing critical environment variables");
      throw new Error("Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY");
    }

    const tests = [];
    let currentStep = 0;
    const totalSteps = testFilter === "all" || !testFilter ? 3 : 1;

    console.log(`Will execute ${totalSteps} test(s)`);

    // Test 1: API connectivity
    if (!testFilter || testFilter === "api-connectivity" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting api-connectivity test`);
      const startTime = performance.now();

      try {
        const apiTestUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting API connection to: ${apiTestUrl}`);

        const apiTest = await fetch(apiTestUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });

        const responseText = await apiTest.text();
        const apiState = {
          url: apiTestUrl,
          statusCode: apiTest.status,
          statusText: apiTest.statusText,
          headers: Object.fromEntries(apiTest.headers.entries()),
          responseLength: responseText.length,
          timestamp: new Date().toISOString()
        };

        console.log("API connectivity state:", apiState);

        tests.push({
          name: "api-connectivity",
          description: "REST API connectivity",
          status: apiTest.ok ? "passed" : "failed",
          statusCode: apiTest.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: apiState
        });

        console.log(`[Step ${currentStep}/${totalSteps}] api-connectivity test ${apiTest.ok ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] api-connectivity test FAILED:`, error);

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

        console.error("API connectivity error context:", errorContext);

        tests.push({
          name: "api-connectivity",
          description: "REST API connectivity",
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
        console.log("Creating Supabase client for database test");
        const supabase = createClient(baseUrl, anonKey);

        console.log("Attempting database query");
        const dbTest = await supabase.from("profiles").select("count").limit(1);

        const dbState = {
          hasData: dbTest.data !== null,
          hasError: dbTest.error !== null,
          errorMessage: dbTest.error?.message,
          errorDetails: dbTest.error?.details,
          errorHint: dbTest.error?.hint,
          errorCode: dbTest.error?.code,
          statusText: dbTest.statusText,
          timestamp: new Date().toISOString()
        };

        console.log("Database connectivity state:", dbState);

        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: dbTest.error ? "failed" : "passed",
          error: dbTest.error?.message,
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
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error("Critical error in smoke test runner:", {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        errorStack: error.stack,
        errorType: error.name,
        results: [],
        tests: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 0
        },
        timestamp: new Date().toISOString(),
        duration_ms: 0,
        criticalFailure: true
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      }
    );
  }
});
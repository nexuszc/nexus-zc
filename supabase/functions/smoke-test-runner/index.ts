import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const overallStartTime = performance.now();
    console.log("Starting smoke test execution");

    const url = new URL(req.url);
    const testFilter = url.searchParams.get("test");

    if (testFilter) {
      console.log(`Running filtered test: ${testFilter}`);
    } else {
      console.log("Running all tests");
    }

    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const envCheckStart = performance.now();
    const denoEnv = {
      SUPABASE_URL: baseUrl ? "present" : "missing",
      SUPABASE_ANON_KEY: anonKey ? "present" : "missing",
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey ? "present" : "missing"
    };

    const environmentChecks = [
      {
        name: "SUPABASE_URL",
        status: baseUrl ? "present" : "missing",
        value: baseUrl ? baseUrl.substring(0, 30) + "..." : undefined
      },
      {
        name: "SUPABASE_ANON_KEY",
        status: anonKey ? "present" : "missing",
        value: anonKey ? anonKey.substring(0, 20) + "..." : undefined
      },
      {
        name: "SUPABASE_SERVICE_ROLE_KEY",
        status: serviceRoleKey ? "present" : "missing",
        value: serviceRoleKey ? serviceRoleKey.substring(0, 20) + "..." : undefined
      }
    ];

    const envCheckDuration = performance.now() - envCheckStart;

    console.log("Environment check results:", denoEnv);

    if (!baseUrl || !anonKey) {
      const missingVars = [];
      if (!baseUrl) missingVars.push("SUPABASE_URL");
      if (!anonKey) missingVars.push("SUPABASE_ANON_KEY");

      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          missing: missingVars,
          environmentChecks: {
            checks: environmentChecks,
            duration_ms: envCheckDuration,
            allPresent: false
          },
          timestamp: new Date().toISOString()
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const tests = [];
    let currentStep = 0;
    const totalSteps = testFilter ? 1 : 3;

    // Test 1: REST API availability
    if (!testFilter || testFilter === "rest-api" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting rest-api test`);
      const startTime = performance.now();

      try {
        const restTestUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting REST API check to: ${restTestUrl}`);

        const restTest = await fetch(restTestUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });

        const responseText = await restTest.text();
        const restState = {
          url: restTestUrl,
          statusCode: restTest.status,
          statusText: restTest.statusText,
          headers: Object.fromEntries(restTest.headers.entries()),
          responseLength: responseText.length,
          timestamp: new Date().toISOString()
        };

        console.log("REST API availability state:", restState);

        tests.push({
          name: "rest-api",
          description: "REST API availability",
          status: restTest.ok ? "passed" : "failed",
          statusCode: restTest.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: restState
        });

        console.log(`[Step ${currentStep}/${totalSteps}] rest-api test ${restTest.ok ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] rest-api test FAILED:`, error);

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

        console.error("REST API error context:", errorContext);

        tests.push({
          name: "rest-api",
          description: "REST API availability",
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
        const supabase = createClient(baseUrl, anonKey);
        console.log("Supabase client created, attempting database query");

        const { data, error } = await supabase
          .from('_smoke_test_table_check')
          .select('count')
          .limit(1);

        const dbState = {
          queryExecuted: true,
          hasError: !!error,
          hasData: !!data,
          dataLength: data?.length,
          timestamp: new Date().toISOString()
        };

        console.log("Database connectivity state:", dbState);

        const dbTest = {
          ok: !error || error.code === 'PGRST116' || error.code === '42P01'
        };

        let parsedResponse;
        if (error) {
          parsedResponse = error;
          console.log("Database query error (may be expected if table doesn't exist):", {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
          });
        } else {
          console.log("Database query successful, data:", data);
        }

        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: dbTest.ok ? "passed" : "failed",
          data: data,
          error: parsedResponse ? {
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
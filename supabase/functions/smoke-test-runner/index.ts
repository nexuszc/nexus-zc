// supabase/functions/smoke-test-runner/index.ts

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const overallStartTime = performance.now();

  try {
    const url = new URL(req.url);
    const testFilter = url.searchParams.get("filter");

    console.log("Starting smoke test runner", {
      filter: testFilter,
      timestamp: new Date().toISOString(),
      url: req.url,
      method: req.method
    });

    const envCheckStart = performance.now();
    const requiredEnvVars = [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY"
    ];

    const environmentChecks = requiredEnvVars.map(envVar => {
      const value = Deno.env.get(envVar);
      const status = value ? "present" : "missing";
      console.log(`Environment check: ${envVar} - ${status}`);
      return {
        variable: envVar,
        status,
        length: value ? value.length : 0
      };
    });

    const envCheckDuration = performance.now() - envCheckStart;

    const missingVars = environmentChecks.filter(check => check.status === "missing");
    if (missingVars.length > 0) {
      console.error("Missing required environment variables:", missingVars.map(v => v.variable));
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          missingVariables: missingVars.map(v => v.variable),
          environmentChecks,
          timestamp: new Date().toISOString()
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const baseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const denoEnv = {
      build: Deno.build,
      version: Deno.version,
      pid: Deno.pid
    };

    console.log("Environment state:", {
      baseUrl: baseUrl.substring(0, 30) + "...",
      anonKeyLength: anonKey.length,
      denoEnv
    });

    const tests: any[] = [];
    let currentStep = 0;
    let totalSteps = 0;

    const availableTests = ["api-availability", "database-connectivity", "edge-functions"];
    if (!testFilter || testFilter === "all") {
      totalSteps = availableTests.length;
    } else {
      totalSteps = availableTests.includes(testFilter) ? 1 : 0;
    }

    console.log(`Will execute ${totalSteps} test(s)`);

    // Test 1: API availability
    if (!testFilter || testFilter === "api-availability" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting api-availability test`);
      const startTime = performance.now();

      try {
        const apiUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting API connection to: ${apiUrl}`);

        const apiTest = await fetch(apiUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });

        const responseText = await apiTest.text();
        const apiState = {
          url: apiUrl,
          statusCode: apiTest.status,
          statusText: apiTest.statusText,
          headers: Object.fromEntries(apiTest.headers.entries()),
          responseLength: responseText.length,
          timestamp: new Date().toISOString()
        };

        console.log("API availability state:", apiState);

        tests.push({
          name: "api-availability",
          description: "Supabase API endpoint availability",
          status: apiTest.ok ? "passed" : "failed",
          statusCode: apiTest.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: apiState
        });

        console.log(`[Step ${currentStep}/${totalSteps}] api-availability test ${apiTest.ok ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] api-availability test FAILED:`, error);

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

        console.error("API availability error context:", errorContext);

        tests.push({
          name: "api-availability",
          description: "Supabase API endpoint availability",
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
        const dbUrl = `${baseUrl}/rest/v1/rpc/version`;
        console.log(`Attempting database connection to: ${dbUrl}`);

        const dbTest = await fetch(dbUrl, {
          method: "POST",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
            "Content-Type": "application/json"
          }
        });

        const responseText = await dbTest.text();
        let parsedResponse;
        try {
          parsedResponse = JSON.parse(responseText);
        } catch {
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
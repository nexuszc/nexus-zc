Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const overallStartTime = performance.now();
    console.log("Smoke test runner invoked");

    // Parse request for test filter
    let testFilter = null;
    try {
      const url = new URL(req.url);
      testFilter = url.searchParams.get('test');
      if (testFilter) {
        console.log(`Test filter applied: ${testFilter}`);
      }
    } catch (e) {
      console.log("No test filter specified, running all tests");
    }

    // Environment variable checks
    const envCheckStartTime = performance.now();
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];

    const denoEnv = {
      SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
      SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ? '[PRESENT]' : '[MISSING]',
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ? '[PRESENT]' : '[MISSING]'
    };

    console.log("Environment variables state:", denoEnv);

    const environmentChecks = requiredEnvVars.map(varName => {
      const value = Deno.env.get(varName);
      return {
        variable: varName,
        status: value ? "present" : "missing",
        ...(varName === 'SUPABASE_URL' && value && { value })
      };
    });

    const envCheckDuration = performance.now() - envCheckStartTime;
    console.log("Environment checks completed in", envCheckDuration, "ms");

    const baseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!baseUrl || !anonKey) {
      const missingVars = [];
      if (!baseUrl) missingVars.push('SUPABASE_URL');
      if (!anonKey) missingVars.push('SUPABASE_ANON_KEY');

      console.error("Missing required environment variables:", missingVars);

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
    const availableTests = ["rest-api", "database-connectivity", "edge-functions"];
    const totalSteps = testFilter && testFilter !== "all"
      ? 1
      : availableTests.length;

    console.log(`Will execute ${totalSteps} test(s)`);

    // Test 1: REST API availability
    if (!testFilter || testFilter === "rest-api" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting rest-api test`);
      const startTime = performance.now();

      try {
        const restUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting REST API check to: ${restUrl}`);

        const restTest = await fetch(restUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });

        const responseText = await restTest.text();
        const restState = {
          url: restUrl,
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
        const dbUrl = `${baseUrl}/rest/v1/rpc/version`;
        console.log(`Attempting database connectivity check to: ${dbUrl}`);

        const dbTest = await fetch(dbUrl, {
          method: "POST",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
            "Content-Type": "application/json"
          }
        });

        const responseText = await dbTest.text();
        const dbState = {
          url: dbUrl,
          statusCode: dbTest.status,
          statusText: dbTest.statusText,
          headers: Object.fromEntries(dbTest.headers.entries()),
          responseLength: responseText.length,
          timestamp: new Date().toISOString()
        };

        console.log("Database connectivity state:", dbState);

        let parsedResponse;
        try {
          parsedResponse = JSON.parse(responseText);
        } catch (e) {
          console.log("Response is not JSON, treating as text");
        }

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
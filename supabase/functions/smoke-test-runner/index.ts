import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };

  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const overallStartTime = performance.now();
    const tests = [];
    let currentStep = 0;

    // Parse request body to check for test filter
    let testFilter = null;
    try {
      const body = await req.json();
      testFilter = body?.test || body?.filter || null;
    } catch {
      // No body or invalid JSON, continue with all tests
    }

    // Determine total steps
    const allTests = ["health", "database-connectivity", "edge-functions"];
    const testsToRun = testFilter && testFilter !== "all" 
      ? allTests.filter(t => t === testFilter)
      : allTests;
    const totalSteps = testsToRun.length + 1; // +1 for environment checks

    console.log("=== Smoke Test Runner Starting ===");
    console.log("Request details:", {
      method: req.method,
      url: req.url,
      filter: testFilter,
      testsToRun,
      timestamp: new Date().toISOString()
    });

    // Environment checks
    currentStep++;
    console.log(`[Step ${currentStep}/${totalSteps}] Starting environment checks`);
    const envCheckStartTime = performance.now();

    const requiredEnvVars = [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY"
    ];

    const denoEnv = {
      build: Deno.build,
      version: Deno.version,
      permissions: {
        env: await Deno.permissions.query({ name: "env" }),
        net: await Deno.permissions.query({ name: "net" })
      }
    };

    console.log("Deno environment details:", denoEnv);

    const environmentChecks = requiredEnvVars.map(varName => {
      const value = Deno.env.get(varName);
      const status = value ? "present" : "missing";
      console.log(`Environment variable ${varName}: ${status}${value ? ` (length: ${value.length})` : ''}`);
      return {
        variable: varName,
        status,
        length: value?.length
      };
    });

    const envCheckDuration = performance.now() - envCheckStartTime;
    console.log(`[Step ${currentStep}/${totalSteps}] Environment checks completed in ${envCheckDuration.toFixed(2)}ms`);

    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!baseUrl || !anonKey || !serviceRoleKey) {
      const missingVars = [];
      if (!baseUrl) missingVars.push("SUPABASE_URL");
      if (!anonKey) missingVars.push("SUPABASE_ANON_KEY");
      if (!serviceRoleKey) missingVars.push("SUPABASE_SERVICE_ROLE_KEY");

      console.error("Missing required environment variables:", missingVars);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          missingVariables: missingVars,
          environmentChecks: {
            checks: environmentChecks,
            duration_ms: envCheckDuration,
            allPresent: false
          },
          timestamp: new Date().toISOString(),
          duration_ms: performance.now() - overallStartTime
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Test 1: Health check
    if (!testFilter || testFilter === "health" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting health test`);
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

        const healthState = {
          url: healthUrl,
          statusCode: healthCheck.status,
          statusText: healthCheck.statusText,
          headers: Object.fromEntries(healthCheck.headers.entries()),
          timestamp: new Date().toISOString()
        };

        console.log("Health check state:", healthState);

        tests.push({
          name: "health",
          description: "API health check",
          status: healthCheck.ok ? "passed" : "failed",
          statusCode: healthCheck.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: healthState
        });

        console.log(`[Step ${currentStep}/${totalSteps}] health test ${healthCheck.ok ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] health test FAILED:`, error);

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

        console.error("Health check error context:", errorContext);

        tests.push({
          name: "health",
          description: "API health check",
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
        const dbTestUrl = `${baseUrl}/rest/v1/rpc/get_current_timestamp`;
        console.log(`Attempting database connectivity check to: ${dbTestUrl}`);

        const dbTest = await fetch(dbTestUrl, {
          method: "POST",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
            "Content-Type": "application/json"
          }
        });

        const responseText = await dbTest.text();
        console.log("Database test response text:", responseText);

        let parsedResponse;
        try {
          parsedResponse = responseText ? JSON.parse(responseText) : null;
        } catch (parseError) {
          console.error("Failed to parse database response:", parseError);
          parsedResponse = responseText;
        }

        const dbState = {
          url: dbTestUrl,
          statusCode: dbTest.status,
          statusText: dbTest.statusText,
          headers: Object.fromEntries(dbTest.headers.entries()),
          responseLength: responseText.length,
          responsePreview: responseText.substring(0, 500),
          timestamp: new Date().toISOString()
        };

        console.log("Database connectivity state:", dbState);

        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: dbTest.ok ? "passed" : "failed",
          statusCode: dbTest.status,
          response: dbTest.ok ? {
            type: typeof parsedResponse,
            keys: typeof parsedResponse === 'object' ? Object.keys(parsedResponse) : [],
            data: parsedResponse
          } : undefined,
          detailedError: !dbTest.ok && typeof parsedResponse === 'object' ? parsedResponse : undefined,
          errorObj: !dbTest.ok && parsedResponse && typeof parsedResponse === 'object' ? {
            hasMessage: 'message' in parsedResponse,
            hasError: 'error' in parsedResponse,
            hasDetails: 'details' in parsedResponse,
            hasHint: 'hint' in parsedResponse,
            hasCode: 'code' in parsedResponse,
            allKeys: Object.keys(parsedResponse),
            values: parsedResponse
          } : undefined,
          extractedError: !dbTest.ok && parsedResponse ? {
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
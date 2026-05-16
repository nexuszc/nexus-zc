import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    const overallStartTime = performance.now();
    console.log("Smoke test runner starting...");

    // Parse query parameters
    const url = new URL(req.url);
    const testFilter = url.searchParams.get("test");

    console.log("Test filter:", testFilter || "all");

    // Environment check
    const envCheckStart = performance.now();
    const requiredEnvVars = [
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY"
    ];

    const denoEnv = {
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
      SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY") ? "[PRESENT]" : "[MISSING]",
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "[PRESENT]" : "[MISSING]"
    };

    console.log("Environment variables state:", denoEnv);

    const environmentChecks = requiredEnvVars.map(varName => ({
      name: varName,
      status: Deno.env.get(varName) ? "present" : "missing",
      timestamp: new Date().toISOString()
    }));

    const envCheckDuration = performance.now() - envCheckStart;

    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!baseUrl || !anonKey) {
      const missingVars = [];
      if (!baseUrl) missingVars.push("SUPABASE_URL");
      if (!anonKey) missingVars.push("SUPABASE_ANON_KEY");

      console.error("Missing required environment variables:", missingVars);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          missingVariables: missingVars,
          environmentChecks,
          results: [],
          tests: [],
          summary: {
            total: 0,
            passed: 0,
            failed: 0
          },
          timestamp: new Date().toISOString(),
          duration_ms: performance.now() - overallStartTime
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

    const tests = [];
    let currentStep = 0;
    const totalSteps = testFilter && testFilter !== "all" ? 1 : 3;

    console.log(`Will execute ${totalSteps} test(s)`);

    // Test 1: API availability
    if (!testFilter || testFilter === "api" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting api test`);
      const startTime = performance.now();

      try {
        const apiTestUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting API test to: ${apiTestUrl}`);

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

        console.log("API availability state:", apiState);

        tests.push({
          name: "api",
          description: "API availability",
          status: apiTest.ok ? "passed" : "failed",
          statusCode: apiTest.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: apiState
        });

        console.log(`[Step ${currentStep}/${totalSteps}] api test ${apiTest.ok ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] api test FAILED:`, error);

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

        console.error("API test error context:", errorContext);

        tests.push({
          name: "api",
          description: "API availability",
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
    if (!testFilter || testFilter === "database" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting database-connectivity test`);
      const startTime = performance.now();

      try {
        const dbTestUrl = `${baseUrl}/rest/v1/?select=*`;
        console.log(`Attempting database test to: ${dbTestUrl}`);

        const dbTest = await fetch(dbTestUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });

        const responseText = await dbTest.text();
        const dbState = {
          url: dbTestUrl,
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
          parsedResponse = { raw: responseText };
        }

        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: dbTest.ok ? "passed" : "failed",
          statusCode: dbTest.status,
          error: !dbTest.ok && parsedResponse?.message ? parsedResponse.message : undefined,
          errorDetails: !dbTest.ok && parsedResponse?.error ? parsedResponse.error : undefined,
          errorHint: !dbTest.ok && parsedResponse?.hint ? parsedResponse.hint : undefined,
          errorMessage: !dbTest.ok && typeof parsedResponse === 'object' && 'message' in parsedResponse 
            ? parsedResponse.message 
            : undefined,
          rawError: !dbTest.ok && typeof parsedResponse === 'object' && 'error' in parsedResponse 
            ? parsedResponse.error 
            : undefined,
          errorData: !dbTest.ok ? parsedResponse : undefined,
          postgrestError: !dbTest.ok && typeof parsedResponse === 'object' ? {
            message: parsedResponse.message || parsedResponse.msg,
            details: parsedResponse.details,
            hint: parsedResponse.hint,
            code: parsedResponse.code
          } : undefined,
          errorText: !dbTest.ok ? responseText : undefined,
          responsePreview: responseText.substring(0, 500),
          testError: !dbTest.ok && typeof parsedResponse === 'object' && 'error' in parsedResponse 
            ? parsedResponse.error 
            : undefined,
          testMessage: !dbTest.ok && typeof parsedResponse === 'object' && 'message' in parsedResponse 
            ? parsedResponse.message 
            : undefined,
          fullResponse: parsedResponse,
          testDetails: !dbTest.ok && typeof parsedResponse === 'object' && 'details' in parsedResponse 
            ? parsedResponse.details 
            : undefined,
          testHint: !dbTest.ok && typeof parsedResponse === 'object' && 'hint' in parsedResponse 
            ? parsedResponse.hint 
            : undefined,
          testCode: !dbTest.ok && typeof parsedResponse === 'object' && 'code' in parsedResponse 
            ? parsedResponse.code 
            : undefined,
          statusMessage: dbTest.statusText,
          httpStatus: dbTest.status,
          testStatusOk: dbTest.ok,
          parsedError: !dbTest.ok ? {
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
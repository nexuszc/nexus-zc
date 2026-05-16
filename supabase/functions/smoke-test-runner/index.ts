// supabase/functions/smoke-test-runner/index.ts

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const testFilter = url.searchParams.get("test");
    
    console.log("=== Smoke Test Runner Started ===");
    console.log("Request details:", {
      method: req.method,
      url: req.url,
      testFilter,
      timestamp: new Date().toISOString()
    });

    const envCheckStart = performance.now();
    const denoEnv = {
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
      SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY") ? "present" : "missing",
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "present" : "missing"
    };
    
    console.log("Environment check:", denoEnv);
    
    const environmentChecks = [
      {
        variable: "SUPABASE_URL",
        status: denoEnv.SUPABASE_URL ? "present" : "missing",
        value: denoEnv.SUPABASE_URL ? denoEnv.SUPABASE_URL : undefined
      },
      {
        variable: "SUPABASE_ANON_KEY",
        status: denoEnv.SUPABASE_ANON_KEY === "present" ? "present" : "missing"
      },
      {
        variable: "SUPABASE_SERVICE_ROLE_KEY",
        status: denoEnv.SUPABASE_SERVICE_ROLE_KEY === "present" ? "present" : "missing"
      }
    ];
    
    const envCheckDuration = performance.now() - envCheckStart;
    console.log(`Environment checks completed in ${envCheckDuration}ms`);

    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!baseUrl || !anonKey) {
      console.error("Missing required environment variables");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          environmentChecks: {
            checks: environmentChecks,
            duration_ms: envCheckDuration,
            allPresent: false
          },
          tests: [],
          summary: {
            total: 0,
            passed: 0,
            failed: 0
          },
          timestamp: new Date().toISOString()
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
    const totalSteps = testFilter 
      ? 1 
      : ["api-availability", "database-connectivity", "edge-functions"].length;

    console.log(`Running ${totalSteps} test(s)${testFilter ? ` (filter: ${testFilter})` : ''}`);

    // Test 1: API availability
    if (!testFilter || testFilter === "api-availability" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting api-availability test`);
      const startTime = performance.now();
      
      try {
        const apiUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting API availability check to: ${apiUrl}`);
        
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
          description: "REST API endpoint accessibility",
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
          description: "REST API endpoint accessibility",
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
        const dbUrl = `${baseUrl}/rest/v1/?select=*`;
        console.log(`Attempting database connectivity check to: ${dbUrl}`);
        
        const dbTest = await fetch(dbUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
            "Prefer": "return=minimal"
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
        
        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: dbTest.ok ? "passed" : "failed",
          statusCode: dbTest.status,
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
      tests,
      timestamp: new Date().toISOString(),
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
      failed: totalTests - passedTests
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
        tests: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 0
        },
        timestamp: new Date().toISOString(),
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
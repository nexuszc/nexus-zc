import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse query parameters for optional test filtering
    const url = new URL(req.url);
    const filterParam = url.searchParams.get("filter");
    
    // Parse request body for optional test filtering
    let bodyFilter = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        bodyFilter = body.filter;
      } catch {
        // No valid JSON body, continue without body filter
      }
    }

    const testFilter = filterParam || bodyFilter;

    // Pre-flight environment checks
    const environmentChecks = [];
    const envStartTime = performance.now();
    
    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const denoEnv = Deno.env.get("DENO_ENV") || "unknown";
    
    environmentChecks.push({
      check: "SUPABASE_URL",
      status: baseUrl ? "present" : "missing",
      value: baseUrl ? `${baseUrl.substring(0, 30)}...` : null
    });
    
    environmentChecks.push({
      check: "SUPABASE_ANON_KEY",
      status: anonKey ? "present" : "missing",
      length: anonKey ? anonKey.length : 0
    });
    
    environmentChecks.push({
      check: "SUPABASE_SERVICE_ROLE_KEY",
      status: serviceRoleKey ? "present" : "missing",
      length: serviceRoleKey ? serviceRoleKey.length : 0
    });
    
    environmentChecks.push({
      check: "DENO_ENV",
      status: "present",
      value: denoEnv
    });
    
    const envCheckDuration = performance.now() - envStartTime;
    
    if (!baseUrl || !anonKey) {
      console.error("Environment validation failed:", {
        baseUrl: !!baseUrl,
        anonKey: !!anonKey,
        timestamp: new Date().toISOString()
      });
      
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          environmentChecks,
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
    const totalSteps = 3;

    // Test 1: Health check
    if (!testFilter || testFilter === "health-check" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting health-check test`);
      const startTime = performance.now();
      
      try {
        const healthState = {
          memoryUsage: Deno.memoryUsage(),
          environment: denoEnv,
          timestamp: new Date().toISOString()
        };
        
        console.log("Health check state:", healthState);
        
        tests.push({
          name: "health-check",
          description: "Basic health check",
          status: "passed",
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: healthState
        });
        
        console.log(`[Step ${currentStep}/${totalSteps}] health-check test PASSED`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] health-check test FAILED:`, error);
        
        tests.push({
          name: "health-check",
          description: "Basic health check",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
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
        const dbTestUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting database connection to: ${dbTestUrl}`);
        
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
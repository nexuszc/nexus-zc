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
    console.log("Smoke test runner initiated");
    
    const url = new URL(req.url);
    const testFilter = url.searchParams.get("test");
    
    console.log("Test filter parameter:", testFilter);

    const envCheckStartTime = performance.now();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    const denoEnv = {
      supabaseUrl: supabaseUrl ? "present" : "missing",
      supabaseAnonKey: supabaseAnonKey ? "present" : "missing",
      supabaseServiceRoleKey: supabaseServiceRoleKey ? "present" : "missing"
    };
    
    console.log("Environment variables check:", denoEnv);

    const environmentChecks = [
      {
        name: "SUPABASE_URL",
        status: supabaseUrl ? "present" : "missing",
        value: supabaseUrl ? supabaseUrl.substring(0, 20) + "..." : null
      },
      {
        name: "SUPABASE_ANON_KEY",
        status: supabaseAnonKey ? "present" : "missing",
        value: supabaseAnonKey ? supabaseAnonKey.substring(0, 20) + "..." : null
      },
      {
        name: "SUPABASE_SERVICE_ROLE_KEY",
        status: supabaseServiceRoleKey ? "present" : "missing",
        value: supabaseServiceRoleKey ? supabaseServiceRoleKey.substring(0, 20) + "..." : null
      }
    ];

    const envCheckDuration = performance.now() - envCheckStartTime;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("Missing critical environment variables");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          environmentChecks,
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
    const baseUrl = supabaseUrl;
    const anonKey = supabaseAnonKey;
    
    let totalSteps = 0;
    if (!testFilter || testFilter === "all") {
      totalSteps = 3;
    } else {
      totalSteps = 1;
    }
    
    let currentStep = 0;

    console.log(`Starting smoke tests with filter: ${testFilter || 'all'}, total steps: ${totalSteps}`);

    // Test 1: Basic HTTP connectivity
    if (!testFilter || testFilter === "http-connectivity" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting http-connectivity test`);
      const startTime = performance.now();
      
      try {
        const healthUrl = `${baseUrl}/rest/v1/`;
        console.log(`Attempting HTTP request to: ${healthUrl}`);
        
        const healthCheck = await fetch(healthUrl, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });
        
        const responseText = await healthCheck.text();
        const httpState = {
          url: healthUrl,
          statusCode: healthCheck.status,
          statusText: healthCheck.statusText,
          headers: Object.fromEntries(healthCheck.headers.entries()),
          responseLength: responseText.length,
          timestamp: new Date().toISOString()
        };
        
        console.log("HTTP connectivity state:", httpState);
        
        tests.push({
          name: "http-connectivity",
          description: "Basic HTTP connectivity to Supabase",
          status: healthCheck.ok ? "passed" : "failed",
          statusCode: healthCheck.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          state: httpState
        });
        
        console.log(`[Step ${currentStep}/${totalSteps}] http-connectivity test ${healthCheck.ok ? 'PASSED' : 'FAILED'}`);
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] http-connectivity test FAILED:`, error);
        
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
        
        console.error("HTTP connectivity error context:", errorContext);
        
        tests.push({
          name: "http-connectivity",
          description: "Basic HTTP connectivity to Supabase",
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
        const dbTestUrl = `${baseUrl}/rest/v1/rpc/healthcheck`;
        console.log(`Attempting database check to: ${dbTestUrl}`);
        
        const dbTest = await fetch(dbTestUrl, {
          method: "POST",
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`,
            "Content-Type": "application/json"
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
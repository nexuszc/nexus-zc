import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

export default Deno.serve(async (req: Request): Promise<Response> => {
  try {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
        }
      });
    }

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

    const tests = [];
    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (!baseUrl || !anonKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
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
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
          }
        }
      );
    }

    // Test 1: Health check
    if (!testFilter || testFilter === "health-check" || testFilter === "all") {
      const startTime = performance.now();
      tests.push({
        name: "health-check",
        description: "Basic health check",
        status: "passed",
        duration_ms: performance.now() - startTime,
        timestamp: new Date().toISOString()
      });
    }

    // Test 2: Database connectivity
    if (!testFilter || testFilter === "database-connectivity" || testFilter === "all") {
      const startTime = performance.now();
      try {
        const dbTest = await fetch(`${baseUrl}/rest/v1/`, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });
        
        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: dbTest.ok ? "passed" : "failed",
          statusCode: dbTest.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: "failed",
          error: error.message,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Test 3: Edge function availability
    if (!testFilter || testFilter === "edge-functions" || testFilter === "all") {
      const startTime = performance.now();
      try {
        const functionsTest = await fetch(`${baseUrl}/functions/v1/`, {
          headers: {
            "apikey": anonKey,
            "Authorization": `Bearer ${anonKey}`
          }
        });
        
        tests.push({
          name: "edge-functions",
          description: "Edge functions availability",
          status: functionsTest.status === 404 || functionsTest.ok ? "passed" : "failed",
          statusCode: functionsTest.status,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        tests.push({
          name: "edge-functions",
          description: "Edge functions availability",
          status: "failed",
          error: error.message,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString()
        });
      }
    }

    const allPassed = tests.every(test => test.status === "passed");
    const totalTests = tests.length;
    const passedTests = tests.filter(test => test.status === "passed").length;

    const result = {
      success: allPassed,
      summary: {
        total: totalTests,
        passed: passedTests,
        failed: totalTests - passedTests
      },
      tests,
      timestamp: new Date().toISOString(),
      ...(testFilter && { filter: testFilter })
    };

    return new Response(
      JSON.stringify(result),
      {
        status: allPassed ? 200 : 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
        }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
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
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
        }
      }
    );
  }
});
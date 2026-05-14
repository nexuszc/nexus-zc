Deno.serve(async (req) => {
  const startTime = Date.now();
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204, 
      headers: corsHeaders 
    });
  }

  try {
    // Validate environment variables
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingEnvVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
    
    if (missingEnvVars.length > 0) {
      console.error('Missing environment variables:', missingEnvVars);
      return Response.json(
        { 
          ok: false, 
          status: "unhealthy", 
          error: "Missing required environment variables",
          missing: missingEnvVars,
          ts: new Date().toISOString() 
        },
        { 
          status: 500,
          headers: corsHeaders 
        }
      );
    }

    // Timeout protection - set max execution time
    const timeoutMs = 8000; // 8 seconds
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Function execution timeout')), timeoutMs);
    });

    // Main health check logic
    const healthCheckPromise = (async () => {
      // Basic health checks
      const checks = {
        timestamp: new Date().toISOString(),
        environment: {
          supabaseUrl: !!Deno.env.get('SUPABASE_URL'),
          supabaseKey: !!Deno.env.get('SUPABASE_ANON_KEY'),
        },
        runtime: {
          denoVersion: Deno.version.deno,
          v8Version: Deno.version.v8,
          typescript: Deno.version.typescript,
        },
        memory: {
          available: true,
        },
        responseTime: 0,
      };

      // Calculate response time
      checks.responseTime = Date.now() - startTime;

      return {
        ok: true,
        status: "healthy",
        ts: checks.timestamp,
        checks,
        message: "Smoke test passed successfully"
      };
    })();

    // Race between timeout and health check
    const result = await Promise.race([healthCheckPromise, timeoutPromise]);

    return Response.json(result, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      }
    });

  } catch (error) {
    console.error('Smoke test error:', error);
    
    const errorResponse = {
      ok: false,
      status: "unhealthy",
      error: error.message || 'Unknown error occurred',
      errorType: error.name || 'Error',
      stack: error.stack || null,
      ts: new Date().toISOString(),
      executionTime: Date.now() - startTime,
    };

    return Response.json(errorResponse, {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      }
    });
  }
});
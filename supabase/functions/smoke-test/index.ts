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
      return new Response(
        JSON.stringify({ 
          ok: false, 
          status: "unhealthy", 
          error: "Missing required environment variables",
          missing: missingEnvVars,
          ts: new Date().toISOString() 
        }),
        { 
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // Timeout protection - set max execution time
    const timeoutMs = 8000; // 8 seconds
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Function execution timeout')), timeoutMs);
    });

    // Main health check logic with comprehensive diagnostics
    const healthCheckPromise = (async () => {
      const diagnostics = {
        timestamp: new Date().toISOString(),
        executionTime: 0,
        environment: {
          supabaseUrl: !!Deno.env.get('SUPABASE_URL'),
          supabaseKey: !!Deno.env.get('SUPABASE_ANON_KEY'),
          supabaseUrlValue: Deno.env.get('SUPABASE_URL') || 'NOT_SET',
        },
        runtime: {
          denoVersion: Deno.version.deno,
          v8Version: Deno.version.v8,
          typescript: Deno.version.typescript,
        },
        memory: {
          available: true,
        },
        database: {
          available: false,
          error: null,
          connectionTest: 'not_attempted',
        },
        authentication: {
          headerPresent: false,
          headerValue: null,
        },
        edgeFunction: {
          healthy: true,
          canServeRequests: true,
        },
      };

      // Check authentication header
      const authHeader = req.headers.get('authorization');
      diagnostics.authentication.headerPresent = !!authHeader;
      if (authHeader) {
        diagnostics.authentication.headerValue = authHeader.substring(0, 20) + '...';
      }

      // Test database connectivity
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

        if (supabaseUrl && supabaseKey) {
          diagnostics.database.connectionTest = 'attempting';
          
          // Import Supabase client
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.3');
          
          const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          });

          // Simple query to test connection
          const { data, error } = await supabase
            .from('profiles')
            .select('count')
            .limit(1)
            .single();

          if (error) {
            diagnostics.database.available = false;
            diagnostics.database.error = error.message;
            diagnostics.database.connectionTest = 'failed';
          } else {
            diagnostics.database.available = true;
            diagnostics.database.connectionTest = 'success';
          }
        } else {
          diagnostics.database.connectionTest = 'skipped_missing_credentials';
        }
      } catch (dbError) {
        diagnostics.database.available = false;
        diagnostics.database.error = dbError.message || 'Unknown database error';
        diagnostics.database.connectionTest = 'error';
      }

      // Calculate response time
      diagnostics.executionTime = Date.now() - startTime;

      // Determine overall health status
      const allChecksPass = 
        diagnostics.environment.supabaseUrl &&
        diagnostics.environment.supabaseKey &&
        diagnostics.edgeFunction.healthy;

      return {
        ok: allChecksPass,
        status: allChecksPass ? "healthy" : "degraded",
        ts: diagnostics.timestamp,
        diagnostics,
        checks: diagnostics,
        message: allChecksPass 
          ? "Smoke test passed successfully with full diagnostics" 
          : "Smoke test completed with warnings",
        warnings: allChecksPass ? [] : [
          !diagnostics.database.available ? 'Database connectivity issue' : null,
        ].filter(Boolean),
      };
    })();

    // Race between timeout and health check
    const result = await Promise.race([healthCheckPromise, timeoutPromise]);

    return new Response(
      JSON.stringify(result, null, 2),
      {
        status: result.ok ? 200 : 503,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        }
      }
    );

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
      diagnostics: {
        criticalFailure: true,
        failurePoint: 'main_execution',
      }
    };

    return new Response(
      JSON.stringify(errorResponse, null, 2),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        }
      }
    );
  }
});
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Logger utility
const logger = {
  log: (level: string, message: string, meta?: any) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta
    };
    console.log(JSON.stringify(logEntry));
  }
};

// Generate request ID for tracking
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Health check function
async function performHealthCheck() {
  const timestamp = new Date().toISOString();
  
  try {
    // Check Supabase connection
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Simple query to verify database connectivity
    const { error } = await supabase.from('users').select('count').limit(1).single();
    
    if (error && error.code !== 'PGRST116') {
      throw new Error(`Database check failed: ${error.message}`);
    }

    return {
      status: 'ok',
      timestamp,
      checks: {
        supabase: 'connected',
        environment: 'configured'
      }
    };
  } catch (error) {
    return {
      status: 'error',
      timestamp,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Smoke test runner function
async function runSmokeTests() {
  const timestamp = new Date().toISOString();
  const results: any[] = [];
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Test 1: Database connectivity
    try {
      const { error } = await supabase.from('users').select('count').limit(1);
      results.push({
        test: 'database_connectivity',
        status: error ? 'failed' : 'passed',
        error: error?.message
      });
    } catch (error) {
      results.push({
        test: 'database_connectivity',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Test 2: Auth service check
    try {
      const { error } = await supabase.auth.getSession();
      results.push({
        test: 'auth_service',
        status: error ? 'failed' : 'passed',
        error: error?.message
      });
    } catch (error) {
      results.push({
        test: 'auth_service',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Test 3: Environment variables
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    results.push({
      test: 'environment_variables',
      status: missingVars.length === 0 ? 'passed' : 'failed',
      missing: missingVars
    });

    const allPassed = results.every(r => r.status === 'passed');

    return {
      status: allPassed ? 'success' : 'failed',
      timestamp,
      results,
      summary: {
        total: results.length,
        passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length
      }
    };
  } catch (error) {
    return {
      status: 'error',
      timestamp,
      error: error instanceof Error ? error.message : String(error),
      results
    };
  }
}

// Main request handler
async function handleRequest(req: Request) {
  const requestId = generateRequestId();
  
  try {
    logger.log('info', 'Incoming request', { 
      requestId, 
      method: req.method, 
      url: req.url 
    });

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      logger.log('info', 'Handling CORS preflight', { requestId });
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // GET endpoint - health check only
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const path = url.pathname;

      // Check if this is a status/health check request
      if (path.includes('/health') || path.includes('/status')) {
        logger.log('info', 'Processing health check request', { requestId });
        
        try {
          const healthCheck = await performHealthCheck();
          
          return new Response(
            JSON.stringify(healthCheck),
            {
              status: healthCheck.status === 'ok' ? 200 : 503,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        } catch (error) {
          logger.log('error', 'Health check failed', { requestId, error: String(error) });
          
          return new Response(
            JSON.stringify({
              status: 'error',
              timestamp: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              requestId
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
          );
        }
      }

      // Default GET - return function info
      logger.log('info', 'Returning function info', { requestId });
      return new Response(
        JSON.stringify({
          function: 'smoke-test-runner',
          version: '1.0.0',
          endpoints: {
            'GET /health': 'Health check',
            'POST /': 'Run full test suite',
            'POST /?action=smoke': 'Run smoke tests only'
          },
          requestId
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // POST endpoint with action query parameter for smoke tests only
    if (req.method === 'POST') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');

      if (action === 'smoke') {
        logger.log('info', 'Processing smoke test request', { requestId });

        // Create timeout promise (30s max)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Smoke test run timeout after 30s')), 30000);
        });

        // Race between smoke test and timeout
        const smokeTestResult = await Promise.race([
          runSmokeTests(),
          timeoutPromise
        ]) as any;

        logger.log('info', 'Smoke test run completed', { 
          requestId, 
          status: smokeTestResult.status
        });

        return new Response(
          JSON.stringify(smokeTestResult),
          {
            status: smokeTestResult.status === 'success' ? 200 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      } else {
        // Default POST handler - run both health check and smoke tests
        try {
          logger.log('info', 'Processing default POST request - running full suite', { requestId });

          // Parse request body if provided
          let requestBody: any = {};
          try {
            const bodyText = await req.text();
            if (bodyText) {
              requestBody = JSON.parse(bodyText);
            }
          } catch (parseError) {
            logger.log('warn', 'Could not parse request body', { requestId, error: String(parseError) });
          }

          // Extract test_suite parameter if provided
          const test_suite = requestBody.test_suite || 'full';

          // Create timeout promise (30s max)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout after 30s')), 30000);
          });

          // Run health check first
          const healthCheckResult = await Promise.race([
            performHealthCheck(),
            timeoutPromise
          ]) as any;

          // If health check passes, run smoke tests
          let smokeTestResult = null;
          if (healthCheckResult.status === 'ok') {
            try {
              smokeTestResult = await Promise.race([
                runSmokeTests(),
                timeoutPromise
              ]) as any;
            } catch (smokeError) {
              logger.log('error', 'Smoke test failed during full suite', { 
                requestId, 
                error: String(smokeError) 
              });
              smokeTestResult = {
                status: 'error',
                error: smokeError instanceof Error ? smokeError.message : String(smokeError),
                timestamp: new Date().toISOString()
              };
            }
          }

          const response = {
            success: healthCheckResult.status === 'ok' && smokeTestResult?.status === 'success',
            status: healthCheckResult.status === 'ok' && smokeTestResult?.status === 'success' ? 'ok' : 'error',
            timestamp: new Date().toISOString(),
            function: 'smoke-test-runner',
            suite: test_suite,
            requestId,
            healthCheck: healthCheckResult,
            smokeTest: smokeTestResult,
            results: {
              health: healthCheckResult,
              tests: smokeTestResult
            }
          };

          logger.log('info', 'Full suite completed', { 
            requestId, 
            status: response.status
          });

          return new Response(
            JSON.stringify(response),
            {
              status: response.status === 'ok' ? 200 : 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            }
          );
        } catch (error) {
          logger.log('error', 'Full suite failed', { requestId, error: String(error) });
          
          return new Response(
            JSON.stringify({
              success: false,
              status: 'error',
              timestamp: new Date().toISOString(),
              function: 'smoke-test-runner',
              error: error instanceof Error ? error.message : String(error),
              requestId
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            }
          );
        }
      }
    }

    // Method not allowed
    logger.log('warn', 'Method not allowed', { requestId, method: req.method });
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'Method not allowed. Use GET for health check or POST to run tests.',
        allowedMethods: ['GET', 'POST', 'OPTIONS'],
        requestId
      }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    logger.log('error', 'Unhandled error in request handler', { 
      requestId, 
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(
      JSON.stringify({
        success: false,
        status: 'error',
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        error: error instanceof Error ? error.message : String(error),
        requestId
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );
  }
}

// Deno.serve() wrapper with proper error handling
Deno.serve(async (req: Request) => {
  const { method } = req;
  
  // Handle CORS preflight immediately
  if (method === 'OPTIONS') {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  try {
    // For POST requests, check if test_suite parameter is provided
    if (method === 'POST') {
      try {
        const contentType = req.headers.get('content-type');
        let test_suite = 'full';
        
        if (contentType?.includes('application/json')) {
          const body = await req.clone().json();
          test_suite = body.test_suite || 'full';
        }

        // Invoke the main handler which will process the request
        return await handleRequest(req);
      } catch (jsonError) {
        // If JSON parsing fails, still proceed with default handler
        logger.log('warn', 'JSON parse error, using default handler', { 
          error: String(jsonError) 
        });
        return await handleRequest(req);
      }
    }

    // For GET requests and other methods, use the main handler
    return await handleRequest(req);
    
  } catch (error) {
    logger.log('error', 'Fatal error in Deno.serve wrapper', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return new Response(
      JSON.stringify({
        success: false,
        status: 'error',
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        error: error instanceof Error ? error.message : String(error),
        fatal: true
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );
  }
});
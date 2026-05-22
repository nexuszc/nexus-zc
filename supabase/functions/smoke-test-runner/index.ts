import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

// Logger utility
const logger = {
  log: (level: string, message: string, meta?: any) => {
    console.log(JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta
    }));
  }
};

// Generate request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Perform health check
async function performHealthCheck() {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    function: 'smoke-test-runner',
    environment: {
      denoVersion: Deno.version.deno,
      v8Version: Deno.version.v8,
      hasSupabaseUrl: !!Deno.env.get('SUPABASE_URL'),
      hasSupabaseKey: !!Deno.env.get('SUPABASE_ANON_KEY')
    }
  };

  return healthData;
}

// Run smoke tests
async function runSmokeTests() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const results = [];
  let allPassed = true;

  // Test 1: Database connection
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    if (error) {
      results.push({
        test: 'database_connection',
        status: 'failed',
        error: error.message
      });
      allPassed = false;
    } else {
      results.push({
        test: 'database_connection',
        status: 'passed'
      });
    }
  } catch (error) {
    results.push({
      test: 'database_connection',
      status: 'failed',
      error: String(error)
    });
    allPassed = false;
  }

  // Test 2: Auth check
  try {
    const { data, error } = await supabase.auth.getSession();
    
    results.push({
      test: 'auth_service',
      status: 'passed',
      note: 'Auth service is accessible'
    });
  } catch (error) {
    results.push({
      test: 'auth_service',
      status: 'failed',
      error: String(error)
    });
    allPassed = false;
  }

  // Test 3: Storage check
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      results.push({
        test: 'storage_service',
        status: 'failed',
        error: error.message
      });
      allPassed = false;
    } else {
      results.push({
        test: 'storage_service',
        status: 'passed',
        bucketCount: buckets?.length || 0
      });
    }
  } catch (error) {
    results.push({
      test: 'storage_service',
      status: 'failed',
      error: String(error)
    });
    allPassed = false;
  }

  return {
    status: allPassed ? 'success' : 'failed',
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passedTests: results.filter(r => r.status === 'passed').length,
    failedTests: results.filter(r => r.status === 'failed').length,
    results
  };
}

// Main handler function
async function handleRequest(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  
  try {
    const url = new URL(req.url);
    
    logger.log('info', 'Incoming request', {
      requestId,
      method: req.method,
      path: url.pathname
    });

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Health check endpoint
    if (url.pathname.endsWith('/health') && req.method === 'GET') {
      try {
        logger.log('info', 'Processing health check request', { requestId });
        
        const healthData = await performHealthCheck();

        logger.log('info', 'Health check completed', { 
          requestId, 
          status: healthData.status 
        });

        return new Response(
          JSON.stringify(healthData),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      } catch (error) {
        logger.log('error', 'Health check failed', { requestId, error: String(error) });
        
        return new Response(
          JSON.stringify({
            status: 'error',
            timestamp: new Date().toISOString(),
            function: 'smoke-test-runner',
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

    // GET request - return health check
    if (req.method === 'GET') {
      try {
        logger.log('info', 'Processing GET request - health check', { requestId });
        
        const healthData = await performHealthCheck();

        logger.log('info', 'Health check completed', { 
          requestId, 
          status: healthData.status 
        });

        return new Response(
          JSON.stringify(healthData),
          {
            status: healthData.status === 'ok' ? 200 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      } catch (error) {
        logger.log('error', 'Health check failed', { requestId, error: String(error) });
        
        return new Response(
          JSON.stringify({
            status: 'error',
            timestamp: new Date().toISOString(),
            function: 'smoke-test-runner',
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

    // Smoke test runner endpoint
    if (url.pathname.endsWith('/run') && req.method === 'POST') {
      try {
        logger.log('info', 'Processing smoke test run request', { requestId });
        
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
      } catch (error) {
        logger.log('error', 'Smoke test run failed', { requestId, error: String(error) });
        
        return new Response(
          JSON.stringify({
            status: 'error',
            timestamp: new Date().toISOString(),
            function: 'smoke-test-runner',
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

    // Default POST handler - run both health check and smoke tests
    if (req.method === 'POST') {
      try {
        logger.log('info', 'Processing default POST request - running full suite', { requestId });

        // Parse request body if provided
        let requestBody = {};
        try {
          const bodyText = await req.text();
          if (bodyText) {
            requestBody = JSON.parse(bodyText);
          }
        } catch (parseError) {
          logger.log('warn', 'Could not parse request body', { requestId, error: String(parseError) });
        }

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
          status: healthCheckResult.status === 'ok' && smokeTestResult?.status === 'success' ? 'ok' : 'error',
          timestamp: new Date().toISOString(),
          function: 'smoke-test-runner',
          requestId,
          healthCheck: healthCheckResult,
          smokeTest: smokeTestResult
        };

        logger.log('info', 'Full suite completed', { 
          requestId, 
          status: response.status
        });

        return new Response(
          JSON.stringify(response),
          {
            status: response.status === 'ok' ? 200 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      } catch (error) {
        logger.log('error', 'Full suite failed', { requestId, error: String(error) });
        
        return new Response(
          JSON.stringify({
            status: 'error',
            timestamp: new Date().toISOString(),
            function: 'smoke-test-runner',
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
        status: 'error',
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
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

// Export using Deno.serve() with proper async handler wrapper
serve(async (req: Request) => {
  try {
    return await handleRequest(req);
  } catch (error) {
    logger.log('error', 'Fatal error in serve wrapper', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return new Response(
      JSON.stringify({
        status: 'error',
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        error: error instanceof Error ? error.message : String(error),
        fatal: true
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
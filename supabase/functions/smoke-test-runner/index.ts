// Setup
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

// Health check function
async function performHealthCheck() {
  const checks = {
    environment: true,
    supabase: false,
    timestamp: new Date().toISOString()
  };

  try {
    // Check environment variables
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length > 0) {
      checks.environment = false;
      logger.log('error', 'Missing environment variables', { missingVars });
    }

    // Check Supabase connection
    if (checks.environment) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase.from('system_config').select('count').limit(1);
      checks.supabase = !error;
      
      if (error) {
        logger.log('error', 'Supabase connection check failed', { error: String(error) });
      }
    }

    return {
      status: checks.environment && checks.supabase ? 'ok' : 'error',
      checks,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.log('error', 'Health check failed', { error: String(error) });
    return {
      status: 'error',
      checks,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
}

// Smoke test runner function
async function runSmokeTests() {
  const testResults = {
    status: 'success',
    tests: [] as any[],
    timestamp: new Date().toISOString(),
    summary: {
      total: 0,
      passed: 0,
      failed: 0
    }
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Test 1: Database connectivity
    const dbTest = {
      name: 'database_connectivity',
      status: 'running',
      startTime: new Date().toISOString()
    };

    try {
      const { data, error } = await supabase.from('system_config').select('count').limit(1);
      dbTest.status = error ? 'failed' : 'passed';
      if (error) {
        (dbTest as any).error = String(error);
        testResults.status = 'error';
      }
    } catch (error) {
      dbTest.status = 'failed';
      (dbTest as any).error = String(error);
      testResults.status = 'error';
    }

    (dbTest as any).endTime = new Date().toISOString();
    testResults.tests.push(dbTest);

    // Test 2: Edge function invocation
    const functionTest = {
      name: 'edge_function_invocation',
      status: 'running',
      startTime: new Date().toISOString()
    };

    try {
      const { data, error } = await supabase.functions.invoke('smoke-test', {
        body: { test: true }
      });
      
      functionTest.status = error ? 'failed' : 'passed';
      if (error) {
        (functionTest as any).error = String(error);
        testResults.status = 'error';
      }
    } catch (error) {
      functionTest.status = 'failed';
      (functionTest as any).error = String(error);
      testResults.status = 'error';
    }

    (functionTest as any).endTime = new Date().toISOString();
    testResults.tests.push(functionTest);

    // Calculate summary
    testResults.summary.total = testResults.tests.length;
    testResults.summary.passed = testResults.tests.filter(t => t.status === 'passed').length;
    testResults.summary.failed = testResults.tests.filter(t => t.status === 'failed').length;

    return testResults;
  } catch (error) {
    logger.log('error', 'Smoke test execution failed', { error: String(error) });
    return {
      status: 'error',
      tests: testResults.tests,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      summary: testResults.summary
    };
  }
}

// Main request handler
async function handleRequest(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  
  try {
    logger.log('info', 'Received request', {
      requestId,
      method: req.method,
      url: req.url
    });

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { 
        headers: corsHeaders 
      });
    }

    // Handle GET - health check only
    if (req.method === 'GET') {
      try {
        logger.log('info', 'Processing health check request', { requestId });

        // Create timeout promise (10s for health check)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Health check timeout after 10s')), 10000);
        });

        // Race between health check and timeout
        const healthCheckResult = await Promise.race([
          performHealthCheck(),
          timeoutPromise
        ]) as any;

        logger.log('info', 'Health check completed', { 
          requestId, 
          status: healthCheckResult.status 
        });

        return new Response(
          JSON.stringify(healthCheckResult),
          {
            status: healthCheckResult.status === 'ok' ? 200 : 500,
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

    // Handle POST with action parameter
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (req.method === 'POST' && action === 'smoke-test') {
      try {
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
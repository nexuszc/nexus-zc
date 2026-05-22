// supabase/functions/smoke-test-runner/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Simple logger utility
const logger = {
  log: (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ timestamp, level, message, ...meta }));
  }
};

// Perform comprehensive health checks
async function performHealthCheck() {
  const checks: any[] = [];
  let allPassed = true;

  try {
    // 1. Environment variables check
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
      }

      checks.push({
        name: 'environment_variables',
        status: 'passed',
        timestamp: new Date().toISOString(),
        details: {
          SUPABASE_URL: !!supabaseUrl,
          SUPABASE_ANON_KEY: !!supabaseAnonKey
        }
      });
    } catch (error) {
      allPassed = false;
      checks.push({
        name: 'environment_variables',
        status: 'failed',
        error: error.message || String(error),
        timestamp: new Date().toISOString()
      });
    }

    // 2. Database connectivity via Supabase client
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (supabaseUrl && supabaseAnonKey) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { error } = await supabase.from('_health_check').select('count').limit(1);
        
        // Consider it successful even if table doesn't exist (connection works)
        if (!error || error.message.includes('does not exist')) {
          checks.push({
            name: 'database_connectivity',
            status: 'passed',
            timestamp: new Date().toISOString()
          });
        } else {
          throw error;
        }
      } else {
        throw new Error('Cannot test database connectivity without credentials');
      }
    } catch (error) {
      allPassed = false;
      checks.push({
        name: 'database_connectivity',
        status: 'failed',
        error: error.message || String(error),
        timestamp: new Date().toISOString()
      });
    }

    // 3. Critical edge functions availability
    const criticalFunctions = ['smoke-test', 'health-monitor', 'nexus-core'];
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (supabaseUrl && supabaseAnonKey) {
        for (const functionName of criticalFunctions) {
          try {
            const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json',
                'apikey': supabaseAnonKey
              },
              body: JSON.stringify({ healthCheck: true }),
              signal: AbortSignal.timeout(5000) // 5s timeout per function
            });

            checks.push({
              name: `edge_function_${functionName}`,
              status: response.ok ? 'passed' : 'failed',
              statusCode: response.status,
              timestamp: new Date().toISOString()
            });

            if (!response.ok) {
              allPassed = false;
            }
          } catch (error) {
            allPassed = false;
            checks.push({
              name: `edge_function_${functionName}`,
              status: 'failed',
              error: error.message || String(error),
              timestamp: new Date().toISOString()
            });
          }
        }
      } else {
        throw new Error('Cannot test edge functions without credentials');
      }
    } catch (error) {
      allPassed = false;
      checks.push({
        name: 'edge_functions_availability',
        status: 'failed',
        error: error.message || String(error),
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logger.log('error', 'Health check encountered unexpected error', { error: String(error) });
    allPassed = false;
    checks.push({
      name: 'health_check_execution',
      status: 'failed',
      error: error.message || String(error),
      timestamp: new Date().toISOString()
    });
  }

  return {
    status: allPassed ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    function: 'smoke-test-runner',
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter(c => c.status === 'passed').length,
      failed: checks.filter(c => c.status === 'failed').length
    }
  };
}

// Run smoke tests by calling the smoke-test function
async function runSmokeTests() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing required environment variables');
  }

  logger.log('info', 'Invoking smoke-test function');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch(`${supabaseUrl}/functions/v1/smoke-test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey
      },
      body: JSON.stringify({ run: true }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    let result;
    
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { rawResponse: responseText };
    }

    logger.log('info', 'Smoke test completed', { 
      status: response.status,
      ok: response.ok 
    });

    return {
      status: response.ok ? 'success' : 'failed',
      statusCode: response.status,
      timestamp: new Date().toISOString(),
      result
    };
  } catch (error) {
    logger.log('error', 'Smoke test invocation failed', { error: String(error) });
    
    if (error.name === 'AbortError') {
      throw new Error('Smoke test timeout after 30 seconds');
    }
    
    throw error;
  }
}

// Deno.serve handler with proper Request/Response pattern
serve(async (req: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      logger.log('info', 'Handling CORS preflight request', { requestId });
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    logger.log('info', 'Incoming request', { 
      requestId, 
      method: req.method, 
      url: req.url 
    });

    const url = new URL(req.url);
    
    // Health check endpoint - comprehensive validation
    if (url.pathname.endsWith('/health') || (req.method === 'GET' && url.pathname === '/')) {
      try {
        logger.log('info', 'Processing health check request', { requestId });
        
        // Create timeout promise (30s max)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Health check timeout after 30s')), 30000);
        });

        // Race between health check and timeout
        const healthCheckResult = await Promise.race([
          performHealthCheck(),
          timeoutPromise
        ]) as any;

        logger.log('info', 'Health check completed', { 
          requestId, 
          status: healthCheckResult.status,
          checksRun: healthCheckResult.checks?.length || 0
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
            error: error.message || String(error),
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
            error: error.message || String(error),
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
              error: smokeError.message || String(smokeError),
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
            error: error.message || String(error),
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
      stack: error.stack 
    });

    return new Response(
      JSON.stringify({
        status: 'error',
        timestamp: new Date().toISO
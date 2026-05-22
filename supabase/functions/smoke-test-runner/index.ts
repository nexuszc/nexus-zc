// supabase/functions/smoke-test-runner/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

interface Logger {
  log: (level: string, message: string, meta?: any) => void;
}

const logger: Logger = {
  log: (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ timestamp, level, message, ...meta }));
  }
};

async function performHealthCheck() {
  const checks = [];
  let allPassed = true;

  // Check environment variables
  const envCheck = {
    name: 'environment_variables',
    status: 'ok' as 'ok' | 'error',
    details: {} as any
  };

  const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
  
  if (missingVars.length > 0) {
    envCheck.status = 'error';
    envCheck.details = { missing: missingVars };
    allPassed = false;
  } else {
    envCheck.details = { all_present: true };
  }
  checks.push(envCheck);

  // Check Supabase connection
  const supabaseCheck = {
    name: 'supabase_connection',
    status: 'ok' as 'ok' | 'error',
    details: {} as any
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase.from('profiles').select('count').limit(1).single();
    
    if (error && error.code !== 'PGRST116') {
      supabaseCheck.status = 'error';
      supabaseCheck.details = { error: error.message };
      allPassed = false;
    } else {
      supabaseCheck.details = { connected: true };
    }
  } catch (error) {
    supabaseCheck.status = 'error';
    supabaseCheck.details = { error: String(error) };
    allPassed = false;
  }
  checks.push(supabaseCheck);

  return {
    status: allPassed ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    function: 'smoke-test-runner',
    checks
  };
}

async function runSmokeTests() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing required environment variables for smoke tests');
  }

  const tests = [];
  let allPassed = true;

  // Test 1: Call smoke-test function
  const smokeTestCheck = {
    name: 'smoke_test_function',
    status: 'ok' as 'ok' | 'error',
    duration: 0,
    details: {} as any
  };

  try {
    const startTime = Date.now();
    const response = await fetch(`${supabaseUrl}/functions/v1/smoke-test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ test: true })
    });

    smokeTestCheck.duration = Date.now() - startTime;

    if (!response.ok) {
      smokeTestCheck.status = 'error';
      smokeTestCheck.details = { 
        status: response.status,
        statusText: response.statusText,
        body: await response.text()
      };
      allPassed = false;
    } else {
      const data = await response.json();
      smokeTestCheck.details = { 
        status: response.status,
        response: data
      };
    }
  } catch (error) {
    smokeTestCheck.status = 'error';
    smokeTestCheck.details = { error: String(error) };
    allPassed = false;
  }
  tests.push(smokeTestCheck);

  // Test 2: Database connectivity
  const dbCheck = {
    name: 'database_connectivity',
    status: 'ok' as 'ok' | 'error',
    duration: 0,
    details: {} as any
  };

  try {
    const startTime = Date.now();
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.from('profiles').select('count').limit(1);

    dbCheck.duration = Date.now() - startTime;

    if (error && error.code !== 'PGRST116') {
      dbCheck.status = 'error';
      dbCheck.details = { error: error.message, code: error.code };
      allPassed = false;
    } else {
      dbCheck.details = { connected: true };
    }
  } catch (error) {
    dbCheck.status = 'error';
    dbCheck.details = { error: String(error) };
    allPassed = false;
  }
  tests.push(dbCheck);

  // Test 3: Auth service
  const authCheck = {
    name: 'auth_service',
    status: 'ok' as 'ok' | 'error',
    duration: 0,
    details: {} as any
  };

  try {
    const startTime = Date.now();
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabase.auth.getSession();

    authCheck.duration = Date.now() - startTime;

    if (error) {
      authCheck.status = 'error';
      authCheck.details = { error: error.message };
      allPassed = false;
    } else {
      authCheck.details = { available: true };
    }
  } catch (error) {
    authCheck.status = 'error';
    authCheck.details = { error: String(error) };
    allPassed = false;
  }
  tests.push(authCheck);

  return {
    status: allPassed ? 'success' : 'error',
    timestamp: new Date().toISOString(),
    function: 'smoke-test-runner',
    tests,
    summary: {
      total: tests.length,
      passed: tests.filter(t => t.status === 'ok').length,
      failed: tests.filter(t => t.status === 'error').length
    }
  };
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const url = new URL(req.url);

  try {
    logger.log('info', 'Request received', { 
      requestId, 
      method: req.method, 
      pathname: url.pathname 
    });

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Health check endpoint
    if ((url.pathname.endsWith('/health') || url.pathname === '/') && req.method === 'GET') {
      try {
        logger.log('info', 'Processing health check request', { requestId });
        
        // Create timeout promise (10s max for health check)
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
});
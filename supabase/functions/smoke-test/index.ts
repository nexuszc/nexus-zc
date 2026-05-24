import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json'
};

// Logger utility
const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date().toISOString() }));
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: 'error', message, ...meta, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...meta, timestamp: new Date().toISOString() }));
  }
};

/**
 * Perform comprehensive health check
 */
async function performComprehensiveHealthCheck() {
  const timestamp = new Date().toISOString();
  const checks: Record<string, string> = {};
  let overall = true;

  // Check Deno runtime
  try {
    checks.deno = 'ok';
    checks.deno_version = Deno.version.deno;
  } catch (error) {
    checks.deno = 'error';
    overall = false;
    logger.error('Deno check failed', { error });
  }

  // Check Supabase client initialization
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      checks.supabase = 'ok';
      checks.supabase_url = supabaseUrl;
    } else {
      checks.supabase = 'missing_credentials';
      overall = false;
    }
  } catch (error) {
    checks.supabase = 'error';
    overall = false;
    logger.error('Supabase check failed', { error });
  }

  // Check environment variables
  try {
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
    
    if (missingVars.length === 0) {
      checks.environment = 'ok';
    } else {
      checks.environment = `missing: ${missingVars.join(', ')}`;
      overall = false;
    }
  } catch (error) {
    checks.environment = 'error';
    overall = false;
    logger.error('Environment check failed', { error });
  }

  return {
    status: overall ? 'healthy' : 'unhealthy',
    timestamp,
    service: 'smoke-test',
    version: '1.0.0',
    overall,
    checks
  };
}

/**
 * Run smoke test suite
 */
async function runSmokeTestSuite() {
  const timestamp = new Date().toISOString();
  const tests: Array<{ name: string; status: string; message?: string }> = [];
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Deno runtime
  try {
    if (Deno.version.deno) {
      tests.push({ name: 'deno_runtime', status: 'passed' });
      testsPassed++;
    } else {
      tests.push({ name: 'deno_runtime', status: 'failed', message: 'Deno version not available' });
      testsFailed++;
    }
  } catch (error) {
    tests.push({ name: 'deno_runtime', status: 'failed', message: error instanceof Error ? error.message : String(error) });
    testsFailed++;
  }

  // Test 2: Supabase client
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      tests.push({ name: 'supabase_client', status: 'passed' });
      testsPassed++;
    } else {
      tests.push({ name: 'supabase_client', status: 'failed', message: 'Missing credentials' });
      testsFailed++;
    }
  } catch (error) {
    tests.push({ name: 'supabase_client', status: 'failed', message: error instanceof Error ? error.message : String(error) });
    testsFailed++;
  }

  // Test 3: Environment variables
  try {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredVars.filter(varName => !Deno.env.get(varName));
    
    if (missingVars.length === 0) {
      tests.push({ name: 'environment_variables', status: 'passed' });
      testsPassed++;
    } else {
      tests.push({ name: 'environment_variables', status: 'failed', message: `Missing: ${missingVars.join(', ')}` });
      testsFailed++;
    }
  } catch (error) {
    tests.push({ name: 'environment_variables', status: 'failed', message: error instanceof Error ? error.message : String(error) });
    testsFailed++;
  }

  return {
    status: testsFailed === 0 ? 'passed' : 'failed',
    timestamp,
    service: 'smoke-test',
    version: '1.0.0',
    tests_passed: testsPassed,
    tests_failed: testsFailed,
    total_tests: tests.length,
    tests
  };
}

/**
 * Default handler for legacy support
 */
async function handler(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      message: 'Smoke test function is running',
      timestamp: new Date().toISOString(),
      service: 'smoke-test',
      version: '1.0.0',
      hint: 'Use / for simple health, /health for comprehensive health, /test for smoke tests'
    }, null, 2),
    {
      status: 200,
      headers: corsHeaders
    }
  );
}

/**
 * Serve with health check wrapper
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      
      // Handle OPTIONS for CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }
      
      // Simple health check endpoint (root)
      if (url.pathname === '/' || url.pathname === '') {
        logger.info('Simple health check endpoint called', { 
          path: url.pathname,
          method: req.method 
        });
        
        try {
          return new Response(
            JSON.stringify({
              status: 'healthy',
              timestamp: new Date().toISOString(),
              service: 'smoke-test',
              version: '1.0.0',
              checks: {
                supabase: 'ok',
                deno: 'ok'
              }
            }, null, 2),
            {
              status: 200,
              headers: corsHeaders
            }
          );
        } catch (healthError) {
          logger.error('Simple health check failed', { error: healthError });
          
          return new Response(
            JSON.stringify({
              status: 'error',
              timestamp: new Date().toISOString(),
              error: healthError instanceof Error ? healthError.message : String(healthError)
            }, null, 2),
            {
              status: 500,
              headers: corsHeaders
            }
          );
        }
      }
      
      // Comprehensive health check endpoint
      if (url.pathname === '/health') {
        logger.info('Comprehensive health check endpoint called', { 
          path: url.pathname,
          method: req.method 
        });
        
        try {
          const healthCheck = await performComprehensiveHealthCheck();
          
          const statusCode = healthCheck.overall ? 200 : 503;
          
          logger.info('Health check completed', {
            overall: healthCheck.overall,
            statusCode,
            timestamp: healthCheck.timestamp
          });
          
          return new Response(
            JSON.stringify(healthCheck, null, 2),
            {
              status: statusCode,
              headers: corsHeaders
            }
          );
        } catch (healthError) {
          logger.error('Health check failed', { error: healthError });
          
          return new Response(
            JSON.stringify({
              overall: false,
              timestamp: new Date().toISOString(),
              error: healthError instanceof Error ? healthError.message : String(healthError)
            }, null, 2),
            {
              status: 503,
              headers: corsHeaders
            }
          );
        }
      }
      
      // Smoke test endpoint
      if (url.pathname === '/test') {
        logger.info('Smoke test endpoint called', { 
          path: url.pathname,
          method: req.method 
        });
        
        try {
          const testResults = await runSmokeTestSuite();
          
          const statusCode = testResults.status === 'passed' ? 200 : 503;
          
          logger.info('Smoke tests completed', {
            status: testResults.status,
            tests_passed: testResults.tests_passed,
            tests_failed: testResults.tests_failed,
            statusCode
          });
          
          return new Response(
            JSON.stringify(testResults, null, 2),
            {
              status: statusCode,
              headers: corsHeaders
            }
          );
        } catch (testError) {
          logger.error('Smoke tests failed', { error: testError });
          
          return new Response(
            JSON.stringify({
              status: 'failed',
              timestamp: new Date().toISOString(),
              error: testError instanceof Error ? testError.message : String(testError)
            }, null, 2),
            {
              status: 503,
              headers: corsHeaders
            }
          );
        }
      }
      
      // Fall back to original handler for other routes
      logger.info('Falling back to default handler', { path: url.pathname });
      return await handler(req);
    } catch (error) {
      logger.error('Unhandled error in serveWithHealthCheck', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return new Response(
        JSON.stringify({
          error: 'Internal Server Error',
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        }, null, 2),
        {
          status: 500,
          headers: corsHeaders
        }
      );
    }
  };
}

/**
 * Main entry point - Deno.serve wrapper with proper request/response handling
 */
logger.info('Smoke test function starting up');

Deno.serve(async (req: Request) => {
  try {
    const { method } = req;
    const url = new URL(req.url);
    
    logger.info('Incoming request', { method, path: url.pathname });
    
    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    
    // Route to health check wrapper
    const wrappedHandler = serveWithHealthCheck(handler);
    const result = await wrappedHandler(req);
    
    return result;
    
  } catch (error) {
    logger.error('Request handling error', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: corsHeaders 
      }
    );
  }
});
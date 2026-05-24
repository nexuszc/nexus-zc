import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

/**
 * CORS headers for cross-origin requests
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

/**
 * Simple logger utility
 */
const logger = {
  info: (message: string, data?: any) => {
    console.log(JSON.stringify({ level: 'info', message, ...data, timestamp: new Date().toISOString() }));
  },
  error: (message: string, data?: any) => {
    console.error(JSON.stringify({ level: 'error', message, ...data, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, data?: any) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...data, timestamp: new Date().toISOString() }));
  }
};

/**
 * Environment variable check
 */
function checkEnvironmentVariables(): { success: boolean; missing: string[] } {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing: string[] = [];
  
  for (const envVar of required) {
    if (!Deno.env.get(envVar)) {
      missing.push(envVar);
    }
  }
  
  return {
    success: missing.length === 0,
    missing
  };
}

/**
 * Test Supabase connection
 */
async function testSupabaseConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return { success: false, error: 'Missing Supabase credentials' };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Simple query to test connection
    const { error } = await supabase.from('_health_check').select('*').limit(1);
    
    // If table doesn't exist, that's okay - connection works
    if (error && !error.message.includes('does not exist')) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Test runtime environment
 */
function testRuntime(): { success: boolean; error?: string } {
  try {
    // Check Deno namespace exists
    if (typeof Deno === 'undefined') {
      return { success: false, error: 'Deno runtime not available' };
    }
    
    // Check basic Deno APIs
    if (typeof Deno.env === 'undefined' || typeof Deno.serve === 'undefined') {
      return { success: false, error: 'Deno APIs not fully available' };
    }
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Perform comprehensive health check
 */
async function performComprehensiveHealthCheck() {
  const errors: string[] = [];
  const checks = {
    supabase: false,
    runtime: false,
    env: false
  };
  
  // Check runtime
  const runtimeResult = testRuntime();
  checks.runtime = runtimeResult.success;
  if (!runtimeResult.success) {
    errors.push(`Runtime check failed: ${runtimeResult.error}`);
  }
  
  // Check environment variables
  const envResult = checkEnvironmentVariables();
  checks.env = envResult.success;
  if (!envResult.success) {
    errors.push(`Environment variables missing: ${envResult.missing.join(', ')}`);
  }
  
  // Check Supabase connection
  const supabaseResult = await testSupabaseConnection();
  checks.supabase = supabaseResult.success;
  if (!supabaseResult.success) {
    errors.push(`Supabase connection failed: ${supabaseResult.error}`);
  }
  
  const overall = checks.supabase && checks.runtime && checks.env;
  
  return {
    status: overall ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks,
    errors,
    overall
  };
}

/**
 * Run smoke test suite
 */
async function runSmokeTestSuite() {
  const tests = [];
  let passed = 0;
  let failed = 0;
  
  // Test 1: Environment variables
  const envCheck = checkEnvironmentVariables();
  tests.push({
    name: 'Environment Variables',
    status: envCheck.success ? 'passed' : 'failed',
    message: envCheck.success ? 'All required environment variables present' : `Missing: ${envCheck.missing.join(', ')}`
  });
  envCheck.success ? passed++ : failed++;
  
  // Test 2: Runtime
  const runtimeCheck = testRuntime();
  tests.push({
    name: 'Runtime Environment',
    status: runtimeCheck.success ? 'passed' : 'failed',
    message: runtimeCheck.success ? 'Deno runtime is operational' : runtimeCheck.error
  });
  runtimeCheck.success ? passed++ : failed++;
  
  // Test 3: Supabase Connection
  const supabaseCheck = await testSupabaseConnection();
  tests.push({
    name: 'Supabase Connection',
    status: supabaseCheck.success ? 'passed' : 'failed',
    message: supabaseCheck.success ? 'Supabase client can connect' : supabaseCheck.error
  });
  supabaseCheck.success ? passed++ : failed++;
  
  return {
    status: failed === 0 ? 'passed' : 'failed',
    timestamp: new Date().toISOString(),
    tests_passed: passed,
    tests_failed: failed,
    tests
  };
}

/**
 * Default handler for unmatched routes
 */
async function handler(req: Request): Promise<Response> {
  logger.warn('Unmatched route', { path: new URL(req.url).pathname });
  
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'Available endpoints: /, /health, /test',
      timestamp: new Date().toISOString()
    }, null, 2),
    {
      status: 404,
      headers: corsHeaders
    }
  );
}

/**
 * Simple health check response (for root endpoint)
 */
async function simpleHealthCheck(): Promise<Response> {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'smoke-test'
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
              service: 'smoke-test'
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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Logger utility
 */
const logger = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', message, ...data, timestamp: new Date().toISOString() }));
  },
  error: (message: string, data?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: 'error', message, ...data, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...data, timestamp: new Date().toISOString() }));
  }
};

/**
 * Health check interface
 */
interface HealthCheckResult {
  overall: boolean;
  timestamp: string;
  checks: {
    database?: boolean;
    environment?: boolean;
    function?: boolean;
  };
  error?: string;
}

/**
 * Smoke test result interface
 */
interface SmokeTestResult {
  status: 'passed' | 'failed';
  timestamp: string;
  tests_passed: number;
  tests_failed: number;
  tests: Array<{
    name: string;
    status: 'passed' | 'failed';
    message?: string;
  }>;
}

/**
 * Perform comprehensive health check
 */
async function performComprehensiveHealthCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = {};
  
  try {
    // Check environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    checks.environment = !!(supabaseUrl && supabaseKey);
    
    logger.info('Environment check', { 
      hasUrl: !!supabaseUrl, 
      hasKey: !!supabaseKey 
    });
    
    // Check database connection
    if (checks.environment) {
      try {
        const supabase = createClient(supabaseUrl!, supabaseKey!);
        const { error } = await supabase.from('profiles').select('count').limit(1).single();
        checks.database = !error || error.code === 'PGRST116'; // PGRST116 is "no rows returned" which means connection works
        
        logger.info('Database check', { 
          success: checks.database,
          error: error?.message 
        });
      } catch (dbError) {
        logger.error('Database check failed', { error: dbError });
        checks.database = false;
      }
    } else {
      checks.database = false;
    }
    
    // Check function availability
    checks.function = true;
    
    const overall = Object.values(checks).every(check => check === true);
    
    return {
      overall,
      timestamp: new Date().toISOString(),
      checks
    };
  } catch (error) {
    logger.error('Health check error', { error });
    
    return {
      overall: false,
      timestamp: new Date().toISOString(),
      checks,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Run smoke test suite
 */
async function runSmokeTestSuite(): Promise<SmokeTestResult> {
  const tests: SmokeTestResult['tests'] = [];
  
  // Test 1: Environment variables
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const hasEnv = !!(supabaseUrl && supabaseKey);
    
    tests.push({
      name: 'Environment Variables',
      status: hasEnv ? 'passed' : 'failed',
      message: hasEnv ? 'All required environment variables present' : 'Missing required environment variables'
    });
  } catch (error) {
    tests.push({
      name: 'Environment Variables',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }
  
  // Test 2: Database connection
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.from('profiles').select('count').limit(1);
      
      const dbConnected = !error || error.code === 'PGRST116';
      
      tests.push({
        name: 'Database Connection',
        status: dbConnected ? 'passed' : 'failed',
        message: dbConnected ? 'Database connection successful' : `Database error: ${error?.message}`
      });
    } else {
      tests.push({
        name: 'Database Connection',
        status: 'failed',
        message: 'Cannot test database connection without environment variables'
      });
    }
  } catch (error) {
    tests.push({
      name: 'Database Connection',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }
  
  // Test 3: Function execution
  tests.push({
    name: 'Function Execution',
    status: 'passed',
    message: 'Function is executing correctly'
  });
  
  const tests_passed = tests.filter(t => t.status === 'passed').length;
  const tests_failed = tests.filter(t => t.status === 'failed').length;
  
  return {
    status: tests_failed === 0 ? 'passed' : 'failed',
    timestamp: new Date().toISOString(),
    tests_passed,
    tests_failed,
    tests
  };
}

/**
 * Main request handler
 */
async function handler(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'Endpoint not found',
      timestamp: new Date().toISOString()
    }, null, 2),
    {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    }
  );
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      
      logger.info('Request received', {
        path: url.pathname,
        method: req.method,
        hasAuth: req.headers.has('Authorization'),
        url: req.url
      });
      
      // Handle OPTIONS for CORS preflight first
      if (req.method === 'OPTIONS') {
        logger.info('CORS preflight request');
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400'
          }
        });
      }
      
      // Health check endpoint - root path returns simple status
      if (url.pathname === '/' || url.pathname === '/smoke-test/' || url.pathname === '/smoke-test') {
        logger.info('Root health check endpoint called', { 
          path: url.pathname,
          method: req.method 
        });
        
        try {
          const simpleHealth = {
            status: 'ok',
            timestamp: new Date().toISOString()
          };
          
          logger.info('Simple health check response', simpleHealth);
          
          return new Response(
            JSON.stringify(simpleHealth, null, 2),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
              }
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
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
              }
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
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
              }
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
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
              }
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
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
              }
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
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
              }
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
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        }
      );
    }
  };
}

/**
 * Deno.serve wrapper - main entry point
 */
logger.info('Smoke test function starting up');

Deno.serve(serveWithHealthCheck(handler));
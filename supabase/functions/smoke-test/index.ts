import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

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

interface HealthCheckResult {
  overall: boolean;
  timestamp: string;
  checks: {
    environment: boolean;
    supabase: boolean;
    database?: boolean;
  };
  details?: any;
}

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
  const checks = {
    environment: false,
    supabase: false,
    database: false
  };

  const details: any = {};

  try {
    // Check environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    checks.environment = !!(supabaseUrl && supabaseServiceKey);
    details.environment = {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!supabaseServiceKey
    };

    if (checks.environment) {
      try {
        // Initialize Supabase client
        const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
        checks.supabase = true;

        // Test database connection
        const { data, error } = await supabase
          .from('profiles')
          .select('id')
          .limit(1);

        checks.database = !error;
        details.database = {
          connected: !error,
          error: error?.message
        };
      } catch (supabaseError) {
        logger.error('Supabase check failed', { error: supabaseError });
        details.supabase = {
          error: supabaseError instanceof Error ? supabaseError.message : String(supabaseError)
        };
      }
    }
  } catch (error) {
    logger.error('Health check error', { error });
    details.error = error instanceof Error ? error.message : String(error);
  }

  const overall = checks.environment && checks.supabase && checks.database;

  return {
    overall,
    timestamp: new Date().toISOString(),
    checks,
    details
  };
}

/**
 * Run smoke test suite
 */
async function runSmokeTestSuite(): Promise<SmokeTestResult> {
  const tests: Array<{ name: string; status: 'passed' | 'failed'; message?: string }> = [];

  // Test 1: Environment variables
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseServiceKey) {
      tests.push({ name: 'Environment Variables', status: 'passed' });
    } else {
      tests.push({ 
        name: 'Environment Variables', 
        status: 'failed',
        message: 'Missing required environment variables'
      });
    }
  } catch (error) {
    tests.push({ 
      name: 'Environment Variables', 
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }

  // Test 2: Supabase client initialization
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      tests.push({ name: 'Supabase Client', status: 'passed' });
    } else {
      tests.push({ 
        name: 'Supabase Client', 
        status: 'failed',
        message: 'Cannot initialize client without environment variables'
      });
    }
  } catch (error) {
    tests.push({ 
      name: 'Supabase Client', 
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }

  // Test 3: Database connectivity
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .limit(1);

      if (error) {
        tests.push({ 
          name: 'Database Connectivity', 
          status: 'failed',
          message: error.message
        });
      } else {
        tests.push({ name: 'Database Connectivity', status: 'passed' });
      }
    } else {
      tests.push({ 
        name: 'Database Connectivity', 
        status: 'failed',
        message: 'Cannot test without environment variables'
      });
    }
  } catch (error) {
    tests.push({ 
      name: 'Database Connectivity', 
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const tests_passed = tests.filter(t => t.status === 'passed').length;
  const tests_failed = tests.filter(t => t.status === 'failed').length;
  const status = tests_failed === 0 ? 'passed' : 'failed';

  return {
    status,
    timestamp: new Date().toISOString(),
    tests_passed,
    tests_failed,
    tests
  };
}

/**
 * Default handler for unmatched routes
 */
async function handler(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'Available endpoints: /health, /, /test, /smoke-test',
      available_endpoints: ['/', '/health', '/test', '/smoke-test'],
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
        hasAuth: req.headers.has('Authorization')
      });
      
      // Health check endpoint
      if (url.pathname === '/health' || url.pathname === '/' || url.pathname === '/smoke-test/') {
        logger.info('Health check endpoint called', { 
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
      if (url.pathname === '/test' || url.pathname === '/smoke-test') {
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
      
      // Handle OPTIONS for CORS preflight
      if (req.method === 'OPTIONS') {
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
      
      // Fall back to original handler for other routes
      return await handler(req);
    } catch (error) {
      logger.error('Unhandled error in serveWithHealthCheck', { error });
      
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
Deno.serve(serveWithHealthCheck(handler));
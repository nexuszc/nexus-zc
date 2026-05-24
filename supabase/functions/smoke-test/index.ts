// Deno Edge Function: Smoke Test with Health Check
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * Logger utility for structured logging
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
 * Perform comprehensive health check
 */
async function performComprehensiveHealthCheck(): Promise<{
  overall: boolean;
  timestamp: string;
  checks: Record<string, { status: boolean; message?: string }>;
}> {
  const checks: Record<string, { status: boolean; message?: string }> = {};
  
  // Check environment variables
  try {
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    checks.environment = {
      status: missingVars.length === 0,
      message: missingVars.length > 0 ? `Missing: ${missingVars.join(', ')}` : 'All required env vars present'
    };
  } catch (error) {
    checks.environment = {
      status: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
  
  // Check Supabase connectivity
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.from('profiles').select('count').limit(1);
      
      checks.database = {
        status: !error,
        message: error ? error.message : 'Database connection successful'
      };
    } else {
      checks.database = {
        status: false,
        message: 'Supabase credentials not available'
      };
    }
  } catch (error) {
    checks.database = {
      status: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
  
  // Check memory and runtime
  try {
    const memoryUsage = (Deno as any).memoryUsage?.() || {};
    checks.runtime = {
      status: true,
      message: `Memory: ${Math.round((memoryUsage.heapUsed || 0) / 1024 / 1024)}MB`
    };
  } catch (error) {
    checks.runtime = {
      status: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
  
  const overall = Object.values(checks).every(check => check.status);
  
  return {
    overall,
    timestamp: new Date().toISOString(),
    checks
  };
}

/**
 * Run smoke test suite
 */
async function runSmokeTestSuite(): Promise<{
  status: string;
  tests_passed: number;
  tests_failed: number;
  timestamp: string;
  results: Array<{ name: string; status: string; message?: string }>;
}> {
  const results: Array<{ name: string; status: string; message?: string }> = [];
  
  // Test 1: Environment variables
  try {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const allPresent = requiredVars.every(v => Deno.env.get(v));
    
    results.push({
      name: 'Environment Variables',
      status: allPresent ? 'passed' : 'failed',
      message: allPresent ? 'All required variables present' : 'Missing required variables'
    });
  } catch (error) {
    results.push({
      name: 'Environment Variables',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }
  
  // Test 2: Supabase client initialization
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      results.push({
        name: 'Supabase Client',
        status: 'passed',
        message: 'Client initialized successfully'
      });
    } else {
      results.push({
        name: 'Supabase Client',
        status: 'failed',
        message: 'Missing credentials'
      });
    }
  } catch (error) {
    results.push({
      name: 'Supabase Client',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }
  
  // Test 3: Database connectivity
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.from('profiles').select('count').limit(1);
      
      results.push({
        name: 'Database Query',
        status: error ? 'failed' : 'passed',
        message: error ? error.message : 'Query executed successfully'
      });
    } else {
      results.push({
        name: 'Database Query',
        status: 'failed',
        message: 'Cannot test without credentials'
      });
    }
  } catch (error) {
    results.push({
      name: 'Database Query',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }
  
  const tests_passed = results.filter(r => r.status === 'passed').length;
  const tests_failed = results.filter(r => r.status === 'failed').length;
  
  return {
    status: tests_failed === 0 ? 'passed' : 'failed',
    tests_passed,
    tests_failed,
    timestamp: new Date().toISOString(),
    results
  };
}

/**
 * Main handler function
 */
async function handler(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'This endpoint does not exist',
      available_endpoints: ['/health', '/', '/test', '/smoke-test'],
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
      if (url.pathname === '/health' || url.pathname === '/') {
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
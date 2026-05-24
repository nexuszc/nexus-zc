// Import required modules
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

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
 * Get Supabase client for testing
 */
function getSupabaseClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }
  
  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Perform comprehensive health checks
 */
async function performComprehensiveHealthCheck() {
  const results = {
    overall: true,
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, { status: boolean; message?: string; duration_ms?: number }>
  };
  
  // Check 1: Environment variables
  const startEnv = Date.now();
  try {
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length > 0) {
      results.checks.environment = {
        status: false,
        message: `Missing environment variables: ${missingVars.join(', ')}`,
        duration_ms: Date.now() - startEnv
      };
      results.overall = false;
    } else {
      results.checks.environment = {
        status: true,
        message: 'All required environment variables present',
        duration_ms: Date.now() - startEnv
      };
    }
  } catch (error) {
    results.checks.environment = {
      status: false,
      message: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startEnv
    };
    results.overall = false;
  }
  
  // Check 2: Supabase connectivity
  const startDb = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('profiles').select('count').limit(1);
    
    if (error) {
      results.checks.database = {
        status: false,
        message: `Database connection failed: ${error.message}`,
        duration_ms: Date.now() - startDb
      };
      results.overall = false;
    } else {
      results.checks.database = {
        status: true,
        message: 'Database connection successful',
        duration_ms: Date.now() - startDb
      };
    }
  } catch (error) {
    results.checks.database = {
      status: false,
      message: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startDb
    };
    results.overall = false;
  }
  
  return results;
}

/**
 * Run smoke test suite
 */
async function runSmokeTestSuite() {
  const results = {
    status: 'passed',
    timestamp: new Date().toISOString(),
    tests_passed: 0,
    tests_failed: 0,
    tests: [] as Array<{ name: string; status: string; message?: string; duration_ms?: number }>
  };
  
  // Test 1: Environment check
  const startEnv = Date.now();
  try {
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length > 0) {
      results.tests.push({
        name: 'environment_variables',
        status: 'failed',
        message: `Missing: ${missingVars.join(', ')}`,
        duration_ms: Date.now() - startEnv
      });
      results.tests_failed++;
      results.status = 'failed';
    } else {
      results.tests.push({
        name: 'environment_variables',
        status: 'passed',
        message: 'All required environment variables present',
        duration_ms: Date.now() - startEnv
      });
      results.tests_passed++;
    }
  } catch (error) {
    results.tests.push({
      name: 'environment_variables',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startEnv
    });
    results.tests_failed++;
    results.status = 'failed';
  }
  
  // Test 2: Database connectivity
  const startDb = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('profiles').select('count').limit(1);
    
    if (error) {
      results.tests.push({
        name: 'database_connectivity',
        status: 'failed',
        message: error.message,
        duration_ms: Date.now() - startDb
      });
      results.tests_failed++;
      results.status = 'failed';
    } else {
      results.tests.push({
        name: 'database_connectivity',
        status: 'passed',
        message: 'Successfully connected to database',
        duration_ms: Date.now() - startDb
      });
      results.tests_passed++;
    }
  } catch (error) {
    results.tests.push({
      name: 'database_connectivity',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startDb
    });
    results.tests_failed++;
    results.status = 'failed';
  }
  
  // Test 3: Profiles table access
  const startProfiles = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('profiles').select('id').limit(1);
    
    if (error) {
      results.tests.push({
        name: 'profiles_table_access',
        status: 'failed',
        message: error.message,
        duration_ms: Date.now() - startProfiles
      });
      results.tests_failed++;
      results.status = 'failed';
    } else {
      results.tests.push({
        name: 'profiles_table_access',
        status: 'passed',
        message: `Can access profiles table (found ${data?.length || 0} records)`,
        duration_ms: Date.now() - startProfiles
      });
      results.tests_passed++;
    }
  } catch (error) {
    results.tests.push({
      name: 'profiles_table_access',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startProfiles
    });
    results.tests_failed++;
    results.status = 'failed';
  }
  
  return results;
}

/**
 * Main handler function
 */
async function handler(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'This endpoint does not exist',
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
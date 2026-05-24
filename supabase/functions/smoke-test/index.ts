import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

/**
 * Logger utility for structured logging
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
 * Comprehensive health check function
 */
async function performComprehensiveHealthCheck() {
  const checks: Record<string, boolean> = {};
  const details: Record<string, any> = {};
  
  try {
    // 1. Check Supabase environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    checks.env_supabase_url = !!supabaseUrl;
    checks.env_supabase_anon_key = !!supabaseAnonKey;
    checks.env_supabase_service_role_key = !!supabaseServiceRoleKey;
    
    details.environment = {
      supabase_url_set: checks.env_supabase_url,
      supabase_anon_key_set: checks.env_supabase_anon_key,
      supabase_service_role_key_set: checks.env_supabase_service_role_key
    };
    
    // 2. Check Supabase client initialization
    if (supabaseUrl && supabaseServiceRoleKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });
        
        checks.supabase_client = true;
        
        // 3. Test database connectivity
        try {
          const { error: dbError } = await supabase.from('profiles').select('id').limit(1);
          checks.database_connection = !dbError;
          
          if (dbError) {
            details.database_error = dbError.message;
          }
        } catch (dbErr) {
          checks.database_connection = false;
          details.database_error = dbErr instanceof Error ? dbErr.message : String(dbErr);
        }
      } catch (clientErr) {
        checks.supabase_client = false;
        details.client_error = clientErr instanceof Error ? clientErr.message : String(clientErr);
      }
    } else {
      checks.supabase_client = false;
      details.client_error = 'Missing required environment variables';
    }
    
    // 4. Check OpenAI API key
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    checks.env_openai_api_key = !!openaiApiKey;
    details.openai_api_key_set = checks.env_openai_api_key;
    
    // Calculate overall health status
    const overall = Object.values(checks).every(check => check === true);
    
    return {
      overall,
      checks,
      details,
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  } catch (error) {
    logger.error('Health check error', { error });
    
    return {
      overall: false,
      checks,
      details: {
        ...details,
        error: error instanceof Error ? error.message : String(error)
      },
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
  }
}

/**
 * Run comprehensive smoke test suite
 */
async function runSmokeTestSuite() {
  const tests: Array<{ name: string; passed: boolean; error?: string; duration?: number }> = [];
  const startTime = Date.now();
  
  try {
    // Test 1: Environment variables
    const envTest = {
      name: 'Environment Variables',
      passed: false,
      duration: 0
    };
    const envStart = Date.now();
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
      
      envTest.passed = !!(supabaseUrl && supabaseAnonKey && supabaseServiceRoleKey && openaiApiKey);
      if (!envTest.passed) {
        envTest.error = 'Missing required environment variables';
      }
    } catch (err) {
      envTest.error = err instanceof Error ? err.message : String(err);
    }
    
    envTest.duration = Date.now() - envStart;
    tests.push(envTest);
    
    // Test 2: Supabase client creation
    const clientTest = {
      name: 'Supabase Client Creation',
      passed: false,
      duration: 0
    };
    const clientStart = Date.now();
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (supabaseUrl && supabaseServiceRoleKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });
        
        clientTest.passed = !!supabase;
      } else {
        clientTest.error = 'Missing Supabase credentials';
      }
    } catch (err) {
      clientTest.error = err instanceof Error ? err.message : String(err);
    }
    
    clientTest.duration = Date.now() - clientStart;
    tests.push(clientTest);
    
    // Test 3: Database connectivity
    const dbTest = {
      name: 'Database Connectivity',
      passed: false,
      duration: 0
    };
    const dbStart = Date.now();
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (supabaseUrl && supabaseServiceRoleKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });
        
        const { error } = await supabase.from('profiles').select('id').limit(1);
        dbTest.passed = !error;
        
        if (error) {
          dbTest.error = error.message;
        }
      } else {
        dbTest.error = 'Missing Supabase credentials';
      }
    } catch (err) {
      dbTest.error = err instanceof Error ? err.message : String(err);
    }
    
    dbTest.duration = Date.now() - dbStart;
    tests.push(dbTest);
    
    // Calculate results
    const totalDuration = Date.now() - startTime;
    const testsPassed = tests.filter(t => t.passed).length;
    const testsFailed = tests.filter(t => !t.passed).length;
    const status = testsFailed === 0 ? 'passed' : 'failed';
    
    return {
      status,
      tests_passed: testsPassed,
      tests_failed: testsFailed,
      total_tests: tests.length,
      tests,
      duration_ms: totalDuration,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Smoke test suite error', { error });
    
    return {
      status: 'failed',
      tests_passed: 0,
      tests_failed: tests.length,
      total_tests: tests.length,
      tests,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Main request handler
 */
async function handler(req: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'This endpoint does not exist. Try /health or /smoke-test',
      available_endpoints: ['/health', '/smoke-test'],
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
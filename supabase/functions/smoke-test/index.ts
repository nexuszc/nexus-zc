import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * Logger utility
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
 * CORS headers for all responses
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache, no-store, must-revalidate'
};

/**
 * Perform comprehensive health check
 */
async function performComprehensiveHealthCheck() {
  const results: any = {
    overall: true,
    timestamp: new Date().toISOString(),
    checks: {}
  };

  try {
    // Check environment variables
    results.checks.environment = {
      status: 'checking',
      details: {}
    };

    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length > 0) {
      results.checks.environment.status = 'failed';
      results.checks.environment.missing = missingVars;
      results.overall = false;
    } else {
      results.checks.environment.status = 'passed';
    }

    // Check Supabase client
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      results.checks.supabase_client = {
        status: 'passed',
        url: supabaseUrl
      };

      // Test database connection
      try {
        const { data, error } = await supabase.from('profiles').select('count').limit(1);
        
        if (error) {
          results.checks.database = {
            status: 'failed',
            error: error.message
          };
          results.overall = false;
        } else {
          results.checks.database = {
            status: 'passed'
          };
        }
      } catch (dbError) {
        results.checks.database = {
          status: 'failed',
          error: dbError instanceof Error ? dbError.message : String(dbError)
        };
        results.overall = false;
      }
    } catch (clientError) {
      results.checks.supabase_client = {
        status: 'failed',
        error: clientError instanceof Error ? clientError.message : String(clientError)
      };
      results.overall = false;
    }

    // Check function runtime
    results.checks.runtime = {
      status: 'passed',
      deno_version: Deno.version.deno,
      v8_version: Deno.version.v8,
      typescript_version: Deno.version.typescript
    };

  } catch (error) {
    results.overall = false;
    results.error = error instanceof Error ? error.message : String(error);
  }

  return results;
}

/**
 * Run smoke test suite
 */
async function runSmokeTestSuite() {
  const results: any = {
    status: 'running',
    timestamp: new Date().toISOString(),
    tests: [],
    tests_passed: 0,
    tests_failed: 0
  };

  try {
    // Test 1: Environment variables
    const envTest = {
      name: 'Environment Variables Check',
      status: 'running',
      details: {}
    };

    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length > 0) {
      envTest.status = 'failed';
      envTest.details = { missing: missingVars };
      results.tests_failed++;
    } else {
      envTest.status = 'passed';
      results.tests_passed++;
    }
    results.tests.push(envTest);

    // Test 2: Supabase client initialization
    const clientTest = {
      name: 'Supabase Client Initialization',
      status: 'running',
      details: {}
    };

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      clientTest.status = 'passed';
      clientTest.details = { url: supabaseUrl };
      results.tests_passed++;
    } catch (clientError) {
      clientTest.status = 'failed';
      clientTest.details = { error: clientError instanceof Error ? clientError.message : String(clientError) };
      results.tests_failed++;
    }
    results.tests.push(clientTest);

    // Test 3: Database connectivity
    const dbTest = {
      name: 'Database Connectivity',
      status: 'running',
      details: {}
    };

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data, error } = await supabase.from('profiles').select('count').limit(1);
      
      if (error) {
        dbTest.status = 'failed';
        dbTest.details = { error: error.message };
        results.tests_failed++;
      } else {
        dbTest.status = 'passed';
        results.tests_passed++;
      }
    } catch (dbError) {
      dbTest.status = 'failed';
      dbTest.details = { error: dbError instanceof Error ? dbError.message : String(dbError) };
      results.tests_failed++;
    }
    results.tests.push(dbTest);

    // Test 4: Runtime check
    const runtimeTest = {
      name: 'Runtime Check',
      status: 'running',
      details: {}
    };

    try {
      runtimeTest.status = 'passed';
      runtimeTest.details = {
        deno_version: Deno.version.deno,
        v8_version: Deno.version.v8,
        typescript_version: Deno.version.typescript
      };
      results.tests_passed++;
    } catch (runtimeError) {
      runtimeTest.status = 'failed';
      runtimeTest.details = { error: runtimeError instanceof Error ? runtimeError.message : String(runtimeError) };
      results.tests_failed++;
    }
    results.tests.push(runtimeTest);

    // Determine overall status
    results.status = results.tests_failed === 0 ? 'passed' : 'failed';

  } catch (error) {
    results.status = 'failed';
    results.error = error instanceof Error ? error.message : String(error);
  }

  return results;
}

/**
 * Original handler function
 */
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  logger.info('Request received', { 
    path: url.pathname, 
    method: req.method 
  });

  // Default response for unhandled routes
  return new Response(
    JSON.stringify({
      service: 'smoke-test',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      endpoints: [
        { path: '/', description: 'Simple health check' },
        { path: '/health', description: 'Comprehensive health check' },
        { path: '/test', description: 'Run smoke test suite' }
      ]
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
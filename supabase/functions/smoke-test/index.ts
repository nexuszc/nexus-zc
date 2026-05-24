import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

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
 * Comprehensive health check function
 */
async function performComprehensiveHealthCheck(): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    overall: true,
    checks: {}
  };

  // Environment check
  try {
    const envCheck = {
      SUPABASE_URL: !!Deno.env.get('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      OPENAI_API_KEY: !!Deno.env.get('OPENAI_API_KEY')
    };
    results.checks = { ...results.checks, environment: { status: 'ok', variables: envCheck } };
  } catch (error) {
    results.overall = false;
    results.checks = { ...results.checks, environment: { status: 'error', error: String(error) } };
  }

  // Database connectivity check
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.from('conversations').select('id').limit(1);
      
      if (error) {
        results.overall = false;
        results.checks = { ...results.checks, database: { status: 'error', error: error.message } };
      } else {
        results.checks = { ...results.checks, database: { status: 'ok' } };
      }
    } else {
      results.overall = false;
      results.checks = { ...results.checks, database: { status: 'error', error: 'Missing credentials' } };
    }
  } catch (error) {
    results.overall = false;
    results.checks = { ...results.checks, database: { status: 'error', error: String(error) } };
  }

  return results;
}

/**
 * Run smoke test suite
 */
async function runSmokeTestSuite(): Promise<Record<string, unknown>> {
  const results = {
    timestamp: new Date().toISOString(),
    status: 'passed',
    tests_passed: 0,
    tests_failed: 0,
    tests: [] as Array<Record<string, unknown>>
  };

  // Test 1: Environment variables
  try {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'];
    const missingVars = requiredVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length === 0) {
      results.tests_passed++;
      results.tests.push({ name: 'Environment Variables', status: 'passed' });
    } else {
      results.tests_failed++;
      results.status = 'failed';
      results.tests.push({ name: 'Environment Variables', status: 'failed', missing: missingVars });
    }
  } catch (error) {
    results.tests_failed++;
    results.status = 'failed';
    results.tests.push({ name: 'Environment Variables', status: 'error', error: String(error) });
  }

  // Test 2: Database connection
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.from('conversations').select('id').limit(1);
      
      if (error) {
        results.tests_failed++;
        results.status = 'failed';
        results.tests.push({ name: 'Database Connection', status: 'failed', error: error.message });
      } else {
        results.tests_passed++;
        results.tests.push({ name: 'Database Connection', status: 'passed' });
      }
    } else {
      results.tests_failed++;
      results.status = 'failed';
      results.tests.push({ name: 'Database Connection', status: 'failed', error: 'Missing credentials' });
    }
  } catch (error) {
    results.tests_failed++;
    results.status = 'failed';
    results.tests.push({ name: 'Database Connection', status: 'error', error: String(error) });
  }

  // Test 3: Table access
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const tables = ['conversations', 'messages', 'documents', 'knowledge_entries'];
      let allPassed = true;
      
      for (const table of tables) {
        const { error } = await supabase.from(table).select('id').limit(1);
        if (error) {
          allPassed = false;
          break;
        }
      }
      
      if (allPassed) {
        results.tests_passed++;
        results.tests.push({ name: 'Table Access', status: 'passed' });
      } else {
        results.tests_failed++;
        results.status = 'failed';
        results.tests.push({ name: 'Table Access', status: 'failed' });
      }
    }
  } catch (error) {
    results.tests_failed++;
    results.status = 'failed';
    results.tests.push({ name: 'Table Access', status: 'error', error: String(error) });
  }

  return results;
}

/**
 * Main handler for smoke-test function
 */
async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'Unknown endpoint. Use /health for health check or /test for smoke tests.',
      available_endpoints: ['/health', '/test', '/smoke-test'],
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
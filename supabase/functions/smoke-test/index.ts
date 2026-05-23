import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Logger utility
 */
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
 * Environment validation
 */
function validateEnvironment(): { isValid: boolean; missing: string[] } {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(key => !Deno.env.get(key));
  
  return {
    isValid: missing.length === 0,
    missing
  };
}

/**
 * Database connectivity check
 */
async function checkDatabaseConnectivity(): Promise<{ connected: boolean; error?: string; latency?: number }> {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        connected: false,
        error: 'Missing Supabase credentials'
      };
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { error } = await supabase.from('profiles').select('count').limit(1).single();
    
    const latency = Date.now() - startTime;
    
    if (error && error.code !== 'PGRST116') {
      return {
        connected: false,
        error: error.message,
        latency
      };
    }
    
    return {
      connected: true,
      latency
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
      latency: Date.now() - startTime
    };
  }
}

/**
 * Edge function health check
 */
async function checkEdgeFunctionHealth(): Promise<{ healthy: boolean; error?: string }> {
  try {
    const memoryUsage = (Deno as any).memoryUsage?.() || {};
    
    return {
      healthy: true,
      error: undefined
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Comprehensive health check
 */
async function performComprehensiveHealthCheck() {
  const startTime = Date.now();
  
  const envCheck = validateEnvironment();
  const dbCheck = await checkDatabaseConnectivity();
  const functionCheck = await checkEdgeFunctionHealth();
  
  const overall = envCheck.isValid && dbCheck.connected && functionCheck.healthy;
  
  return {
    overall,
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    checks: {
      environment: {
        valid: envCheck.isValid,
        missing: envCheck.missing
      },
      database: {
        connected: dbCheck.connected,
        latency: dbCheck.latency,
        error: dbCheck.error
      },
      function: {
        healthy: functionCheck.healthy,
        error: functionCheck.error
      }
    }
  };
}

/**
 * Individual smoke tests
 */
async function testDatabaseQuery(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);
    
    if (error) {
      throw error;
    }
    
    return {
      passed: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testAuthService(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1
    });
    
    if (error) {
      throw error;
    }
    
    return {
      passed: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testStorageAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await supabase.storage.listBuckets();
    
    if (error) {
      throw error;
    }
    
    return {
      passed: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Run complete smoke test suite
 */
async function runSmokeTestSuite() {
  const suiteStartTime = Date.now();
  
  const tests = {
    'Database Query': testDatabaseQuery,
    'Auth Service': testAuthService,
    'Storage Access': testStorageAccess
  };
  
  const testResults: Array<[string, { passed: boolean; duration: number; error?: string }]> = [];
  
  for (const [name, testFn] of Object.entries(tests)) {
    logger.info(`Running test: ${name}`);
    const result = await testFn();
    testResults.push([name, result]);
    
    logger.info(`Test ${name} ${result.passed ? 'passed' : 'failed'}`, {
      duration: result.duration,
      error: result.error
    });
  }
  
  const allPassed = testResults.every(([_, result]) => result.passed);
  const testsPassed = testResults.filter(([_, result]) => result.passed).length;
  const testsFailed = testResults.length - testsPassed;
  
  return {
    status: allPassed ? 'passed' : 'failed',
    tests_passed: testsPassed,
    tests_failed: testsFailed,
    total_tests: testResults.length,
    timestamp: new Date().toISOString(),
    duration: Date.now() - suiteStartTime,
    tests,
    errors: testResults
      .filter(([_, result]) => !result.passed)
      .map(([name, result]) => `${name}: ${result.error || 'Unknown error'}`)
  };
}

/**
 * Main handler function
 */
async function handler(req: Request): Promise<Response> {
  logger.info('Default handler called - returning 404');
  
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'Use /health for health checks or /test for smoke tests',
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
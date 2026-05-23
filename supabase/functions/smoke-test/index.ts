import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { logger } from '../_shared/logger.ts'

/**
 * Validate environment variables
 */
function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  for (const varName of requiredVars) {
    if (!Deno.env.get(varName)) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Test database connection
 */
async function testDatabaseConnection(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('users').select('id').limit(1);
    
    if (error) {
      throw error;
    }
    
    return {
      healthy: true,
      latency: Date.now() - startTime
    };
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Perform comprehensive health check
 */
async function performComprehensiveHealthCheck() {
  const envCheck = validateEnvironment();
  const dbCheck = await testDatabaseConnection();
  
  return {
    overall: envCheck.valid && dbCheck.healthy,
    timestamp: new Date().toISOString(),
    checks: {
      environment: {
        status: envCheck.valid ? 'healthy' : 'unhealthy',
        errors: envCheck.errors
      },
      database: {
        status: dbCheck.healthy ? 'healthy' : 'unhealthy',
        latency: dbCheck.latency,
        error: dbCheck.error
      }
    }
  };
}

async function testUserTableAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('users').select('id').limit(1);
    
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

async function testNotesTableAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('notes').select('id').limit(1);
    
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

async function testChatMessagesTableAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('chat_messages').select('id').limit(1);
    
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

async function testChatSessionsTableAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('chat_sessions').select('id').limit(1);
    
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

async function testEnvironmentVariables(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const envCheck = validateEnvironment();
    
    if (!envCheck.valid) {
      throw new Error(envCheck.errors.join(', '));
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

async function testDatabaseLatency(): Promise<{ passed: boolean; duration: number; error?: string; latency?: number }> {
  const startTime = Date.now();
  try {
    const result = await testDatabaseConnection();
    
    if (!result.healthy) {
      throw new Error(result.error || 'Database unhealthy');
    }
    
    const latencyThreshold = 5000; // 5 seconds
    const passed = (result.latency || 0) < latencyThreshold;
    
    return {
      passed,
      duration: Date.now() - startTime,
      latency: result.latency,
      error: passed ? undefined : `Latency ${result.latency}ms exceeds threshold ${latencyThreshold}ms`
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
  logger.info('Starting smoke test suite');
  const suiteStartTime = Date.now();
  
  const tests = {
    'environment_variables': await testEnvironmentVariables(),
    'database_latency': await testDatabaseLatency(),
    'users_table': await testUserTableAccess(),
    'notes_table': await testNotesTableAccess(),
    'chat_messages_table': await testChatMessagesTableAccess(),
    'chat_sessions_table': await testChatSessionsTableAccess()
  };
  
  const testResults = Object.entries(tests);
  const passed = testResults.filter(([_, result]) => result.passed).length;
  const failed = testResults.filter(([_, result]) => !result.passed).length;
  
  const status = failed === 0 ? 'passed' : 'failed';
  
  return {
    status,
    tests_run: testResults.length,
    tests_passed: passed,
    tests_failed: failed,
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
          error: '
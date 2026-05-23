import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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
 * Validate environment variables
 */
function validateEnvironment() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const missing: string[] = [];
  const present: string[] = [];
  
  for (const key of required) {
    if (Deno.env.get(key)) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing,
    present
  };
}

/**
 * Test environment configuration
 */
async function testEnvironment() {
  return {
    success: true,
    duration: 0,
    result: validateEnvironment()
  };
}

/**
 * Test database connection
 */
async function testDatabase() {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Simple query to test connection
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (error) throw error;
    
    return {
      success: true,
      duration: Date.now() - startTime,
      result: { connected: true, message: 'Database connection successful' }
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Test table access
 */
async function testTableAccess(tableName: string) {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
    
    if (error) throw error;
    
    return {
      success: true,
      duration: Date.now() - startTime,
      result: { accessible: true, table: tableName }
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Comprehensive health check
 */
async function performComprehensiveHealthCheck() {
  const checks: Record<string, unknown> = {};
  let overall = true;
  
  // Environment check
  const envCheck = validateEnvironment();
  checks.environment = envCheck;
  if (!envCheck.valid) overall = false;
  
  // Database connection check
  const dbTest = await testDatabase();
  checks.database = {
    healthy: dbTest.success,
    duration: dbTest.duration,
    error: dbTest.error
  };
  if (!dbTest.success) overall = false;
  
  // Table access checks
  const tables = ['users', 'chats', 'messages', 'documents', 'chat_participants'];
  const tableChecks: Record<string, unknown> = {};
  
  for (const table of tables) {
    const tableTest = await testTableAccess(table);
    tableChecks[table] = {
      accessible: tableTest.success,
      duration: tableTest.duration,
      error: tableTest.error
    };
    if (!tableTest.success) overall = false;
  }
  
  checks.tables = {
    healthy: Object.values(tableChecks).every((t: any) => t.accessible),
    tables: tableChecks
  };
  
  // Edge functions check (basic)
  checks.edgeFunctions = {
    healthy: true,
    functions: {
      'smoke-test': { deployed: true }
    }
  };
  
  return {
    overall,
    timestamp: new Date().toISOString(),
    checks
  };
}

/**
 * Run with timeout
 */
async function runWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<{ success: boolean; duration: number; result?: T; error?: string }> {
  const startTime = Date.now();
  
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    );
    
    const result = await Promise.race([fn(), timeoutPromise]);
    
    return {
      success: true,
      duration: Date.now() - startTime,
      result
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Run comprehensive smoke tests
 */
async function runSmokeTests() {
  logger.info('Starting comprehensive smoke test suite');
  
  const startTime = Date.now();
  const tests: Record<string, unknown> = {};
  const errors: string[] = [];
  let testsRun = 0;
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Environment validation
  testsRun++;
  logger.info('Running environment validation test');
  const envTest = await runWithTimeout(
    async () => {
      return validateEnvironment();
    },
    5000
  );
  tests.environment = {
    passed: envTest.success && envTest.result?.valid,
    duration: envTest.duration,
    error: envTest.error,
    details: envTest.result
  };
  if (envTest.success && envTest.result?.valid) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Environment validation failed: ${envTest.error || 'Invalid environment'}`);
  }

  // Test 2: Database connection
  testsRun++;
  logger.info('Running database connection test');
  const dbTest = await runWithTimeout(
    async () => {
      return await testDatabase();
    },
    10000
  );
  tests.database = {
    passed: dbTest.success && dbTest.result?.success,
    duration: dbTest.duration,
    error: dbTest.error,
    details: dbTest.result
  };
  if (dbTest.success && dbTest.result?.success) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Database connection test failed: ${dbTest.error || dbTest.result?.error}`);
  }

  // Test 3: Table access tests
  const tables = ['users', 'chats', 'messages', 'documents', 'chat_participants'];
  for (const table of tables) {
    testsRun++;
    logger.info(`Running table access test for ${table}`);
    const tableTest = await runWithTimeout(
      async () => {
        return await testTableAccess(table);
      },
      10000
    );
    tests[`table_${table}`] = {
      passed: tableTest.success && tableTest.result?.success,
      duration: tableTest.duration,
      error: tableTest.error,
      details: tableTest.result
    };
    if (tableTest.success && tableTest.result?.success) testsPassed++;
    else {
      testsFailed++;
      errors.push(`Table ${table} access test failed: ${tableTest.error || tableTest.result?.error}`);
    }
  }

  // Test 4: Supabase client creation
  testsRun++;
  logger.info('Running Supabase client test');
  const clientTest = await runWithTimeout(
    async () => {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase credentials');
      }
      
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // Test a simple query
      const { error } = await supabase.from('users').select('count').limit(1);
      
      if (error) throw error;
      
      return { success: true, message: 'Client created and tested successfully' };
    },
    10000
  );
  tests.supabase_client = {
    passed: clientTest.success,
    duration: clientTest.duration,
    error: clientTest.error,
    details: clientTest.result
  };
  if (clientTest.success) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Supabase client test failed: ${clientTest.error}`);
  }

  const duration = Date.now() - startTime;
  const status = testsFailed === 0 ? 'passed' : 'failed';

  const result = {
    status,
    tests_run: testsRun,
    tests_passed: testsPassed,
    tests_failed: testsFailed,
    timestamp: new Date().toISOString(),
    duration,
    tests,
    errors
  };

  logger.info('Smoke test suite completed', {
    status,
    tests_run: testsRun,
    tests_passed: testsPassed,
    tests_failed: testsFailed,
    duration
  });

  return result;
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      
      // Health check endpoint
      if (url.pathname === '/health' || url.pathname === '/') {
        logger.info('Health check endpoint called', { 
          path: url.pathname,
          method: req.method 
        });
        
        try {
          const healthCheck = await performComprehensiveHealthCheck();
          
          const statusCode = healthCheck.overall ? 200 : 503;
          
          return new Response(
            JSON.stringify(healthCheck, null, 2),
            {
              status: statusCode,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
              }
            }
          );
        } catch (error) {
          logger.error('Health check failed with exception', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          
          return new Response(
            JSON.stringify({
              overall: false,
              timestamp: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              checks: {
                environment: { valid: false, errors: ['Health check threw exception'] },
                database: { healthy: false, error: 'Health check failed' },
                tables: { healthy: false, tables: {} },
                edgeFunctions: { healthy: false, functions: {} }
              }
            }, null, 2),
            {
              status: 503,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
              }
            }
          );
        }
      }
      
      // Delegate to actual handler for other paths
      return await handler(req);
      
    } catch (error) {
      logger.error('Request handler failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        }, null, 2),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }
  };
}

/**
 * Main handler - smoke test endpoints
 */
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  logger.info('Smoke test request received', {
    path: url.pathname,
    method: req.method
  });
  
  // Test endpoint: comprehensive smoke test suite
  if (url.pathname === '/test/run' || url.pathname === '/test/smoke') {
    logger.info('Comprehensive smoke test endpoint called');
    
    try {
      const results = await runSmokeTests();
      
      const statusCode = results.status === 'passed' ? 200 : 500;
      
      return new Response(
        JSON.stringify(results, null, 2),
        {
          status: statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        }
      );
    } catch (error) {
      logger.error('Smoke test suite failed with exception', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return new Response(
        JSON.stringify({
          status: 'failed',
          tests_run: 0,
          tests_passed: 0,
          tests_failed: 0,
          timestamp: new Date().toISOString(),
          duration: 0,
          tests: {},
          errors: [error instanceof Error ? error.message : String(error)]
        }, null, 2),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        }
      );
    }
  }
  
  // Test endpoint: basic ping
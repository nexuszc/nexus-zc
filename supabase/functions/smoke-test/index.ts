import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * Comprehensive Smoke Test Suite for Nexus System
 * 
 * Tests:
 * - Environment variable validation
 * - Database connectivity
 * - Critical table access
 * - Supabase client functionality
 */

interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

const logger: Logger = {
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
 * Run a function with a timeout
 */
async function runWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<{ success: boolean; result?: T; error?: string; duration: number }> {
  const startTime = Date.now();
  
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    );
    
    const result = await Promise.race([fn(), timeoutPromise]);
    
    return {
      success: true,
      result,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime
    };
  }
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): { valid: boolean; missing: string[]; errors: string[] } {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const missing: string[] = [];
  const errors: string[] = [];
  
  for (const varName of required) {
    const value = Deno.env.get(varName);
    if (!value) {
      missing.push(varName);
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing,
    errors
  };
}

/**
 * Test database connectivity
 */
async function testDatabaseConnection(): Promise<{ healthy: boolean; error?: string; latency?: number }> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const startTime = Date.now();
    const { error } = await supabase.from('users').select('count').limit(1);
    const latency = Date.now() - startTime;
    
    if (error) throw error;
    
    return { healthy: true, latency };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Test access to critical tables
 */
async function testTableAccess(): Promise<{
  healthy: boolean;
  tables: Record<string, { accessible: boolean; error?: string }>;
}> {
  const tables = ['users', 'sessions', 'conversations', 'messages'];
  const results: Record<string, { accessible: boolean; error?: string }> = {};
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    for (const table of tables) {
      try {
        const { error } = await supabase.from(table).select('count').limit(1);
        
        if (error) throw error;
        
        results[table] = { accessible: true };
      } catch (error) {
        results[table] = {
          accessible: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
    
    const allAccessible = Object.values(results).every(r => r.accessible);
    
    return {
      healthy: allAccessible,
      tables: results
    };
  } catch (error) {
    return {
      healthy: false,
      tables: Object.fromEntries(
        tables.map(t => [t, { accessible: false, error: error instanceof Error ? error.message : String(error) }])
      )
    };
  }
}

/**
 * Perform comprehensive health check
 */
async function performComprehensiveHealthCheck() {
  logger.info('Starting comprehensive health check');
  
  const startTime = Date.now();
  
  // Check 1: Environment variables
  logger.info('Checking environment variables');
  const envCheck = validateEnvironment();
  
  // Check 2: Database connectivity
  logger.info('Testing database connection');
  const dbCheck = await testDatabaseConnection();
  
  // Check 3: Table access
  logger.info('Testing table access');
  const tableCheck = await testTableAccess();
  
  // Check 4: Edge function status (self-check)
  const edgeFunctionCheck = {
    healthy: true,
    functions: {
      'smoke-test': { accessible: true, status: 'running' }
    }
  };
  
  const duration = Date.now() - startTime;
  
  const overall = envCheck.valid && dbCheck.healthy && tableCheck.healthy && edgeFunctionCheck.healthy;
  
  const result = {
    overall,
    timestamp: new Date().toISOString(),
    duration,
    checks: {
      environment: envCheck,
      database: dbCheck,
      tables: tableCheck,
      edgeFunctions: edgeFunctionCheck
    }
  };
  
  logger.info('Health check completed', {
    overall,
    duration,
    environment_valid: envCheck.valid,
    database_healthy: dbCheck.healthy,
    tables_healthy: tableCheck.healthy
  });
  
  return result;
}

/**
 * Run comprehensive smoke tests
 */
async function runSmokeTests() {
  logger.info('Starting comprehensive smoke test suite');
  
  const startTime = Date.now();
  let testsRun = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  const tests: Record<string, unknown> = {};
  const errors: string[] = [];

  // Test 1: Environment validation
  testsRun++;
  logger.info('Running environment validation test');
  const envTest = await runWithTimeout(
    async () => validateEnvironment(),
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
    errors.push(`Environment validation failed: ${envTest.error || envTest.result?.errors.join(', ')}`);
  }

  // Test 2: Database connectivity
  testsRun++;
  logger.info('Running database connectivity test');
  const dbTest = await runWithTimeout(
    async () => testDatabaseConnection(),
    10000
  );
  tests.database = {
    passed: dbTest.success && dbTest.result?.healthy,
    duration: dbTest.duration,
    error: dbTest.error,
    details: dbTest.result
  };
  if (dbTest.success && dbTest.result?.healthy) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Database connectivity test failed: ${dbTest.error || dbTest.result?.error}`);
  }

  // Test 3: Table access
  testsRun++;
  logger.info('Running table access test');
  const tableTest = await runWithTimeout(
    async () => testTableAccess(),
    15000
  );
  tests.table_access = {
    passed: tableTest.success && tableTest.result?.healthy,
    duration: tableTest.duration,
    error: tableTest.error,
    details: tableTest.result
  };
  if (tableTest.success && tableTest.result?.healthy) testsPassed++;
  else {
    testsFailed++;
    if (!tableTest.result?.healthy) {
      const failedTables = Object.entries(tableTest.result?.tables || {})
        .filter(([_, info]) => !(info as { accessible: boolean }).accessible)
        .map(([name]) => name);
      errors.push(`Table access test failed for: ${failedTables.join(', ')}`);
    } else {
      errors.push(`Table access test failed: ${tableTest.error || tableTest.result?.error}`);
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
        error: error instanceof Error ? error.message
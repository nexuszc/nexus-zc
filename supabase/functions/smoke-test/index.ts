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
 * Timeout wrapper for async operations
 */
async function runWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number
): Promise<{ success: boolean; result?: T; error?: string; duration: number }> {
  const startTime = Date.now();
  
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    
    const result = await Promise.race([operation(), timeoutPromise]);
    const duration = Date.now() - startTime;
    
    return { success: true, result, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration
    };
  }
}

/**
 * Check environment variables
 */
async function checkEnvironment(): Promise<{
  valid: boolean;
  variables: Record<string, boolean>;
  errors: string[];
}> {
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const variables: Record<string, boolean> = {};
  const errors: string[] = [];
  
  for (const varName of requiredVars) {
    const value = Deno.env.get(varName);
    variables[varName] = !!value;
    if (!value) {
      errors.push(`Missing environment variable: ${varName}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    variables,
    errors
  };
}

/**
 * Test database connection
 */
async function testDatabaseConnection(): Promise<{
  healthy: boolean;
  latency?: number;
  error?: string;
}> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceKey) {
    return {
      healthy: false,
      error: 'Missing Supabase credentials'
    };
  }
  
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const startTime = Date.now();
    
    const { error } = await supabase.from('users').select('count').limit(1);
    
    const latency = Date.now() - startTime;
    
    if (error) {
      return {
        healthy: false,
        latency,
        error: error.message
      };
    }
    
    return {
      healthy: true,
      latency
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Test table access
 */
async function testTableAccess(): Promise<{
  healthy: boolean;
  tables: Record<string, { accessible: boolean; error?: string }>;
  error?: string;
}> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceKey) {
    return {
      healthy: false,
      tables: {},
      error: 'Missing Supabase credentials'
    };
  }
  
  const tablesToTest = ['users', 'sessions', 'conversations', 'messages'];
  const tables: Record<string, { accessible: boolean; error?: string }> = {};
  
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    
    for (const table of tablesToTest) {
      try {
        const { error } = await supabase.from(table).select('count').limit(1);
        
        if (error) {
          tables[table] = { accessible: false, error: error.message };
        } else {
          tables[table] = { accessible: true };
        }
      } catch (error) {
        tables[table] = {
          accessible: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
    
    const allAccessible = Object.values(tables).every(t => t.accessible);
    
    return {
      healthy: allAccessible,
      tables
    };
  } catch (error) {
    return {
      healthy: false,
      tables,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Test edge functions
 */
async function testEdgeFunctions(): Promise<{
  healthy: boolean;
  functions: Record<string, { available: boolean; error?: string }>;
  error?: string;
}> {
  const functions: Record<string, { available: boolean; error?: string }> = {};
  
  // For now, just check if the function itself is running
  functions['smoke-test'] = { available: true };
  
  return {
    healthy: true,
    functions
  };
}

/**
 * Comprehensive health check
 */
async function performComprehensiveHealthCheck(): Promise<{
  overall: boolean;
  timestamp: string;
  checks: {
    environment: Awaited<ReturnType<typeof checkEnvironment>>;
    database: Awaited<ReturnType<typeof testDatabaseConnection>>;
    tables: Awaited<ReturnType<typeof testTableAccess>>;
    edgeFunctions: Awaited<ReturnType<typeof testEdgeFunctions>>;
  };
}> {
  logger.info('Starting comprehensive health check');
  
  const [environment, database, tables, edgeFunctions] = await Promise.all([
    checkEnvironment(),
    testDatabaseConnection(),
    testTableAccess(),
    testEdgeFunctions()
  ]);
  
  const overall = environment.valid && database.healthy && tables.healthy && edgeFunctions.healthy;
  
  logger.info('Health check completed', {
    overall,
    environment: environment.valid,
    database: database.healthy,
    tables: tables.healthy,
    edgeFunctions: edgeFunctions.healthy
  });
  
  return {
    overall,
    timestamp: new Date().toISOString(),
    checks: {
      environment,
      database,
      tables,
      edgeFunctions
    }
  };
}

/**
 * Run comprehensive smoke tests
 */
async function runSmokeTests(): Promise<{
  status: 'passed' | 'failed';
  tests_run: number;
  tests_passed: number;
  tests_failed: number;
  timestamp: string;
  duration: number;
  tests: Record<string, {
    passed: boolean;
    duration: number;
    error?: string;
    details?: unknown;
  }>;
  errors: string[];
}> {
  logger.info('Starting comprehensive smoke test suite');
  
  const startTime = Date.now();
  let testsRun = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  const tests: Record<string, {
    passed: boolean;
    duration: number;
    error?: string;
    details?: unknown;
  }> = {};
  const errors: string[] = [];
  
  // Test 1: Environment variables
  testsRun++;
  logger.info('Running environment check');
  const envTest = await runWithTimeout(checkEnvironment, 5000);
  tests.environment = {
    passed: envTest.success && envTest.result?.valid === true,
    duration: envTest.duration,
    error: envTest.error,
    details: envTest.result
  };
  if (envTest.success && envTest.result?.valid) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Environment test failed: ${envTest.error || envTest.result?.errors.join(', ')}`);
  }
  
  // Test 2: Database connection
  testsRun++;
  logger.info('Running database connection test');
  const dbTest = await runWithTimeout(testDatabaseConnection, 10000);
  tests.database = {
    passed: dbTest.success && dbTest.result?.healthy === true,
    duration: dbTest.duration,
    error: dbTest.error,
    details: dbTest.result
  };
  if (dbTest.success && dbTest.result?.healthy) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Database test failed: ${dbTest.error || dbTest.result?.error}`);
  }
  
  // Test 3: Table access
  testsRun++;
  logger.info('Running table access test');
  const tableTest = await runWithTimeout(
    testTableAccess,
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
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
error(`Error checking edge function ${func}`, { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  const allAvailable = Object.values(results).every(r => r.available);
  
  return { 
    healthy: allAvailable, 
    functions: results 
  };
}

/**
 * Comprehensive health check with detailed reporting
 */
async function performComprehensiveHealthCheck(): Promise<{
  overall: boolean;
  timestamp: string;
  checks: {
    environment: { valid: boolean; errors?: string[] };
    database: { healthy: boolean; error?: string; attempts?: number };
    tables: { healthy: boolean; tables: Record<string, { accessible: boolean; error?: string }> };
    edgeFunctions: { healthy: boolean; functions: Record<string, { available: boolean; error?: string }> };
  };
}> {
  logger.info('Starting comprehensive health check');
  
  const envCheck = validateEnvironment();
  
  let dbCheck = { healthy: false, error: 'Skipped due to environment validation failure' };
  let tablesCheck = { healthy: false, tables: {} };
  let functionsCheck = { healthy: false, functions: {} };
  
  if (envCheck.valid) {
    dbCheck = await checkDatabaseConnectivity(3, 1000);
    
    if (dbCheck.healthy) {
      [tablesCheck, functionsCheck] = await Promise.all([
        checkCriticalTables(),
        checkEdgeFunctions()
      ]);
    } else {
      logger.error('Skipping table and function checks due to database connectivity failure');
    }
  } else {
    logger.error('Skipping all checks due to environment validation failure');
  }
  
  const overall = envCheck.valid && dbCheck.healthy && tablesCheck.healthy && functionsCheck.healthy;
  
  const result = {
    overall,
    timestamp: new Date().toISOString(),
    checks: {
      environment: envCheck.valid ? { valid: true } : { valid: false, errors: envCheck.errors },
      database: dbCheck,
      tables: tablesCheck,
      edgeFunctions: functionsCheck
    }
  };
  
  logger.info('Comprehensive health check completed', {
    overall,
    environmentValid: envCheck.valid,
    databaseHealthy: dbCheck.healthy,
    tablesHealthy: tablesCheck.healthy,
    functionsHealthy: functionsCheck.healthy
  });
  
  return result;
}

/**
 * Test execution with timeout management
 */
async function executeTestWithTimeout<T>(
  testName: string,
  testFn: () => Promise<T>,
  timeoutMs: number = 10000
): Promise<{ success: boolean; result?: T; error?: string; duration: number }> {
  const startTime = Date.now();
  
  try {
    logger.info(`Executing test: ${testName}`);
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Test timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    
    const result = await Promise.race([
      testFn(),
      timeoutPromise
    ]);
    
    const duration = Date.now() - startTime;
    logger.info(`Test completed: ${testName}`, { duration });
    
    return {
      success: true,
      result,
      duration
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error(`Test failed: ${testName}`, {
      error: errorMessage,
      duration,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return {
      success: false,
      error: errorMessage,
      duration
    };
  }
}

/**
 * Comprehensive smoke test suite
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
    details?: any;
  }>;
  errors: string[];
}> {
  const startTime = Date.now();
  const tests: Record<string, any> = {};
  const errors: string[] = [];
  let testsRun = 0;
  let testsPassed = 0;
  let testsFailed = 0;

  logger.info('Starting comprehensive smoke test suite');

  // Test 1: Environment validation
  testsRun++;
  const envTest = await executeTestWithTimeout(
    'environment_validation',
    async () => {
      const envCheck = validateEnvironment();
      if (!envCheck.valid) {
        throw new Error(`Environment validation failed: ${envCheck.errors?.join(', ')}`);
      }
      return envCheck;
    },
    5000
  );
  tests.environment_validation = {
    passed: envTest.success,
    duration: envTest.duration,
    error: envTest.error,
    details: envTest.result
  };
  if (envTest.success) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Environment validation failed: ${envTest.error}`);
  }

  // Test 2: Database connectivity
  testsRun++;
  const dbTest = await executeTestWithTimeout(
    'database_connectivity',
    async () => {
      const dbCheck = await checkDatabaseConnectivity(3, 1000);
      if (!dbCheck.healthy) {
        throw new Error(dbCheck.error || 'Database connectivity check failed');
      }
      return dbCheck;
    },
    15000
  );
  tests.database_connectivity = {
    passed: dbTest.success,
    duration: dbTest.duration,
    error: dbTest.error,
    details: dbTest.result
  };
  if (dbTest.success) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Database connectivity failed: ${dbTest.error}`);
  }

  // Test 3: Critical tables accessibility
  if (dbTest.success) {
    testsRun++;
    const tablesTest = await executeTestWithTimeout(
      'critical_tables',
      async () => {
        const tablesCheck = await checkCriticalTables();
        if (!tablesCheck.healthy) {
          const failedTables = Object.entries(tablesCheck.tables)
            .filter(([_, t]) => !t.accessible)
            .map(([name, t]) => `${name}: ${t.error}`);
          throw new Error(`Table checks failed: ${failedTables.join(', ')}`);
        }
        return tablesCheck;
      },
      15000
    );
    tests.critical_tables = {
      passed: tablesTest.success,
      duration: tablesTest.duration,
      error: tablesTest.error,
      details: tablesTest.result
    };
    if (tablesTest.success) testsPassed++;
    else {
      testsFailed++;
      errors.push(`Critical tables check failed: ${tablesTest.error}`);
    }
  } else {
    tests.critical_tables = {
      passed: false,
      duration: 0,
      error: 'Skipped due to database connectivity failure'
    };
  }

  // Test 4: Edge functions availability
  testsRun++;
  const functionsTest = await executeTestWithTimeout(
    'edge_functions',
    async () => {
      const functionsCheck = await checkEdgeFunctions();
      if (!functionsCheck.healthy) {
        const unavailableFunctions = Object.entries(functionsCheck.functions)
          .filter(([_, f]) => !f.available)
          .map(([name, f]) => `${name}: ${f.error}`);
        throw new Error(`Function checks failed: ${unavailableFunctions.join(', ')}`);
      }
      return functionsCheck;
    },
    20000
  );
  tests.edge_functions = {
    passed: functionsTest.success,
    duration: functionsTest.duration,
    error: functionsTest.error,
    details: functionsTest.result
  };
  if (functionsTest.success) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Edge functions check failed: ${functionsTest.error}`);
  }

  // Test 5: Supabase client initialization
  testsRun++;
  const clientTest = await executeTestWithTimeout(
    'supabase_client',
    async () => {
      try {
        const testClient = createClient(
          Deno.env.get('SUPABASE_URL') || '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
        );
        
        // Test a simple query
        const { error } = await testClient.from('profiles').select('id').limit(1);
        if (error) throw error;
        
        return { initialized: true };
      } catch (error) {
        throw new Error(`Client initialization failed: ${error instanceof Error ? error.message : String(error)}`);
      }
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
  if (url.pathname === '/test/ping') {
    logger.info('Ping test endpoint called');
    return new Response(
      JSON.stringify({
        success: true,
        message: 'pong',
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
  
  // Test endpoint: environment check
  if (url.pathname === '/test/env') {
    logger.info('Environment test endpoint called');
    const envCheck = validateEnvironment();
    return new Response(
      JSON.stringify({
        success: envCheck.valid,
        ...envCheck,
        timestamp: new Date().toISOString()
      }),
      {
        status: envCheck.valid ? 200 : 500,
        headers:
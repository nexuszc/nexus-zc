nection test');
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

  // Test 5: Edge Function endpoints with auth
  testsRun++;
  logger.info('Running edge function endpoints test');
  const edgeFunctionTest = await runWithTimeout(
    async () => {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing Supabase credentials for edge function test');
      }
      
      const endpoints = [
        { name: 'chat', path: '/chat', method: 'POST', requiresAuth: true },
        { name: 'message-history', path: '/message-history', method: 'GET', requiresAuth: true },
        { name: 'smoke-test-health', path: '/smoke-test/health', method: 'GET', requiresAuth: false }
      ];
      
      const results: Record<string, { accessible: boolean; status?: number; error?: string }> = {};
      
      for (const endpoint of endpoints) {
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          };
          
          if (endpoint.requiresAuth) {
            headers['Authorization'] = `Bearer ${supabaseAnonKey}`;
            headers['apikey'] = supabaseAnonKey;
          }
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(`${supabaseUrl}/functions/v1${endpoint.path}`, {
            method: endpoint.method,
            headers,
            body: endpoint.method === 'POST' ? JSON.stringify({ message: 'test' }) : undefined,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          results[endpoint.name] = {
            accessible: response.status !== 404 && response.status !== 500,
            status: response.status
          };
          
          logger.info(`Endpoint ${endpoint.name} test result`, {
            status: response.status,
            accessible: results[endpoint.name].accessible
          });
        } catch (error) {
          results[endpoint.name] = {
            accessible: false,
            error: error instanceof Error ? error.message : String(error)
          };
          
          logger.error(`Endpoint ${endpoint.name} test failed`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      const allAccessible = Object.values(results).every(r => r.accessible);
      
      return {
        healthy: allAccessible,
        endpoints: results,
        message: allAccessible ? 'All endpoints accessible' : 'Some endpoints failed'
      };
    },
    20000
  );
  
  tests.edge_functions = {
    passed: edgeFunctionTest.success && edgeFunctionTest.result?.healthy === true,
    duration: edgeFunctionTest.duration,
    error: edgeFunctionTest.error,
    details: edgeFunctionTest.result
  };
  
  if (edgeFunctionTest.success && edgeFunctionTest.result?.healthy) testsPassed++;
  else {
    testsFailed++;
    errors.push(`Edge function test failed: ${edgeFunctionTest.error || edgeFunctionTest.result?.message || 'Unknown error'}`);
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
 * Validate response schema
 */
function validateResponseSchema(data: unknown, schema: Record<string, string>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data || typeof data !== 'object') {
    errors.push('Response is not an object');
    return { valid: false, errors };
  }
  
  for (const [key, type] of Object.entries(schema)) {
    const value = (data as Record<string, unknown>)[key];
    
    if (value === undefined) {
      errors.push(`Missing required field: ${key}`);
      continue;
    }
    
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    
    if (actualType !== type) {
      errors.push(`Field ${key} has type ${actualType}, expected ${type}`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Enhanced timeout handler with detailed logging
 */
async function runWithTimeoutEnhanced<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  testName: string
): Promise<{ success: boolean; result?: T; error?: string; duration: number; timedOut?: boolean }> {
  const startTime = Date.now();
  
  try {
    logger.info(`Starting test: ${testName}`, { timeout: timeoutMs });
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    
    const result = await Promise.race([
      fn(),
      timeoutPromise
    ]);
    
    const duration = Date.now() - startTime;
    
    logger.info(`Test completed: ${testName}`, { duration, success: true });
    
    return {
      success: true,
      result,
      duration
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const timedOut = errorMessage.includes('timeout');
    
    logger.error(`Test failed: ${testName}`, {
      error: errorMessage,
      duration,
      timedOut,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return {
      success: false,
      error: errorMessage,
      duration,
      timedOut
    };
  }
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
      
      // Smoke test endpoint
      if (url.pathname === '/test' || url.pathname === '/smoke-test') {
        logger.info('Smoke test endpoint called', {
          path: url.pathname,
          method: req.method
        });
        
        try {
          const testResult = await runSmokeTestSuite();
          
          const statusCode = testResult.status === 'passed' ? 200 : 500;
          
          logger.info('Smoke test completed', {
            status: testResult.status,
            statusCode,
            tests_run: testResult.tests_run,
            tests_passed: testResult.tests_passed,
            tests_failed: testResult.tests_failed
          });
          
          return new Response(
            JSON.stringify(testResult, null, 2),
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
          logger.error('Smoke test failed with exception', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          
          return new Response(
            JSON.stringify({
              status: 'failed',
              tests_run: 0,
              tests_passed: 0,
              tests_failed: 1,
              timestamp: new Date().toISOString(),
              duration: 0,
              tests: {},
              errors: [error instanceof Error ? error.message : String(error)]
            }, null, 2),
            {
              status: 500,
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
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        }
      );
    }
  };
}
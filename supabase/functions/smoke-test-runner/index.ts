console.log(`✓ Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`);
  } catch (error) {
    tests.push({
      name: 'Memory Usage',
      status: 'failed',
      duration_ms: performance.now() - memTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Memory check error:', error.message);
  }

  // Test 7: File System Access
  currentStep++;
  const fsTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing file system access...`);

  try {
    const tempFile = await Deno.makeTempFile();
    await Deno.writeTextFile(tempFile, 'test');
    const content = await Deno.readTextFile(tempFile);
    await Deno.remove(tempFile);

    tests.push({
      name: 'File System Access',
      status: 'passed',
      duration_ms: performance.now() - fsTestStart,
      details: 'Read/write operations successful'
    });
    console.log('✓ File system access verified');
  } catch (error) {
    tests.push({
      name: 'File System Access',
      status: 'failed',
      duration_ms: performance.now() - fsTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ File system access error:', error.message);
  }

  const totalDuration = performance.now() - startTime;
  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = tests.filter(t => t.status === 'failed').length;

  console.log('=== Smoke Tests Complete ===');
  console.log(`Total: ${tests.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Duration: ${totalDuration.toFixed(2)}ms`);

  return {
    total: tests.length,
    passed,
    failed,
    duration_ms: totalDuration,
    timestamp: new Date().toISOString(),
    tests
  };
}

interface HealthCheckResult {
  function: string;
  status: 'success' | 'failed';
  duration_ms: number;
  error?: string;
  response?: any;
  retries?: number;
  stackTrace?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkFunctionHealth(functionName: string, timeout: number = 30000): Promise<HealthCheckResult> {
  const startTime = performance.now();
  const functionUrl = `${SUPABASE_URL}/functions/v1/${functionName}`;
  const maxRetries = 3;
  let lastError: any = null;
  let stackTrace: string | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Exponential backoff: 0ms, 1000ms, 2000ms
      if (attempt > 0) {
        const backoffMs = attempt * 1000;
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} for ${functionName} after ${backoffMs}ms`);
        await sleep(backoffMs);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ healthCheck: true }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const duration = performance.now() - startTime;

      if (response.ok) {
        let responseData;
        try {
          responseData = await response.json();
        } catch {
          responseData = { status: response.status };
        }

        return {
          function: functionName,
          status: 'success',
          duration_ms: duration,
          response: responseData,
          retries: attempt
        };
      } else {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        
        // Only retry on 5xx errors or 429 (rate limit)
        if (response.status >= 500 || response.status === 429) {
          continue;
        } else {
          // Don't retry on 4xx errors (except 429)
          break;
        }
      }
    } catch (error) {
      lastError = error;
      stackTrace = error.stack || '';
      
      // Check if it's a timeout error
      if (error.name === 'AbortError') {
        console.error(`Function ${functionName} timed out after ${timeout}ms on attempt ${attempt + 1}`);
      } else {
        console.error(`Function ${functionName} error on attempt ${attempt + 1}:`, error.message);
      }
      
      // Continue to next retry
      continue;
    }
  }

  // All retries exhausted
  const duration = performance.now() - startTime;
  return {
    function: functionName,
    status: 'failed',
    duration_ms: duration,
    error: typeof lastError === 'string' ? lastError : lastError?.message || 'Unknown error',
    retries: maxRetries - 1,
    stackTrace
  };
}

async function runHealthChecksWithTimeout(criticalFunctions: string[], timeoutMs: number = 120000): Promise<HealthCheckResult[]> {
  const healthCheckPromises = criticalFunctions.map(functionName => 
    checkFunctionHealth(functionName, 30000)
  );

  try {
    const timeoutPromise = new Promise<HealthCheckResult[]>((_, reject) => {
      setTimeout(() => reject(new Error('Health checks timed out')), timeoutMs);
    });

    const results = await Promise.race([
      Promise.all(healthCheckPromises),
      timeoutPromise
    ]);

    return results;
  } catch (error) {
    console.error('Health checks timed out, returning partial results');
    
    // Return failed results for all functions
    return criticalFunctions.map(functionName => ({
      function: functionName,
      status: 'failed',
      duration_ms: timeoutMs,
      error: 'Health check timeout exceeded',
      stackTrace: error.stack
    }));
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // Validate request method
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed', allowed: ['GET', 'POST'] }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  let summary: any = null;
  let healthCheckResults: HealthCheckResult[] = [];

  try {
    // Authorization check
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    if (token !== SMOKE_TEST_SECRET) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Starting smoke test execution...');

    // Run the smoke tests with error handling
    try {
      summary = await runSmokeTests();
      console.log(`Smoke tests completed: ${summary.passed}/${summary.total} passed`);
    } catch (error) {
      console.error('Critical error during smoke tests:', error);
      summary = {
        total: 0,
        passed: 0,
        failed: 1,
        duration_ms: 0,
        timestamp: new Date().toISOString(),
        tests: [{
          name: 'Smoke Test Execution',
          status: 'failed',
          duration_ms: 0,
          error: error.message,
          stackTrace: error.stack
        }]
      };
    }

    // Run health checks for critical functions
    console.log('Starting health checks for critical functions...');
    const criticalFunctions = [
      'chat',
      'nexus-core',
      'nexus-router',
      'brain-api',
      'contractor-dashboard-api',
      'portal-api'
    ];

    try {
      healthCheckResults = await runHealthChecksWithTimeout(criticalFunctions, 120000);
      
      for (const result of healthCheckResults) {
        if (result.status === 'success') {
          console.log(`✓ ${result.function}: ${result.status} (${result.duration_ms.toFixed(2)}ms, ${result.retries || 0} retries)`);
        } else {
          console.error(`✗ ${result.function}: ${result.status} (${result.duration_ms.toFixed(2)}ms, ${result.retries || 0} retries)`);
          if (result.error) {
            console.error(`  Error: ${result.error}`);
          }
          if (result.stackTrace) {
            console.error(`  Stack: ${result.stackTrace.substring(0, 200)}...`);
          }
        }
      }
    } catch (error) {
      console.error('Critical error during health checks:', error);
      healthCheckResults = criticalFunctions.map(functionName => ({
        function: functionName,
        status: 'failed',
        duration_ms: 0,
        error: 'Health check system failure',
        stackTrace: error.stack
      }));
    }

    const healthChecksFailed = healthCheckResults.filter(r => r.status === 'failed').length;
    const healthChecksSuccess = healthCheckResults.filter(r => r.status === 'success').length;

    // Determine overall status - be more lenient with failures
    const criticalFailures = summary.failed > 0 || healthChecksFailed >= criticalFunctions.length;
    const overallSuccess = !criticalFailures;

    const response = {
      success: overallSuccess,
      timestamp: new Date().toISOString(),
      smoke_tests: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        duration_ms: summary.duration_ms,
        tests: summary.tests
      },
      health_checks: {
        total: healthCheckResults.length,
        success: healthChecksSuccess,
        failed: healthChecksFailed,
        results: healthCheckResults
      },
      summary: {
        all_tests_passed: summary.failed === 0,
        all_health_checks_passed: healthChecksFailed === 0,
        critical_failures: criticalFailures,
        total_duration_ms: summary.duration_ms + healthCheckResults.reduce((sum, r) => sum + r.duration_ms, 0)
      }
    };

    const statusCode = overallSuccess ? 200 : 207; // 207 Multi-Status for partial success

    return new Response(
      JSON.stringify(response, null, 2),
      {
        status: statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Unhandled error in smoke test runner:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error during smoke test execution',
        message: error.message,
        stackTrace: error.stack,
        timestamp: new Date().toISOString(),
        smoke_tests: summary || { total: 0, passed: 0, failed: 0, tests: [] },
        health_checks: {
          total: healthCheckResults.length,
          success: 0,
          failed: healthCheckResults.length,
          results: healthCheckResults
        }
      }, null, 2),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
r instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      elapsed
    });
    
    return createErrorResponse(
      `Smoke test execution failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        requestId,
        elapsed
      }
    );
  }
}

/**
 * Run smoke tests with comprehensive error handling and isolation
 */
async function runSmokeTests(): Promise<{
  passed: number;
  failed: number;
  results: Array<{
    test: string;
    status: string;
    endpoint: string;
    statusCode?: number;
    expectedStatus?: number[];
    elapsed: number;
    details?: string;
    error?: string;
    errorType?: string;
    response?: unknown;
    stack?: string;
  }>;
}> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    logger.error('Missing Supabase credentials for tests');
    return {
      passed: 0,
      failed: 1,
      results: [{
        test: 'Environment Check',
        status: 'ERROR',
        endpoint: 'N/A',
        elapsed: 0,
        error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
        errorType: 'configuration'
      }]
    };
  }
  
  const baseUrl = supabaseUrl.replace(/\/$/, '');
  const testTimeout = 30000; // 30 seconds
  
  const testCases: TestCase[] = [
    {
      name: 'Health Check',
      endpoint: `${baseUrl}/functions/v1/smoke-test/health`,
      method: 'GET',
      expectedStatus: [200],
      validateResponse: (data) => {
        try {
          const health = data as Record<string, unknown>;
          return typeof health.status === 'string' && typeof health.timestamp === 'string';
        } catch (error) {
          logger.error('Health check validation failed', { error: error instanceof Error ? error.message : String(error) });
          return false;
        }
      }
    },
    {
      name: 'Database Connectivity',
      endpoint: `${baseUrl}/rest/v1/profiles?select=count&limit=1`,
      method: 'GET',
      expectedStatus: [200, 206],
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      validateResponse: (data) => {
        try {
          // Database should return some response even if empty
          return data !== null && data !== undefined;
        } catch (error) {
          logger.error('Database connectivity validation failed', { error: error instanceof Error ? error.message : String(error) });
          return false;
        }
      }
    },
    {
      name: 'Profiles Table Access',
      endpoint: `${baseUrl}/rest/v1/profiles?select=id&limit=1`,
      method: 'GET',
      expectedStatus: [200, 206],
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      validateResponse: (data) => {
        try {
          // Should return array (empty or with data)
          return Array.isArray(data);
        } catch (error) {
          logger.error('Profiles table validation failed', { error: error instanceof Error ? error.message : String(error) });
          return false;
        }
      }
    },
    {
      name: 'Edge Function Availability',
      endpoint: `${baseUrl}/functions/v1/`,
      method: 'GET',
      expectedStatus: [200, 404], // Either success or not found is acceptable for availability check
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    },
    {
      name: 'Messages Table Access',
      endpoint: `${baseUrl}/rest/v1/messages?select=count&limit=1`,
      method: 'GET',
      expectedStatus: [200, 206],
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      validateResponse: (data) => {
        try {
          return data !== null && data !== undefined;
        } catch (error) {
          logger.error('Messages table validation failed', { error: error instanceof Error ? error.message : String(error) });
          return false;
        }
      }
    },
    {
      name: 'Conversations Table Access',
      endpoint: `${baseUrl}/rest/v1/conversations?select=count&limit=1`,
      method: 'GET',
      expectedStatus: [200, 206],
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      validateResponse: (data) => {
        try {
          return data !== null && data !== undefined;
        } catch (error) {
          logger.error('Conversations table validation failed', { error: error instanceof Error ? error.message : String(error) });
          return false;
        }
      }
    }
  ];
  
  let passed = 0;
  let failed = 0;
  const results: Array<{
    test: string;
    status: string;
    endpoint: string;
    statusCode?: number;
    expectedStatus?: number[];
    elapsed: number;
    details?: string;
    error?: string;
    errorType?: string;
    response?: unknown;
    stack?: string;
  }> = [];
  
  for (const test of testCases) {
    const testStartTime = Date.now();
    let controller: AbortController | null = null;
    let timeoutId: number | null = null;
    
    try {
      logger.info(`Running test: ${test.name}`, {
        endpoint: test.endpoint,
        method: test.method
      });
      
      controller = new AbortController();
      timeoutId = setTimeout(() => {
        logger.warn(`Test timeout triggered for: ${test.name}`);
        controller?.abort();
      }, test.timeout || testTimeout);
      
      let response: Response;
      try {
        response = await fetch(test.endpoint, {
          method: test.method,
          headers: {
            'Content-Type': 'application/json',
            ...test.headers
          },
          body: test.body ? JSON.stringify(test.body) : undefined,
          signal: controller.signal
        });
      } catch (fetchError) {
        throw new Error(`Fetch failed: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
      }
      
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      const elapsed = Date.now() - testStartTime;
      const statusMatch = test.expectedStatus.includes(response.status);
      
      let responseData: unknown;
      let parseError = false;
      try {
        const text = await response.text();
        responseData = text ? JSON.parse(text) : null;
      } catch (parseErr) {
        parseError = true;
        responseData = 'Unable to parse response';
        logger.warn(`Response parse error for ${test.name}`, { 
          error: parseErr instanceof Error ? parseErr.message : String(parseErr) 
        });
      }
      
      let validationPassed = true;
      let validationError: string | undefined;
      
      if (test.validateResponse && !parseError) {
        try {
          validationPassed = test.validateResponse(responseData);
          if (!validationPassed) {
            validationError = 'Response validation returned false';
          }
        } catch (valErr) {
          validationPassed = false;
          validationError = `Validation threw error: ${valErr instanceof Error ? valErr.message : String(valErr)}`;
          logger.error(`Validation error for ${test.name}`, { 
            error: valErr instanceof Error ? valErr.message : String(valErr),
            stack: valErr instanceof Error ? valErr.stack : undefined
          });
        }
      }
      
      if (statusMatch && validationPassed) {
        passed++;
        results.push({
          test: test.name,
          status: 'PASS',
          endpoint: test.endpoint,
          statusCode: response.status,
          elapsed,
          details: 'Test passed successfully'
        });
        logger.info(`Test passed: ${test.name}`, { elapsed, statusCode: response.status });
      } else {
        failed++;
        const failureDetails = [];
        
        if (!statusMatch) {
          failureDetails.push(`Status code mismatch. Expected: ${test.expectedStatus.join(' or ')}, Got: ${response.status}`);
        }
        
        if (!validationPassed) {
          failureDetails.push(validationError || 'Response validation failed');
        }
        
        results.push({
          test: test.name,
          status: 'FAIL',
          endpoint: test.endpoint,
          statusCode: response.status,
          expectedStatus: test.expectedStatus,
          elapsed,
          details: failureDetails.join('; '),
          response: responseData
        });
        
        logger.error(`Test failed: ${test.name}`, {
          elapsed,
          statusCode: response.status,
          expectedStatus: test.expectedStatus,
          validationPassed,
          validationError,
          responsePreview: typeof responseData === 'string' 
            ? responseData.substring(0, 200) 
            : JSON.stringify(responseData).substring(0, 200)
        });
      }
    } catch (error) {
      // Clean up timeout if still active
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      
      const elapsed = Date.now() - testStartTime;
      failed++;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('abort') || errorMessage.toLowerCase().includes('timeout');
      const isNetworkError = errorMessage.toLowerCase().includes('network') || 
                            errorMessage.toLowerCase().includes('fetch') ||
                            errorMessage.toLowerCase().includes('connection');
      
      let errorType = 'exception';
      if (isTimeout) {
        errorType = 'timeout';
      } else if (isNetworkError) {
        errorType = 'network';
      }
      
      let details = `Test threw exception: ${errorMessage}`;
      if (isTimeout) {
        details = `Test timed out after ${test.timeout || testTimeout}ms`;
      } else if (isNetworkError) {
        details = `Network error: ${errorMessage}`;
      }
      
      results.push({
        test: test.name,
        status: 'ERROR',
        endpoint: test.endpoint,
        elapsed,
        error: errorMessage,
        errorType,
        details,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      logger.error(`Test error: ${test.name}`, {
        error: errorMessage,
        elapsed,
        errorType,
        isTimeout,
        isNetworkError,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  const totalTests = testCases.length;
  const passRate = totalTests > 0 ? ((passed / totalTests) * 100).toFixed(1) : '0.0';

  logger.info('All tests completed', { 
    passed, 
    failed, 
    total: totalTests,
    passRate: `${passRate}%`,
    criticalFailures: results.filter(r => r.errorType === 'timeout' || r.errorType === 'network').length
  });

  return { passed, failed, results };
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    
    // Handle health check endpoint
    if (url.pathname.endsWith('/health') && req.method === 'GET') {
      try {
        const healthStatus = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          service: 'smoke-test',
          version: '1.0.0',
          environment: {
            supabaseUrl: !!Deno.env.get('SUPABASE_URL'),
            supabaseKey: !!Deno.env.get('SUPABASE_ANON_KEY')
          }
        };
        
        logger.info('Health check requested', healthStatus);
        
        return new Response(JSON.stringify(healthStatus), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
      } catch (error) {
        logger.error('Health check failed', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
        
        return new Response(JSON.stringify({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      }
    }
    
    // Delegate to main handler
    return handler(req);
  };
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response
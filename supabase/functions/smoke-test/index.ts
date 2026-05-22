failed: ${healthError instanceof Error ? healthError.message : String(healthError)}`,
          500,
          { error: healthError }
        );
      }
    }

    // Default to health check for root path
    logger.info('Default health check execution');
    
    try {
      const healthStatus = await runHealthChecks();
      
      // Validate health status structure
      if (!validateHealthResponse(healthStatus)) {
        logger.error('Invalid health status structure returned');
        return createErrorResponse('Invalid health check response structure', 500);
      }
      
      const statusCode = healthStatus.status === 'healthy' ? 200 :
                        healthStatus.status === 'degraded' ? 200 : 503;

      const elapsed = Date.now() - startTime;
      logger.info('Health check completed', { 
        status: healthStatus.status, 
        statusCode,
        elapsed,
        summary: healthStatus.summary
      });

      return createSuccessResponse(healthStatus, statusCode);
    } catch (healthError) {
      logger.error('Health check execution error', {
        error: healthError instanceof Error ? healthError.message : String(healthError),
        stack: healthError instanceof Error ? healthError.stack : undefined,
        elapsed: Date.now() - startTime
      });
      
      return createErrorResponse(
        `Health check failed: ${healthError instanceof Error ? healthError.message : String(healthError)}`,
        500,
        { error: healthError }
      );
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('Smoke test execution failed with unhandled error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      elapsed,
      url: req.url,
      method: req.method
    });
    
    return createErrorResponse(
      `Smoke test execution failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
      { error }
    );
  }
}

/**
 * Enhanced test runner with better error handling and timeout support
 */
async function runEndpointTests(): Promise<{ passed: number; failed: number; results: any[] }> {
  const testTimeout = 30000; // 30 second timeout per test
  let passed = 0;
  let failed = 0;
  const results: any[] = [];

  const testCases = [
    {
      name: 'health-monitor endpoint',
      endpoint: '/health-monitor',
      method: 'GET',
      expectedStatus: [200, 503],
      requiresAuth: false,
      validateResponse: (data: any) => {
        return data && typeof data.status === 'string' && 
               (data.status === 'healthy' || data.status === 'degraded' || data.status === 'unhealthy');
      }
    },
    {
      name: 'get-public-config endpoint',
      endpoint: '/get-public-config',
      method: 'GET',
      expectedStatus: [200],
      requiresAuth: false,
      validateResponse: (data: any) => {
        return data && typeof data === 'object' && data.nexusVersion !== undefined;
      }
    },
    {
      name: 'nexus-core health',
      endpoint: '/nexus-core/health',
      method: 'GET',
      expectedStatus: [200],
      requiresAuth: false,
      validateResponse: (data: any) => {
        return data && (data.status === 'healthy' || data.status === 'degraded' || data.status === 'unhealthy');
      }
    },
    {
      name: 'brain-api health',
      endpoint: '/brain-api/health',
      method: 'GET',
      expectedStatus: [200, 503],
      requiresAuth: false,
      validateResponse: (data: any) => {
        return data && typeof data.status === 'string';
      }
    },
    {
      name: 'nexus-core authenticated endpoint',
      endpoint: '/nexus-core',
      method: 'POST',
      expectedStatus: [200, 400, 401],
      requiresAuth: true,
      body: { action: 'test' },
      validateResponse: (data: any, status: number) => {
        // Accept 401 as valid for auth-required endpoints
        if (status === 401) return true;
        // Accept 400 for malformed requests
        if (status === 400) return true;
        return data !== null;
      }
    }
  ];

  const baseUrl = Deno.env.get('SUPABASE_URL') || 'http://localhost:54321';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  for (const test of testCases) {
    const testStartTime = Date.now();
    logger.info(`Running test: ${test.name}`, { endpoint: test.endpoint });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), testTimeout);

      const headers: HeadersInit = {
        'Content-Type': 'application/json'
      };

      if (test.requiresAuth && serviceRoleKey) {
        headers['Authorization'] = `Bearer ${serviceRoleKey}`;
      }

      const requestOptions: RequestInit = {
        method: test.method,
        headers,
        signal: controller.signal
      };

      if (test.body) {
        requestOptions.body = JSON.stringify(test.body);
      }

      const response = await fetch(`${baseUrl}/functions/v1${test.endpoint}`, requestOptions);
      clearTimeout(timeoutId);

      const elapsed = Date.now() - testStartTime;
      const responseText = await response.text();
      let responseData;

      try {
        responseData = responseText ? JSON.parse(responseText) : null;
      } catch {
        responseData = responseText;
      }

      const statusMatch = test.expectedStatus.includes(response.status);
      const validationPassed = test.validateResponse(responseData, response.status);

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
        results.push({
          test: test.name,
          status: 'FAIL',
          endpoint: test.endpoint,
          statusCode: response.status,
          expectedStatus: test.expectedStatus,
          elapsed,
          details: !statusMatch 
            ? `Status code mismatch. Expected: ${test.expectedStatus.join(' or ')}, Got: ${response.status}`
            : 'Response validation failed',
          response: responseData
        });
        logger.error(`Test failed: ${test.name}`, {
          elapsed,
          statusCode: response.status,
          expectedStatus: test.expectedStatus,
          validationPassed,
          responsePreview: typeof responseData === 'string' ? responseData.substring(0, 200) : JSON.stringify(responseData).substring(0, 200)
        });
      }
    } catch (error) {
      const elapsed = Date.now() - testStartTime;
      failed++;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('abort');
      
      results.push({
        test: test.name,
        status: 'ERROR',
        endpoint: test.endpoint,
        elapsed,
        error: errorMessage,
        errorType: isTimeout ? 'timeout' : 'exception',
        details: isTimeout 
          ? `Test timed out after ${testTimeout}ms`
          : `Test threw exception: ${errorMessage}`,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      logger.error(`Test error: ${test.name}`, {
        error: errorMessage,
        elapsed,
        isTimeout,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  logger.info('All tests completed', { 
    passed, 
    failed, 
    total: testCases.length,
    passRate: `${((passed / testCases.length) * 100).toFixed(1)}%`
  });

  return { passed, failed, results };
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    
    logger.info('Request received', {
      requestId,
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString()
    });

    try {
      const url = new URL(req.url);
      
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        logger.info('Handling CORS preflight in wrapper', { requestId });
        const headers = new Headers();
        addCorsHeaders(headers);
        return new Response(null, { status: 204, headers });
      }
      
      // Validate environment before processing
      const envValidation = validateEnvironment();
      if (!envValidation.valid) {
        logger.error('Environment validation failed in wrapper', {
          requestId,
          missing: envValidation.missing
        });
        return createErrorResponse(
          `Missing required environment variables: ${envValidation.missing.join(', ')}`,
          500,
          { missing: envValidation.missing, requestId }
        );
      }
      
      if (url.pathname === '/health' || url.pathname.endsWith('/health')) {
        logger.info('Health check endpoint hit in wrapper', { requestId });
        
        try {
          const healthStatus = await runHealthChecks();
          
          // Validate response structure
          if (!validateHealthResponse(healthStatus)) {
            logger.error('Invalid health status structure in wrapper', { requestId });
            return createErrorResponse('Invalid health check response structure', 500);
          }
          
          const statusCode = healthStatus.status === 'healthy' ? 200 :
                            healthStatus.status === 'degraded' ? 200 : 503;

          const elapsed = Date.now() - startTime;
          logger.info('Health check completed in wrapper', {
            requestId,
            status: healthStatus.status,
            statusCode,
            elapsed,
            summary: healthStatus.summary
          });

          return createSuccessResponse(healthStatus, statusCode);
        } catch (healthError) {
          const elapsed = Date.now() - startTime;
          logger.error('Health check failed in wrapper', {
            requestId,
            error: healthError instanceof Error ? healthError.message : String(healthError),
            stack: healthError instanceof Error ? healthError.stack : undefined,
            elapsed
          });
          
          return createErrorResponse(
            `Health check failed: ${healthError instanceof Error ? healthError.message : String(healthError)}`,
            500,
            { error: healthError, requestId }
          );
        }
      }
      
      logger.info('Delegating to main handler', { requestId });
      const response = await handler(req);
      
      const elapsed = Date.now() - startTime;
      logger.info('Request completed', {
        requestId,
        status: response.status,
        elapsed
      });
      
      return response;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logger.error('Request handling failed in wrapper', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        elapsed,
        url: req.url,
        method: req.method
      });
      
      return createErrorResponse(
        `Request handling failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
        { error, requestId }
      );
    }
  };
}

logger.info('Smoke test function initialized', {
  timestamp: new Date().toISOString(),
  denoVersion: Deno.version.deno,
  v8Version: Deno.version.v8
});

Deno.serve(serveWithHealthCheck(handler));
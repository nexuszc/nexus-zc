// Send alert notification for critical failures
async function sendFailureAlert(
  smokeTestResults: SmokeSummary,
  healthCheckResults: HealthCheckResult[]
) {
  if (!ENABLE_NOTIFICATIONS || !SLACK_WEBHOOK_URL) {
    logger.log('info', 'Notifications disabled or webhook not configured');
    return;
  }

  try {
    const failedTests = smokeTestResults.tests.filter(t => t.status === 'failed');
    const failedHealthChecks = healthCheckResults.filter(h => h.status === 'failed');

    const message = {
      text: '🚨 Smoke Test Failure Alert',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Smoke Test Failure Detected'
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Failed Tests:* ${failedTests.length}/${smokeTestResults.total}`
            },
            {
              type: 'mrkdwn',
              text: `*Failed Health Checks:* ${failedHealthChecks.length}/${healthCheckResults.length}`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Timestamp:* ${new Date().toISOString()}`
          }
        }
      ]
    };

    if (failedTests.length > 0) {
      message.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Failed Tests:*\n${failedTests.map(t => `• ${t.name}: ${t.error}`).join('\n')}`
        }
      });
    }

    if (failedHealthChecks.length > 0) {
      message.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Failed Health Checks:*\n${failedHealthChecks.map(h => `• ${h.function}: ${h.error}`).join('\n')}`
        }
      });
    }

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}`);
    }

    logger.log('info', 'Failure alert sent successfully');
  } catch (error) {
    logger.log('error', 'Failed to send failure alert', { error: error.message });
  }
}

// Health checks with timeout and retry logic
async function runHealthChecksWithTimeout(
  functionNames: string[],
  timeoutMs: number = 120000
): Promise<HealthCheckResult[]> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Health check timeout exceeded')), timeoutMs);
  });

  try {
    const healthCheckPromises = functionNames.map(name => checkFunctionHealth(name));
    
    const results = await Promise.race([
      Promise.all(healthCheckPromises),
      timeoutPromise
    ]);

    return results;
  } catch (error) {
    logger.log('error', 'Health check timeout or error', { error: error.message });
    
    // Return failed results for all functions
    return functionNames.map(functionName => ({
      function: functionName,
      status: 'failed',
      duration_ms: timeoutMs,
      error: 'Health check timeout exceeded',
      stackTrace: error.stack,
      timestamp: new Date().toISOString()
    }));
  }
}

// Retry logic for failed smoke tests
async function runSmokeTestsWithRetry(maxRetries: number = 2): Promise<SmokeSummary> {
  let lastResult: SmokeSummary | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      logger.log('info', `Retrying smoke tests (attempt ${attempt + 1}/${maxRetries + 1})`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
    }
    
    try {
      lastResult = await runSmokeTests();
      
      if (lastResult.failed === 0) {
        logger.log('info', 'All smoke tests passed', { attempt: attempt + 1 });
        return lastResult;
      }
      
      logger.log('warn', `Smoke tests failed on attempt ${attempt + 1}`, {
        failed: lastResult.failed,
        total: lastResult.total
      });
    } catch (error) {
      logger.log('error', `Smoke test attempt ${attempt + 1} threw error`, {
        error: error.message,
        stack: error.stack
      });
      
      if (!lastResult) {
        lastResult = {
          total: 0,
          passed: 0,
          failed: 1,
          duration_ms: 0,
          tests: [{
            name: 'smoke-test-execution',
            status: 'failed',
            duration_ms: 0,
            error: error.message,
            stackTrace: error.stack,
            timestamp: new Date().toISOString()
          }]
        };
      }
    }
  }
  
  return lastResult!;
}

// Improved error response parsing
function parseErrorResponse(error: any): { message: string; details?: any; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      details: error.cause
    };
  }
  
  if (typeof error === 'string') {
    return { message: error };
  }
  
  if (error && typeof error === 'object') {
    return {
      message: error.message || error.error || 'Unknown error',
      details: error.details || error.data,
      stack: error.stack
    };
  }
  
  return { message: 'Unknown error occurred' };
}

// Timeout wrapper for individual function calls
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

// Health check endpoint handler
async function handleHealthCheck(req: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  
  try {
    return new Response(
      JSON.stringify({
        status: 'healthy',
        service: 'smoke-test-runner',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    return new Response(
      JSON.stringify({
        status: 'unhealthy',
        service: 'smoke-test-runner',
        error: errorInfo.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

// Main handler with health check support
async function handleRequest(req: Request): Promise<Response> {
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

  // Check for health check endpoint
  const url = new URL(req.url);
  if (url.pathname.endsWith('/health') || url.searchParams.get('health') === 'true') {
    return handleHealthCheck(req);
  }

  // Validate request method
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed', allowed_methods: ['GET', 'POST'] }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    logger.log('info', 'Starting smoke test runner');

    // Parse request body for configuration
    let config: any = {};
    if (req.method === 'POST') {
      try {
        const text = await withTimeout(req.text(), 5000, 'Request body read timeout');
        config = text ? JSON.parse(text) : {};
      } catch (parseError) {
        logger.log('warn', 'Failed to parse request body, using defaults', {
          error: parseError.message
        });
        config = {};
      }
    }

    const functionsToCheck = config.functions || [
      'chat',
      'memory-manager',
      'search-query',
      'smoke-test'
    ];

    const maxRetries = config.maxRetries || 2;
    const healthCheckTimeout = config.healthCheckTimeout || 120000;

    // Run smoke tests with retry logic
    logger.log('info', 'Running smoke tests with retry logic', { maxRetries });
    const smokeTestResults = await withTimeout(
      runSmokeTestsWithRetry(maxRetries),
      180000,
      'Smoke test execution timeout'
    );
    logger.log('info', 'Smoke tests completed', {
      total: smokeTestResults.total,
      passed: smokeTestResults.passed,
      failed: smokeTestResults.failed
    });

    // Run health checks
    logger.log('info', 'Running health checks', { functions: functionsToCheck });
    const healthCheckResults = await runHealthChecksWithTimeout(
      functionsToCheck,
      healthCheckTimeout
    );
    logger.log('info', 'Health checks completed', {
      total: healthCheckResults.length,
      passed: healthCheckResults.filter(h => h.status === 'passed').length,
      failed: healthCheckResults.filter(h => h.status === 'failed').length
    });

    // Determine overall success
    const overallSuccess = 
      smokeTestResults.failed === 0 && 
      healthCheckResults.every(h => h.status === 'passed');

    // Persist results
    await persistTestResults(smokeTestResults, healthCheckResults, overallSuccess);

    // Send alerts if there are failures
    if (!overallSuccess) {
      await sendFailureAlert(smokeTestResults, healthCheckResults);
    }

    // Return results
    return new Response(
      JSON.stringify({
        success: overallSuccess,
        timestamp: new Date().toISOString(),
        smoke_tests: smokeTestResults,
        health_checks: healthCheckResults,
        logs: logger.getLogs()
      }),
      {
        status: overallSuccess ? 200 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    logger.log('error', 'Smoke test runner failed', errorInfo);

    return new Response(
      JSON.stringify({
        success: false,
        error: errorInfo.message,
        details: errorInfo.details,
        stack: errorInfo.stack,
        timestamp: new Date().toISOString(),
        logs: logger.getLogs()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

// Serve with health check wrapper
Deno.serve(async (req: Request) => {
  try {
    return await handleRequest(req);
  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    logger.log('error', 'Unhandled error in serve wrapper', errorInfo);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: errorInfo.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
});
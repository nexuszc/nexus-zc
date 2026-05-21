ing credentials');
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase.from('system_logs').insert({
      event_type: 'smoke_test_run',
      severity: overallSuccess ? 'info' : 'error',
      message: `Smoke test run ${overallSuccess ? 'passed' : 'failed'}`,
      metadata: {
        smoke_tests: smokeTestResults,
        health_checks: healthCheckResults,
        timestamp: new Date().toISOString()
      }
    });

    if (error) {
      logger.log('error', 'Failed to persist test results', parseErrorResponse(error));
    } else {
      logger.log('info', 'Test results persisted successfully');
    }
  } catch (error) {
    logger.log('error', 'Exception persisting test results', parseErrorResponse(error));
  }
}

// Send failure alerts
async function sendFailureAlert(
  smokeTestResults: any,
  healthCheckResults: any[]
): Promise<void> {
  try {
    logger.log('warn', 'Sending failure alert', {
      smoke_tests: smokeTestResults,
      health_checks: healthCheckResults
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      logger.log('warn', 'Cannot send alert: missing credentials');
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from('system_logs').insert({
      event_type: 'smoke_test_alert',
      severity: 'error',
      message: 'Smoke test failures detected',
      metadata: {
        failed_smoke_tests: smokeTestResults.failed,
        failed_health_checks: healthCheckResults.filter(h => h.status === 'failed').length,
        details: {
          smoke_tests: smokeTestResults,
          health_checks: healthCheckResults
        }
      }
    });

    logger.log('info', 'Failure alert sent');
  } catch (error) {
    logger.log('error', 'Failed to send alert', parseErrorResponse(error));
  }
}

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

// Check smoke-test health endpoint before running full suite
async function checkSmokeTestHealth(): Promise<{ healthy: boolean; error?: string; details?: any }> {
  try {
    logger.log('info', 'Checking smoke-test health endpoint');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        healthy: false,
        error: 'Missing Supabase credentials for health check'
      };
    }

    const healthUrl = `${supabaseUrl}/functions/v1/smoke-test?health=true`;
    
    const response = await withTimeout(
      fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      }),
      10000,
      'Health check timeout after 10s'
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.log('warn', 'Smoke-test health check failed', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      
      return {
        healthy: false,
        error: `Health check returned ${response.status}: ${response.statusText}`,
        details: { status: response.status, body: errorText }
      };
    }

    const healthData = await response.json();
    logger.log('info', 'Smoke-test health check passed', healthData);
    
    return {
      healthy: true,
      details: healthData
    };
  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    logger.log('error', 'Smoke-test health check exception', {
      message: errorInfo.message,
      stack: errorInfo.stack,
      details: errorInfo.details
    });
    
    return {
      healthy: false,
      error: errorInfo.message,
      details: errorInfo
    };
  }
}

// Parse standardized error response format from wrapper
function parseStandardizedError(error: any): { message: string; stack?: string; details?: any; isTimeout?: boolean } {
  if (error?.error) {
    // New standardized format from Deno.serve() wrapper
    return {
      message: error.error,
      stack: error.stack,
      details: error.details || {},
      isTimeout: error.error?.includes('timeout') || error.error?.includes('timed out')
    };
  }
  
  // Fallback to existing error parsing
  const errorInfo = parseErrorResponse(error);
  return {
    message: errorInfo.message,
    stack: errorInfo.stack,
    details: errorInfo.details,
    isTimeout: errorInfo.message?.toLowerCase().includes('timeout')
  };
}

// Enhanced smoke test runner with health check and better error handling
async function runSmokeTestWithTimeout(): Promise<any> {
  try {
    logger.log('info', 'Starting smoke test with health check');
    
    // First check health endpoint
    const healthCheck = await checkSmokeTestHealth();
    if (!healthCheck.healthy) {
      logger.log('error', 'Smoke-test health check failed, aborting test run', {
        error: healthCheck.error,
        details: healthCheck.details
      });
      
      return {
        success: false,
        error: 'Health check failed',
        healthCheck: healthCheck,
        tests: []
      };
    }

    logger.log('info', 'Health check passed, proceeding with smoke tests');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    const smokeTestUrl = `${supabaseUrl}/functions/v1/smoke-test`;
    
    logger.log('info', 'Invoking smoke-test function with 35s timeout');
    
    const response = await withTimeout(
      fetch(smokeTestUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ runAll: true })
      }),
      35000,
      'Smoke test execution timeout after 35s'
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      
      const parsedError = parseStandardizedError(errorData);
      
      logger.log('error', 'Smoke test returned error response', {
        status: response.status,
        statusText: response.statusText,
        message: parsedError.message,
        stack: parsedError.stack,
        details: parsedError.details,
        isTimeout: parsedError.isTimeout
      });
      
      return {
        success: false,
        error: parsedError.message,
        stack: parsedError.stack,
        details: parsedError.details,
        isTimeout: parsedError.isTimeout,
        status: response.status,
        tests: []
      };
    }

    const result = await response.json();
    logger.log('info', 'Smoke test completed successfully', {
      testsRun: result.tests?.length || 0
    });
    
    return {
      success: true,
      ...result
    };
  } catch (error) {
    const errorInfo = parseStandardizedError(error);
    
    logger.log('error', 'Smoke test execution failed with exception', {
      message: errorInfo.message,
      stack: errorInfo.stack,
      details: errorInfo.details,
      isTimeout: errorInfo.isTimeout
    });
    
    return {
      success: false,
      error: errorInfo.message,
      stack: errorInfo.stack,
      details: errorInfo.details,
      isTimeout: errorInfo.isTimeout,
      tests: []
    };
  }
}

// Generate structured failure report
function generateFailureReport(smokeTestResult: any, healthCheckResults: any[]): any {
  const failedTests = smokeTestResult.tests?.filter((t: any) => t.status === 'failed') || [];
  const failedHealthChecks = healthCheckResults.filter(h => h.status === 'failed');
  
  return {
    summary: {
      timestamp: new Date().toISOString(),
      smokeTestSuccess: smokeTestResult.success,
      totalTests: smokeTestResult.tests?.length || 0,
      failedTests: failedTests.length,
      failedHealthChecks: failedHealthChecks.length,
      hadTimeout: smokeTestResult.isTimeout || false
    },
    smokeTest: {
      success: smokeTestResult.success,
      error: smokeTestResult.error,
      stack: smokeTestResult.stack,
      details: smokeTestResult.details,
      isTimeout: smokeTestResult.isTimeout,
      healthCheck: smokeTestResult.healthCheck,
      failedTests: failedTests.map((test: any) => ({
        name: test.name,
        error: test.error,
        stack: test.stack,
        duration: test.duration
      }))
    },
    healthChecks: {
      total: healthCheckResults.length,
      failed: failedHealthChecks.length,
      failures: failedHealthChecks.map(check => ({
        function: check.function,
        error: check.error,
        status: check.status,
        duration: check.duration
      }))
    },
    diagnostics: {
      supabaseUrlConfigured: !!Deno.env.get('SUPABASE_URL'),
      supabaseKeyConfigured: !!Deno.env.get('SUPABASE_ANON_KEY'),
      serviceRoleKeyConfigured: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    }
  };
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

    // Run enhanced smoke tests with health check
    logger.log('info', 'Running enhanced smoke tests with health check and timeout handling');
    const smokeTestResult = await runSmokeTestWithTimeout();
    
    const smokeTestResults = {
      total: smokeTestResult.tests?.length || 0,
      passed: smokeTestResult.tests?.filter((t: any) => t.status === 'passed').length || 0,
      failed: smokeTestResult.tests?.filter((t: any) => t.status === 'failed').length || 0,
      success: smokeTestResult.success,
      error: smokeTestResult.error,
      stack: smokeTestResult.stack,
      details: smokeTestResult.details,
      isTimeout: smokeTestResult.isTimeout,
      healthCheck: smokeTestResult.healthCheck,
      tests: smokeTestResult.tests || []
    };
    
    logger.log('info', 'Smoke tests completed', {
      total: smokeTestResults.total,
      passed: smokeTestResults.passed,
      failed: smokeTestResults.failed,
      success: smokeTestResults.success,
      hadError: !!smokeTestResults.error,
      isTimeout: smokeTestResults.isTimeout
    });

    // Run health
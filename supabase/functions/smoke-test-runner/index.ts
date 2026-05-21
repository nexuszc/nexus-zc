import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { Logger } from '../_shared/logger.ts'
import { parseErrorResponse, parseStandardizedError, withTimeout, createTimeoutError } from '../_shared/error-utils.ts'

const logger = new Logger('smoke-test-runner');

// Timeout configurations
const SMOKE_TEST_TIMEOUT = 180000; // 3 minutes for smoke test execution
const HEALTH_CHECK_TIMEOUT = 30000; // 30 seconds per health check
const FUNCTION_INVOKE_TIMEOUT = 120000; // 2 minutes per function invocation

// Run smoke test with timeout protection
async function runSmokeTestWithTimeout(): Promise<any> {
  try {
    logger.log('info', 'Invoking smoke-test function with timeout protection');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const invokePromise = supabase.functions.invoke('smoke-test', {
      body: { 
        runTests: true,
        includeHealthCheck: true,
        timeout: SMOKE_TEST_TIMEOUT - 10000 // Leave buffer for outer timeout
      }
    });

    const result = await withTimeout(
      invokePromise,
      SMOKE_TEST_TIMEOUT,
      'Smoke test execution timeout'
    );

    if (result.error) {
      logger.log('error', 'Smoke test invocation returned error', {
        error: result.error
      });
      throw new Error(`Smoke test failed: ${result.error.message || JSON.stringify(result.error)}`);
    }

    logger.log('info', 'Smoke test completed successfully', {
      hasData: !!result.data,
      dataKeys: result.data ? Object.keys(result.data) : []
    });

    return {
      success: true,
      ...result.data
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

    // Run health checks on other functions
    logger.log('info', 'Running health checks on functions', { functions: functionsToCheck });
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required Supabase configuration for health checks');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const healthCheckResults = [];

    for (const functionName of functionsToCheck) {
      const startTime = Date.now();
      try {
        logger.log('info', `Health checking function: ${functionName}`);
        
        const invokePromise = supabase.functions.invoke(functionName, {
          body: { health: true }
        });

        const result = await withTimeout(
          invokePromise,
          HEALTH_CHECK_TIMEOUT,
          `Health check timeout for ${functionName}`
        );

        const duration = Date.now() - startTime;

        if (result.error) {
          logger.log('warn', `Health check failed for ${functionName}`, {
            error: result.error,
            duration
          });
          healthCheckResults.push({
            function: functionName,
            status: 'failed',
            error: result.error.message || JSON.stringify(result.error),
            duration
          });
        } else {
          logger.log('info', `Health check passed for ${functionName}`, { duration });
          healthCheckResults.push({
            function: functionName,
            status: 'passed',
            duration,
            response: result.data
          });
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorInfo = parseStandardizedError(error);
        logger.log('error', `Health check exception for ${functionName}`, {
          error: errorInfo.message,
          isTimeout: errorInfo.isTimeout,
          duration
        });
        healthCheckResults.push({
          function: functionName,
          status: 'failed',
          error: errorInfo.message,
          isTimeout: errorInfo.isTimeout,
          duration
        });
      }
    }

    // Aggregate results
    const overallSuccess = smokeTestResults.success && 
                          healthCheckResults.every(h => h.status === 'passed');

    const responseData = {
      success: overallSuccess,
      timestamp: new Date().toISOString(),
      smokeTests: smokeTestResults,
      healthChecks: {
        total: healthCheckResults.length,
        passed: healthCheckResults.filter(h => h.status === 'passed').length,
        failed: healthCheckResults.filter(h => h.status === 'failed').length,
        results: healthCheckResults
      }
    };

    // Add failure report if there were any failures
    if (!overallSuccess) {
      responseData['failureReport'] = generateFailureReport(smokeTestResult, healthCheckResults);
    }

    logger.log('info', 'Smoke test runner completed', {
      overallSuccess,
      smokeTestSuccess: smokeTestResults.success,
      healthChecksPassed: healthCheckResults.filter(h => h.status === 'passed').length,
      healthChecksFailed: healthCheckResults.filter(h => h.status === 'failed').length
    });

    // Return appropriate status code based on results
    const statusCode = overallSuccess ? 200 : 500;

    return new Response(
      JSON.stringify(responseData),
      {
        status: statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    logger.log('error', 'Smoke test runner failed with exception', {
      message: errorInfo.message,
      stack: errorInfo.stack,
      details: errorInfo.details
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: errorInfo.message,
        stack: errorInfo.stack,
        details: errorInfo.details,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

// Deno.serve handler wrapper
Deno.serve(async (req: Request) => {
  return await handleRequest(req);
});
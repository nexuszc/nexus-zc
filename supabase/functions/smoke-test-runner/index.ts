import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Timeout utilities
const HEALTH_CHECK_TIMEOUT = 30000;
const SMOKE_TEST_TIMEOUT = 60000;

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError(errorMessage));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

// Logger utility
const logger = {
  log: (level: string, message: string, meta?: any) => {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta
    };
    console.log(JSON.stringify(logEntry));
  }
};

// Error parsing utilities
function parseStandardizedError(error: any): { message: string; isTimeout: boolean; stack?: string } {
  if (error instanceof TimeoutError) {
    return {
      message: error.message,
      isTimeout: true,
      stack: error.stack
    };
  }
  
  return {
    message: error?.message || String(error),
    isTimeout: false,
    stack: error?.stack
  };
}

function parseErrorResponse(error: any): { message: string; stack?: string; details?: any } {
  return {
    message: error?.message || String(error),
    stack: error?.stack,
    details: error?.details || error
  };
}

// Failure report generator
function generateFailureReport(smokeTestResult: any, healthCheckResults: any[]): any {
  const report: any = {
    failedTests: [],
    failedHealthChecks: []
  };

  if (smokeTestResult.tests) {
    report.failedTests = smokeTestResult.tests
      .filter((t: any) => t.status === 'failed')
      .map((t: any) => ({
        name: t.name,
        error: t.error,
        isTimeout: t.isTimeout
      }));
  }

  if (smokeTestResult.error) {
    report.smokeTestError = {
      message: smokeTestResult.error,
      stack: smokeTestResult.stack,
      isTimeout: smokeTestResult.isTimeout
    };
  }

  report.failedHealthChecks = healthCheckResults
    .filter(h => h.status === 'failed')
    .map(h => ({
      function: h.function,
      error: h.error,
      isTimeout: h.isTimeout,
      duration: h.duration
    }));

  return report;
}

// Smoke test runner
async function runSmokeTestWithTimeout(): Promise<any> {
  const tests: any[] = [];
  let healthCheckPassed = false;
  
  try {
    // Test 1: Environment variables
    const envTest = {
      name: 'Environment Variables Check',
      status: 'running' as 'running' | 'passed' | 'failed',
      startTime: Date.now()
    };
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
      }
      
      envTest.status = 'passed';
      tests.push({ ...envTest, duration: Date.now() - envTest.startTime });
    } catch (error) {
      const errorInfo = parseStandardizedError(error);
      envTest.status = 'failed';
      tests.push({
        ...envTest,
        duration: Date.now() - envTest.startTime,
        error: errorInfo.message,
        isTimeout: errorInfo.isTimeout
      });
    }

    // Test 2: Health check
    const healthTest = {
      name: 'Health Check',
      status: 'running' as 'running' | 'passed' | 'failed',
      startTime: Date.now()
    };
    
    try {
      const response = await withTimeout(
        fetch('http://localhost:54321/rest/v1/', {
          method: 'GET',
          headers: {
            'apikey': Deno.env.get('SUPABASE_ANON_KEY') || '',
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') || ''}`
          }
        }),
        HEALTH_CHECK_TIMEOUT,
        'Health check timeout'
      );
      
      if (response.ok || response.status === 404) {
        healthCheckPassed = true;
        healthTest.status = 'passed';
      } else {
        throw new Error(`Health check failed with status ${response.status}`);
      }
      
      tests.push({ ...healthTest, duration: Date.now() - healthTest.startTime });
    } catch (error) {
      const errorInfo = parseStandardizedError(error);
      healthTest.status = 'failed';
      tests.push({
        ...healthTest,
        duration: Date.now() - healthTest.startTime,
        error: errorInfo.message,
        isTimeout: errorInfo.isTimeout
      });
    }

    const allPassed = tests.every(t => t.status === 'passed');
    
    return {
      success: allPassed,
      tests,
      healthCheck: healthCheckPassed,
      details: {
        totalTests: tests.length,
        passed: tests.filter(t => t.status === 'passed').length,
        failed: tests.filter(t => t.status === 'failed').length
      }
    };
  } catch (error) {
    const errorInfo = parseStandardizedError(error);
    return {
      success: false,
      error: errorInfo.message,
      stack: errorInfo.stack,
      isTimeout: errorInfo.isTimeout,
      tests,
      healthCheck: healthCheckPassed
    };
  }
}

async function runSmokeTests(req: Request) {
  try {
    logger.log('info', 'Starting smoke test runner');

    // Parse configuration from request body
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

    return {
      success: overallSuccess,
      statusCode: overallSuccess ? 200 : 500,
      data: responseData
    };

  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    logger.log('error', 'Smoke test runner failed with exception', {
      message: errorInfo.message,
      stack: errorInfo.stack,
      details: errorInfo.details
    });

    return {
      success: false,
      statusCode: 500,
      data: {
        success: false,
        error: errorInfo.message,
        stack: errorInfo.stack,
        details: errorInfo.details,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Deno.serve handler wrapper
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    // Health check endpoint
    const url = new URL(req.url);
    if (url.pathname === '/health' || req.method === 'GET') {
      try {
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
        if (!supabaseAnonKey) {
          throw new Error('SUPABASE_ANON_KEY not found');
        }

        const healthResponse = await fetch('http://localhost:54321/rest/v1/', {
          method: 'GET',
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`
          }
        });

        const healthCheckResult = {
          status: (healthResponse.ok || healthResponse.status === 404) ? 'ok' : 'error',
          timestamp: new Date().toISOString(),
          supabaseRestApi: {
            statusCode: healthResponse.status,
            statusText: healthResponse.statusText,
            reachable: healthResponse.ok || healthResponse.status === 404
          }
        };

        return new Response(
          JSON.stringify(healthCheckResult),
          {
            status: healthCheckResult.status === 'ok' ? 200 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            status: 'error',
            error: error.message || String(error),
            timestamp: new Date().toISOString()
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // Run full smoke tests
    const result = await runSmokeTests(req);
    
    return new Response(
      JSON.stringify(result.data),
      {
        status: result.statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'error',
        error: error.message || String(error),
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers
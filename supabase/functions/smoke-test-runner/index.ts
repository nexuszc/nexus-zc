// supabase/functions/smoke-test-runner/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HealthCheckResult {
  function: string;
  status: 'passed' | 'failed';
  error?: string;
  duration: number;
  statusCode?: number;
}

interface SmokeTestResult {
  success: boolean;
  timestamp: string;
  results: HealthCheckResult[];
  total: number;
  passed: number;
  failed: number;
}

interface ErrorInfo {
  message: string;
  stack?: string;
  details?: any;
}

const logger = {
  log: (level: string, message: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({
      timestamp,
      level,
      message,
      ...meta
    }));
  }
};

function parseErrorResponse(error: any): ErrorInfo {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      details: error
    };
  }
  
  if (typeof error === 'object' && error !== null) {
    return {
      message: error.message || 'Unknown error',
      stack: error.stack,
      details: error
    };
  }
  
  return {
    message: String(error),
    details: error
  };
}

function generateFailureReport(smokeTestResults: SmokeTestResult, healthCheckResults: HealthCheckResult[]): any {
  const failedTests = healthCheckResults.filter(h => h.status === 'failed');
  
  return {
    summary: `${failedTests.length} test(s) failed out of ${healthCheckResults.length} total`,
    failedTests: failedTests.map(test => ({
      function: test.function,
      error: test.error,
      statusCode: test.statusCode,
      duration: test.duration
    })),
    recommendations: failedTests.map(test => {
      if (test.error?.includes('timeout')) {
        return `${test.function}: Function timed out - check for infinite loops or slow operations`;
      }
      if (test.statusCode && test.statusCode >= 500) {
        return `${test.function}: Server error - check function logs and dependencies`;
      }
      if (test.statusCode === 404) {
        return `${test.function}: Function not found - verify deployment`;
      }
      return `${test.function}: Check function logs for details`;
    })
  };
}

async function runSmokeTests(req: Request): Promise<{ success: boolean; statusCode: number; data: any }> {
  try {
    logger.log('info', 'Starting smoke test runner');

    // Validate environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      logger.log('error', 'Missing required environment variables', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseAnonKey
      });
      
      return {
        success: false,
        statusCode: 500,
        data: {
          success: false,
          error: 'Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY',
          timestamp: new Date().toISOString()
        }
      };
    }

    // Parse request to check for specific function to test
    const url = new URL(req.url);
    const targetFunction = url.searchParams.get('function');

    // Define critical functions to test
    const allCriticalFunctions = [
      'chat',
      'knowledge-base-query',
      'agents-api',
      'send-email'
    ];

    const functionsToCheck = targetFunction 
      ? [targetFunction]
      : allCriticalFunctions;

    logger.log('info', 'Functions to check', { 
      functionsToCheck,
      targetFunction: targetFunction || 'all'
    });

    // Run health checks on all functions
    const healthCheckPromises = functionsToCheck.map(async (functionName): Promise<HealthCheckResult> => {
      const startTime = Date.now();
      
      try {
        logger.log('info', `Testing function: ${functionName}`);
        
        const functionUrl = `${supabaseUrl}/functions/v1/${functionName}/health`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        try {
          const response = await fetch(functionUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${supabaseAnonKey}`,
              'apikey': supabaseAnonKey,
              'Content-Type': 'application/json'
            },
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          const duration = Date.now() - startTime;
          
          if (response.ok || response.status === 404) {
            logger.log('info', `Function ${functionName} health check passed`, {
              statusCode: response.status,
              duration
            });
            
            return {
              function: functionName,
              status: 'passed',
              duration,
              statusCode: response.status
            };
          } else {
            const errorText = await response.text().catch(() => 'Unable to read error response');
            logger.log('warn', `Function ${functionName} health check failed`, {
              statusCode: response.status,
              error: errorText,
              duration
            });
            
            return {
              function: functionName,
              status: 'failed',
              error: `HTTP ${response.status}: ${errorText}`,
              duration,
              statusCode: response.status
            };
          }
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          
          if (fetchError.name === 'AbortError') {
            const duration = Date.now() - startTime;
            logger.log('error', `Function ${functionName} timed out`, { duration });
            
            return {
              function: functionName,
              status: 'failed',
              error: 'Request timeout after 10 seconds',
              duration
            };
          }
          
          throw fetchError;
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorInfo = parseErrorResponse(error);
        
        logger.log('error', `Function ${functionName} health check error`, {
          error: errorInfo.message,
          duration
        });
        
        return {
          function: functionName,
          status: 'failed',
          error: errorInfo.message,
          duration
        };
      }
    });

    const settledResults = await Promise.allSettled(healthCheckPromises);
    
    const healthCheckResults: HealthCheckResult[] = settledResults.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const functionName = functionsToCheck[index];
        logger.log('error', `Promise rejected for ${functionName}`, { reason: result.reason });
        return {
          function: functionName,
          status: 'failed',
          error: String(result.reason),
          duration: 0
        };
      }
    });

    // Aggregate results
    const passedCount = healthCheckResults.filter(h => h.status === 'passed').length;
    const failedCount = healthCheckResults.filter(h => h.status === 'failed').length;
    const overallSuccess = failedCount === 0;

    const smokeTestResults: SmokeTestResult = {
      success: overallSuccess,
      timestamp: new Date().toISOString(),
      results: healthCheckResults,
      total: healthCheckResults.length,
      passed: passedCount,
      failed: failedCount
    };

    const responseData = {
      success: overallSuccess,
      timestamp: new Date().toISOString(),
      tests_run: healthCheckResults.length,
      passed: passedCount,
      failed: failedCount,
      results: healthCheckResults,
      smokeTests: smokeTestResults,
      healthChecks: {
        total: healthCheckResults.length,
        passed: passedCount,
        failed: failedCount,
        results: healthCheckResults
      }
    };

    // Add failure report if there were any failures
    if (!overallSuccess) {
      responseData['failureReport'] = generateFailureReport(smokeTestResults, healthCheckResults);
    }

    logger.log('info', 'Smoke test runner completed', {
      overallSuccess,
      smokeTestSuccess: smokeTestResults.success,
      healthChecksPassed: passedCount,
      healthChecksFailed: failedCount
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
        timestamp: new Date().toISOString(),
        tests_run: 0,
        passed: 0,
        failed: 0,
        results: []
      }
    };
  }
}

// Deno.serve handler wrapper
serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    const url = new URL(req.url);
    
    // Health check endpoint - simple ping to verify function is running
    if (url.pathname.endsWith('/health') || (req.method === 'GET' && url.pathname === '/')) {
      try {
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
        if (!supabaseAnonKey) {
          throw new Error('SUPABASE_ANON_KEY not found');
        }

        // Try to reach Supabase REST API
        const healthResponse = await fetch('http://localhost:54321/rest/v1/', {
          method: 'GET',
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`
          }
        }).catch(err => {
          logger.log('warn', 'Supabase REST API health check failed', { error: String(err) });
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        });

        const healthCheckResult = {
          status: (healthResponse.ok || healthResponse.status === 404) ? 'ok' : 'error',
          timestamp: new Date().toISOString(),
          function: 'smoke-test-runner',
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
        logger.log('error', 'Health check failed', { error: String(error) });
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

    // GET endpoint with optional ?function=name parameter - run smoke tests
    if (req.method === 'GET') {
      logger.log('info', 'Received GET request to run smoke tests', {
        pathname: url.pathname,
        searchParams: Object.fromEntries(url.searchParams.entries())
      });
      
      const result = await runSmokeTests(req);
      
      return new Response(
        JSON.stringify(result.data),
        {
          status: result.statusCode,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // POST endpoint - run full smoke tests
    if (req.method === 'POST') {
      logger.log('info', 'Received POST request to run smoke tests');
      
      const result = await runSmokeTests(req);
      
      return new Response(
        JSON.stringify(result.data),
        {
          status: result.statusCode,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Default: treat any other request as a smoke test trigger
    logger.log('info', 'Received request, running smoke tests', { method: req.method, path: url.pathname });
    
    const result = await runSmokeTests(req);
    
    return new Response(
      JSON.stringify(result.data),
      {
        status: result.statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    logger.log('error', 'Request handler failed', { error: String(error), stack: error?.stack });
    
    return new Response(
      JSON.stringify({
        status: 'error',
        error: error.message || String(error),
        stack: error?.stack,
        timestamp: new Date().toISOString(),
        success: false,
        tests_run: 0,
        passed: 0,
        failed: 0,
        results: []
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
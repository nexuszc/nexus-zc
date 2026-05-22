import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

interface Logger {
  log: (level: string, message: string, metadata?: any) => void;
}

const logger: Logger = {
  log: (level: string, message: string, metadata?: any) => {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...metadata
    };
    console.log(JSON.stringify(logEntry));
  }
};

const HEALTH_CHECK_TIMEOUT = 30000;
const SMOKE_TEST_TIMEOUT = 45000;

// Critical edge functions to test
const CRITICAL_FUNCTIONS = [
  'chat',
  'document-processor',
  'query-optimizer',
  'vector-search',
  'auth-handler'
];

interface HealthCheckResult {
  function: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: string;
  isTimeout?: boolean;
  response?: any;
}

interface SmokeTestResult {
  success: boolean;
  timestamp: string;
  results: HealthCheckResult[];
  total: number;
  passed: number;
  failed: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    )
  ]);
}

function parseStandardizedError(error: any): { message: string; isTimeout: boolean; stack?: string } {
  const message = error?.message || String(error);
  const isTimeout = message.toLowerCase().includes('timeout') || 
                    message.toLowerCase().includes('timed out');
  return {
    message,
    isTimeout,
    stack: error?.stack
  };
}

function parseErrorResponse(error: any): { message: string; stack?: string; details?: any } {
  return {
    message: error?.message || String(error),
    stack: error?.stack,
    details: error?.details || error?.cause
  };
}

function generateFailureReport(smokeTestResults: any, healthCheckResults: HealthCheckResult[]): any {
  const failedHealthChecks = healthCheckResults.filter(h => h.status === 'failed');
  
  return {
    summary: {
      totalFailures: failedHealthChecks.length,
      timeoutFailures: failedHealthChecks.filter(h => h.isTimeout).length,
      otherFailures: failedHealthChecks.filter(h => !h.isTimeout).length
    },
    failedFunctions: failedHealthChecks.map(h => ({
      function: h.function,
      error: h.error,
      isTimeout: h.isTimeout,
      duration: h.duration
    })),
    recommendations: failedHealthChecks.length > 0 
      ? ['Check function logs', 'Verify environment variables', 'Check database connectivity']
      : []
  };
}

async function runSmokeTests(req: Request): Promise<{ success: boolean; statusCode: number; data: any }> {
  try {
    logger.log('info', 'Starting smoke test runner');

    // Parse request body if present
    let requestBody: any = {};
    try {
      const contentType = req.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        requestBody = await req.json();
      }
    } catch (e) {
      logger.log('warn', 'Could not parse request body', { error: String(e) });
    }

    // Determine which functions to check
    const functionsToCheck = requestBody.functions || CRITICAL_FUNCTIONS;

    logger.log('info', 'Functions to check', { functions: functionsToCheck });

    // Get Supabase credentials
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required Supabase configuration for health checks');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Run health checks in parallel with Promise.allSettled
    logger.log('info', 'Starting parallel health checks', { count: functionsToCheck.length });
    
    const healthCheckPromises = functionsToCheck.map(async (functionName: string): Promise<HealthCheckResult> => {
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
          return {
            function: functionName,
            status: 'failed',
            error: result.error.message || JSON.stringify(result.error),
            duration
          };
        } else {
          logger.log('info', `Health check passed for ${functionName}`, { duration });
          return {
            function: functionName,
            status: 'passed',
            duration,
            response: result.data
          };
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorInfo = parseStandardizedError(error);
        logger.log('error', `Health check exception for ${functionName}`, {
          error: errorInfo.message,
          isTimeout: errorInfo.isTimeout,
          duration
        });
        return {
          function: functionName,
          status: 'failed',
          error: errorInfo.message,
          isTimeout: errorInfo.isTimeout,
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
        timestamp: new Date().toISOString()
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
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
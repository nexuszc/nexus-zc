import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { corsHeaders } from '../_shared/cors.ts';

// Logger implementation
class Logger {
  private logs: Array<{ level: string; message: string; data?: any; timestamp: string }> = [];

  log(level: string, message: string, data?: any) {
    const entry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString()
    };
    this.logs.push(entry);
    console.log(JSON.stringify(entry));
  }

  getLogs() {
    return this.logs;
  }
}

const logger = new Logger();

// Error parsing helper
function parseErrorResponse(error: any): { message: string; details?: any; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      details: error.cause
    };
  }
  return {
    message: String(error)
  };
}

// Health check wrapper for Deno.serve
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
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
    }

    // Call the main handler with error wrapping
    try {
      return await handler(req);
    } catch (error) {
      const errorInfo = parseErrorResponse(error);
      logger.log('error', 'Unhandled error in serve wrapper', errorInfo);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Internal server error',
          message: errorInfo.message,
          details: errorInfo.details,
          stack: errorInfo.stack,
          timestamp: new Date().toISOString(),
          logs: logger.getLogs()
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }
  };
}

// Smoke test runner implementation
async function runSmokeTestsWithRetry(maxRetries: number): Promise<any> {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      logger.log('info', `Smoke test attempt ${attempt + 1}/${maxRetries + 1}`);
      
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase credentials');
      }

      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const tests = [
        { name: 'Database Connection', fn: async () => {
          const { error } = await supabase.from('system_logs').select('count').limit(1);
          if (error) throw error;
        }},
        { name: 'Environment Variables', fn: async () => {
          const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
          const missing = required.filter(key => !Deno.env.get(key));
          if (missing.length > 0) {
            throw new Error(`Missing env vars: ${missing.join(', ')}`);
          }
        }}
      ];

      let passed = 0;
      let failed = 0;
      const results: any[] = [];

      for (const test of tests) {
        try {
          await test.fn();
          passed++;
          results.push({ name: test.name, status: 'passed' });
          logger.log('info', `Test passed: ${test.name}`);
        } catch (error) {
          failed++;
          const errorInfo = parseErrorResponse(error);
          results.push({ 
            name: test.name, 
            status: 'failed', 
            error: errorInfo.message,
            stack: errorInfo.stack 
          });
          logger.log('error', `Test failed: ${test.name}`, errorInfo);
        }
      }

      return {
        total: tests.length,
        passed,
        failed,
        results
      };

    } catch (error) {
      lastError = error;
      logger.log('warn', `Smoke test attempt ${attempt + 1} failed`, parseErrorResponse(error));
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.log('info', `Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Smoke tests failed after all retries');
}

// Health check implementation
async function runHealthChecksWithTimeout(
  functions: string[],
  timeoutMs: number
): Promise<any[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    logger.log('error', 'Missing Supabase credentials for health checks');
    return functions.map(fn => ({
      function: fn,
      status: 'failed',
      error: 'Missing credentials',
      timestamp: new Date().toISOString()
    }));
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const results: any[] = [];

  for (const functionName of functions) {
    try {
      logger.log('info', `Health checking function: ${functionName}`);
      
      const healthCheckPromise = supabase.functions.invoke(functionName, {
        body: { health: true }
      });

      const result = await withTimeout(
        healthCheckPromise,
        timeoutMs,
        `Health check timeout for ${functionName}`
      );

      if (result.error) {
        throw result.error;
      }

      results.push({
        function: functionName,
        status: 'passed',
        timestamp: new Date().toISOString(),
        response: result.data
      });
      
      logger.log('info', `Health check passed: ${functionName}`);

    } catch (error) {
      const errorInfo = parseErrorResponse(error);
      results.push({
        function: functionName,
        status: 'failed',
        error: errorInfo.message,
        stack: errorInfo.stack,
        timestamp: new Date().toISOString()
      });
      
      logger.log('error', `Health check failed: ${functionName}`, errorInfo);
    }
  }

  return results;
}

// Persist results to database
async function persistTestResults(
  smokeTestResults: any,
  healthCheckResults: any[],
  overallSuccess: boolean
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      logger.log('warn', 'Cannot persist results: missing credentials');
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
      failed: healthCheckResults.filter(h
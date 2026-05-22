import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

// Logger utility
const logger = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'INFO', message, ...data, timestamp: new Date().toISOString() }));
  },
  error: (message: string, data?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: 'ERROR', message, ...data, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'WARN', message, ...data, timestamp: new Date().toISOString() }));
  }
};

/**
 * Add CORS headers to response
 */
function addCorsHeaders(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-client-info, apikey');
}

/**
 * Create success response with CORS
 */
function createSuccessResponse(data: unknown, status = 200): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });
  addCorsHeaders(headers);
  
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

/**
 * Create error response with CORS
 */
function createErrorResponse(message: string, status = 500, details?: unknown): Response {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });
  addCorsHeaders(headers);
  
  return new Response(
    JSON.stringify({
      error: message,
      status,
      details,
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers,
    }
  );
}

/**
 * Validate environment variables
 */
function validateEnvironment(): { valid: boolean; missing: string[] } {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = required.filter(key => !Deno.env.get(key));
  
  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Validate health response structure
 */
function validateHealthResponse(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  
  const health = response as Record<string, unknown>;
  
  return (
    typeof health.status === 'string' &&
    ['healthy', 'degraded', 'unhealthy'].includes(health.status as string) &&
    typeof health.timestamp === 'string' &&
    typeof health.checks === 'object' &&
    health.checks !== null
  );
}

/**
 * Run health checks
 */
async function runHealthChecks(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: Record<string, { status: string; message?: string; latency?: number }>;
  summary: { total: number; healthy: number; unhealthy: number };
}> {
  const checks: Record<string, { status: string; message?: string; latency?: number }> = {};
  
  // Check environment
  const envValidation = validateEnvironment();
  checks.environment = {
    status: envValidation.valid ? 'healthy' : 'unhealthy',
    message: envValidation.valid ? 'All required environment variables present' : `Missing: ${envValidation.missing.join(', ')}`
  };
  
  // Check Supabase connectivity
  try {
    const startTime = Date.now();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // Simple query to test connectivity
      const { error } = await supabase.from('profiles').select('count', { count: 'exact', head: true });
      
      const latency = Date.now() - startTime;
      
      if (error) {
        checks.supabase = {
          status: 'unhealthy',
          message: error.message,
          latency
        };
      } else {
        checks.supabase = {
          status: 'healthy',
          message: 'Database connection successful',
          latency
        };
      }
    } else {
      checks.supabase = {
        status: 'unhealthy',
        message: 'Missing Supabase credentials'
      };
    }
  } catch (error) {
    checks.supabase = {
      status: 'unhealthy',
      message: error instanceof Error ? error.message : String(error)
    };
  }
  
  // Calculate overall status
  const healthyCount = Object.values(checks).filter(c => c.status === 'healthy').length;
  const totalCount = Object.keys(checks).length;
  
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (healthyCount === totalCount) {
    overallStatus = 'healthy';
  } else if (healthyCount > 0) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'unhealthy';
  }
  
  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
    summary: {
      total: totalCount,
      healthy: healthyCount,
      unhealthy: totalCount - healthyCount
    }
  };
}

/**
 * Test case interface
 */
interface TestCase {
  name: string;
  endpoint: string;
  method: string;
  expectedStatus: number[];
  body?: unknown;
  headers?: Record<string, string>;
  validateResponse?: (data: unknown) => boolean;
  timeout?: number;
}

/**
 * Main handler for smoke tests
 */
async function handler(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  logger.info('Smoke test handler invoked', {
    requestId,
    method: req.method,
    url: req.url
  });

  try {
    const url = new URL(req.url);
    
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      logger.info('Handling CORS preflight', { requestId });
      const headers = new Headers();
      addCorsHeaders(headers);
      return new Response(null, { status: 204, headers });
    }
    
    // Health check is handled by wrapper, but keep fallback
    if (url.pathname === '/health' || url.pathname.endsWith('/health')) {
      logger.info('Health check in main handler (fallback)', { requestId });
      const healthStatus = await runHealthChecks();
      const statusCode = healthStatus.status === 'healthy' ? 200 :
                        healthStatus.status === 'degraded' ? 200 : 503;
      return createSuccessResponse(healthStatus, statusCode);
    }
    
    // Run smoke tests
    logger.info('Starting smoke test execution', { requestId });
    
    const testResults = await runSmokeTests();
    
    const elapsed = Date.now() - startTime;
    const allPassed = testResults.failed === 0;
    
    const response = {
      success: allPassed,
      status: allPassed ? 'passed' : 'failed',
      timestamp: new Date().toISOString(),
      elapsed,
      summary: {
        total: testResults.passed + testResults.failed,
        passed: testResults.passed,
        failed: testResults.failed,
        passRate: `${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`
      },
      results: testResults.results,
      health: await runHealthChecks(),
      requestId
    };
    
    logger.info('Smoke tests completed', {
      requestId,
      success: allPassed,
      passed: testResults.passed,
      failed: testResults.failed,
      elapsed
    });
    
    return createSuccessResponse(response, allPassed ? 200 : 500);
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('Smoke test handler failed', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
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
 * Run smoke tests
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
        const health = data as Record<string, unknown>;
        return typeof health.status === 'string' && typeof health.timestamp === 'string';
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
    
    try {
      logger.info(`Running test: ${test.name}`, {
        endpoint: test.endpoint,
        method: test.method
      });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), test.timeout || testTimeout);
      
      const response = await fetch(test.endpoint, {
        method: test.method,
        headers: {
          'Content-Type': 'application/json',
          ...test.headers
        },
        body: test.body ? JSON.stringify(test.body) : undefined,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const elapsed = Date.now() - testStartTime;
      const statusMatch = test.expectedStatus.includes(response.status);
      
      let responseData: unknown;
      try {
        const text = await response.text();
        responseData = text ? JSON.parse(text) : null;
      } catch {
        responseData = 'Unable to parse response';
      }
      
      const validationPassed = test.validateResponse ? test.validateResponse(responseData) : true;
      
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
function serveWithHealthCheck(handler: (req: Request) => Promise<Response
// ============================================================================
// SMOKE TEST EDGE FUNCTION
// ============================================================================
// Comprehensive health check endpoint for Nexus system validation
// Tests runtime, database, environment, and core functionality

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const FUNCTION_NAME = 'smoke-test';
const FUNCTION_VERSION = '1.0.0';
const FUNCTION_START_TIME = performance.now();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  duration_ms: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  uptime_ms: number;
  checks: HealthCheck[];
  metadata: {
    deno_version: string;
    region: string;
    function_name: string;
  };
}

interface ErrorResponse {
  error: string;
  message: string;
  timestamp: string;
  path: string;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Logging utility with structured output
 */
function log(level: 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>) {
  const logEntry = {
    level,
    function: FUNCTION_NAME,
    message,
    timestamp: new Date().toISOString(),
    ...details,
  };
  console.log(JSON.stringify(logEntry));
}

/**
 * Get CORS headers for responses
 */
function getCorsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Create JSON response with CORS headers
 */
function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(),
    },
  });
}

// ============================================================================
// HEALTH CHECK FUNCTIONS
// ============================================================================

/**
 * Check Deno runtime availability and version
 */
function checkRuntime(): HealthCheck {
  const start = performance.now();

  try {
    const version = Deno.version;

    return {
      name: 'runtime',
      status: 'pass',
      duration_ms: performance.now() - start,
      details: {
        deno: version.deno,
        v8: version.v8,
        typescript: version.typescript,
      },
    };
  } catch (error) {
    return {
      name: 'runtime',
      status: 'fail',
      duration_ms: performance.now() - start,
      message: error instanceof Error ? error.message : 'Runtime check failed',
    };
  }
}

/**
 * Check environment variables are set
 */
function checkEnvironment(): HealthCheck {
  const start = performance.now();

  try {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars: string[] = [];

    for (const varName of requiredVars) {
      if (!Deno.env.get(varName)) {
        missingVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      return {
        name: 'environment',
        status: 'fail',
        duration_ms: performance.now() - start,
        message: `Missing required environment variables: ${missingVars.join(', ')}`,
      };
    }

    return {
      name: 'environment',
      status: 'pass',
      duration_ms: performance.now() - start,
      details: {
        variables_checked: requiredVars.length,
      },
    };
  } catch (error) {
    return {
      name: 'environment',
      status: 'fail',
      duration_ms: performance.now() - start,
      message: error instanceof Error ? error.message : 'Environment check failed',
    };
  }
}

/**
 * Check Supabase client initialization
 */
function checkSupabaseClient(): HealthCheck {
  const start = performance.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      return {
        name: 'supabase_client',
        status: 'fail',
        duration_ms: performance.now() - start,
        message: 'Supabase credentials not configured',
      };
    }

    const client = createClient(supabaseUrl, supabaseAnonKey);

    if (!client) {
      return {
        name: 'supabase_client',
        status: 'fail',
        duration_ms: performance.now() - start,
        message: 'Failed to create Supabase client',
      };
    }

    return {
      name: 'supabase_client',
      status: 'pass',
      duration_ms: performance.now() - start,
      details: {
        url: supabaseUrl,
      },
    };
  } catch (error) {
    return {
      name: 'supabase_client',
      status: 'fail',
      duration_ms: performance.now() - start,
      message: error instanceof Error ? error.message : 'Supabase client check failed',
    };
  }
}

/**
 * Check database connectivity with a simple query
 */
async function checkDatabase(): Promise<HealthCheck> {
  const start = performance.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - start,
        message: 'Database credentials not configured',
      };
    }

    const client = createClient(supabaseUrl, supabaseAnonKey);

    // Simple query to check connectivity - using a basic RPC or simple select
    const { error } = await client.from('profiles').select('count', { count: 'exact', head: true });

    if (error) {
      return {
        name: 'database',
        status: 'warn',
        duration_ms: performance.now() - start,
        message: `Database query failed: ${error.message}`,
      };
    }

    return {
      name: 'database',
      status: 'pass',
      duration_ms: performance.now() - start,
      details: {
        connection: 'established',
      },
    };
  } catch (error) {
    return {
      name: 'database',
      status: 'fail',
      duration_ms: performance.now() - start,
      message: error instanceof Error ? error.message : 'Database check failed',
    };
  }
}

/**
 * Check JSON serialization works correctly
 */
function checkJsonSerialization(): HealthCheck {
  const start = performance.now();

  try {
    const testObject = {
      string: 'test',
      number: 42,
      boolean: true,
      null: null,
      array: [1, 2, 3],
      nested: { key: 'value' },
    };

    const serialized = JSON.stringify(testObject);
    const deserialized = JSON.parse(serialized);

    if (JSON.stringify(deserialized) !== serialized) {
      return {
        name: 'json_serialization',
        status: 'fail',
        duration_ms: performance.now() - start,
        message: 'JSON round-trip failed',
      };
    }

    return {
      name: 'json_serialization',
      status: 'pass',
      duration_ms: performance.now() - start,
    };
  } catch (error) {
    return {
      name: 'json_serialization',
      status: 'fail',
      duration_ms: performance.now() - start,
      message: error instanceof Error ? error.message : 'JSON serialization check failed',
    };
  }
}

/**
 * Check memory usage
 */
function checkMemory(): HealthCheck {
  const start = performance.now();

  try {
    if (!Deno.memoryUsage) {
      return {
        name: 'memory',
        status: 'warn',
        duration_ms: performance.now() - start,
        message: 'Memory API not available',
      };
    }

    const memory = Deno.memoryUsage();
    const heapUsedMB = memory.heapUsed / 1024 / 1024;
    const heapTotalMB = memory.heapTotal / 1024 / 1024;

    return {
      name: 'memory',
      status: 'pass',
      duration_ms: performance.now() - start,
      details: {
        heap_used_mb: Math.round(heapUsedMB * 100) / 100,
        heap_total_mb: Math.round(heapTotalMB * 100) / 100,
        usage_percent: Math.round((heapUsedMB / heapTotalMB) * 100),
      },
    };
  } catch (error) {
    return {
      name: 'memory',
      status: 'fail',
      duration_ms: performance.now() - start,
      message: error instanceof Error ? error.message : 'Memory check failed',
    };
  }
}

// ============================================================================
// REQUEST HANDLERS
// ============================================================================

/**
 * Handle OPTIONS preflight requests
 */
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(),
  });
}

/**
 * Validate incoming request
 */
function validateRequest(req: Request): { valid: boolean; error?: string } {
  const method = req.method;

  if (!['GET', 'POST', 'OPTIONS'].includes(method)) {
    return {
      valid: false,
      error: `Method ${method} not allowed`,
    };
  }

  return { valid: true };
}

/**
 * Execute all health checks and aggregate results
 */
async function performHealthChecks(): Promise<HealthCheckResponse> {
  const checkStartTime = performance.now();

  log('info', 'Starting health checks');

  // Execute all health checks in parallel
  const checks = await Promise.all([
    checkRuntime(),
    checkEnvironment(),
    checkSupabaseClient(),
    checkDatabase(),
    checkJsonSerialization(),
    checkMemory(),
  ]);

  // Determine overall status
  const failedChecks = checks.filter((check) => check.status === 'fail');
  const passedChecks = checks.filter((check) => check.status === 'pass');

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (failedChecks.length === 0) {
    overallStatus = 'healthy';
  } else if (passedChecks.length > failedChecks.length) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'unhealthy';
  }

  const environment = Deno.env.get('ENVIRONMENT') || 'production';
  const region = Deno.env.get('DENO_REGION') || 'unknown';

  const response: HealthCheckResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: FUNCTION_VERSION,
    environment,
    uptime_ms: performance.now() - FUNCTION_START_TIME,
    checks,
    metadata: {
      deno_version: Deno.version.deno,
      region,
      function_name: FUNCTION_NAME,
    },
  };

  log('info', 'Health checks completed', {
    status: overallStatus,
    total_checks: checks.length,
    passed: passedChecks.length,
    failed: failedChecks.length,
    duration_ms: performance.now() - checkStartTime,
  });

  return response;
}

/**
 * Handle health check requests
 */
async function handleHealthCheck(req: Request): Promise<Response> {
  try {
    const healthCheckResult = await performHealthChecks();

    const statusCode = healthCheckResult.status === 'unhealthy' ? 503 : 200;

    return createJsonResponse(healthCheckResult, statusCode);
  } catch (error) {
    log('error', 'Health check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const errorResponse: ErrorResponse = {
      error: 'HEALTH_CHECK_FAILED',
      message: error instanceof Error ? error.message : 'Health check encountered an error',
      timestamp: new Date().toISOString(),
      path: new URL(req.url).pathname,
    };

    return createJsonResponse(errorResponse, 500);
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main Deno.serve handler
 * Processes all incoming requests with comprehensive error handling
 */
Deno.serve(async (req: Request): Promise<Response> => {
  const requestStart = performance.now();
  const url = new URL(req.url);
  const method = req.method;

  log('info', 'Incoming request', {
    method,
    path: url.pathname,
    origin: req.headers.get('origin'),
  });

  try {
    // Handle OPTIONS preflight requests
    if (method === 'OPTIONS') {
      log('info', 'Handling OPTIONS preflight request');
      return handleOptions();
    }

    // Validate request
    const validation = validateRequest(req);
    if (!validation.valid) {
      log('warn', 'Request validation failed', { error: validation.error });

      const errorResponse: ErrorResponse = {
        error: 'INVALID_REQUEST',
        message: validation.error || 'Request validation failed',
        timestamp: new Date().toISOString(),
        path: url.pathname,
      };

      return createJsonResponse(errorResponse, 400);
    }

    // Execute health check
    const response = await handleHealthCheck(req);

    const duration = performance.now() - requestStart;

    log('info', 'Request completed', {
      status: response.status,
      duration_ms: duration,
    });

    return response;
  } catch (error) {
    const duration = performance.now() - requestStart;

    log('error', 'Unhandled error in request handler', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      duration_ms: duration,
    });

    const errorResponse: ErrorResponse = {
      error: 'INTERNAL_SERVER_ERROR',
      message: error instanceof Error ? error.message : 'An
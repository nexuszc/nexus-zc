ion check failed',
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
// RETRY LOGIC
// ============================================================================

/**
 * Retry configuration for transient failures
 */
interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
};

/**
 * Execute a function with retry logic for transient failures
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  checkName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | unknown;
  let delay = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      log('debug', `Executing ${checkName}`, { attempt, maxAttempts: config.maxAttempts });
      return await fn();
    } catch (error) {
      lastError = error;
      
      log('warn', `${checkName} failed on attempt ${attempt}`, {
        attempt,
        maxAttempts: config.maxAttempts,
        error: error instanceof Error ? error.message : 'Unknown error',
        willRetry: attempt < config.maxAttempts,
      });

      if (attempt < config.maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Execute a function with a timeout
 */
async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  checkName: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${checkName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([fn(), timeoutPromise]);
}

/**
 * Safe wrapper for health checks with timeout and retry
 */
async function safeHealthCheck(
  checkFn: () => Promise<HealthCheck> | HealthCheck,
  checkName: string,
  timeoutMs: number = 5000
): Promise<HealthCheck> {
  const start = performance.now();

  try {
    const result = await withTimeout(
      async () => {
        try {
          return await withRetry(
            async () => await Promise.resolve(checkFn()),
            checkName
          );
        } catch (retryError) {
          // If all retries failed, return a fail status instead of throwing
          return {
            name: checkName,
            status: 'fail' as const,
            duration_ms: performance.now() - start,
            message: retryError instanceof Error ? retryError.message : 'Check failed after retries',
            details: {
              error: retryError instanceof Error ? {
                message: retryError.message,
                stack: retryError.stack,
              } : { message: 'Unknown error' },
            },
          };
        }
      },
      timeoutMs,
      checkName
    );

    return result;
  } catch (error) {
    // Timeout or other fatal error
    log('error', `Fatal error in ${checkName}`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      name: checkName,
      status: 'fail' as const,
      duration_ms: performance.now() - start,
      message: error instanceof Error ? error.message : 'Check encountered a fatal error',
      details: {
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
        } : { message: 'Unknown error' },
      },
    };
  }
}

/**
 * Validate health check result structure
 */
function validateHealthCheckResult(check: HealthCheck, checkName: string): boolean {
  if (!check || typeof check !== 'object') {
    log('error', `Invalid health check result for ${checkName}`, { check });
    return false;
  }

  if (!check.name || typeof check.name !== 'string') {
    log('error', `Health check missing valid name`, { check });
    return false;
  }

  if (!check.status || !['pass', 'fail', 'warn'].includes(check.status)) {
    log('error', `Invalid status for ${checkName}`, { status: check.status });
    return false;
  }

  if (typeof check.duration_ms !== 'number' || check.duration_ms < 0) {
    log('error', `Invalid duration for ${checkName}`, { duration_ms: check.duration_ms });
    return false;
  }

  return true;
}

/**
 * Sanitize health check result for safe serialization
 */
function sanitizeHealthCheck(check: HealthCheck): HealthCheck {
  const sanitized: HealthCheck = {
    name: String(check.name),
    status: check.status,
    duration_ms: Number(check.duration_ms) || 0,
  };

  if (check.message) {
    sanitized.message = String(check.message);
  }

  if (check.details) {
    try {
      // Deep clone to avoid circular references
      sanitized.details = JSON.parse(JSON.stringify(check.details));
    } catch (error) {
      log('warn', `Failed to sanitize details for ${check.name}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      sanitized.details = { sanitization_error: 'Could not serialize details' };
    }
  }

  return sanitized;
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

  // Execute all health checks in parallel with safety wrappers
  const checkPromises = [
    safeHealthCheck(() => checkRuntime(), 'runtime', 3000),
    safeHealthCheck(() => checkEnvironment(), 'environment', 3000),
    safeHealthCheck(() => checkSupabaseClient(), 'supabase_client', 5000),
    safeHealthCheck(() => checkDatabase(), 'database', 10000),
    safeHealthCheck(() => checkJsonSerialization(), 'json_serialization', 3000),
    safeHealthCheck(() => checkMemory(), 'memory', 3000),
  ];

  let checks: HealthCheck[];
  
  try {
    checks = await Promise.all(checkPromises);
  } catch (error) {
    log('error', 'Critical error during health checks execution', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Return minimal response indicating critical failure
    return {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: FUNCTION_VERSION,
      environment: Deno.env.get('ENVIRONMENT') || 'production',
      uptime_ms: performance.now() - FUNCTION_START_TIME,
      checks: [{
        name: 'health_check_execution',
        status: 'fail',
        duration_ms: performance.now() - checkStartTime,
        message: error instanceof Error ? error.message : 'Critical failure executing health checks',
        details: {
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack,
          } : { message: 'Unknown error' },
        },
      }],
      metadata: {
        deno_version: Deno.version.deno,
        region: Deno.env.get('DENO_REGION') || 'unknown',
        function_name: FUNCTION_NAME,
      },
    };
  }

  // Validate and sanitize all check results
  const validatedChecks: HealthCheck[] = [];
  for (const check of checks) {
    if (validateHealthCheckResult(check, check.name)) {
      validatedChecks.push(sanitizeHealthCheck(check));
    } else {
      log('error', 'Invalid health check result, creating fallback', { checkName: check.name });
      validatedChecks.push({
        name: check.name || 'unknown',
        status: 'fail',
        duration_ms: check.duration_ms || 0,
        message: 'Health check returned invalid result',
      });
    }
  }

  // Determine overall status
  const failedChecks = validatedChecks.filter((check) => check.status === 'fail');
  const warnChecks = validatedChecks.filter((check) => check.status === 'warn');
  const passedChecks = validatedChecks.filter((check) => check.status === 'pass');

  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (failedChecks.length === 0 && warnChecks.length === 0) {
    overallStatus = 'healthy';
  } else if (failedChecks.length === 0) {
    overallStatus = 'degraded';
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
    checks: validatedChecks,
    metadata: {
      deno_version: Deno.version.deno,
      region,
      function_name: FUNCTION_NAME,
    },
  };

  log('info', 'Health checks completed', {
    status: overallStatus,
    total_checks: validatedChecks.length,
    passed: passedChecks.length,
    warnings: warnChecks.length,
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
      stack: error instanceof Error ? error.stack : undefined,
    });

    const errorResponse: ErrorResponse = {
      error: 'HEALTH_CHECK_FAILED',
      message: error instanceof Error ? error.message : 'Health check encountered an error',
      timestamp: new Date().toISOString(),
      path: new URL(req.url).pathname,
      details: error instanceof Error ? {
        stack: error.stack,
        name: error.name,
      } : undefined,
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
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
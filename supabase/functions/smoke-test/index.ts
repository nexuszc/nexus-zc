summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'pass').length,
    failed: checks.filter(c => c.status === 'fail').length,
    warnings: checks.filter(c => c.status === 'warn').length,
  };

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (summary.failed > 0) {
    status = 'unhealthy';
  } else if (summary.warnings > 0) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  const healthStatus: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    checks,
    summary,
  };

  logger.info('Health checks completed', { status, summary });
  
  return healthStatus;
}

/**
 * Validate required environment variables
 */
function validateEnvironment(): { valid: boolean; missing: string[] } {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const missing = required.filter(key => !Deno.env.get(key));
  
  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missing });
  }
  
  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Wrapper for fetch with timeout and error handling
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Validate response structure
 */
function validateHealthResponse(data: unknown): data is HealthStatus {
  if (!data || typeof data !== 'object') {
    logger.error('Invalid health response: not an object', { data });
    return false;
  }
  
  const health = data as Record<string, unknown>;
  
  if (!health.status || !['healthy', 'degraded', 'unhealthy'].includes(health.status as string)) {
    logger.error('Invalid health response: invalid status', { status: health.status });
    return false;
  }
  
  if (!health.timestamp || typeof health.timestamp !== 'string') {
    logger.error('Invalid health response: invalid timestamp', { timestamp: health.timestamp });
    return false;
  }
  
  if (!Array.isArray(health.checks)) {
    logger.error('Invalid health response: checks is not an array', { checks: health.checks });
    return false;
  }
  
  if (!health.summary || typeof health.summary !== 'object') {
    logger.error('Invalid health response: invalid summary', { summary: health.summary });
    return false;
  }
  
  return true;
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(headers: Headers): Headers {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  return headers;
}

/**
 * Create error response with proper headers
 */
function createErrorResponse(
  message: string,
  statusCode: number = 500,
  details?: unknown
): Response {
  logger.error('Creating error response', { message, statusCode, details });
  
  const errorResponse: ApiResponse = {
    success: false,
    error: message,
  };
  
  const headers = new Headers({ 'Content-Type': 'application/json' });
  addCorsHeaders(headers);
  
  return new Response(
    JSON.stringify(errorResponse, null, 2),
    {
      status: statusCode,
      headers
    }
  );
}

/**
 * Create success response with proper headers
 */
function createSuccessResponse<T>(
  data: T,
  statusCode: number = 200
): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };
  
  const headers = new Headers({ 'Content-Type': 'application/json' });
  addCorsHeaders(headers);
  
  return new Response(
    JSON.stringify(response, null, 2),
    {
      status: statusCode,
      headers
    }
  );
}

/**
 * Main handler function
 */
async function handler(req: Request): Promise<Response> {
  const startTime = Date.now();
  logger.info('Smoke test endpoint called', { 
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });

  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      logger.info('Handling CORS preflight request');
      const headers = new Headers();
      addCorsHeaders(headers);
      return new Response(null, { status: 204, headers });
    }

    if (req.method !== 'GET') {
      logger.warn('Invalid method for smoke test', { method: req.method });
      return createErrorResponse('Method not allowed', 405);
    }

    // Validate environment variables
    const envValidation = validateEnvironment();
    if (!envValidation.valid) {
      logger.error('Environment validation failed', { missing: envValidation.missing });
      return createErrorResponse(
        `Missing required environment variables: ${envValidation.missing.join(', ')}`,
        500,
        { missing: envValidation.missing }
      );
    }

    const url = new URL(req.url);
    logger.info('Processing request', { pathname: url.pathname });
    
    if (url.pathname.endsWith('/health')) {
      logger.info('Health endpoint called');
      
      try {
        const healthStatus = await runHealthChecks();
        
        // Validate health status structure
        if (!validateHealthResponse(healthStatus)) {
          logger.error('Invalid health status structure returned');
          return createErrorResponse('Invalid health check response structure', 500);
        }
        
        const statusCode = healthStatus.status === 'healthy' ? 200 :
                          healthStatus.status === 'degraded' ? 200 : 503;

        const elapsed = Date.now() - startTime;
        logger.info('Health check completed', { 
          status: healthStatus.status, 
          statusCode,
          elapsed,
          summary: healthStatus.summary
        });

        return createSuccessResponse(healthStatus, statusCode);
      } catch (healthError) {
        logger.error('Health check execution error', {
          error: healthError instanceof Error ? healthError.message : String(healthError),
          stack: healthError instanceof Error ? healthError.stack : undefined,
          elapsed: Date.now() - startTime
        });
        
        return createErrorResponse(
          `Health check failed: ${healthError instanceof Error ? healthError.message : String(healthError)}`,
          500,
          { error: healthError }
        );
      }
    }

    // Default to health check for root path
    logger.info('Default health check execution');
    
    try {
      const healthStatus = await runHealthChecks();
      
      // Validate health status structure
      if (!validateHealthResponse(healthStatus)) {
        logger.error('Invalid health status structure returned');
        return createErrorResponse('Invalid health check response structure', 500);
      }
      
      const statusCode = healthStatus.status === 'healthy' ? 200 :
                        healthStatus.status === 'degraded' ? 200 : 503;

      const elapsed = Date.now() - startTime;
      logger.info('Health check completed', { 
        status: healthStatus.status, 
        statusCode,
        elapsed,
        summary: healthStatus.summary
      });

      return createSuccessResponse(healthStatus, statusCode);
    } catch (healthError) {
      logger.error('Health check execution error', {
        error: healthError instanceof Error ? healthError.message : String(healthError),
        stack: healthError instanceof Error ? healthError.stack : undefined,
        elapsed: Date.now() - startTime
      });
      
      return createErrorResponse(
        `Health check failed: ${healthError instanceof Error ? healthError.message : String(healthError)}`,
        500,
        { error: healthError }
      );
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.error('Smoke test execution failed with unhandled error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      elapsed,
      url: req.url,
      method: req.method
    });
    
    return createErrorResponse(
      `Smoke test execution failed: ${error instanceof Error ? error.message : String(error)}`,
      500,
      { error }
    );
  }
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    
    logger.info('Request received', {
      requestId,
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString()
    });

    try {
      const url = new URL(req.url);
      
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        logger.info('Handling CORS preflight in wrapper', { requestId });
        const headers = new Headers();
        addCorsHeaders(headers);
        return new Response(null, { status: 204, headers });
      }
      
      // Validate environment before processing
      const envValidation = validateEnvironment();
      if (!envValidation.valid) {
        logger.error('Environment validation failed in wrapper', {
          requestId,
          missing: envValidation.missing
        });
        return createErrorResponse(
          `Missing required environment variables: ${envValidation.missing.join(', ')}`,
          500,
          { missing: envValidation.missing, requestId }
        );
      }
      
      if (url.pathname === '/health' || url.pathname.endsWith('/health')) {
        logger.info('Health check endpoint hit in wrapper', { requestId });
        
        try {
          const healthStatus = await runHealthChecks();
          
          // Validate response structure
          if (!validateHealthResponse(healthStatus)) {
            logger.error('Invalid health status structure in wrapper', { requestId });
            return createErrorResponse('Invalid health check response structure', 500);
          }
          
          const statusCode = healthStatus.status === 'healthy' ? 200 :
                            healthStatus.status === 'degraded' ? 200 : 503;

          const elapsed = Date.now() - startTime;
          logger.info('Health check completed in wrapper', {
            requestId,
            status: healthStatus.status,
            statusCode,
            elapsed,
            summary: healthStatus.summary
          });

          return createSuccessResponse(healthStatus, statusCode);
        } catch (healthError) {
          const elapsed = Date.now() - startTime;
          logger.error('Health check failed in wrapper', {
            requestId,
            error: healthError instanceof Error ? healthError.message : String(healthError),
            stack: healthError instanceof Error ? healthError.stack : undefined,
            elapsed
          });
          
          return createErrorResponse(
            `Health check failed: ${healthError instanceof Error ? healthError.message : String(healthError)}`,
            500,
            { error: healthError, requestId }
          );
        }
      }
      
      logger.info('Delegating to main handler', { requestId });
      const response = await handler(req);
      
      const elapsed = Date.now() - startTime;
      logger.info('Request completed', {
        requestId,
        status: response.status,
        elapsed
      });
      
      return response;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logger.error('Request handling failed in wrapper', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        elapsed,
        url: req.url,
        method: req.method
      });
      
      return createErrorResponse(
        `Request handling failed: ${error instanceof Error ? error.message : String(error)}`,
        500,
        { error, requestId }
      );
    }
  };
}

logger.info('Smoke test function initialized', {
  timestamp: new Date().toISOString(),
  denoVersion: Deno.version.deno,
  v8Version: Deno.version.v8
});

Deno.serve(serveWithHealthCheck(handler));
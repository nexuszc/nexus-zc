Deno.serve(async (req) => {
  const startTime = performance.now();
  
  try {
    logger.info('Smoke test request received', {
      method: req.method,
      url: req.url,
    });

    // Only allow GET requests
    if (req.method !== 'GET') {
      logger.warn('Method not allowed', { method: req.method });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Method not allowed',
          message: 'Only GET requests are supported',
        }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            'Allow': 'GET',
          },
        }
      );
    }

    // Run smoke tests with timeout protection
    const timeoutMs = 30000; // 30 second timeout
    const testPromise = runSmokeTests();
    const timeoutPromise = new Promise<SmokeTestResult>((_, reject) =>
      setTimeout(() => reject(new Error('Smoke tests timed out')), timeoutMs)
    );

    let result: SmokeTestResult;
    try {
      result = await Promise.race([testPromise, timeoutPromise]);
    } catch (timeoutError) {
      logger.error('Smoke tests timed out', timeoutError);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Smoke tests timed out',
          message: 'Tests exceeded maximum execution time',
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 504,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate result structure
    if (!result || typeof result !== 'object') {
      logger.error('Invalid test result structure', { result });
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid test result',
          message: 'Smoke tests returned invalid result structure',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Determine HTTP status code based on test results
    let statusCode = 200;
    if (result.overall_status === 'fail') {
      statusCode = 503; // Service Unavailable
    } else if (result.overall_status === 'warn') {
      statusCode = 200; // OK but with warnings
    }

    logger.info('Returning smoke test results', {
      status: result.overall_status,
      statusCode,
      duration_ms: result.duration_ms,
    });

    return new Response(JSON.stringify(result), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Test-Duration': String(result.duration_ms),
        'X-Test-Status': result.overall_status,
      },
    });
  } catch (error) {
    logger.error('Unhandled error in smoke test handler', error);
    
    const errorResponse = {
      success: false,
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
      stack: error instanceof Error ? error.stack : undefined,
      duration_ms: performance.now() - startTime,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Logger utility with structured logging
 */
const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    }));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    }));
  },
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : String(error),
      timestamp: new Date().toISOString(),
      ...meta,
    }));
  },
};

/**
 * Type definitions
 */
interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  duration_ms: number;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
}

interface SmokeTestResult {
  success: boolean;
  timestamp: string;
  duration_ms: number;
  checks: HealthCheck[];
  overall_status: 'pass' | 'fail' | 'warn';
  environment: string;
  version: string;
  service_dependencies: {
    database: boolean;
    edge_functions: boolean;
    external_services: boolean;
  };
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting database connectivity check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      logger.warn('Database credentials not configured');
      return {
        name: 'database',
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Database credentials not configured',
        details: {
          supabase_url_present: !!supabaseUrl,
          supabase_key_present: !!supabaseKey,
        },
      };
    }

    // Test basic database connectivity with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('Database connectivity check failed', {
          status: response.status,
          statusText: response.statusText,
        });
        return {
          name: 'database',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: `Database returned status ${response.status}`,
          details: {
            status: response.status,
            statusText: response.statusText,
          },
        };
      }

      logger.info('Database connectivity check passed');
      return {
        name: 'database',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Database is accessible',
        details: {
          status: response.status,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Database connectivity check timed out');
        return {
          name: 'database',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'Database connectivity check timed out',
          error: 'Request timeout after 5 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error('Database check failed', error);
    return {
      name: 'database',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Database connectivity check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check authentication system
 */
async function checkAuthentication(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting authentication check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      logger.warn('Authentication credentials not configured');
      return {
        name: 'authentication',
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Authentication credentials not configured',
      };
    }

    // Test auth endpoint availability with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
        method: 'GET',
        headers: {
          'apikey': supabaseAnonKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('Authentication endpoint returned error', {
          status: response.status,
        });
        return {
          name: 'authentication',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: `Authentication endpoint returned status ${response.status}`,
          details: {
            status: response.status,
          },
        };
      }

      logger.info('Authentication check passed');
      return {
        name: 'authentication',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Authentication system is operational',
        details: {
          status: response.status,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Authentication check timed out');
        return {
          name: 'authentication',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'Authentication check timed out',
          error: 'Request timeout after 5 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error('Authentication check failed', error);
    return {
      name: 'authentication',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Authentication check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check external service dependencies
 */
async function checkExternalServices(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting external services check');
  
  try {
    // Check internet connectivity with a reliable endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('External service connectivity degraded', {
          status: response.status,
        });
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External service connectivity may be degraded',
          details: {
            status: response.status,
          },
        };
      }

      logger.info('External services check passed');
      return {
        name: 'external_services',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'External services are accessible',
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.warn('External services check timed out');
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External service check timed out',
          error: 'Request timeout after 3 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.warn('External services check encountered error', error);
    return {
      name: 'external_services',
      status: 'warn',
      duration_ms: performance.now() - startTime,
      message: error instanceof Error ? error.message : 'External service check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check environment configuration
 */
async function checkEnvironment(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting environment check');
  
  try {
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];

    const missingVars: string[] = [];
    const presentVars: string[] = [];

    for (const varName of requiredEnvVars) {
      const value = Deno.env.get(varName);
      if (!value) {
        missingVars.push(varName);
      } else {
        presentVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      logger.warn('Missing environment variables', { missing: missingVars });
      return {
        name: 'environment',
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Some environment variables are missing',
        details: {
          missing: missingVars,
          present: presentVars,
        },
      };
    }

    logger.info('Environment check passed');
    return {
      name: 'environment',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'All required environment variables configured',
      details: {
        configured_vars: presentVars.length,
      },
    };
  } catch (error) {
    logger.error('Environment check failed', error);
    return {
      name: 'environment',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Environment check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check edge function availability
 */
async function checkEdgeFunctions(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting edge function availability check');
  
  try {
    // Check if we're running in Deno edge runtime
    const isDenoRuntime = typeof Deno !== 'undefined';
    const hasDenoServe = typeof Deno !== 'undefined' && typeof Deno.serve === 'function';
    
    if (!isDenoRuntime) {
      logger.warn('Not running in Deno runtime');
      return {
        name: 'edge_functions',
        status
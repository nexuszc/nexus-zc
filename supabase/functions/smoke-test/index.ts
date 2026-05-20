import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

// Types
interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  duration_ms: number;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
}

interface SmokeTestResult {
  success: boolean;
  timestamp: string;
  duration_ms: number;
  checks: HealthCheck[];
  overall_status: 'pass' | 'fail' | 'warn';
}

// Logger utility
const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date().toISOString() }));
  },
  error: (message: string, error?: unknown) => {
    console.error(JSON.stringify({ 
      level: 'error', 
      message, 
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString() 
    }));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...meta, timestamp: new Date().toISOString() }));
  },
};

/**
 * Timeout wrapper for promises
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutId: number;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting database check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      logger.error('Missing Supabase credentials for database check');
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Missing database credentials',
        error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured',
      };
    }

    let supabase;
    try {
      supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          fetch: fetch.bind(globalThis),
        },
      });
    } catch (clientError) {
      logger.error('Failed to create Supabase client', clientError);
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Failed to create database client',
        error: clientError instanceof Error ? clientError.message : String(clientError),
      };
    }

    // Test database connection with a simple query
    try {
      const { data, error } = await withTimeout(
        supabase.from('users').select('count').limit(1).single(),
        5000,
        'Database query timeout after 5 seconds'
      );

      if (error) {
        logger.error('Database query error', error);
        return {
          name: 'database',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'Database query failed',
          error: error.message,
        };
      }

      logger.info('Database check passed', { queryResult: data });
      return {
        name: 'database',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Database connection operational',
        details: {
          connection_verified: true,
        },
      };
    } catch (queryError) {
      logger.error('Database query exception', queryError);
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Database query exception',
        error: queryError instanceof Error ? queryError.message : String(queryError),
      };
    }
  } catch (error) {
    logger.error('Database check failed', error);
    return {
      name: 'database',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Database check failed',
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
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      logger.error('Missing Supabase credentials for auth check');
      return {
        name: 'authentication',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Missing authentication credentials',
        error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured',
      };
    }

    let supabase;
    try {
      supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          fetch: fetch.bind(globalThis),
        },
      });
    } catch (clientError) {
      logger.error('Failed to create Supabase client for auth', clientError);
      return {
        name: 'authentication',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Failed to create auth client',
        error: clientError instanceof Error ? clientError.message : String(clientError),
      };
    }

    // Test auth system by getting session (should be null for anon)
    try {
      const { data, error } = await withTimeout(
        supabase.auth.getSession(),
        3000,
        'Auth check timeout after 3 seconds'
      );

      if (error) {
        logger.error('Auth system error', error);
        return {
          name: 'authentication',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'Authentication system check failed',
          error: error.message,
        };
      }

      logger.info('Authentication check passed', { hasSession: !!data.session });
      return {
        name: 'authentication',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Authentication system operational',
        details: {
          auth_available: true,
          session_checked: true,
        },
      };
    } catch (authError) {
      logger.error('Auth check exception', authError);
      return {
        name: 'authentication',
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Auth check exception',
        error: authError instanceof Error ? authError.message : String(authError),
      };
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
 * Check external service connectivity
 */
async function checkExternalServices(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting external services check');
  
  try {
    // Check if fetch is available
    if (typeof fetch === 'undefined') {
      logger.error('Fetch API not available');
      return {
        name: 'external_services',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Fetch API not available',
        error: 'fetch is undefined',
      };
    }

    // Simple connectivity check to a reliable endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('External connectivity degraded', { status: response.status });
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External connectivity degraded',
          details: {
            status_code: response.status,
            status_text: response.statusText,
          },
        };
      }

      logger.info('External services check passed');
      return {
        name: 'external_services',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'External service connectivity operational',
        details: {
          status_code: response.status,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.warn('External service check timed out');
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External service check timed out',
          error: 'Request aborted after timeout',
        };
      }
      
      throw fetchError;
    }
  } catch (error) {
    logger.error('External services check failed', error);
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
 * Run all smoke tests
 */
async function runSmokeTests(): Promise<SmokeTestResult> {
  const startTime = performance.now();
  logger.info('Starting smoke tests');

  const checks: HealthCheck[] = [];

  // Run all checks in parallel
  const [envCheck, dbCheck, authCheck, extCheck] = await Promise.all([
    checkEnvironment(),
    checkDatabase(),
    checkAuthentication(),
    checkExternalServices(),
  ]);

  checks.push(envCheck, dbCheck, authCheck, extCheck);

  // Determine overall status
  const hasFailure = checks.some(check => check.status === 'fail');
  const hasWarning = checks.some(check => check.status === 'warn');
  
  let overallStatus: 'pass' | 'fail' | 'warn';
  if (hasFailure) {
    overallStatus = 'fail';
  } else if (hasWarning) {
    overallStatus = 'warn';
  } else {
    overallStatus = 'pass';
  }

  const duration = performance.now() - startTime;
  
  const result: SmokeTestResult = {
    success: overallStatus === 'pass',
    timestamp: new Date().toISOString(),
    duration_ms: duration,
    checks,
    overall_status: overallStatus,
  };

  logger.info('Smoke tests completed', { 
    overall_status: overallStatus,
    duration_ms: duration,
    checks_count: checks.length 
  });

  return result;
}

/**
 * Main handler wrapped in Deno.serve
 */
Deno.serve(async (req: Request) => {
  try {
    logger.info('Smoke test handler invoked', { 
      method: req.method,
      url: req.url 
    });

    // Run smoke tests
    const result = await runSmokeTests();

    // Determine HTTP status code based on overall result
    const statusCode = result.overall_status === 'fail' ? 503 : 200;

    return new Response(
      JSON.stringify(result, null, 2),
      {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    logger.error('Smoke test handler error', error);
    
    const errorResponse = {
      success: false,
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      overall_status: 'fail',
    };

    return new Response(
      JSON.stringify(errorResponse, null, 2),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
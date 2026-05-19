import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const FUNCTION_START_TIME = performance.now();

/**
 * Type definitions
 */
interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  duration_ms: number;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
}

interface SmokeTestResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    failed: number;
    total_duration_ms: number;
  };
}

/**
 * Logger utility with structured output
 */
const logger = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', message, ...data, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...data, timestamp: new Date().toISOString() }));
  },
  error: (message: string, error?: unknown, data?: Record<string, unknown>) => {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : String(error),
      ...data,
      timestamp: new Date().toISOString(),
    }));
  },
};

/**
 * Safe timeout wrapper for async operations
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: number | undefined;
  
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Check Deno runtime availability and version
 */
async function checkDenoRuntime(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting Deno runtime check');
  
  try {
    const version = Deno.version;
    const hasRequiredAPIs = typeof Deno.serve === 'function' &&
                           typeof Deno.env === 'object' &&
                           typeof performance === 'object';

    if (!hasRequiredAPIs) {
      logger.error('Missing required Deno APIs', null, { version });
      return {
        name: 'deno_runtime',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Required Deno APIs not available',
        details: { version },
        error: 'Missing Deno.serve, Deno.env, or performance API',
      };
    }

    logger.info('Deno runtime check passed', { version });
    return {
      name: 'deno_runtime',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Deno runtime operational',
      details: {
        deno: version.deno,
        v8: version.v8,
        typescript: version.typescript,
      },
    };
  } catch (error) {
    logger.error('Deno runtime check failed', error);
    return {
      name: 'deno_runtime',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Deno runtime check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check environment variables and configuration
 */
async function checkEnvironment(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting environment check');
  
  try {
    const requiredVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];

    const missingVars = requiredVars.filter(varName => {
      try {
        const value = Deno.env.get(varName);
        return !value || value.trim().length === 0;
      } catch {
        return true;
      }
    });

    if (missingVars.length > 0) {
      logger.error('Missing required environment variables', null, { missingVars });
      return {
        name: 'environment',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: `Missing required environment variables: ${missingVars.join(', ')}`,
        details: {
          missing_variables: missingVars,
          total_required: requiredVars.length,
        },
        error: 'Configuration incomplete',
      };
    }

    // Validate URL format
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      if (supabaseUrl) {
        new URL(supabaseUrl);
      }
    } catch (urlError) {
      logger.error('Invalid SUPABASE_URL format', urlError);
      return {
        name: 'environment',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Invalid SUPABASE_URL format',
        error: urlError instanceof Error ? urlError.message : String(urlError),
      };
    }

    logger.info('Environment check passed', { requiredVarsCount: requiredVars.length });
    return {
      name: 'environment',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'All required environment variables present',
      details: {
        variables_checked: requiredVars.length,
        all_present: true,
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
 * Check database connectivity and basic operations
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
        message: 'Missing Supabase credentials',
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
        message: 'Failed to create Supabase client',
        error: clientError instanceof Error ? clientError.message : String(clientError),
      };
    }

    // Test basic database connectivity with timeout
    try {
      const { data, error, status } = await withTimeout(
        supabase.from('users').select('count', { count: 'exact', head: true }),
        5000,
        'Database query timeout after 5 seconds'
      );

      if (error) {
        logger.error('Database query error', error, { status });
        return {
          name: 'database',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'Database query failed',
          details: {
            error_code: error.code,
            error_hint: error.hint,
            status,
          },
          error: error.message,
        };
      }

      logger.info('Database check passed', { status });
      return {
        name: 'database',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Database connectivity operational',
        details: {
          query_status: status,
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
      message: error instanceof Error ? error.message : 'External
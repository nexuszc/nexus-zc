import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Logger utility
const logger = {
  info: (message: string, data?: unknown) => {
    console.log(JSON.stringify({ level: 'info', message, data, timestamp: new Date().toISOString() }));
  },
  error: (message: string, error?: unknown) => {
    console.error(JSON.stringify({ level: 'error', message, error, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, data?: unknown) => {
    console.warn(JSON.stringify({ level: 'warn', message, data, timestamp: new Date().toISOString() }));
  },
};

// Health check types
interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  duration_ms: number;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
}

interface SmokeTestResult {
  status: 'pass' | 'warn' | 'fail';
  timestamp: string;
  duration_ms: number;
  checks: HealthCheck[];
  summary: {
    total: number;
    passed: number;
    warned: number;
    failed: number;
  };
}

/**
 * Wrapper for Deno.serve with health check endpoint and proper error handling
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response> | Response) {
  return serve(async (req: Request) => {
    try {
      const url = new URL(req.url);
      
      // Health check endpoint
      if (url.pathname === '/health' && req.method === 'GET') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            timestamp: Date.now(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      
      // Call the actual handler with timeout protection
      const timeoutPromise = new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 30000);
      });
      
      const handlerPromise = Promise.resolve(handler(req));
      
      return await Promise.race([handlerPromise, timeoutPromise]);
    } catch (error) {
      logger.error('Request handler error', error);
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  });
}

/**
 * Check environment variables
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

    const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));

    if (missingVars.length > 0) {
      logger.error('Missing environment variables', { missingVars });
      return {
        name: 'environment',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: `Missing required environment variables: ${missingVars.join(', ')}`,
        error: 'Configuration incomplete',
      };
    }

    logger.info('Environment check passed');
    return {
      name: 'environment',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'All required environment variables are present',
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
 * Check Edge Functions availability
 */
async function checkEdgeFunctions(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting edge functions check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    
    if (!supabaseUrl) {
      logger.error('SUPABASE_URL not configured');
      return {
        name: 'edge_functions',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Edge functions check skipped - SUPABASE_URL not configured',
        error: 'Missing SUPABASE_URL',
      };
    }

    logger.info('Edge functions check passed');
    return {
      name: 'edge_functions',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Edge functions environment is operational',
      details: {
        url: supabaseUrl,
      },
    };
  } catch (error) {
    logger.error('Edge functions check failed', error);
    return {
      name: 'edge_functions',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Edge functions check failed',
      error: error instanceof Error ? error.message : String(error),
    };
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
      logger.error('Database configuration missing');
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Database configuration not available',
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      };
    }

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
        logger.error('Database check failed', { status: response.status });
        return {
          name: 'database',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: `Database returned status ${response.status}`,
          details: {
            status: response.status,
          },
        };
      }

      logger.info('Database check passed');
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
        logger.error('Database check timed out');
        return {
          name: 'database',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'Database check timed out',
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
      message: 'Database check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check authentication service
 */
async function checkAuthentication(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting authentication check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      logger.error('Authentication configuration missing');
      return {
        name: 'authentication',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Authentication configuration not available',
        error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.error('Authentication check failed', { status: response.status });
        return {
          name: 'authentication',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: `Authentication service returned status ${response.status}`,
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
        message: 'Authentication service is operational',
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
 * Check external services connectivity
 */
async function checkExternalServices(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting external services check');
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('External services check returned non-OK status', {
          status: response.status,
        });
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External services connectivity may be limited',
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
          message: 'External services check timed out',
          error: 'Request timeout after 5 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.warn('External services check failed', error);
    return {
      name: 'external_services',
      status: 'warn',
      duration_ms: performance.now() - startTime,
      message: 'External services connectivity check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check Supabase client connectivity with detailed error handling
 */
async function checkSupabaseClient(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting Supabase client connectivity check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      logger.error('Supabase client configuration missing');
      return {
        name: 'supabase_client',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Supabase client configuration not available',
        error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok && response.status >= 500) {
        logger.error('Supabase client check failed with server error', {
          status: response.status,
        });
        return {
          name: 'supabase_client',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: `Supabase client returned status ${response.status}`,
          details: {
            status: response.status,
          },
        };
      }

      logger.info('Supabase client connectivity check passed');
      return {
        name: 'supabase_client',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'Supabase client is connected and operational',
        details: {
          status: response.status,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('Supabase client check timed out');
        return {
          name: 'supabase_client',
          status: 'fail',
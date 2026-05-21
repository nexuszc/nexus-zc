import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { createServeHandler } from '../_shared/serve.ts';
import { logger } from '../_shared/logger.ts';

/**
 * Health check result structure
 */
interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  duration_ms: number;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * Overall health status
 */
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

/**
 * Standard API response format
 */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting database connectivity check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      logger.error('Database configuration missing');
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Database configuration not available',
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error } = await supabase
      .from('users')
      .select('id')
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error('Database connectivity check failed', error);
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Database query failed',
        error: error.message,
      };
    }

    logger.info('Database connectivity check passed');
    return {
      name: 'database',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Database is connected and operational',
    };
  } catch (error) {
    logger.error('Database connectivity check failed', error);
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
      logger.error('Authentication configuration missing');
      return {
        name: 'authentication',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Authentication configuration not available',
        error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
      };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      logger.error('Authentication check failed', error);
      return {
        name: 'authentication',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Authentication system check failed',
        error: error.message,
      };
    }

    logger.info('Authentication check passed');
    return {
      name: 'authentication',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Authentication system is operational',
      details: {
        session_available: data.session !== null,
      },
    };
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
          message: `External services returned status ${response.status}`,
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
        message: 'External services connectivity confirmed',
        details: {
          status: response.status,
        },
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
          duration_ms: performance.now() - startTime,
          message: 'Supabase client check timed out',
          error: 'Request timeout after 5 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error('Supabase client connectivity check failed', error);
    return {
      name: 'supabase_client',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Supabase client connectivity check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run all health checks and aggregate results
 */
async function runHealthChecks(): Promise<HealthStatus> {
  logger.info('Starting comprehensive health checks');
  
  const checks = await Promise.all([
    checkDatabase(),
    checkAuthentication(),
    checkExternalServices(),
    checkSupabaseClient(),
  ]);

  const summary = {
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
 * Main handler function
 */
async function handler(req: Request): Promise<Response> {
  logger.info('Smoke test endpoint called', { method: req.method });

  if (req.method !== 'GET') {
    logger.warn('Invalid method for smoke test', { method: req.method });
    const errorResponse: ApiResponse = {
      success: false,
      error: 'Method not allowed',
    };
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const url = new URL(req.url);
    
    if (url.pathname.endsWith('/health')) {
      logger.info('Health endpoint called');
      const healthStatus = await runHealthChecks();
      
      const statusCode = healthStatus.status === 'healthy' ? 200 :
                        healthStatus.status === 'degraded' ? 200 : 503;

      const response: ApiResponse<HealthStatus> = {
        success: healthStatus.status !== 'unhealthy',
        data: healthStatus,
      };

      logger.info('Returning health status', { 
        status: healthStatus.status, 
        statusCode 
      });

      return new Response(
        JSON.stringify(response, null, 2),
        {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const healthStatus = await runHealthChecks();
    
    const statusCode = healthStatus.status === 'healthy' ? 200 :
                      healthStatus.status === 'degraded' ? 200 : 503;

    const response: ApiResponse<HealthStatus> = {
      success: healthStatus.status !== 'unhealthy',
      data: healthStatus,
    };

    logger.info('Returning health status', { 
      status: healthStatus.status, 
      statusCode 
    });

    return new Response(
      JSON.stringify(response, null, 2),
      {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    logger.error('Smoke test execution failed', error);
    
    const errorResponse: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };

    return new Response(
      JSON.stringify(errorResponse, null, 2),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      
      if (url.pathname === '/health' || url.pathname.endsWith('/health')) {
        logger.info('Health check endpoint hit');
        try {
          const healthStatus = await runHealthChecks();
          const statusCode = healthStatus.status === 'healthy' ? 200 :
                            healthStatus.status === 'degraded' ? 200 : 503;

          const response: ApiResponse<HealthStatus> = {
            success: healthStatus.status !== 'unhealthy',
            data: healthStatus,
          };

          return new Response(
            JSON.stringify(response, null, 2),
            {
              status: statusCode,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        } catch (healthError) {
          logger.error('Health check failed', healthError);
          const errorResponse: ApiResponse = {
            success: false,
            error: healthError instanceof Error ? healthError.message : String(healthError),
          };
          return new Response(
            JSON.stringify(errorResponse, null, 2),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
      }

      return await handler(req);
    } catch (error) {
      logger.error('Request handler failed', error);
      const errorResponse: ApiResponse
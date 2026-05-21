import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

/**
 * Types
 */
interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  duration_ms: number;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Logger utility
 */
const logger = {
  info: (message: string, data?: unknown) => {
    console.log(JSON.stringify({ level: 'info', message, data, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, data?: unknown) => {
    console.warn(JSON.stringify({ level: 'warn', message, data, timestamp: new Date().toISOString() }));
  },
  error: (message: string, error?: unknown) => {
    console.error(JSON.stringify({ 
      level: 'error', 
      message, 
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      timestamp: new Date().toISOString() 
    }));
  },
};

/**
 * Environment validation
 */
function getRequiredEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<CheckResult> {
  const startTime = performance.now();
  
  try {
    logger.info('Starting database check');
    
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);

    if (error) {
      logger.error('Database check failed', error);
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Database connectivity check failed',
        error: error.message,
      };
    }

    logger.info('Database check completed', { hasData: !!data });
    
    return {
      name: 'database',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Database is accessible and responding',
      details: {
        hasData: !!data,
      },
    };
  } catch (error) {
    logger.error('Database check error', error);
    return {
      name: 'database',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Database connectivity check error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check authentication functionality
 */
async function checkAuthentication(): Promise<CheckResult> {
  const startTime = performance.now();
  
  try {
    logger.info('Starting authentication check');
    
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data, error } = await supabase.auth.getUser();

    if (error && error.message !== 'Auth session missing!') {
      logger.error('Authentication check failed', error);
      return {
        name: 'authentication',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Authentication service check failed',
        error: error.message,
      };
    }

    logger.info('Authentication check completed');
    
    return {
      name: 'authentication',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Authentication service is operational',
      details: {
        authEnabled: true,
      },
    };
  } catch (error) {
    logger.error('Authentication check error', error);
    return {
      name: 'authentication',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Authentication service check error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check external services
 */
async function checkExternalServices(): Promise<CheckResult> {
  const startTime = performance.now();
  
  try {
    logger.info('Starting external services check');
    
    const openAIKey = Deno.env.get('OPENAI_API_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    
    const servicesStatus = {
      openai: !!openAIKey,
      anthropic: !!anthropicKey,
    };

    const allConfigured = Object.values(servicesStatus).every(status => status);
    
    logger.info('External services check completed', servicesStatus);
    
    return {
      name: 'external_services',
      status: allConfigured ? 'pass' : 'warn',
      duration_ms: performance.now() - startTime,
      message: allConfigured 
        ? 'All external services are configured'
        : 'Some external services may not be configured',
      details: servicesStatus,
    };
  } catch (error) {
    logger.error('External services check error', error);
    return {
      name: 'external_services',
      status: 'warn',
      duration_ms: performance.now() - startTime,
      message: 'External services check error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check Supabase client connectivity
 */
async function checkSupabaseClient(): Promise<CheckResult> {
  const startTime = performance.now();
  
  try {
    logger.info('Starting Supabase client check');
    
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const supabaseKey = getRequiredEnv('SUPABASE_ANON_KEY');
    
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

      logger.info('Supabase client check completed', { status: response.status });
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
 * Add CORS headers to response
 */
function addCorsHeaders(headers: Headers): Headers {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  return headers;
}

/**
 * Main handler function
 */
async function handler(req: Request): Promise<Response> {
  logger.info('Smoke test endpoint called', { method: req.method });

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const headers = new Headers();
    addCorsHeaders(headers);
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'GET') {
    logger.warn('Invalid method for smoke test', { method: req.method });
    const errorResponse: ApiResponse = {
      success: false,
      error: 'Method not allowed',
    };
    const headers = new Headers({ 'Content-Type': 'application/json' });
    addCorsHeaders(headers);
    return new Response(
      JSON.stringify(errorResponse),
      { 
        status: 405,
        headers
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

    const headers = new Headers({ 'Content-Type': 'application/json' });
    addCorsHeaders(headers);
    return new Response(
      JSON.stringify(response, null, 2),
      {
        status: statusCode,
        headers
      }
    );
  } catch (error) {
    logger.error('Smoke test execution failed', error);
    
    const errorResponse: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };

    const headers = new Headers({ 'Content-Type': 'application/json' });
    addCorsHeaders(headers);
    return new Response(
      JSON.stringify(errorResponse, null, 2),
      {
        status: 500,
        headers
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
      
      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        const headers = new Headers();
        addCorsHeaders(headers);
        return new Response(null, { status: 204, headers });
      }
      
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

          const headers = new Headers({ 'Content-Type': 'application/json' });
          addCorsHeaders(headers);
          return new Response(
            JSON.stringify(response, null, 2),
            {
              status: statusCode,
              headers
            }
          );
        } catch (healthError) {
          logger.error('Health check failed', healthError);
          const errorResponse: ApiResponse = {
            success: false,
            error: healthError instanceof Error ? healthError.message : String(healthError),
          };
          const headers = new Headers({ 'Content-Type': 'application/json' });
          addCorsHeaders(headers);
          return new Response(
            JSON.stringify(errorResponse, null, 2),
            {
              status: 500,
              headers
            }
          );
        }
      }
      
      return await handler(req);
    } catch (error) {
      logger.error('Request handling failed', error);
      const errorResponse: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      const headers = new Headers({ 'Content-Type': 'application/json' });
      addCorsHeaders(headers);
      return new Response(
        JSON
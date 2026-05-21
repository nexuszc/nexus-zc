import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * Logger utility for structured logging
 */
const logger = {
  info: (message: string, data?: unknown) => {
    console.log(JSON.stringify({ level: 'info', message, data, timestamp: new Date().toISOString() }));
  },
  error: (message: string, error?: unknown) => {
    console.error(JSON.stringify({ level: 'error', message, error: error instanceof Error ? { message: error.message, stack: error.stack } : error, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, data?: unknown) => {
    console.warn(JSON.stringify({ level: 'warn', message, data, timestamp: new Date().toISOString() }));
  },
};

/**
 * Type definitions
 */
interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  duration_ms: number;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
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
 * Get required environment variables with validation
 */
function getEnvVars() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL environment variable is not set');
  }
  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set');
  }
  if (!supabaseAnonKey) {
    throw new Error('SUPABASE_ANON_KEY environment variable is not set');
  }

  return { supabaseUrl, supabaseServiceKey, supabaseAnonKey };
}

/**
 * Check database connectivity and basic operations
 */
async function checkDatabase(): Promise<CheckResult> {
  const startTime = performance.now();
  
  try {
    logger.info('Starting database connectivity check');
    const { supabaseUrl, supabaseServiceKey } = getEnvVars();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Test 1: Simple query
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    if (error) {
      logger.error('Database query failed', error);
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Database query failed',
        error: error.message,
      };
    }

    logger.info('Database check passed', { rowCount: data?.length ?? 0 });
    return {
      name: 'database',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Database is accessible and responding',
      details: {
        rowCount: data?.length ?? 0,
      },
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
 * Check authentication service
 */
async function checkAuthentication(): Promise<CheckResult> {
  const startTime = performance.now();
  
  try {
    logger.info('Starting authentication service check');
    const { supabaseUrl, supabaseServiceKey } = getEnvVars();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Test: List users (limited to 1)
    const { data, error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    if (error) {
      logger.error('Authentication service check failed', error);
      return {
        name: 'authentication',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Authentication service check failed',
        error: error.message,
      };
    }

    logger.info('Authentication check passed', { userCount: data.users.length });
    return {
      name: 'authentication',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Authentication service is operational',
      details: {
        userCount: data.users.length,
      },
    };
  } catch (error) {
    logger.error('Authentication service check failed', error);
    return {
      name: 'authentication',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Authentication service check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check external services connectivity
 */
async function checkExternalServices(): Promise<CheckResult> {
  const startTime = performance.now();
  
  try {
    logger.info('Starting external services check');
    const { supabaseUrl } = getEnvVars();

    // Test: Health endpoint of Supabase
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok && response.status !== 401 && response.status !== 404) {
        logger.warn('External service returned non-OK status', { status: response.status });
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External service returned non-OK status',
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
        message: 'External services are reachable',
        details: {
          status: response.status,
        },
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.error('External services check timed out');
        return {
          name: 'external_services',
          status: 'fail',
          duration_ms: performance.now() - startTime,
          message: 'External services check timed out',
          error: 'Request timeout after 5 seconds',
        };
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error('External services check failed', error);
    return {
      name: 'external_services',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'External services check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check Supabase client initialization
 */
async function checkSupabaseClient(): Promise<CheckResult> {
  const startTime = performance.now();
  
  try {
    logger.info('Starting Supabase client check');
    const { supabaseUrl, supabaseAnonKey } = getEnvVars();
    
    // Test: Initialize client with anon key
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Test: Simple health check using anon client
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'apikey': supabaseAnonKey,
        },
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
          const statusCode = healthStatus.status ===
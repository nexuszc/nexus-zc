import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * Logger utility for structured logging
 */
const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...meta, timestamp: new Date().toISOString() }));
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
 * Health check result interface
 */
interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  duration_ms: number;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
  response_time_ms?: number;
}

/**
 * Overall smoke test result
 */
interface SmokeTestResult {
  success: boolean;
  timestamp: string;
  duration_ms: number;
  checks: HealthCheck[];
  overall_status: 'pass' | 'fail' | 'warn';
  environment?: string;
  version?: string;
  service_dependencies?: {
    database: boolean;
    edge_functions: boolean;
    external_services: boolean;
  };
}

/**
 * Check database connectivity with enhanced metrics
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
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      };
    }

    const queryStartTime = performance.now();
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Test with a simple query
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    const queryDuration = performance.now() - queryStartTime;

    if (error) {
      logger.error('Database query failed', error);
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        response_time_ms: queryDuration,
        message: 'Database query failed',
        error: error.message,
        details: {
          error_code: error.code,
          error_hint: error.hint,
        },
      };
    }

    logger.info('Database check passed', { query_duration_ms: queryDuration });
    return {
      name: 'database',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      response_time_ms: queryDuration,
      message: 'Database connectivity operational',
      details: {
        query_executed: true,
        records_tested: data?.length || 0,
      },
    };
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
 * Check authentication service
 */
async function checkAuthentication(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting authentication check');
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      logger.warn('Auth credentials not configured');
      return {
        name: 'authentication',
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Auth credentials not configured',
        error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
      };
    }

    const authStartTime = performance.now();
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Test auth service availability
    const { data, error } = await supabase.auth.getSession();
    const authDuration = performance.now() - authStartTime;

    if (error) {
      logger.error('Authentication service check failed', error);
      return {
        name: 'authentication',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        response_time_ms: authDuration,
        message: 'Authentication service failed',
        error: error.message,
      };
    }

    logger.info('Authentication check passed', { auth_duration_ms: authDuration });
    return {
      name: 'authentication',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      response_time_ms: authDuration,
      message: 'Authentication service operational',
      details: {
        service_available: true,
        session_check: 'completed',
      },
    };
  } catch (error) {
    logger.error('Authentication check failed', error);
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
async function checkExternalServices(): Promise<HealthCheck> {
  const startTime = performance.now();
  logger.info('Starting external services check');
  
  try {
    if (typeof fetch === 'undefined') {
      logger.warn('Fetch API not available');
      return {
        name: 'external_services',
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Fetch API not available',
        error: 'fetch is undefined',
      };
    }

    // Simple connectivity check to a reliable endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const fetchStartTime = performance.now();
      const response = await fetch('https://www.google.com', {
        method: 'HEAD',
        signal: controller.signal,
      });
      const fetchDuration = performance.now() - fetchStartTime;

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn('External connectivity degraded', { status: response.status });
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          response_time_ms: fetchDuration,
          message: 'External connectivity degraded',
          details: {
            status_code: response.status,
            status_text: response.statusText,
          },
        };
      }

      logger.info('External services check passed', { fetch_duration_ms: fetchDuration });
      return {
        name: 'external_services',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        response_time_ms: fetchDuration,
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
        status: 'warn',
        duration_ms: performance.now() - startTime,
        message: 'Not running in Deno runtime',
        details: {
          runtime: 'unknown',
        },
      };
    }

    logger.info('Edge functions check passed');
    return {
      name: 'edge_functions',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Edge function runtime operational',
      details: {
        runtime: 'deno',
        serve_available: hasDenoServe,
        version: Deno.version?.deno || 'unknown',
      },
    };
  } catch (error) {
    logger.error('Edge functions check failed', error);
    return {
      name: 'edge_functions',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: 'Edge function check failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run all smoke tests with enhanced error handling
 */
async function runSmokeTests(): Promise<SmokeTestResult> {
  const startTime = performance.now();
  logger.info('Starting comprehensive smoke tests');

  const checks: HealthCheck[] = [];

  try {
    // Run all checks in parallel with individual error handling
    const checkResults = await Promise.allSettled([
      checkEnvironment(),
      checkDatabase(),
      checkAuthentication(),
      checkExternalServices(),
      checkEdgeFunctions(),
    ]);

    // Process results and handle rejected promises
    for (const result of checkResults) {
      if (result.status === 'fulfilled') {
        checks.push(result.value);
      } else {
        // If a check promise was rejected, add a failure check
        logger.error('Check promise rejected', result.reason);
        checks.push({
          name: 'unknown_check',
          status: 'fail',
          duration_ms: 0,
          message: 'Check failed to complete',
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

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
    
    // Calculate service dependencies status
    const dbCheck = checks.find(c => c.name === 'database');
    const edgeFnCheck = checks.find(c => c.name === 'edge_functions');
    const extCheck = checks.find(c => c.name === 'external_services');
    
    const result: SmokeTestResult = {
      success: overallStatus === 'pass',
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      checks,
      overall_status: overallStatus,
      environment: Deno.env.get('ENVIRONMENT') || 'unknown',
      version: Deno.version?.deno || 'unknown',
      service_dependencies: {
        database: dbCheck?.status === 'pass',
        edge_functions: edgeFnCheck?.status === 'pass',
        external_services: extCheck?.status === 'pass' || extCheck?.status === 'warn',
      },
    };

    logger.info('Smoke tests completed successfully', { 
      overall_status: overallStatus,
      duration_ms: duration,
      checks_count: checks.length,
      passed: checks.filter(c => c.status === 'pass').length,
      warned: checks.filter(c => c.status === 'warn').length,
      failed: checks.filter(c => c.status === 'fail').length,
    });
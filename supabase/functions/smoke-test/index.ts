// supabase/functions/smoke-test/index.ts

/**
 * Smoke Test Edge Function
 * 
 * Performs comprehensive health checks on the Nexus system including:
 * - Deno runtime verification
 * - Environment configuration
 * - Database connectivity
 * - External service availability
 * - Performance metrics
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const FUNCTION_START_TIME = performance.now();

interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  duration_ms: number;
  message: string;
  details?: Record<string, unknown>;
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
 * Check Deno runtime environment
 */
async function checkDenoRuntime(): Promise<HealthCheck> {
  const startTime = performance.now();
  try {
    const version = Deno.version;
    const permissions = {
      env: await Deno.permissions.query({ name: 'env' }),
      net: await Deno.permissions.query({ name: 'net' }),
      read: await Deno.permissions.query({ name: 'read' }),
    };

    const allGranted = Object.values(permissions).every(p => p.state === 'granted');

    return {
      name: 'deno_runtime',
      status: allGranted ? 'pass' : 'warn',
      duration_ms: performance.now() - startTime,
      message: allGranted ? 'Deno runtime operational' : 'Some permissions not granted',
      details: {
        deno_version: version.deno,
        v8_version: version.v8,
        typescript_version: version.typescript,
        permissions: Object.fromEntries(
          Object.entries(permissions).map(([k, v]) => [k, v.state])
        ),
      },
    };
  } catch (error) {
    return {
      name: 'deno_runtime',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: error instanceof Error ? error.message : 'Runtime check failed',
    };
  }
}

/**
 * Check environment configuration
 */
async function checkEnvironment(): Promise<HealthCheck> {
  const startTime = performance.now();
  try {
    const requiredVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];

    const missing: string[] = [];
    const present: string[] = [];

    for (const varName of requiredVars) {
      const value = Deno.env.get(varName);
      if (!value) {
        missing.push(varName);
      } else {
        present.push(varName);
      }
    }

    const status = missing.length === 0 ? 'pass' : 'fail';

    return {
      name: 'environment',
      status,
      duration_ms: performance.now() - startTime,
      message: missing.length === 0
        ? 'All required environment variables present'
        : `Missing required variables: ${missing.join(', ')}`,
      details: {
        required_vars: requiredVars,
        present_count: present.length,
        missing_count: missing.length,
        missing_vars: missing,
      },
    };
  } catch (error) {
    return {
      name: 'environment',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: error instanceof Error ? error.message : 'Environment check failed',
    };
  }
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheck> {
  const startTime = performance.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Missing Supabase credentials',
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Perform a simple query to verify connectivity
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    if (error) {
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Database query failed',
        details: {
          error_message: error.message,
          error_code: error.code,
        },
      };
    }

    return {
      name: 'database',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Database connectivity confirmed',
      details: {
        query_successful: true,
      },
    };
  } catch (error) {
    return {
      name: 'database',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: error instanceof Error ? error.message : 'Database check failed',
    };
  }
}

/**
 * Check external service connectivity
 */
async function checkExternalServices(): Promise<HealthCheck> {
  const startTime = performance.now();
  try {
    // Check if fetch is available
    if (typeof fetch === 'undefined') {
      return {
        name: 'external_services',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Fetch API not available',
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
        return {
          name: 'external_services',
          status: 'warn',
          duration_ms: performance.now() - startTime,
          message: 'External connectivity degraded',
          details: {
            status_code: response.status,
          },
        };
      }

      return {
        name: 'external_services',
        status: 'pass',
        duration_ms: performance.now() - startTime,
        message: 'External service connectivity operational',
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    return {
      name: 'external_services',
      status: 'warn',
      duration_ms: performance.now() - startTime,
      message: error instanceof Error ? error.message : 'External services check failed',
    };
  }
}

/**
 * Check function performance metrics
 */
async function checkPerformance(): Promise<HealthCheck> {
  const startTime = performance.now();
  try {
    const uptime = performance.now() - FUNCTION_START_TIME;
    const memoryUsage = Deno.memoryUsage();
    const memoryMB = memoryUsage.heapUsed / 1024 / 1024;

    // Determine performance status
    let status: 'pass' | 'warn' | 'fail' = 'pass';
    const issues: string[] = [];

    if (memoryMB > 128) {
      status = 'warn';
      issues.push('High memory usage');
    }

    if (uptime > 300000) { // 5 minutes
      status = 'warn';
      issues.push('Long uptime may indicate stale instance');
    }

    return {
      name: 'performance',
      status,
      duration_ms: performance.now() - startTime,
      message: issues.length > 0 ? issues.join(', ') : 'Performance metrics nominal',
      details: {
        uptime_ms: Math.round(uptime),
        memory_mb: Math.round(memoryMB * 100) / 100,
        heap_total_mb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 100) / 100,
        external_mb: Math.round((memoryUsage.external / 1024 / 1024) * 100) / 100,
      },
    };
  } catch (error) {
    return {
      name: 'performance',
      status: 'warn',
      duration_ms: performance.now() - startTime,
      message: error instanceof Error ? error.message : 'Performance check failed',
    };
  }
}

/**
 * Run all health checks
 */
async function runHealthChecks(): Promise<SmokeTestResponse> {
  const overallStartTime = performance.now();
  
  // Run all checks in parallel
  const checks = await Promise.all([
    checkDenoRuntime(),
    checkEnvironment(),
    checkDatabase(),
    checkExternalServices(),
    checkPerformance(),
  ]);

  // Calculate summary
  const passed = checks.filter(c => c.status === 'pass').length;
  const warnings = checks.filter(c => c.status === 'warn').length;
  const failed = checks.filter(c => c.status === 'fail').length;

  // Determine overall status
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (failed > 0) {
    overallStatus = 'unhealthy';
  } else if (warnings > 0) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
    summary: {
      total: checks.length,
      passed,
      warnings,
      failed,
      total_duration_ms: Math.round((performance.now() - overallStartTime) * 100) / 100,
    },
  };
}

Deno.serve(async (req) => {
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Only accept GET requests for smoke test
    if (req.method !== 'GET') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Run all health checks
    const result = await runHealthChecks();

    // Determine HTTP status code based on health
    let httpStatus: number;
    switch (result.status) {
      case 'healthy':
        httpStatus = 200;
        break;
      case 'degraded':
        httpStatus = 200; // Still operational
        break;
      case 'unhealthy':
        httpStatus = 503; // Service unavailable
        break;
      default:
        httpStatus = 500;
    }

    return new Response(
      JSON.stringify(result, null, 2),
      {
        status: httpStatus,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Smoke test error:', error);
    
    const errorResponse: SmokeTestResponse = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      checks: [{
        name: 'smoke_test',
        status: 'fail',
        duration_ms: 0,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      }],
      summary: {
        total: 1,
        passed: 0,
        warnings: 0,
        failed: 1,
        total_duration_ms: 0,
      },
    };

    return new Response(
      JSON.stringify(errorResponse, null, 2),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});
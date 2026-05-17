import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  duration_ms: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  environment: string;
  uptime_ms: number;
  checks: HealthCheck[];
  metadata: {
    deno_version: string;
    region: string;
    function_name: string;
  };
}

interface ErrorResponse {
  error: string;
  message: string;
  timestamp: string;
  path: string;
  details?: Record<string, unknown>;
}

interface RequestValidation {
  valid: boolean;
  error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const FUNCTION_NAME = 'smoke-test';
const FUNCTION_VERSION = '1.0.0';
const FUNCTION_START_TIME = performance.now();

// Request validation constants
const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB
const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://nexus.app',
  /^https:\/\/.*\.nexus\.app$/,
];

// Health check configuration
const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds
const DATABASE_QUERY_TIMEOUT = 3000; // 3 seconds

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

/**
 * Structured logging function
 */
function log(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  context?: Record<string, unknown>
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    function: FUNCTION_NAME,
    message,
    ...context,
  };
  console.log(JSON.stringify(logEntry));
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate incoming request
 */
function validateRequest(req: Request): RequestValidation {
  const method = req.method;
  const url = new URL(req.url);

  // Check HTTP method
  if (!ALLOWED_METHODS.includes(method)) {
    return {
      valid: false,
      error: `Method ${method} not allowed. Allowed methods: ${ALLOWED_METHODS.join(', ')}`,
    };
  }

  // Check origin for non-GET requests
  if (method !== 'GET' && method !== 'OPTIONS') {
    const origin = req.headers.get('origin');
    if (!origin) {
      return {
        valid: false,
        error: 'Origin header required for non-GET requests',
      };
    }

    const isAllowedOrigin = ALLOWED_ORIGINS.some((allowed) => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      }
      return allowed.test(origin);
    });

    if (!isAllowedOrigin) {
      return {
        valid: false,
        error: `Origin ${origin} not allowed`,
      };
    }
  }

  // Check content-length for POST requests
  if (method === 'POST') {
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
      return {
        valid: false,
        error: `Request body too large. Maximum size: ${MAX_REQUEST_SIZE} bytes`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate health check result structure
 */
function validateHealthCheckResult(
  check: unknown,
  checkName: string
): check is HealthCheck {
  if (!check || typeof check !== 'object') {
    log('error', 'Health check result is not an object', { checkName });
    return false;
  }

  const c = check as Record<string, unknown>;

  if (typeof c.name !== 'string') {
    log('error', 'Health check missing valid name', { checkName });
    return false;
  }

  if (!['pass', 'fail', 'warn'].includes(c.status as string)) {
    log('error', 'Health check has invalid status', { checkName, status: c.status });
    return false;
  }

  if (typeof c.duration_ms !== 'number' || c.duration_ms < 0) {
    log('error', 'Health check has invalid duration', { checkName, duration: c.duration_ms });
    return false;
  }

  return true;
}

/**
 * Sanitize health check result to prevent injection
 */
function sanitizeHealthCheck(check: HealthCheck): HealthCheck {
  return {
    name: String(check.name).substring(0, 100),
    status: check.status,
    duration_ms: Math.round(check.duration_ms * 100) / 100,
    message: check.message ? String(check.message).substring(0, 500) : undefined,
    details: check.details ? sanitizeObject(check.details) : undefined,
  };
}

/**
 * Sanitize object recursively
 */
function sanitizeObject(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 5) return {}; // Prevent deep recursion

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = String(key).substring(0, 100);
    
    if (value === null || value === undefined) {
      sanitized[sanitizedKey] = value;
    } else if (typeof value === 'string') {
      sanitized[sanitizedKey] = value.substring(0, 1000);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[sanitizedKey] = value;
    } else if (Array.isArray(value)) {
      sanitized[sanitizedKey] = value.slice(0, 100).map((item) =>
        typeof item === 'object' && item !== null
          ? sanitizeObject(item as Record<string, unknown>, depth + 1)
          : item
      );
    } else if (typeof value === 'object') {
      sanitized[sanitizedKey] = sanitizeObject(value as Record<string, unknown>, depth + 1);
    }
  }
  return sanitized;
}

// ============================================================================
// RESPONSE UTILITIES
// ============================================================================

/**
 * Create JSON response with appropriate headers
 */
function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Function-Version': FUNCTION_VERSION,
    },
  });
}

/**
 * Handle OPTIONS preflight requests
 */
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// ============================================================================
// HEALTH CHECK IMPLEMENTATIONS
// ============================================================================

/**
 * Check Deno runtime health
 */
async function checkDenoRuntime(): Promise<HealthCheck> {
  const startTime = performance.now();
  try {
    // Basic runtime checks
    const memoryUsage = Deno.memoryUsage();
    const hasRequiredAPIs = typeof Deno.serve === 'function' &&
      typeof Deno.env === 'object' &&
      typeof performance === 'object';

    if (!hasRequiredAPIs) {
      return {
        name: 'deno_runtime',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: 'Required Deno APIs not available',
      };
    }

    // Check memory pressure
    const memoryMB = memoryUsage.heapUsed / 1024 / 1024;
    const memoryStatus = memoryMB > 100 ? 'warn' : 'pass';

    return {
      name: 'deno_runtime',
      status: memoryStatus,
      duration_ms: performance.now() - startTime,
      message: 'Deno runtime operational',
      details: {
        deno_version: Deno.version.deno,
        v8_version: Deno.version.v8,
        typescript_version: Deno.version.typescript,
        memory_mb: Math.round(memoryMB * 100) / 100,
      },
    };
  } catch (error) {
    return {
      name: 'deno_runtime',
      status: 'fail',
      duration_ms: performance.now() - startTime,
      message: error instanceof Error ? error.message : 'Deno runtime check failed',
    };
  }
}

/**
 * Check environment variables
 */
async function checkEnvironment(): Promise<HealthCheck> {
  const startTime = performance.now();
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
      if (!value || value.trim() === '') {
        missingVars.push(varName);
      } else {
        presentVars.push(varName);
      }
    }

    if (missingVars.length > 0) {
      return {
        name: 'environment',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: `Missing required environment variables: ${missingVars.join(', ')}`,
        details: {
          missing: missingVars,
          present: presentVars,
        },
      };
    }

    return {
      name: 'environment',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'All required environment variables present',
      details: {
        variables_checked: requiredEnvVars.length,
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
 * Check Supabase database connectivity
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
        message: 'Database credentials not configured',
      };
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Execute simple query with timeout
    const queryPromise = supabase
      .from('profiles')
      .select('id')
      .limit(1);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Database query timeout')), DATABASE_QUERY_TIMEOUT)
    );

    const { data, error } = await Promise.race([queryPromise, timeoutPromise]) as Awaited<typeof queryPromise>;

    if (error) {
      return {
        name: 'database',
        status: 'fail',
        duration_ms: performance.now() - startTime,
        message: `Database query failed: ${error.message}`,
        details: {
          error_code: error.code,
          error_details: error.details,
        },
      };
    }

    return {
      name: 'database',
      status: 'pass',
      duration_ms: performance.now() - startTime,
      message: 'Database connection successful',
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
    // Check if fetch API is available
    if (typeof fetch !== 'function') {
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
    const memoryUsage = Deno.memoryUs
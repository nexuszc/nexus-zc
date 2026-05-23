import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

/**
 * Logger utility with structured logging
 */
const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date().toISOString() }));
  },
  error: (message: string, meta?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: 'error', message, ...meta, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...meta, timestamp: new Date().toISOString() }));
  }
};

/**
 * Validate environment variables
 */
function validateEnvironment(): { valid: boolean; errors: string[] } {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const errors: string[] = [];
  
  for (const key of required) {
    const value = Deno.env.get(key);
    if (!value) {
      errors.push(`Missing required environment variable: ${key}`);
    } else if (value.trim() === '') {
      errors.push(`Environment variable ${key} is empty`);
    }
  }
  
  if (errors.length > 0) {
    logger.error('Environment validation failed', { errors });
    return { valid: false, errors };
  }
  
  logger.info('Environment validation passed');
  return { valid: true, errors: [] };
}

/**
 * Check database connectivity with retries
 */
async function checkDatabaseConnectivity(maxRetries = 3, retryDelay = 1000): Promise<{ healthy: boolean; error?: string; attempts: number }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    logger.error('Cannot check database: missing credentials');
    return { healthy: false, error: 'Missing Supabase credentials', attempts: 0 };
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Database connectivity check attempt ${attempt}/${maxRetries}`);
      
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const { data, error } = await supabase
        .from('profiles')
        .select('count')
        .limit(1)
        .abortSignal(controller.signal);
      
      clearTimeout(timeoutId);
      
      if (error) {
        logger.error(`Database check attempt ${attempt} failed`, { 
          error: error.message,
          code: error.code,
          details: error.details
        });
        
        if (attempt < maxRetries) {
          logger.info(`Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        
        return { 
          healthy: false, 
          error: `${error.message} (code: ${error.code})`,
          attempts: attempt
        };
      }
      
      logger.info(`Database connectivity check passed on attempt ${attempt}`);
      return { healthy: true, attempts: attempt };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Database check attempt ${attempt} threw exception`, { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      if (attempt < maxRetries) {
        logger.info(`Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      
      return { 
        healthy: false, 
        error: errorMessage,
        attempts: attempt
      };
    }
  }
  
  return { 
    healthy: false, 
    error: 'Max retries exceeded',
    attempts: maxRetries
  };
}

/**
 * Check critical tables accessibility
 */
async function checkCriticalTables(): Promise<{ healthy: boolean; tables: Record<string, { accessible: boolean; error?: string }> }> {
  const criticalTables = ['profiles', 'conversations', 'messages', 'embeddings'];
  const results: Record<string, { accessible: boolean; error?: string }> = {};
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    logger.error('Cannot check tables: missing credentials');
    return { healthy: false, tables: {} };
  }
  
  for (const table of criticalTables) {
    try {
      logger.info(`Checking table accessibility: ${table}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=count&limit=1`, {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        results[table] = { accessible: true };
        logger.info(`Table ${table} is accessible`);
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        results[table] = { 
          accessible: false, 
          error: `HTTP ${response.status}: ${errorText}` 
        };
        logger.error(`Table ${table} is not accessible`, { 
          status: response.status, 
          error: errorText 
        });
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results[table] = { accessible: false, error: errorMessage };
      logger.error(`Error checking table ${table}`, { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  const allAccessible = Object.values(results).every(r => r.accessible);
  
  return { 
    healthy: allAccessible, 
    tables: results 
  };
}

/**
 * Check edge function availability
 */
async function checkEdgeFunctions(): Promise<{ healthy: boolean; functions: Record<string, { available: boolean; error?: string }> }> {
  const edgeFunctions = ['chat', 'health'];
  const results: Record<string, { available: boolean; error?: string }> = {};
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    logger.error('Cannot check edge functions: missing credentials');
    return { healthy: false, functions: {} };
  }
  
  for (const func of edgeFunctions) {
    try {
      logger.info(`Checking edge function availability: ${func}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const url = `${supabaseUrl}/functions/v1/${func}${func === 'health' ? '' : '/health'}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok || response.status === 404) {
        results[func] = { available: true };
        logger.info(`Edge function ${func} is available`, { status: response.status });
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        results[func] = { 
          available: false, 
          error: `HTTP ${response.status}: ${errorText}` 
        };
        logger.error(`Edge function ${func} is not available`, { 
          status: response.status, 
          error: errorText 
        });
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results[func] = { available: false, error: errorMessage };
      logger.error(`Error checking edge function ${func}`, { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  const allAvailable = Object.values(results).every(r => r.available);
  
  return { 
    healthy: allAvailable, 
    functions: results 
  };
}

/**
 * Comprehensive health check with detailed reporting
 */
async function performComprehensiveHealthCheck(): Promise<{
  overall: boolean;
  timestamp: string;
  checks: {
    environment: { valid: boolean; errors?: string[] };
    database: { healthy: boolean; error?: string; attempts?: number };
    tables: { healthy: boolean; tables: Record<string, { accessible: boolean; error?: string }> };
    edgeFunctions: { healthy: boolean; functions: Record<string, { available: boolean; error?: string }> };
  };
}> {
  logger.info('Starting comprehensive health check');
  
  const envCheck = validateEnvironment();
  
  let dbCheck = { healthy: false, error: 'Skipped due to environment validation failure' };
  let tablesCheck = { healthy: false, tables: {} };
  let functionsCheck = { healthy: false, functions: {} };
  
  if (envCheck.valid) {
    dbCheck = await checkDatabaseConnectivity(3, 1000);
    
    if (dbCheck.healthy) {
      [tablesCheck, functionsCheck] = await Promise.all([
        checkCriticalTables(),
        checkEdgeFunctions()
      ]);
    } else {
      logger.error('Skipping table and function checks due to database connectivity failure');
    }
  } else {
    logger.error('Skipping all checks due to environment validation failure');
  }
  
  const overall = envCheck.valid && dbCheck.healthy && tablesCheck.healthy && functionsCheck.healthy;
  
  const result = {
    overall,
    timestamp: new Date().toISOString(),
    checks: {
      environment: envCheck.valid ? { valid: true } : { valid: false, errors: envCheck.errors },
      database: dbCheck,
      tables: tablesCheck,
      edgeFunctions: functionsCheck
    }
  };
  
  logger.info('Comprehensive health check completed', {
    overall,
    environmentValid: envCheck.valid,
    databaseHealthy: dbCheck.healthy,
    tablesHealthy: tablesCheck.healthy,
    functionsHealthy: functionsCheck.healthy
  });
  
  return result;
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      
      // Health check endpoint
      if (url.pathname === '/health' || url.pathname === '/') {
        logger.info('Health check endpoint called', { 
          path: url.pathname,
          method: req.method 
        });
        
        try {
          const healthCheck = await performComprehensiveHealthCheck();
          
          const statusCode = healthCheck.overall ? 200 : 503;
          
          return new Response(
            JSON.stringify(healthCheck, null, 2),
            {
              status: statusCode,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
              }
            }
          );
        } catch (error) {
          logger.error('Health check failed with exception', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          
          return new Response(
            JSON.stringify({
              overall: false,
              timestamp: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              checks: {
                environment: { valid: false, errors: ['Health check threw exception'] },
                database: { healthy: false, error: 'Health check failed' },
                tables: { healthy: false, tables: {} },
                edgeFunctions: { healthy: false, functions: {} }
              }
            }, null, 2),
            {
              status: 503,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
              }
            }
          );
        }
      }
      
      // Delegate to actual handler for other paths
      return await handler(req);
      
    } catch (error) {
      logger.error('Request handler failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        }, null, 2),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    }
  };
}

/**
 * Main handler - smoke test endpoints
 */
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  logger.info('Smoke test request received', {
    path: url.pathname,
    method: req.method
  });
  
  // Test endpoint: basic ping
  if (url.pathname === '/test/ping') {
    logger.info('Ping test endpoint called');
    return new Response(
      JSON.stringify({
        success: true,
        message: 'pong',
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
  
  // Test endpoint: environment check
  if (url.pathname === '/test/env') {
    logger.info('Environment test endpoint called');
    const envCheck = validateEnvironment();
    return new Response(
      JSON.stringify({
        success: envCheck.valid,
        ...envCheck,
        timestamp: new Date().toISOString()
      }),
      {
        status: envCheck.valid ? 200
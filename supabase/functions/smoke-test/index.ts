// supabase/functions/smoke-test/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * Logger utility for structured logging
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
 * Environment variable validation
 */
interface EnvironmentCheck {
  valid: boolean;
  errors: string[];
}

function validateEnvironment(): EnvironmentCheck {
  const errors: string[] = [];
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  
  for (const varName of required) {
    if (!Deno.env.get(varName)) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Database connection test
 */
async function testDatabaseConnection(): Promise<{ healthy: boolean; error?: string; latency?: number }> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      return {
        healthy: false,
        error: 'Missing Supabase credentials'
      };
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    const startTime = Date.now();
    const { error } = await supabase.from('users').select('count').limit(1).single();
    const latency = Date.now() - startTime;
    
    if (error && error.code !== 'PGRST116') {
      return {
        healthy: false,
        error: error.message,
        latency
      };
    }
    
    return {
      healthy: true,
      latency
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Table existence checks
 */
async function testTables(): Promise<{ healthy: boolean; tables: Record<string, boolean> }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      healthy: false,
      tables: {}
    };
  }
  
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const tablesToCheck = ['users', 'notes', 'chat_messages', 'chat_sessions'];
  const results: Record<string, boolean> = {};
  
  for (const table of tablesToCheck) {
    try {
      const { error } = await supabase.from(table).select('count').limit(1).single();
      results[table] = !error || error.code === 'PGRST116';
    } catch {
      results[table] = false;
    }
  }
  
  return {
    healthy: Object.values(results).every(v => v),
    tables: results
  };
}

/**
 * Edge function availability checks
 */
async function testEdgeFunctions(): Promise<{ healthy: boolean; functions: Record<string, boolean> }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !anonKey) {
    return {
      healthy: false,
      functions: {}
    };
  }
  
  const functionsToCheck = ['chat', 'notes', 'smoke-test'];
  const results: Record<string, boolean> = {};
  
  for (const funcName of functionsToCheck) {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/${funcName}`, {
        method: 'HEAD',
        headers: {
          'Authorization': `Bearer ${anonKey}`
        }
      });
      
      results[funcName] = response.status !== 404;
    } catch {
      results[funcName] = false;
    }
  }
  
  return {
    healthy: Object.values(results).some(v => v),
    functions: results
  };
}

/**
 * Comprehensive health check
 */
async function performComprehensiveHealthCheck() {
  logger.info('Starting comprehensive health check');
  
  const envCheck = validateEnvironment();
  const dbCheck = await testDatabaseConnection();
  const tableCheck = await testTables();
  const functionCheck = await testEdgeFunctions();
  
  const overall = envCheck.valid && dbCheck.healthy && tableCheck.healthy;
  
  return {
    overall,
    timestamp: new Date().toISOString(),
    checks: {
      environment: envCheck,
      database: dbCheck,
      tables: tableCheck,
      edgeFunctions: functionCheck
    }
  };
}

/**
 * Individual smoke test definitions
 */
async function testUserTableAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('users').select('id').limit(1);
    
    if (error) {
      throw error;
    }
    
    return {
      passed: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testNotesTableAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('notes').select('id').limit(1);
    
    if (error) {
      throw error;
    }
    
    return {
      passed: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testChatMessagesTableAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('chat_messages').select('id').limit(1);
    
    if (error) {
      throw error;
    }
    
    return {
      passed: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testChatSessionsTableAccess(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.from('chat_sessions').select('id').limit(1);
    
    if (error) {
      throw error;
    }
    
    return {
      passed: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testEnvironmentVariables(): Promise<{ passed: boolean; duration: number; error?: string }> {
  const startTime = Date.now();
  try {
    const envCheck = validateEnvironment();
    
    if (!envCheck.valid) {
      throw new Error(envCheck.errors.join(', '));
    }
    
    return {
      passed: true,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function testDatabaseLatency(): Promise<{ passed: boolean; duration: number; error?: string; latency?: number }> {
  const startTime = Date.now();
  try {
    const result = await testDatabaseConnection();
    
    if (!result.healthy) {
      throw new Error(result.error || 'Database unhealthy');
    }
    
    const latencyThreshold = 5000; // 5 seconds
    const passed = (result.latency || 0) < latencyThreshold;
    
    return {
      passed,
      duration: Date.now() - startTime,
      latency: result.latency,
      error: passed ? undefined : `Latency ${result.latency}ms exceeds threshold ${latencyThreshold}ms`
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Run complete smoke test suite
 */
async function runSmokeTestSuite() {
  logger.info('Starting smoke test suite');
  const suiteStartTime = Date.now();
  
  const tests = {
    'environment_variables': await testEnvironmentVariables(),
    'database_latency': await testDatabaseLatency(),
    'users_table': await testUserTableAccess(),
    'notes_table': await testNotesTableAccess(),
    'chat_messages_table': await testChatMessagesTableAccess(),
    'chat_sessions_table': await testChatSessionsTableAccess()
  };
  
  const testResults = Object.entries(tests);
  const passed = testResults.filter(([_, result]) => result.passed).length;
  const failed = testResults.filter(([_, result]) => !result.passed).length;
  
  const status = failed === 0 ? 'passed' : 'failed';
  
  return {
    status,
    tests_run: testResults.length,
    tests_passed: passed,
    tests_failed: failed,
    timestamp: new Date().toISOString(),
    duration: Date.now() - suiteStartTime,
    tests,
    errors: testResults
      .filter(([_, result]) => !result.passed)
      .map(([name, result]) => `${name}: ${result.error || 'Unknown error'}`)
  };
}

/**
 * Main handler function
 */
async function handler(req: Request): Promise<Response> {
  logger.info('Default handler called - returning 404');
  
  return new Response(
    JSON.stringify({
      error: 'Not Found',
      message: 'Use /health for health checks or /test for smoke tests',
      available_endpoints: ['/health', '/', '/test', '/smoke-test'],
      timestamp: new Date().toISOString()
    }, null, 2),
    {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    }
  );
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      
      logger.info('Request received', {
        path: url.pathname,
        method: req.method,
        hasAuth: req.headers.has('Authorization')
      });
      
      // Health check endpoint
      if (url.pathname === '/health' || url.pathname === '/') {
        logger.info('Health check endpoint called', { 
          path: url.pathname,
          method: req.method 
        });
        
        try {
          const healthCheck = await performComprehensiveHealthCheck();
          
          const statusCode = healthCheck.overall ? 200 : 503;
          
          logger.info('Health check completed', {
            overall: healthCheck.overall,
            statusCode,
            timestamp: healthCheck.timestamp
          });
          
          return new Response(
            JSON.stringify(healthCheck, null, 2),
            {
              status: statusCode,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
              }
            }
          );
        } catch
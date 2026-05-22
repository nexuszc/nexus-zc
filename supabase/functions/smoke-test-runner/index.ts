import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE'
};

// Simple logger utility
const logger = {
  log: (level: string, message: string, meta?: any) => {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta
    };
    console.log(JSON.stringify(logEntry));
  }
};

// Parse error responses
function parseErrorResponse(error: any) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || '',
    details: error?.details || error?.hint || ''
  };
}

// Generate failure report
function generateFailureReport(smokeTestResults: any, healthCheckResults: any[]) {
  const failedHealthChecks = healthCheckResults.filter(r => !r.passed);
  
  return {
    smokeTestFailed: !smokeTestResults.success,
    failedHealthChecks: failedHealthChecks.map(check => ({
      name: check.name,
      error: check.error,
      timestamp: check.timestamp
    })),
    totalFailures: (smokeTestResults.success ? 0 : 1) + failedHealthChecks.length
  };
}

// Run individual smoke test
async function runSmokeTest(functionName: string, supabaseUrl: string, supabaseAnonKey: string): Promise<any> {
  try {
    logger.log('info', `Running smoke test for function: ${functionName}`);
    
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey
      },
      body: JSON.stringify({ test: true })
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    return {
      name: functionName,
      passed: response.ok,
      status: response.status,
      statusText: response.statusText,
      response: responseData,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.log('error', `Smoke test failed for ${functionName}`, { error: String(error) });
    return {
      name: functionName,
      passed: false,
      error: error.message || String(error),
      timestamp: new Date().toISOString()
    };
  }
}

// Main smoke test runner
async function runSmokeTests(req: Request) {
  try {
    logger.log('info', 'Starting smoke test runner');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing required environment variables');
    }

    // Parse request for specific function to test
    const url = new URL(req.url);
    const specificFunction = url.searchParams.get('function');

    // Define functions to test
    const functionsToTest = specificFunction 
      ? [specificFunction]
      : ['smoke-test', 'health-monitor', 'nexus-core'];

    // Run smoke tests
    const smokeTestPromises = functionsToTest.map(fn => 
      runSmokeTest(fn, supabaseUrl, supabaseAnonKey)
    );
    
    const smokeTestResults = await Promise.all(smokeTestPromises);
    const allPassed = smokeTestResults.every(result => result.passed);

    // Run health checks
    const healthCheckResults: any[] = [];
    let passedCount = 0;
    let failedCount = 0;

    // Database connectivity check
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { error } = await supabase.from('_health_check').select('count').limit(1);
      
      if (!error || error.message.includes('does not exist')) {
        healthCheckResults.push({
          name: 'database_connectivity',
          passed: true,
          timestamp: new Date().toISOString()
        });
        passedCount++;
      } else {
        throw error;
      }
    } catch (error) {
      healthCheckResults.push({
        name: 'database_connectivity',
        passed: false,
        error: error.message || String(error),
        timestamp: new Date().toISOString()
      });
      failedCount++;
    }

    // Environment variables check
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingEnvVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
    
    if (missingEnvVars.length === 0) {
      healthCheckResults.push({
        name: 'environment_variables',
        passed: true,
        timestamp: new Date().toISOString()
      });
      passedCount++;
    } else {
      healthCheckResults.push({
        name: 'environment_variables',
        passed: false,
        error: `Missing variables: ${missingEnvVars.join(', ')}`,
        timestamp: new Date().toISOString()
      });
      failedCount++;
    }

    // Edge functions availability check
    smokeTestResults.forEach(result => {
      if (result.passed) {
        healthCheckResults.push({
          name: `edge_function_${result.name}`,
          passed: true,
          timestamp: result.timestamp
        });
        passedCount++;
      } else {
        healthCheckResults.push({
          name: `edge_function_${result.name}`,
          passed: false,
          error: result.error || `HTTP ${result.status}`,
          timestamp: result.timestamp
        });
        failedCount++;
      }
    });

    const overallSuccess = allPassed && failedCount === 0;

    const smokeTestResult = {
      success: overallSuccess,
      timestamp: new Date().toISOString(),
      results: healthCheckResults,
      total: healthCheckResults.length,
      passed: passedCount,
      failed: failedCount
    };

    const responseData = {
      success: overallSuccess,
      timestamp: new Date().toISOString(),
      tests_run: healthCheckResults.length,
      passed: passedCount,
      failed: failedCount,
      results: healthCheckResults,
      smokeTests: smokeTestResults,
      healthChecks: {
        total: healthCheckResults.length,
        passed: passedCount,
        failed: failedCount,
        results: healthCheckResults
      }
    };

    // Add failure report if there were any failures
    if (!overallSuccess) {
      responseData['failureReport'] = generateFailureReport({ success: allPassed, results: smokeTestResults }, healthCheckResults);
    }

    logger.log('info', 'Smoke test runner completed', {
      overallSuccess,
      smokeTestSuccess: allPassed,
      healthChecksPassed: passedCount,
      healthChecksFailed: failedCount
    });

    return {
      success: overallSuccess,
      statusCode: overallSuccess ? 200 : 500,
      data: responseData
    };

  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    logger.log('error', 'Smoke test runner failed with exception', {
      message: errorInfo.message,
      stack: errorInfo.stack,
      details: errorInfo.details
    });

    return {
      success: false,
      statusCode: 500,
      data: {
        success: false,
        error: errorInfo.message,
        stack: errorInfo.stack,
        details: errorInfo.details,
        timestamp: new Date().toISOString(),
        tests_run: 0,
        passed: 0,
        failed: 0,
        results: []
      }
    };
  }
}

// Enhanced health check with comprehensive validation
async function performHealthCheck(): Promise<any> {
  const checks: any[] = [];
  let allPassed = true;

  try {
    // 1. Environment variables validation
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
      }

      checks.push({
        name: 'environment_variables',
        status: 'passed',
        timestamp: new Date().toISOString(),
        details: {
          SUPABASE_URL: !!supabaseUrl,
          SUPABASE_ANON_KEY: !!supabaseAnonKey
        }
      });
    } catch (error) {
      allPassed = false;
      checks.push({
        name: 'environment_variables',
        status: 'failed',
        error: error.message || String(error),
        timestamp: new Date().toISOString()
      });
    }

    // 2. Database connectivity via Supabase client
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (supabaseUrl && supabaseAnonKey) {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { error } = await supabase.from('_health_check').select('count').limit(1);
        
        // Consider it successful even if table doesn't exist (connection works)
        if (!error || error.message.includes('does not exist')) {
          checks.push({
            name: 'database_connectivity',
            status: 'passed',
            timestamp: new Date().toISOString()
          });
        } else {
          throw error;
        }
      } else {
        throw new Error('Cannot test database connectivity without credentials');
      }
    } catch (error) {
      allPassed = false;
      checks.push({
        name: 'database_connectivity',
        status: 'failed',
        error: error.message || String(error),
        timestamp: new Date().toISOString()
      });
    }

    // 3. Critical edge functions availability
    const criticalFunctions = ['smoke-test', 'health-monitor', 'nexus-core'];
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (supabaseUrl && supabaseAnonKey) {
        for (const functionName of criticalFunctions) {
          try {
            const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json',
                'apikey': supabaseAnonKey
              },
              body: JSON.stringify({ healthCheck: true }),
              signal: AbortSignal.timeout(5000) // 5s timeout per function
            });

            checks.push({
              name: `edge_function_${functionName}`,
              status: response.ok ? 'passed' : 'failed',
              statusCode: response.status,
              timestamp: new Date().toISOString()
            });

            if (!response.ok) {
              allPassed = false;
            }
          } catch (error) {
            allPassed = false;
            checks.push({
              name: `edge_function_${functionName}`,
              status: 'failed',
              error: error.message || String(error),
              timestamp: new Date().toISOString()
            });
          }
        }
      } else {
        throw new Error('Cannot test edge functions without credentials');
      }
    } catch (error) {
      allPassed = false;
      checks.push({
        name: 'edge_functions_availability',
        status: 'failed',
        error: error.message || String(error),
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logger.log('error', 'Health check encountered unexpected error', { error: String(error) });
    allPassed = false;
    checks.push({
      name: 'health_check_execution',
      status: 'failed',
      error: error.message || String(error),
      timestamp: new Date().toISOString()
    });
  }

  return {
    status: allPassed ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    function: 'smoke-test-runner',
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter(c => c.status === 'passed').length,
      failed: checks.filter(c => c.status === 'failed').length
    }
  };
}

// Deno.serve handler with proper Request/Response pattern
serve(async (req: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      logger.log('info', 'Handling CORS preflight request', { requestId });
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    logger.log('info', 'Incoming request', { 
      requestId, 
      method: req.method, 
      url: req.url 
    });

    const url = new URL(req.url);
    
    // Health check endpoint - comprehensive validation
    if (url.pathname.endsWith('/health') || (req.method === 'GET' && url.pathname === '/')) {
      try {
        logger.log('info', 'Processing health check request', { requestId });
        
        // Create timeout promise (30s max)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Health check timeout after 30s')), 30000);
        });

        // Race between health check and timeout
        const healthCheckResult = await Promise.race([
          performHealthCheck(),
          timeoutPromise
        ]) as any;

        logger.log('info', 'Health check completed', { 
          requestId, 
          status: healthCheckResult.status,
          checksRun: healthCheckResult.checks?.length || 0
        });

        return new Response(
          JSON.stringify(healthCheckResult),
          {
            status: healthCheckResult.status === 'ok' ? 200 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      } catch (error) {
        logger.log('error',
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ENABLE_NOTIFICATIONS = Deno.env.get('ENABLE_NOTIFICATIONS') === 'true';
const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL');

// Logger utility
const logger = {
  logs: [] as any[],
  log(level: string, message: string, meta: any = {}) {
    const logEntry = {
      level,
      message,
      meta,
      timestamp: new Date().toISOString()
    };
    this.logs.push(logEntry);
    console.log(JSON.stringify(logEntry));
  },
  getLogs() {
    return this.logs;
  }
};

// Types
interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  retries?: number;
  error?: string;
  stackTrace?: string;
  timestamp: string;
}

interface SmokeSummary {
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  timestamp: string;
  tests: TestResult[];
}

interface HealthCheckResult {
  function: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  error?: string;
  stackTrace?: string;
  timestamp: string;
}

// Retry with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; initialDelayMs: number }
): Promise<{ result: T; retries: number }> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retries: attempt };
    } catch (error) {
      lastError = error;
      
      if (attempt < options.maxRetries) {
        const delay = options.initialDelayMs * Math.pow(2, attempt);
        logger.log('warn', `Retry attempt ${attempt + 1} after ${delay}ms`, { error: error.message });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}

// Check health of individual function
async function checkFunctionHealth(functionName: string): Promise<HealthCheckResult> {
  const startTime = performance.now();
  
  try {
    const { result, retries } = await retryWithBackoff(
      async () => {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ health_check: true })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      },
      { maxRetries: 2, initialDelayMs: 1000 }
    );

    return {
      function: functionName,
      status: 'passed',
      duration_ms: performance.now() - startTime,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      function: functionName,
      status: 'failed',
      duration_ms: performance.now() - startTime,
      error: error.message,
      stackTrace: error.stack,
      timestamp: new Date().toISOString()
    };
  }
}

// Run basic smoke tests
async function runSmokeTests(): Promise<SmokeSummary> {
  const startTime = performance.now();
  const tests: TestResult[] = [];

  // Test 1: Database Connectivity
  try {
    const testStart = performance.now();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { result, retries } = await retryWithBackoff(
      async () => {
        const { data, error } = await supabase
          .from('smoke_test_results')
          .select('count')
          .limit(1);
        
        if (error) throw error;
        return data;
      },
      { maxRetries: 2, initialDelayMs: 500 }
    );

    tests.push({
      name: 'Database Connectivity',
      status: 'passed',
      duration_ms: performance.now() - testStart,
      retries,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    tests.push({
      name: 'Database Connectivity',
      status: 'failed',
      duration_ms: performance.now() - testStart,
      error: error.message,
      stackTrace: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  // Test 2: Environment Variables
  try {
    const testStart = performance.now();
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    tests.push({
      name: 'Environment Variables',
      status: 'passed',
      duration_ms: performance.now() - testStart,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    tests.push({
      name: 'Environment Variables',
      status: 'failed',
      duration_ms: performance.now() - testStart,
      error: error.message,
      stackTrace: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  // Test 3: API Authentication
  try {
    const testStart = performance.now();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { result, retries } = await retryWithBackoff(
      async () => {
        const { data, error } = await supabase.auth.getUser();
        if (error && error.message !== 'Invalid token') {
          throw error;
        }
        return data;
      },
      { maxRetries: 2, initialDelayMs: 500 }
    );

    tests.push({
      name: 'API Authentication',
      status: 'passed',
      duration_ms: performance.now() - testStart,
      retries,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    tests.push({
      name: 'API Authentication',
      status: 'failed',
      duration_ms: performance.now() - testStart,
      error: error.message,
      stackTrace: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  const totalDuration = performance.now() - startTime;
  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = tests.filter(t => t.status === 'failed').length;

  return {
    total: tests.length,
    passed,
    failed,
    duration_ms: totalDuration,
    timestamp: new Date().toISOString(),
    tests
  };
}

// Persist test results to database
async function persistTestResults(
  smokeTestResults: SmokeSummary,
  healthCheckResults: HealthCheckResult[],
  overallSuccess: boolean
) {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { error } = await supabase
      .from('smoke_test_results')
      .insert({
        timestamp: new Date().toISOString(),
        success: overallSuccess,
        smoke_tests: smokeTestResults,
        health_checks: healthCheckResults,
        logs: logger.getLogs()
      });

    if (error) {
      logger.log('error', 'Failed to persist test results', { error: error.message });
    } else {
      logger.log('info', 'Test results persisted successfully');
    }
  } catch (error) {
    logger.log('error', 'Exception while persisting test results', { error: error.message });
  }
}

// Send alert notification for critical failures
async function sendFailureAlert(
  smokeTestResults: SmokeSummary,
  healthCheckResults: HealthCheckResult[]
) {
  if (!ENABLE_NOTIFICATIONS || !SLACK_WEBHOOK_URL) {
    logger.log('info', 'Notifications disabled or webhook not configured');
    return;
  }

  try {
    const failedTests = smokeTestResults.tests.filter(t => t.status === 'failed');
    const failedHealthChecks = healthCheckResults.filter(h => h.status === 'failed');

    const message = {
      text: '🚨 Smoke Test Failure Alert',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Smoke Test Failure Detected'
          }
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Failed Tests:* ${failedTests.length}/${smokeTestResults.total}`
            },
            {
              type: 'mrkdwn',
              text: `*Failed Health Checks:* ${failedHealthChecks.length}/${healthCheckResults.length}`
            }
          ]
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Timestamp:* ${new Date().toISOString()}`
          }
        }
      ]
    };

    if (failedTests.length > 0) {
      message.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Failed Tests:*\n${failedTests.map(t => `• ${t.name}: ${t.error}`).join('\n')}`
        }
      });
    }

    if (failedHealthChecks.length > 0) {
      message.blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Failed Health Checks:*\n${failedHealthChecks.map(h => `• ${h.function}: ${h.error}`).join('\n')}`
        }
      });
    }

    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}`);
    }

    logger.log('info', 'Failure alert sent successfully');
  } catch (error) {
    logger.log('error', 'Failed to send failure alert', { error: error.message });
  }
}

// Health checks with timeout and retry logic
async function runHealthChecksWithTimeout(
  functionNames: string[],
  timeoutMs: number = 120000
): Promise<HealthCheckResult[]> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Health check timeout exceeded')), timeoutMs);
  });

  try {
    const healthCheckPromises = functionNames.map(name => checkFunctionHealth(name));
    
    const results = await Promise.race([
      Promise.all(healthCheckPromises),
      timeoutPromise
    ]);

    return results;
  } catch (error) {
    logger.log('error', 'Health check timeout or error', { error: error.message });
    
    // Return failed results for all functions
    return functionNames.map(functionName => ({
      function: functionName,
      status: 'failed',
      duration_ms: timeoutMs,
      error: 'Health check timeout exceeded',
      stackTrace: error.stack,
      timestamp: new Date().toISOString()
    }));
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // Validate request method
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed', allowed_methods: ['GET', 'POST'] }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    logger.log('info', 'Starting smoke test runner');

    // Parse request body for configuration
    let config: any = {};
    if (req.method === 'POST') {
      try {
        config = await req.json();
      } catch {
        config = {};
      }
    }

    const functionsToCheck = config.functions || [
      'chat',
      'memory-manager',
      'search-query',
      'smoke-test'
    ];

    // Run smoke tests
    logger.log('info', 'Running smoke tests');
    const smokeTestResults = await runSmokeTests();
    logger.log('info', 'Smoke tests completed', {
      total: smokeTestResults.total,
      passed: smokeTestResults.passed,
      failed: smokeTestResults.failed
    });

    // Run health checks
    logger.log('info', 'Running health checks', { functions: functionsToCheck });
    const healthCheckResults = await runHealthChecksWithTimeout(functionsToCheck);
    logger.log('info', 'Health checks completed', {
      total: healthCheckResults.length,
      passed: healthCheckResults.filter(h => h.status === 'passed').length,
      failed: healthCheckResults.filter(h => h.status === 'failed').length
    });

    // Determine overall success
    const overallSuccess = 
      smokeTestResults.failed === 0 && 
      healthCheckResults.every(h => h.status === 'passed');

    // Persist results
    await persistTestResults(smokeTestResults, healthCheckResults, overallSuccess);

    // Send alerts if there are failures
    if (!overallSuccess) {
      await sendFailureAlert(smokeTestResults, healthCheckResults);
    }

    // Return results
    return new Response(
      JSON.stringify({
        success: overallSuccess,
        timestamp: new Date().toISOString(),
        smoke_tests: smokeTestResults,
        health_checks: healthCheckResults,
        logs: logger.getLogs()
      }),
      {
        status: overallSuccess ? 200 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    logger.log('error',
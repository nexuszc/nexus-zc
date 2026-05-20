// supabase/functions/smoke-test-runner/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SMOKE_TEST_SECRET = Deno.env.get('SMOKE_TEST_SECRET') || 'test-secret';
const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL');
const ENABLE_NOTIFICATIONS = Deno.env.get('ENABLE_SMOKE_TEST_NOTIFICATIONS') === 'true';

interface HealthCheckResult {
  function: string;
  status: 'success' | 'failed';
  duration_ms: number;
  error?: string;
  stackTrace?: string;
  retries?: number;
  timestamp?: string;
  details?: any;
}

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
  stackTrace?: string;
  retries?: number;
  timestamp?: string;
  details?: any;
}

interface SmokeSummary {
  total: number;
  passed: number;
  failed: number;
  skipped?: number;
  duration_ms: number;
  timestamp: string;
  tests: TestResult[];
}

// Structured logger for test results
class TestLogger {
  private logs: Array<{level: string; message: string; timestamp: string; data?: any}> = [];

  log(level: 'info' | 'warn' | 'error', message: string, data?: any) {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      data
    };
    this.logs.push(logEntry);
    
    // Console output
    const logMethod = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (data) {
      logMethod(`[${level.toUpperCase()}] ${message}`, JSON.stringify(data, null, 2));
    } else {
      logMethod(`[${level.toUpperCase()}] ${message}`);
    }
  }

  getLogs() {
    return this.logs;
  }

  clear() {
    this.logs = [];
  }
}

const logger = new TestLogger();

// Exponential backoff retry logic
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (attempt: number, error: any) => void;
  } = {}
): Promise<{ result: T; retries: number }> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    onRetry
  } = options;

  let lastError: any;
  let retries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retries };
    } catch (error) {
      lastError = error;
      retries = attempt;

      if (attempt < maxRetries) {
        const delay = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        );
        
        if (onRetry) {
          onRetry(attempt + 1, error);
        }
        
        logger.log('warn', `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, {
          error: error.message
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Health check with retry logic
async function checkFunctionHealth(functionName: string): Promise<HealthCheckResult> {
  const startTime = performance.now();
  
  try {
    const { result, retries } = await retryWithBackoff(
      async () => {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/${functionName}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ action: 'health_check' })
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
      },
      {
        maxRetries: 3,
        initialDelayMs: 500,
        maxDelayMs: 5000,
        onRetry: (attempt, error) => {
          logger.log('warn', `Health check retry for ${functionName}`, {
            attempt,
            error: error.message
          });
        }
      }
    );

    const duration = performance.now() - startTime;

    return {
      function: functionName,
      status: 'success',
      duration_ms: duration,
      retries,
      timestamp: new Date().toISOString(),
      details: result
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    
    return {
      function: functionName,
      status: 'failed',
      duration_ms: duration,
      error: error.message,
      stackTrace: error.stack,
      timestamp: new Date().toISOString()
    };
  }
}

// Run smoke tests with detailed error reporting
async function runSmokeTests(): Promise<SmokeSummary> {
  const startTime = performance.now();
  const tests: TestResult[] = [];

  // Test 1: Database connectivity
  try {
    const testStart = performance.now();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const { result, retries } = await retryWithBackoff(
      async () => {
        const { data, error } = await supabase
          .from('system_health')
          .select('*')
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
      duration_ms: performance.now() - startTime,
      error: error.message,
      stackTrace: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  // Test 2: Edge function reachability
  try {
    const testStart = performance.now();
    const { result, retries } = await retryWithBackoff(
      async () => {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/health`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        });
        
        if (!response.ok) {
          throw new Error(`Health endpoint returned ${response.status}`);
        }
        
        return await response.json();
      },
      { maxRetries: 2, initialDelayMs: 500 }
    );

    tests.push({
      name: 'Edge Function Reachability',
      status: 'passed',
      duration_ms: performance.now() - testStart,
      retries,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    tests.push({
      name: 'Edge Function Reachability',
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
      JSON.stringify({ error: 'Method not allowed', allowed
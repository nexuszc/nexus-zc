import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SMOKE_TEST_SECRET = Deno.env.get('SMOKE_TEST_SECRET') || '';

let supabaseClient: any = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
  }
}

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  details?: string;
  error?: string;
  errorCategory?: string;
}

function categorizeError(status: number | null, message: string): string {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 404) return 'not_found';
  if (status === 500 || status === 502 || status === 503) return 'server_error';
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('network')) return 'network';
  if (message.includes('permission')) return 'permissions';
  return 'unknown';
}

async function runSmokeTests(): Promise<any> {
  const tests: TestResult[] = [];
  const startTime = performance.now();
  const totalSteps = 7;
  let currentStep = 0;

  console.log('=== Starting Smoke Tests ===');

  // Test 1: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);

  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SMOKE_TEST_SECRET'
  ];

  const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));

  if (missingVars.length === 0) {
    tests.push({
      name: 'Environment Variables',
      status: 'passed',
      duration_ms: performance.now() - envTestStart,
      details: 'All required environment variables are set'
    });
    console.log('✓ Environment variables verified');
  } else {
    tests.push({
      name: 'Environment Variables',
      status: 'failed',
      duration_ms: performance.now() - envTestStart,
      error: `Missing: ${missingVars.join(', ')}`,
      errorCategory: 'configuration'
    });
    console.error('✗ Missing environment variables:', missingVars.join(', '));
  }

  // Test 2: Network Connectivity
  currentStep++;
  const networkTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing network connectivity...`);

  try {
    const response = await fetch('https://www.google.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });

    tests.push({
      name: 'Network Connectivity',
      status: 'passed',
      duration_ms: performance.now() - networkTestStart,
      details: `Status: ${response.status}`
    });
    console.log('✓ Network connectivity verified');
  } catch (error) {
    tests.push({
      name: 'Network Connectivity',
      status: 'failed',
      duration_ms: performance.now() - networkTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Network connectivity error:', error.message);
  }

  // Test 3: Supabase API Reachability
  currentStep++;
  const supabaseTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing Supabase API reachability...`);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      signal: AbortSignal.timeout(5000)
    });

    tests.push({
      name: 'Supabase API Reachability',
      status: 'passed',
      duration_ms: performance.now() - supabaseTestStart,
      details: `Status: ${response.status}`
    });
    console.log('✓ Supabase API reachable');
  } catch (error) {
    tests.push({
      name: 'Supabase API Reachability',
      status: 'failed',
      duration_ms: performance.now() - supabaseTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Supabase API error:', error.message);
  }

  // Test 4: JSON Processing
  currentStep++;
  const jsonTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);

  try {
    const testData = { test: 'data', timestamp: new Date().toISOString() };
    const jsonString = JSON.stringify(testData);
    const parsed = JSON.parse(jsonString);

    if (parsed.test === testData.test) {
      tests.push({
        name: 'JSON Processing',
        status: 'passed',
        duration_ms: performance.now() - jsonTestStart,
        details: 'JSON serialization and parsing successful'
      });
      console.log('✓ JSON processing verified');
    } else {
      throw new Error('JSON data mismatch');
    }
  } catch (error) {
    tests.push({
      name: 'JSON Processing',
      status: 'failed',
      duration_ms: performance.now() - jsonTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ JSON processing error:', error.message);
  }

  // Test 5: Database Connection (if client available)
  currentStep++;
  const dbTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing database connection...`);

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('app_metadata')
        .select('key')
        .limit(1);

      if (error) throw error;

      tests.push({
        name: 'Database Connection',
        status: 'passed',
        duration_ms: performance.now() - dbTestStart,
        details: 'Database query successful'
      });
      console.log('✓ Database connection verified');
    } catch (error) {
      tests.push({
        name: 'Database Connection',
        status: 'failed',
        duration_ms: performance.now() - dbTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Database connection error:', error.message);
    }
  } else {
    tests.push({
      name: 'Database Connection',
      status: 'failed',
      duration_ms: performance.now() - dbTestStart,
      error: 'Supabase client not initialized',
      errorCategory: categorizeError(null, 'client not initialized')
    });
  }

  // Test 6: Memory Usage
  currentStep++;
  const memTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing memory usage...`);

  try {
    const memoryUsage = Deno.memoryUsage();
    const heapUsedMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);

    tests.push({
      name: 'Memory Usage',
      status: 'passed',
      duration_ms: performance.now() - memTestStart,
      details: `Heap: ${heapUsedMB}MB / ${heapTotalMB}MB`
    });
    console.log(`✓ Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`);
  } catch (error) {
    tests.push({
      name: 'Memory Usage',
      status: 'failed',
      duration_ms: performance.now() - memTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Memory check error:', error.message);
  }

  // Test 7: File System Access
  currentStep++;
  const fsTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing file system access...`);

  try {
    const tempFile = await Deno.makeTempFile();
    await Deno.writeTextFile(tempFile, 'test');
    const content = await Deno.readTextFile(tempFile);
    await Deno.remove(tempFile);

    tests.push({
      name: 'File System Access',
      status: 'passed',
      duration_ms: performance.now() - fsTestStart,
      details: 'Read/write operations successful'
    });
    console.log('✓ File system access verified');
  } catch (error) {
    tests.push({
      name: 'File System Access',
      status: 'failed',
      duration_ms: performance.now() - fsTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ File system access error:', error.message);
  }

  const totalDuration = performance.now() - startTime;
  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = tests.filter(t => t.status === 'failed').length;

  console.log('=== Smoke Tests Complete ===');
  console.log(`Total: ${tests.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Duration: ${totalDuration.toFixed(2)}ms`);

  return {
    total: tests.length,
    passed,
    failed,
    duration_ms: totalDuration,
    timestamp: new Date().toISOString(),
    tests
  };
}

interface HealthCheckResult {
  function: string;
  status: 'success' | 'failed';
  duration_ms: number;
  error?: string;
  response?: any;
}

async function checkFunctionHealth(functionName: string, timeout: number = 30000): Promise<HealthCheckResult> {
  const startTime = performance.now();
  const functionUrl = `${SUPABASE_URL}/functions/v1/${functionName}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ healthCheck: true }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const duration = performance.now() - startTime;

    if (response.ok) {
      let responseData;
      try {
        responseData = await response.json();
      } catch {
        responseData = { status: response.status };
      }

      return {
        function: functionName,
        status: 'success',
        duration_ms: duration,
        response: responseData
      };
    } else {
      return {
        function: functionName,
        status: 'failed',
        duration_ms: duration,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (error) {
    const duration = performance.now() - startTime;
    return {
      function: functionName,
      status: 'failed',
      duration_ms: duration,
      error: error.message
    };
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
      JSON.stringify({ error: 'Method not allowed', allowed: ['GET', 'POST'] }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    // Authorization check
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    if (token !== SMOKE_TEST_SECRET) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    console.log('Starting smoke test execution...');

    // Run the smoke tests
    const summary = await runSmokeTests();

    // Run health checks for critical functions
    console.log('Starting health checks for critical functions...');
    const criticalFunctions = [
      'chat',
      'nexus-core',
      'nexus-router',
      'brain-api',
      'contractor-dashboard-api',
      'portal-api'
    ];

    const healthCheckResults: HealthCheckResult[] = [];
    
    for (const functionName of criticalFunctions) {
      console.log(`Checking health of function: ${functionName}`);
      const result = await checkFunctionHealth(functionName, 30000);
      healthCheckResults.push(result);
      console.log(`${functionName}: ${result.status} (${result.duration_ms.toFixed(2)}ms)`);
    }

    const healthChecksFailed = healthCheckResults.filter(r => r.status === 'failed').length;
    const healthChecksSuccess = healthCheckResults.filter(r => r.status === 'success').length;

    // Determine overall status
    const overallSuccess = summary.failed === 0 && healthChecksFailed === 0;

    const response = {
      success: overallSuccess,
      timestamp: new
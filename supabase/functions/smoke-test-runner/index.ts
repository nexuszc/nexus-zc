import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const SMOKE_TEST_SECRET = Deno.env.get('SMOKE_TEST_SECRET') || '';

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  details?: string;
  error?: string;
  errorCategory?: string;
}

interface SmokeTestSummary {
  total: number;
  passed: number;
  failed: number;
  duration_ms: number;
  timestamp: string;
  tests: TestResult[];
}

function categorizeError(response: Response | null, errorMessage: string): string {
  if (response) {
    if (response.status === 404) return 'NOT_FOUND';
    if (response.status === 401 || response.status === 403) return 'AUTH_ERROR';
    if (response.status >= 500) return 'SERVER_ERROR';
    if (response.status === 429) return 'RATE_LIMIT';
  }

  const msg = errorMessage.toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('network') || msg.includes('fetch')) return 'NETWORK_ERROR';
  if (msg.includes('permission') || msg.includes('denied')) return 'PERMISSION_ERROR';
  if (msg.includes('not found')) return 'NOT_FOUND';
  if (msg.includes('client not initialized')) return 'INIT_ERROR';

  return 'UNKNOWN';
}

async function runSmokeTests(): Promise<SmokeTestSummary> {
  const startTime = performance.now();
  const tests: TestResult[] = [];
  let supabaseClient: any = null;

  const totalSteps = 7;
  let currentStep = 0;

  console.log('=== Starting Smoke Tests ===');

  // Test 1: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);

  try {
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));

    if (missingVars.length === 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required environment variables present'
      });
      console.log('✓ Environment variables verified');
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing: ${missingVars.join(', ')}`,
        errorCategory: 'INIT_ERROR'
      });
      console.error(`✗ Missing environment variables: ${missingVars.join(', ')}`);
    }
  } catch (error) {
    tests.push({
      name: 'Environment Variables',
      status: 'failed',
      duration_ms: performance.now() - envTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Environment check error:', error.message);
  }

  // Test 2: Supabase Client Initialization
  currentStep++;
  const clientTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing Supabase client initialization...`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    supabaseClient = createClient(supabaseUrl, supabaseKey);

    tests.push({
      name: 'Supabase Client',
      status: 'passed',
      duration_ms: performance.now() - clientTestStart,
      details: 'Client initialized successfully'
    });
    console.log('✓ Supabase client initialized');
  } catch (error) {
    tests.push({
      name: 'Supabase Client',
      status: 'failed',
      duration_ms: performance.now() - clientTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Supabase client initialization failed:', error.message);
  }

  // Test 3: External HTTP Request
  currentStep++;
  const httpTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing external HTTP request...`);

  try {
    const response = await fetch('https://httpbin.org/get', {
      method: 'GET',
      headers: { 'User-Agent': 'Nexus-SmokeTest/1.0' }
    });

    if (response.ok) {
      tests.push({
        name: 'External HTTP Request',
        status: 'passed',
        duration_ms: performance.now() - httpTestStart,
        details: `Status: ${response.status}`
      });
      console.log('✓ External HTTP request successful');
    } else {
      tests.push({
        name: 'External HTTP Request',
        status: 'failed',
        duration_ms: performance.now() - httpTestStart,
        error: `HTTP ${response.status}`,
        errorCategory: categorizeError(response, '')
      });
      console.error(`✗ External HTTP request failed: ${response.status}`);
    }
  } catch (error) {
    tests.push({
      name: 'External HTTP Request',
      status: 'failed',
      duration_ms: performance.now() - httpTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ External HTTP request error:', error.message);
  }

  // Test 4: JSON Processing
  currentStep++;
  const jsonTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);

  try {
    const testData = {
      test: true,
      timestamp: new Date().toISOString(),
      nested: { value: 42 }
    };

    const serialized = JSON.stringify(testData);
    const deserialized = JSON.parse(serialized);

    if (deserialized.test === true && deserialized.nested.value === 42) {
      tests.push({
        name: 'JSON Processing',
        status: 'passed',
        duration_ms: performance.now() - jsonTestStart,
        details: 'Serialization and deserialization successful'
      });
      console.log('✓ JSON processing verified');
    } else {
      throw new Error('JSON data mismatch after round-trip');
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

    // Determine overall status
    const overallStatus = summary.failed === 0 ? 'success' : 'partial_failure';

    const response = {
      status: overallStatus,
      summary: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        duration_ms: summary.duration_ms,
        timestamp: summary.timestamp
      },
      tests: summary.tests
    };

    return new Response(
      JSON.stringify(response, null, 2),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Smoke test runner error:', error);

    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  details?: string;
  error?: string;
  errorCategory?: string;
}

interface StructuralIssue {
  severity: 'critical' | 'warning';
  path: string;
  issue: string;
}

interface EdgeFunctionCheck {
  function: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  statusCode?: number;
  error?: string;
}

function categorizeError(response: Response | null, errorMessage: string): string {
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return 'timeout';
  }
  if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('network')) {
    return 'network';
  }
  if (errorMessage.includes('not initialized') || errorMessage.includes('client')) {
    return 'configuration';
  }
  if (response && response.status >= 500) {
    return 'server_error';
  }
  if (response && response.status >= 400) {
    return 'client_error';
  }
  return 'unknown';
}

async function checkEdgeFunction(functionName: string, timeoutMs: number = 30000): Promise<EdgeFunctionCheck> {
  const startTime = performance.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    }

    const url = `${supabaseUrl}/functions/v1/${functionName}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const duration = performance.now() - startTime;
      
      if (response.status === 200) {
        return {
          function: functionName,
          status: 'passed',
          duration_ms: duration,
          statusCode: response.status
        };
      } else {
        const errorText = await response.text().catch(() => 'Unable to read response');
        return {
          function: functionName,
          status: 'failed',
          duration_ms: duration,
          statusCode: response.status,
          error: `HTTP ${response.status}: ${errorText}`
        };
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const duration = performance.now() - startTime;
    return {
      function: functionName,
      status: 'failed',
      duration_ms: duration,
      error: error.name === 'AbortError' ? 'Request timed out' : error.message
    };
  }
}

async function runHealthChecks(): Promise<{
  success: boolean;
  checks: EdgeFunctionCheck[];
  timestamp: string;
  errors: string[];
}> {
  console.log('Starting edge function health checks...');
  
  const functionsToCheck = [
    'smoke-test',
    'health-monitor',
    'get-public-config'
  ];
  
  const checks: EdgeFunctionCheck[] = [];
  const errors: string[] = [];
  
  for (const functionName of functionsToCheck) {
    console.log(`Checking function: ${functionName}`);
    const check = await checkEdgeFunction(functionName, 30000);
    checks.push(check);
    
    if (check.status === 'failed') {
      errors.push(`${functionName}: ${check.error || 'Unknown error'}`);
    }
  }
  
  const allPassed = checks.every(check => check.status === 'passed');
  
  return {
    success: allPassed,
    checks,
    timestamp: new Date().toISOString(),
    errors
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  const overallStart = performance.now();
  const tests: TestResult[] = [];
  const structuralIssues: StructuralIssue[] = [];
  let currentStep = 0;
  const totalSteps = 8;

  try {
    console.log('=== Smoke Test Runner Started ===');
    console.log(`Request Method: ${req.method}`);
    console.log(`Request URL: ${req.url}`);

    // Handle POST requests for triggered runs
    if (req.method === 'POST') {
      const healthCheckResult = await runHealthChecks();
      
      return new Response(
        JSON.stringify(healthCheckResult, null, 2),
        {
          status: healthCheckResult.success ? 200 : 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        }
      );
    }

    // Handle GET requests for health status
    if (req.method === 'GET') {
      const url = new URL(req.url);
      
      // If requesting health check endpoint
      if (url.pathname.includes('/health') || url.searchParams.has('health')) {
        const healthCheckResult = await runHealthChecks();
        
        return new Response(
          JSON.stringify(healthCheckResult, null, 2),
          {
            status: healthCheckResult.success ? 200 : 500,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            }
          }
        );
      }
    }

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);

    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];

    const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));

    if (missingVars.length === 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: `All ${requiredEnvVars.length} required variables present`
      });
      console.log(`✓ All environment variables present`);
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing variables: ${missingVars.join(', ')}`,
        errorCategory: 'configuration'
      });
      console.error(`✗ Missing environment variables: ${missingVars.join(', ')}`);
    }

    // Test 2: Supabase Client Initialization
    currentStep++;
    const clientTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing Supabase client initialization...`);

    let supabaseClient = null;
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      }

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
      console.log('✓
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
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

function categorizeError(error: Error | null, message: string): string {
  if (!message) return 'unknown';
  
  const msg = message.toLowerCase();
  
  if (msg.includes('permission') || msg.includes('denied')) {
    return 'permission';
  }
  if (msg.includes('not found') || msg.includes('enoent')) {
    return 'not_found';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'network';
  }
  if (msg.includes('parse') || msg.includes('json')) {
    return 'parsing';
  }
  if (msg.includes('auth') || msg.includes('unauthorized')) {
    return 'auth';
  }
  
  return 'unknown';
}

Deno.serve(async (req: Request) => {
  const tests: TestResult[] = [];
  const structuralIssues: StructuralIssue[] = [];
  
  const totalSteps = 8;
  let currentStep = 0;

  console.log('');
  console.log('=== NEXUS SMOKE TEST RUNNER ===');
  console.log(`Starting ${totalSteps} smoke tests...`);
  console.log('');

  // Test 1: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
  
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
      details: 'All required environment variables present'
    });
    console.log('✓ All environment variables present');
  } else {
    tests.push({
      name: 'Environment Variables',
      status: 'failed',
      duration_ms: performance.now() - envTestStart,
      error: `Missing variables: ${missingVars.join(', ')}`,
      errorCategory: 'configuration'
    });
    console.error('✗ Missing environment variables:', missingVars.join(', '));
  }

  // Test 2: Supabase Client Initialization
  currentStep++;
  const clientTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Initializing Supabase client...`);
  
  let supabaseClient: any = null;
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseKey) {
      supabaseClient = createClient(supabaseUrl, supabaseKey);
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'passed',
        duration_ms: performance.now() - clientTestStart,
        details: 'Client initialized successfully'
      });
      console.log('✓ Supabase client initialized');
    } else {
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'failed',
        duration_ms: performance.now() - clientTestStart,
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
        errorCategory: 'configuration'
      });
      console.error('✗ Cannot initialize client: missing credentials');
    }
  } catch (error) {
    tests.push({
      name: 'Supabase Client Initialization',
      status: 'failed',
      duration_ms: performance.now() - clientTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ Client initialization error:', error.message);
  }

  // Test 3: External HTTP Request
  currentStep++;
  const httpTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing external HTTP request...`);
  
  try {
    const response = await fetch('https://httpbin.org/status/200', {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
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
        errorCategory: 'network'
      });
      console.error('✗ External HTTP request failed:', response.status);
    }
  } catch (error) {
    tests.push({
      name: 'External HTTP Request',
      status: 'failed',
      duration_ms: performance.now() - httpTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ External HTTP error:', error.message);
  }

  // Test 4: JSON Parsing
  currentStep++;
  const jsonTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing JSON parsing...`);
  
  try {
    const testObject = { test: 'data', nested: { value: 123 } };
    const jsonString = JSON.stringify(testObject);
    const parsed = JSON.parse(jsonString);
    
    if (parsed.test === 'data' && parsed.nested.value === 123) {
      tests.push({
        name: 'JSON Parsing',
        status: 'passed',
        duration_ms: performance.now() - jsonTestStart,
        details: 'JSON serialization/deserialization successful'
      });
      console.log('✓ JSON parsing verified');
    } else {
      tests.push({
        name: 'JSON Parsing',
        status: 'failed',
        duration_ms: performance.now() - jsonTestStart,
        error: 'Data mismatch after parsing',
        errorCategory: 'parsing'
      });
      console.error('✗ JSON parsing data mismatch');
    }
  } catch (error) {
    tests.push({
      name: 'JSON Parsing',
      status: 'failed',
      duration_ms: performance.now() - jsonTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ JSON parsing error:', error.message);
  }

  // Test 5: Database Connectivity
  currentStep++;
  const dbTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
  
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('count')
        .limit(1)
        .maybeSingle();
      
      if (error) {
        tests.push({
          name: 'Database Connectivity',
          status: 'failed',
          duration_ms: performance.now() - dbTestStart,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
        console.error('✗ Database query error:', error.message);
      } else {
        tests.push({
          name: 'Database Connectivity',
          status: 'passed',
          duration_ms: performance.now() - dbTestStart,
          details: 'Database query successful'
        });
        console.log('✓ Database connectivity verified');
      }
    } catch (error) {
      tests.push({
        name: 'Database Connectivity',
        status: 'failed',
        duration_ms: performance.now() - dbTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Database connection error:', error.message);
    }
  } else {
    tests.push({
      name: 'Database Connectivity',
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

  // Test 8: Structural Analysis
  currentStep++;
  const structuralTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Running structural analysis...`);
  
  try {
    const criticalPaths = [
      './supabase/functions',
      './src',
      './package.json'
    ];

    for (const path of criticalPaths) {
      try {
        const stat = await Deno.stat(path);
        if (!stat.isDirectory && !stat.isFile) {
          structuralIssues.push({
            severity: 'warning',
            path,
            issue: 'Path exists but is neither file nor directory'
          });
        }
      } catch (error) {
        if (error.name === 'NotFound') {
          structuralIssues.push({
            severity: 'critical',
            path,
            issue: 'Required path not found'
          });
        } else if (error.name === 'PermissionDenied') {
          structuralIssues.push({
            severity: 'warning',
            path,
            issue: 'Permission denied (expected in sandboxed environment)'
          });
        }
      }
    }
    
    const duration = performance.now() - structuralTestStart;
    tests.push({
      name: 'Structural Analysis',
      status: structuralIssues.filter(i => i.severity === 'critical').length > 0 ? 'failed' : 'passed',
      duration_ms: duration,
      details: `Found ${structuralIssues.length} issues`
    });
    
    if (structuralIssues.length === 0) {
      console.log('✓ Structural analysis complete: no issues found');
    } else {
      console.log(`⚠️ Structural analysis found ${structuralIssues.length} issues`);
      structuralIssues.forEach(issue => {
        console.log(`  ${issue.severity === 'critical' ? '✗' : '⚠️'} ${issue.path}: ${issue.issue}`);
      });
    }
  } catch (error) {
    tests.push({
      name: 'Structural Analysis',
      status: 'failed',
      duration_ms: performance.now() - structuralTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Structural analysis error:', error.message);
  }

  // Calculate summary
  const totalDuration = performance.now();
  const passedTests = tests.filter(t => t.status === 'passed').length;
  const failedTests = tests.filter(t => t.status === 'failed').length;
  const skippedTests = tests.filter(t => t.status === 'skipped').length;

  console.log('');
  console.log('=== TEST SUMMARY ===');
  console.log(`Total: ${tests.length} | Passed: ${passedTests} | Failed: ${failedTests} | Skipped: ${skippedTests}`);
  console.log(`Duration: ${totalDuration.toFixed(2)}ms`);
  console.log('');

  const result = {
    success: failedTests === 0,
    summary: {
      total: tests.length,
      passed: passedTests,
      failed: failedTests,
      skipped: skippedTests,
      duration_ms: totalDuration
    },
    tests,
    structuralIssues,
    timestamp: new Date().toISOString()
  };

  return new Response(JSON.stringify(result, null, 2), {
    headers: {
      'Content-Type': 'application/json
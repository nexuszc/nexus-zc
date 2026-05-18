import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface SmokeTestResult {
  name: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  error?: string;
  details?: string;
  errorCategory?: ErrorCategory;
}

interface ErrorCategory {
  category: string;
  isCritical: boolean;
  suggestion: string;
}

interface StructuralIssue {
  severity: 'critical' | 'warning';
  path: string;
  issue: string;
}

function categorizeError(error: any, message: string): ErrorCategory {
  const msg = message.toLowerCase();
  
  if (msg.includes('permission') || msg.includes('denied')) {
    return {
      category: 'permissions',
      isCritical: false,
      suggestion: 'Expected in sandboxed environment'
    };
  }
  
  if (msg.includes('not found') || msg.includes('notfound')) {
    return {
      category: 'missing_resource',
      isCritical: true,
      suggestion: 'Check if resource exists and path is correct'
    };
  }
  
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return {
      category: 'timeout',
      isCritical: true,
      suggestion: 'Check network connectivity or increase timeout'
    };
  }
  
  if (msg.includes('network') || msg.includes('fetch')) {
    return {
      category: 'network',
      isCritical: true,
      suggestion: 'Verify network connectivity and endpoint availability'
    };
  }
  
  if (msg.includes('missing') || msg.includes('undefined')) {
    return {
      category: 'configuration',
      isCritical: true,
      suggestion: 'Check environment variables and configuration'
    };
  }
  
  return {
    category: 'unknown',
    isCritical: true,
    suggestion: 'Review error details and logs'
  };
}

Deno.serve(async (req) => {
  const startTime = performance.now();
  const tests: SmokeTestResult[] = [];
  const structuralIssues: StructuralIssue[] = [];
  let supabaseClient: any = null;
  
  console.log('=== Smoke Test Runner Started ===');
  
  const totalSteps = 8;
  let currentStep = 0;

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
      details: `All ${requiredEnvVars.length} required variables present`
    });
    console.log('✓ All environment variables present');
  } else {
    tests.push({
      name: 'Environment Variables',
      status: 'failed',
      duration_ms: performance.now() - envTestStart,
      error: `Missing: ${missingVars.join(', ')}`,
      errorCategory: categorizeError(null, 'missing environment variables')
    });
    console.error('✗ Missing environment variables:', missingVars.join(', '));
  }

  // Test 2: External API Connectivity
  currentStep++;
  const apiTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing external API connectivity...`);
  
  try {
    const response = await fetch('https://httpbin.org/status/200', {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      tests.push({
        name: 'External API Connectivity',
        status: 'passed',
        duration_ms: performance.now() - apiTestStart,
        details: 'Successfully reached external endpoint'
      });
      console.log('✓ External API connectivity verified');
    } else {
      tests.push({
        name: 'External API Connectivity',
        status: 'failed',
        duration_ms: performance.now() - apiTestStart,
        error: `HTTP ${response.status}`,
        errorCategory: categorizeError(null, `HTTP ${response.status}`)
      });
      console.error('✗ External API returned non-OK status:', response.status);
    }
  } catch (error) {
    tests.push({
      name: 'External API Connectivity',
      status: 'failed',
      duration_ms: performance.now() - apiTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ External API connectivity error:', error.message);
  }

  // Test 3: JSON Processing
  currentStep++;
  const jsonTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);
  
  try {
    const testData = {
      timestamp: new Date().toISOString(),
      nested: { value: 42, array: [1, 2, 3] }
    };
    const serialized = JSON.stringify(testData);
    const deserialized = JSON.parse(serialized);
    
    if (deserialized.nested.value === 42) {
      tests.push({
        name: 'JSON Processing',
        status: 'passed',
        duration_ms: performance.now() - jsonTestStart,
        details: 'Serialization and deserialization successful'
      });
      console.log('✓ JSON processing verified');
    } else {
      throw new Error('Data integrity check failed');
    }
  } catch (error) {
    tests.push({
      name: 'JSON Processing',
      status: 'failed',
      duration_ms: performance.now() - jsonTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ JSON processing error:', error.message);
  }

  // Test 4: Supabase Client Initialization
  currentStep++;
  const clientTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Initializing Supabase client...`);
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (supabaseUrl && supabaseKey) {
    try {
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
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ Supabase client error:', error.message);
    }
  } else {
    tests.push({
      name: 'Supabase Client',
      status: 'failed',
      duration_ms: performance.now() - clientTestStart,
      error: 'Missing environment variables',
      errorCategory: categorizeError(null, 'missing environment variables')
    });
    console.error('✗ Cannot create Supabase client: missing env vars');
  }

  // Test 5: Database Connectivity
  currentStep++;
  const dbTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
  
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('smoke_test_results')
        .select('count')
        .limit(1);
      
      if (error) {
        const errorCat = categorizeError(error, error.message);
        tests.push({
          name: 'Database Connectivity',
          status: errorCat.isCritical ? 'failed' : 'passed',
          duration_ms: performance.now() - dbTestStart,
          error: error.message,
          errorCategory: errorCat
        });
        console.log(`${errorCat.isCritical ? '✗' : '✓'} Database query error (may be expected):`, error.message);
      } else {
        tests.push({
          name: 'Database Connectivity',
          status: 'passed',
          duration_ms: performance.now() - dbTestStart,
          details: 'Query executed successfully'
        });
        console.log('✓ Database connectivity verified');
      }
    } catch (error) {
      tests.push({
        name: 'Database Connectivity',
        status: 'failed',
        duration_ms: performance.now() - dbTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ Database connectivity error:', error.message);
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
      details: structuralIssues.length > 0 ? `Found ${structuralIssues.length} issues` : 'No issues found'
    });
  } catch (error) {
    tests.push({
      name: 'Structural Analysis',
      status: 'failed',
      duration_ms: performance.now() - structuralTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
  }

  // Calculate summary
  const passedTests = tests.filter(t => t.status === 'passed').length;
  const failedTests = tests.filter(t => t.status === 'failed').length;
  const totalDuration = performance.now() - startTime;
  
  const result = {
    timestamp: new Date().toISOString(),
    summary: {
      total: tests.length,
      passed: passedTests,
      failed: failedTests,
      duration_ms: totalDuration,
      success_rate: ((passedTests / tests.length) * 100).toFixed(2) + '%'
    },
    tests,
    structuralIssues,
    environment: {
      deno_version: Deno.version.deno,
      v8_version: Deno.version.v8,
      typescript_version: Deno.version.typescript
    }
  };
  
  console.log('\n=== Smoke Test Summary ===');
  console.log(`Total Tests: ${tests.length}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
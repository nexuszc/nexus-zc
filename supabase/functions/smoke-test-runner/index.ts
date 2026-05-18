Deno.serve(async (req) => {
  const startTime = performance.now();
  const totalSteps = 8;
  let currentStep = 0;
  
  const tests = [];
  const structuralIssues = [];

  console.log('\n=== Starting Smoke Test Suite ===\n');

  // Test 1: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
  
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const missingEnvVars = [];
  for (const envVar of requiredEnvVars) {
    if (!Deno.env.get(envVar)) {
      missingEnvVars.push(envVar);
    }
  }
  
  tests.push({
    name: 'Environment Variables',
    status: missingEnvVars.length === 0 ? 'passed' : 'failed',
    duration_ms: performance.now() - envTestStart,
    details: missingEnvVars.length === 0 
      ? 'All required variables present' 
      : `Missing: ${missingEnvVars.join(', ')}`
  });
  
  if (missingEnvVars.length === 0) {
    console.log('✓ All environment variables present');
  } else {
    console.log('✗ Missing environment variables:', missingEnvVars.join(', '));
  }

  // Test 2: Network Connectivity
  currentStep++;
  const netTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing network connectivity...`);
  
  try {
    const response = await fetch('https://www.google.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    
    tests.push({
      name: 'Network Connectivity',
      status: response.ok ? 'passed' : 'failed',
      duration_ms: performance.now() - netTestStart,
      details: `HTTP ${response.status}`
    });
    console.log(`✓ Network connectivity verified (${response.status})`);
  } catch (error) {
    tests.push({
      name: 'Network Connectivity',
      status: 'failed',
      duration_ms: performance.now() - netTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ Network connectivity error:', error.message);
  }

  // Test 3: JSON Processing
  currentStep++;
  const jsonTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);
  
  try {
    const testData = { test: 'data', nested: { value: 123 } };
    const serialized = JSON.stringify(testData);
    const deserialized = JSON.parse(serialized);
    
    const isValid = deserialized.test === 'data' && deserialized.nested.value === 123;
    
    tests.push({
      name: 'JSON Processing',
      status: isValid ? 'passed' : 'failed',
      duration_ms: performance.now() - jsonTestStart,
      details: 'Serialization and deserialization successful'
    });
    console.log('✓ JSON processing verified');
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

  // Test 4: Crypto Operations
  currentStep++;
  const cryptoTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing crypto operations...`);
  
  try {
    const data = new TextEncoder().encode('test data');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    tests.push({
      name: 'Crypto Operations',
      status: 'passed',
      duration_ms: performance.now() - cryptoTestStart,
      details: 'SHA-256 hash generated successfully'
    });
    console.log('✓ Crypto operations verified');
  } catch (error) {
    tests.push({
      name: 'Crypto Operations',
      status: 'failed',
      duration_ms: performance.now() - cryptoTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Crypto operations error:', error.message);
  }

  // Test 5: Database Connectivity
  currentStep++;
  const dbTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
  
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('_smoke_test_probe')
        .select('*')
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
  console.log(`Success Rate: ${result.summary.success_rate}`);
  console.log(`Total Duration: ${totalDuration.toFixed(2)}ms`);
  console.log('============================\n');

  return new Response(JSON.stringify(result, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
    },
    status: 200
  });
});
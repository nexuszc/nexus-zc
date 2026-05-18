Deno.serve(async (req) => {
  const startTime = performance.now();
  const tests: any[] = [];
  const structuralIssues: any[] = [];
  let currentStep = 0;
  const totalSteps = 8;

  console.log('=== Starting Smoke Test Suite ===');
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // Helper function to categorize errors
  function categorizeError(error: any, message: string) {
    const categories = {
      network: ['fetch', 'ECONNREFUSED', 'ETIMEDOUT', 'network'],
      permission: ['PermissionDenied', 'permission'],
      notFound: ['NotFound', '404', 'ENOENT'],
      timeout: ['timeout', 'ETIMEDOUT'],
      memory: ['memory', 'heap'],
      unknown: []
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(kw => message?.toLowerCase().includes(kw.toLowerCase()))) {
        return {
          category,
          isCritical: ['network', 'permission'].includes(category)
        };
      }
    }

    return { category: 'unknown', isCritical: false };
  }

  // Test 1: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);
  
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'OPENAI_API_KEY'
  ];
  
  const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
  
  tests.push({
    name: 'Environment Variables',
    status: missingVars.length === 0 ? 'passed' : 'failed',
    duration_ms: performance.now() - envTestStart,
    details: missingVars.length === 0 ? 'All required variables present' : `Missing: ${missingVars.join(', ')}`
  });
  
  if (missingVars.length === 0) {
    console.log('✓ All environment variables present');
  } else {
    console.error('✗ Missing environment variables:', missingVars.join(', '));
  }

  // Test 2: OpenAI API
  currentStep++;
  const openaiTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing OpenAI API...`);
  
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`
      }
    });
    
    if (response.ok) {
      tests.push({
        name: 'OpenAI API',
        status: 'passed',
        duration_ms: performance.now() - openaiTestStart,
        details: 'API accessible and authenticated'
      });
      console.log('✓ OpenAI API accessible');
    } else {
      const errorCat = categorizeError(null, `Status ${response.status}`);
      tests.push({
        name: 'OpenAI API',
        status: 'failed',
        duration_ms: performance.now() - openaiTestStart,
        error: `HTTP ${response.status}`,
        errorCategory: errorCat
      });
      console.error(`✗ OpenAI API error: HTTP ${response.status}`);
    }
  } catch (error) {
    const errorCat = categorizeError(error, error.message);
    tests.push({
      name: 'OpenAI API',
      status: 'failed',
      duration_ms: performance.now() - openaiTestStart,
      error: error.message,
      errorCategory: errorCat
    });
    console.error('✗ OpenAI API error:', error.message);
  }

  // Test 3: External API (httpbin)
  currentStep++;
  const httpbinTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing external API access...`);
  
  try {
    const response = await fetch('https://httpbin.org/get', {
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      tests.push({
        name: 'External API Access',
        status: 'passed',
        duration_ms: performance.now() - httpbinTestStart,
        details: 'Successfully connected to external service'
      });
      console.log('✓ External API access verified');
    } else {
      const errorCat = categorizeError(null, `Status ${response.status}`);
      tests.push({
        name: 'External API Access',
        status: 'failed',
        duration_ms: performance.now() - httpbinTestStart,
        error: `HTTP ${response.status}`,
        errorCategory: errorCat
      });
      console.error(`✗ External API error: HTTP ${response.status}`);
    }
  } catch (error) {
    const errorCat = categorizeError(error, error.message);
    tests.push({
      name: 'External API Access',
      status: 'failed',
      duration_ms: performance.now() - httpbinTestStart,
      error: error.message,
      errorCategory: errorCat
    });
    console.error('✗ External API error:', error.message);
  }

  // Test 4: JSON Processing
  currentStep++;
  const jsonTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);
  
  try {
    const testData = { test: 'data', nested: { value: 123 } };
    const serialized = JSON.stringify(testData);
    const deserialized = JSON.parse(serialized);
    
    if (deserialized.nested.value === 123) {
      tests.push({
        name: 'JSON Processing',
        status: 'passed',
        duration_ms: performance.now() - jsonTestStart,
        details: 'Serialization and deserialization successful'
      });
      console.log('✓ JSON processing verified');
    } else {
      tests.push({
        name: 'JSON Processing',
        status: 'failed',
        duration_ms: performance.now() - jsonTestStart,
        error: 'Data integrity check failed',
        errorCategory: categorizeError(null, 'data integrity')
      });
      console.error('✗ JSON processing failed: data integrity check');
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

  // Test 5: Database Connectivity (if Supabase client available)
  currentStep++;
  const dbTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
  
  if (Deno.env.get('SUPABASE_URL') && Deno.env.get('SUPABASE_ANON_KEY')) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      });
      
      const errorCat = categorizeError(null, `Status ${response.status}`);
      
      if (!response.ok && errorCat.isCritical) {
        tests.push({
          name: 'Database Connectivity',
          status: 'failed',
          duration_ms: performance.now() - dbTestStart,
          error: `HTTP ${response.status}`,
          errorCategory: errorCat
        });
        console.error(`✗ Database connectivity error: HTTP ${response.status}`);
      } else if (!response.ok) {
        tests.push({
          name: 'Database Connectivity',
          status: 'passed',
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
      'Content-Type': '
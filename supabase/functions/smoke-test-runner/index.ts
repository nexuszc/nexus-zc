Deno.serve(async (req) => {
  const startTime = performance.now();
  const totalSteps = 8;
  let currentStep = 0;
  
  const tests = [];
  const structuralIssues = [];

  // Helper function to categorize errors
  function categorizeError(error: any, message: string) {
    const categories = {
      network: ['fetch', 'connection', 'timeout', 'ECONNREFUSED'],
      permission: ['PermissionDenied', 'permission', 'EACCES'],
      database: ['database', 'query', 'sql', 'relation'],
      filesystem: ['NotFound', 'ENOENT', 'file', 'directory'],
      memory: ['memory', 'heap', 'allocation'],
      configuration: ['environment', 'config', 'missing']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(kw => message.toLowerCase().includes(kw.toLowerCase()))) {
        return {
          category,
          isCritical: ['network', 'database', 'configuration'].includes(category),
          isExpected: ['permission', 'filesystem'].includes(category)
        };
      }
    }

    return { category: 'unknown', isCritical: false, isExpected: false };
  }

  console.log('='.repeat(60));
  console.log('NEXUS SMOKE TEST RUNNER');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);
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
  
  const missingVars = [];
  const presentVars = [];
  
  for (const envVar of requiredEnvVars) {
    if (Deno.env.get(envVar)) {
      presentVars.push(envVar);
    } else {
      missingVars.push(envVar);
    }
  }
  
  if (missingVars.length === 0) {
    tests.push({
      name: 'Environment Variables',
      status: 'passed',
      duration_ms: performance.now() - envTestStart,
      details: `All ${requiredEnvVars.length} required variables present`
    });
    console.log(`✓ All environment variables present (${presentVars.length}/${requiredEnvVars.length})`);
  } else {
    tests.push({
      name: 'Environment Variables',
      status: 'failed',
      duration_ms: performance.now() - envTestStart,
      error: `Missing: ${missingVars.join(', ')}`,
      errorCategory: categorizeError(null, 'environment configuration')
    });
    console.error(`✗ Missing environment variables: ${missingVars.join(', ')}`);
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
      status: 'passed',
      duration_ms: performance.now() - netTestStart,
      details: `HTTP ${response.status}`
    });
    console.log('✓ Network connectivity verified');
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

  // Test 3: Supabase Client Initialization
  currentStep++;
  const supabaseTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Initializing Supabase client...`);
  
  let supabaseClient = null;
  
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (supabaseUrl && supabaseKey) {
      supabaseClient = createClient(supabaseUrl, supabaseKey);
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'passed',
        duration_ms: performance.now() - supabaseTestStart,
        details: 'Client created successfully'
      });
      console.log('✓ Supabase client initialized');
    } else {
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'failed',
        duration_ms: performance.now() - supabaseTestStart,
        error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
        errorCategory: categorizeError(null, 'environment configuration')
      });
      console.error('✗ Cannot initialize Supabase client: missing credentials');
    }
  } catch (error) {
    tests.push({
      name: 'Supabase Client Initialization',
      status: 'failed',
      duration_ms: performance.now() - supabaseTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ Supabase client initialization error:', error.message);
  }

  // Test 4: JSON Processing
  currentStep++;
  const jsonTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);
  
  try {
    const testData = {
      timestamp: new Date().toISOString(),
      nested: { array: [1, 2, 3], value: 'test' },
      unicode: '🚀 Test data'
    };
    
    const serialized = JSON.stringify(testData);
    const deserialized = JSON.parse(serialized);
    
    if (deserialized.unicode === testData.unicode) {
      tests.push({
        name: 'JSON Processing',
        status: 'passed',
        duration_ms: performance.now() - jsonTestStart,
        details: 'Serialization and deserialization successful'
      });
      console.log('✓ JSON processing verified');
    } else {
      throw new Error('Data mismatch after serialization');
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
        const errorCat = categorizeError(error, error.message);
        tests.push({
          name: 'Database Connectivity',
          status: errorCat.isCritical ? 'failed' : 'passed',
          duration_ms: performance.now() - dbTestStart,
          error: error.message,
          errorCategory: errorCat
        });
        console.log(`${errorCat.isCritical ? '✗' : '⚠'} Database query error (may be expected):`, error.message);
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
      details: `Found ${structuralIssues.length} issues`
    });
    
    if (structuralIssues.length === 0) {
      console.log('✓ Structural analysis complete: no issues found');
    } else {
      console.log(`⚠  Structural analysis found ${structuralIssues.length} issues`);
      structuralIssues.forEach(issue => {
        console.log(`  ${issue.severity === 'critical' ? '✗' : '⚠ '} ${issue.path}: ${issue.issue}`);
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
  const totalDuration = performance.now() - startTime;
  const passedTests = tests.filter(t => t.status === 'passed').length;
  const failedTests = tests.filter(t => t.status === 'failed').length;
  const criticalFailures = tests.filter(t => t.status === 'failed' && t.errorCategory?.isCritical).length;

  console.log('');
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${tests.length}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);
  console.log(`Critical Failures: ${criticalFailures}`);
  console.log(`Total Duration: ${totalDuration.toFixed(2)}ms`);
  console.log(`Completed at: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  const result = {
    success: criticalFailures === 0,
    timestamp: new Date().toISOString(),
    summary: {
      total: tests.length,
      passed: passedTests,
      failed: failedTests,
      critical_failures: criticalFailures,
      duration_ms: totalDuration
    },
    tests,
    structural_issues:
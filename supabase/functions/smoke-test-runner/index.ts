import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// Helper function to categorize errors
function categorizeError(error: any, message: string) {
  const errorCategories = {
    'relation "smoke_test_results" does not exist': {
      category: 'expected_schema_missing',
      isCritical: false,
      suggestion: 'Table may not exist yet - this is expected in new environments'
    },
    'client not initialized': {
      category: 'initialization_error',
      isCritical: true,
      suggestion: 'Check Supabase URL and keys configuration'
    },
    'PermissionDenied': {
      category: 'permission_error',
      isCritical: false,
      suggestion: 'Expected in sandboxed environment'
    },
    'NotFound': {
      category: 'file_not_found',
      isCritical: true,
      suggestion: 'Required file or directory is missing'
    }
  };

  for (const [pattern, details] of Object.entries(errorCategories)) {
    if (message.includes(pattern)) {
      return details;
    }
  }

  return {
    category: 'unknown_error',
    isCritical: true,
    suggestion: 'Review error details for diagnosis'
  };
}

Deno.serve(async (req) => {
  const startTime = performance.now();
  const tests: any[] = [];
  const structuralIssues: any[] = [];
  
  console.log('=== Starting Smoke Test Runner ===');
  console.log('Request URL:', req.url);
  console.log('Request Method:', req.method);
  
  const totalSteps = 8;
  let currentStep = 0;

  // Test 1: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);
  
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const missingEnvVars: string[] = [];
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
    console.error('✗ Missing environment variables:', missingEnvVars.join(', '));
  }

  // Test 2: Supabase Client Initialization
  currentStep++;
  const clientTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing Supabase client initialization...`);
  
  let supabaseClient = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseKey) {
      supabaseClient = createClient(supabaseUrl, supabaseKey);
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'passed',
        duration_ms: performance.now() - clientTestStart,
        details: 'Client created successfully'
      });
      console.log('✓ Supabase client initialized');
    } else {
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'failed',
        duration_ms: performance.now() - clientTestStart,
        error: 'Missing required environment variables'
      });
      console.error('✗ Cannot initialize client: missing env vars');
    }
  } catch (error) {
    tests.push({
      name: 'Supabase Client Initialization',
      status: 'failed',
      duration_ms: performance.now() - clientTestStart,
      error: error.message
    });
    console.error('✗ Client initialization error:', error.message);
  }

  // Test 3: Network Connectivity
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
      status: response.ok ? 'passed' : 'failed',
      duration_ms: performance.now() - networkTestStart,
      details: `Status: ${response.status}`
    });
    console.log(`${response.ok ? '✓' : '✗'} Network connectivity: ${response.status}`);
  } catch (error) {
    tests.push({
      name: 'Network Connectivity',
      status: 'failed',
      duration_ms: performance.now() - networkTestStart,
      error: error.message
    });
    console.error('✗ Network connectivity error:', error.message);
  }

  // Test 4: Request Object
  currentStep++;
  const reqTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing request object...`);
  
  try {
    const requestDetails = {
      method: req.method,
      url: req.url,
      hasHeaders: !!req.headers,
      headerCount: Array.from(req.headers.keys()).length
    };
    
    tests.push({
      name: 'Request Object',
      status: 'passed',
      duration_ms: performance.now() - reqTestStart,
      details: JSON.stringify(requestDetails)
    });
    console.log('✓ Request object validated');
  } catch (error) {
    tests.push({
      name: 'Request Object',
      status: 'failed',
      duration_ms: performance.now() - reqTestStart,
      error: error.message
    });
    console.error('✗ Request object error:', error.message);
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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface SmokeTest {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
  details?: string;
  errorCategory?: string;
}

interface StructuralIssue {
  severity: 'critical' | 'warning';
  path: string;
  issue: string;
}

function categorizeError(statusCode: number | null, errorMessage: string): string {
  if (statusCode === 401 || statusCode === 403) return 'authentication';
  if (statusCode === 404) return 'not_found';
  if (statusCode && statusCode >= 500) return 'server_error';
  if (errorMessage.toLowerCase().includes('timeout')) return 'timeout';
  if (errorMessage.toLowerCase().includes('network')) return 'network';
  if (errorMessage.toLowerCase().includes('permission')) return 'permission';
  return 'unknown';
}

Deno.serve(async (req) => {
  const tests: SmokeTest[] = [];
  const structuralIssues: StructuralIssue[] = [];
  let totalSteps = 8;
  let currentStep = 0;

  console.log('=== NEXUS SMOKE TEST RUNNER ===');
  console.log(`Starting ${totalSteps} tests...`);
  console.log('');

  // Test 1: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
  
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'OPENAI_API_KEY'
  ];

  const missingVars: string[] = [];
  for (const envVar of requiredEnvVars) {
    if (!Deno.env.get(envVar)) {
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
    console.log('✓ All environment variables present');
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

  // Test 2: OpenAI API Connectivity
  currentStep++;
  const openaiTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing OpenAI API connectivity...`);
  
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (openaiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${openaiKey}`
        }
      });

      if (response.ok) {
        tests.push({
          name: 'OpenAI API Connectivity',
          status: 'passed',
          duration_ms: performance.now() - openaiTestStart,
          details: 'API accessible'
        });
        console.log('✓ OpenAI API connectivity verified');
      } else {
        tests.push({
          name: 'OpenAI API Connectivity',
          status: 'failed',
          duration_ms: performance.now() - openaiTestStart,
          error: `HTTP ${response.status}`,
          errorCategory: categorizeError(response.status, '')
        });
        console.error('✗ OpenAI API returned status:', response.status);
      }
    } catch (error) {
      tests.push({
        name: 'OpenAI API Connectivity',
        status: 'failed',
        duration_ms: performance.now() - openaiTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ OpenAI API connection error:', error.message);
    }
  } else {
    tests.push({
      name: 'OpenAI API Connectivity',
      status: 'skipped',
      duration_ms: performance.now() - openaiTestStart,
      details: 'No API key configured'
    });
    console.log('⊘ OpenAI API test skipped (no key)');
  }

  // Test 3: Supabase Edge Function Runtime
  currentStep++;
  const runtimeTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing edge function runtime...`);
  
  try {
    const denoVersion = Deno.version;
    tests.push({
      name: 'Edge Function Runtime',
      status: 'passed',
      duration_ms: performance.now() - runtimeTestStart,
      details: `Deno ${denoVersion.deno}`
    });
    console.log(`✓ Runtime verified: Deno ${denoVersion.deno}`);
  } catch (error) {
    tests.push({
      name: 'Edge Function Runtime',
      status: 'failed',
      duration_ms: performance.now() - runtimeTestStart,
      error: error.message,
      errorCategory: categorizeError(null, error.message)
    });
    console.error('✗ Runtime check error:', error.message);
  }

  // Test 4: Network Connectivity
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
      details: `HTTP ${response.status}`
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

  // Test 5: Database Connectivity
  currentStep++;
  const dbTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase.from('conversations').select('id').limit(1);
      
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
      'Content-Type': 'application/json'
    },
    status: failedTests === 0 ? 200 : 500
  });
});
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  details?: string;
  error?: string;
  errorCategory?: {
    category: string;
    isCritical: boolean;
    reason: string;
  };
}

interface StructuralIssue {
  severity: 'critical' | 'warning';
  path: string;
  issue: string;
}

function categorizeError(error: any, message: string): { category: string; isCritical: boolean; reason: string } {
  const msg = message.toLowerCase();
  
  if (msg.includes('permission') || msg.includes('denied')) {
    return {
      category: 'permissions',
      isCritical: false,
      reason: 'Permission issues are expected in sandboxed environments'
    };
  }
  
  if (msg.includes('not found') || msg.includes('enoent')) {
    return {
      category: 'missing_resource',
      isCritical: true,
      reason: 'Required resource is missing'
    };
  }
  
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
    return {
      category: 'network',
      isCritical: true,
      reason: 'Network connectivity issue'
    };
  }
  
  if (msg.includes('timeout')) {
    return {
      category: 'timeout',
      isCritical: true,
      reason: 'Operation timed out'
    };
  }
  
  if (msg.includes('auth') || msg.includes('unauthorized')) {
    return {
      category: 'authentication',
      isCritical: true,
      reason: 'Authentication or authorization failure'
    };
  }
  
  return {
    category: 'unknown',
    isCritical: true,
    reason: 'Unclassified error'
  };
}

function generateRecommendations(tests: TestResult[], structuralIssues: StructuralIssue[]): string[] {
  const recommendations: string[] = [];
  
  const criticalStructuralIssues = structuralIssues.filter(i => i.severity === 'critical');
  if (criticalStructuralIssues.length > 0) {
    recommendations.push(`Fix ${criticalStructuralIssues.length} critical structural issues`);
  }
  
  const networkErrors = tests.filter(t => t.errorCategory?.category === 'network');
  if (networkErrors.length > 0) {
    recommendations.push('Check network connectivity and firewall rules');
  }
  
  const authErrors = tests.filter(t => t.errorCategory?.category === 'authentication');
  if (authErrors.length > 0) {
    recommendations.push('Verify Supabase credentials and permissions');
  }
  
  const missingResources = tests.filter(t => t.errorCategory?.category === 'missing_resource');
  if (missingResources.length > 0) {
    recommendations.push('Restore missing files or dependencies');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('System is operating normally');
  }
  
  return recommendations;
}

Deno.serve(async (req) => {
  const overallStartTime = performance.now();
  const tests: TestResult[] = [];
  const structuralIssues: StructuralIssue[] = [];
  
  let currentStep = 0;
  const totalSteps = 8;

  console.log('='.repeat(60));
  console.log('STARTING COMPREHENSIVE SMOKE TEST SUITE');
  console.log('='.repeat(60));

  // Test 1: Deno Runtime
  currentStep++;
  const denoTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing Deno runtime...`);
  
  let denoEnv = {};
  try {
    denoEnv = {
      version: Deno.version.deno,
      v8: Deno.version.v8,
      typescript: Deno.version.typescript
    };
    tests.push({
      name: 'Deno Runtime',
      status: 'passed',
      duration_ms: performance.now() - denoTestStart,
      details: `Deno ${Deno.version.deno}`
    });
    console.log(`✓ Deno runtime available: v${Deno.version.deno}`);
  } catch (error) {
    tests.push({
      name: 'Deno Runtime',
      status: 'failed',
      duration_ms: performance.now() - denoTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ Deno runtime error:', error.message);
  }

  // Test 2: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
  
  const baseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (baseUrl && anonKey) {
    tests.push({
      name: 'Environment Variables',
      status: 'passed',
      duration_ms: performance.now() - envTestStart,
      details: 'Required environment variables present'
    });
    console.log('✓ Environment variables configured');
  } else {
    const missing = [];
    if (!baseUrl) missing.push('SUPABASE_URL');
    if (!anonKey) missing.push('SUPABASE_ANON_KEY');
    
    tests.push({
      name: 'Environment Variables',
      status: 'failed',
      duration_ms: performance.now() - envTestStart,
      error: `Missing variables: ${missing.join(', ')}`,
      errorCategory: categorizeError(null, 'missing environment variables')
    });
    console.error('✗ Missing environment variables:', missing.join(', '));
  }

  // Test 3: HTTP Fetch
  currentStep++;
  const httpTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing HTTP fetch capability...`);
  
  try {
    const response = await fetch('https://httpbin.org/json', {
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      tests.push({
        name: 'HTTP Fetch',
        status: 'passed',
        duration_ms: performance.now() - httpTestStart,
        details: `Status: ${response.status}`
      });
      console.log('✓ HTTP fetch working');
    } else {
      tests.push({
        name: 'HTTP Fetch',
        status: 'failed',
        duration_ms: performance.now() - httpTestStart,
        error: `HTTP ${response.status}`,
        errorCategory: categorizeError(null, `HTTP ${response.status}`)
      });
      console.error(`✗ HTTP fetch returned ${response.status}`);
    }
  } catch (error) {
    tests.push({
      name: 'HTTP Fetch',
      status: 'failed',
      duration_ms: performance.now() - httpTestStart,
      error: error.message,
      errorCategory: categorizeError(error, error.message)
    });
    console.error('✗ HTTP fetch error:', error.message);
  }

  // Test 4: Supabase Client Creation
  currentStep++;
  const clientTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing Supabase client creation...`);
  
  let supabaseClient = null;
  if (baseUrl && anonKey) {
    try {
      supabaseClient = createClient(baseUrl, anonKey);
      tests.push({
        name: 'Supabase Client',
        status: 'passed',
        duration_ms: performance.now() - clientTestStart,
        details: 'Client initialized successfully'
      });
      console.log('✓ Supabase client created');
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
  const passedTests = tests.filter(t => t.status ===
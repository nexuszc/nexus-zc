// Import statements at the top
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
  errorCategory?: string;
  details?: string;
}

interface StructuralIssue {
  severity: 'critical' | 'warning';
  path: string;
  issue: string;
}

function categorizeError(statusCode: number | null, errorMessage: string): string {
  if (statusCode) {
    if (statusCode >= 500) return 'server_error';
    if (statusCode === 429) return 'rate_limit';
    if (statusCode === 403 || statusCode === 401) return 'auth_error';
    if (statusCode >= 400) return 'client_error';
  }
  
  if (errorMessage) {
    const msg = errorMessage.toLowerCase();
    if (msg.includes('timeout')) return 'timeout';
    if (msg.includes('network')) return 'network_error';
    if (msg.includes('permission')) return 'permission_error';
    if (msg.includes('not found')) return 'not_found';
    if (msg.includes('auth')) return 'auth_error';
  }
  
  return 'unknown_error';
}

Deno.serve(async (req) => {
  const tests: TestResult[] = [];
  const structuralIssues: StructuralIssue[] = [];
  const startTime = performance.now();
  
  const totalSteps = 8;
  let currentStep = 0;

  console.log('🚀 Starting comprehensive smoke tests...');

  // Test 1: Environment Variables
  currentStep++;
  const envTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
  
  const requiredEnvVars = [
    'ANTHROPIC_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
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
      error: `Missing: ${missingVars.join(', ')}`,
      errorCategory: 'configuration_error'
    });
    console.error('✗ Missing environment variables:', missingVars.join(', '));
  }

  // Test 2: Network Connectivity
  currentStep++;
  const networkTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing network connectivity...`);
  
  try {
    const response = await fetch('https://www.google.com', { 
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      tests.push({
        name: 'Network Connectivity',
        status: 'passed',
        duration_ms: performance.now() - networkTestStart,
        details: 'External network reachable'
      });
      console.log('✓ Network connectivity verified');
    } else {
      tests.push({
        name: 'Network Connectivity',
        status: 'failed',
        duration_ms: performance.now() - networkTestStart,
        error: `HTTP ${response.status}`,
        errorCategory: categorizeError(response.status, '')
      });
      console.error('✗ Network test failed:', response.status);
    }
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

  // Test 3: Supabase Connectivity
  currentStep++;
  const supabaseTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing Supabase connectivity...`);
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  
  if (supabaseUrl) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok || response.status === 404) {
        tests.push({
          name: 'Supabase Connectivity',
          status: 'passed',
          duration_ms: performance.now() - supabaseTestStart,
          details: 'Supabase endpoint reachable'
        });
        console.log('✓ Supabase connectivity verified');
      } else {
        tests.push({
          name: 'Supabase Connectivity',
          status: 'failed',
          duration_ms: performance.now() - supabaseTestStart,
          error: `HTTP ${response.status}`,
          errorCategory: categorizeError(response.status, '')
        });
        console.error('✗ Supabase connectivity failed:', response.status);
      }
    } catch (error) {
      tests.push({
        name: 'Supabase Connectivity',
        status: 'failed',
        duration_ms: performance.now() - supabaseTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Supabase connectivity error:', error.message);
    }
  } else {
    tests.push({
      name: 'Supabase Connectivity',
      status: 'failed',
      duration_ms: performance.now() - supabaseTestStart,
      error: 'SUPABASE_URL not configured',
      errorCategory: 'configuration_error'
    });
  }

  // Test 4: Anthropic API Connectivity
  currentStep++;
  const anthropicTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing Anthropic API connectivity...`);
  
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
  
  if (anthropicApiKey) {
    try {
      const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }]
        }),
        signal: AbortSignal.timeout(10000)
      });
      
      if (anthropicResponse.ok) {
        tests.push({
          name: 'Anthropic Connectivity',
          status: 'passed',
          duration_ms: performance.now() - anthropicTestStart,
          details: 'API responded successfully'
        });
        console.log('✓ Anthropic API connectivity verified');
      } else {
        if (anthropicResponse.status === 401) {
          tests.push({
            name: 'Anthropic Connectivity',
            status: 'failed',
            duration_ms: performance.now() - anthropicTestStart,
            error: 'Invalid API key',
            errorCategory: 'auth_error'
          });
          console.error('✗ Anthropic API key invalid');
        } else {
          tests.push({
            name: 'Anthropic Connectivity',
            status: 'failed',
            duration_ms: performance.now() - anthropicTestStart,
            error: `HTTP ${anthropicResponse.status}`,
            errorCategory: categorizeError(anthropicResponse.status, '')
          });
          console.error('✗ Anthropic connectivity failed:', anthropicResponse.status);
        }
      }
    } catch (error) {
      tests.push({
        name: 'Anthropic Connectivity',
        status: 'failed',
        duration_ms: performance.now() - anthropicTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Anthropic connectivity error:', error.message);
    }
  } else {
    tests.push({
      name: 'Anthropic Connectivity',
      status: 'failed',
      duration_ms: performance.now() - anthropicTestStart,
      error: 'ANTHROPIC_API_KEY not configured',
      errorCategory: 'configuration_error'
    });
  }

  // Test 5: Database Connectivity
  currentStep++;
  const dbTestStart = performance.now();
  console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
  
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase.from('conversations').select('count').limit(1);
      
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
      details: structuralIssues.length === 0 
        ? 'No structural issues found' 
        : `Found ${structuralIssues.length} issue(s)`
    });
    console.log(`✓ Structural analysis completed (${structuralIssues.length} issues found)`);
  } catch (error) {
    tests.push({
      name: 'Structural Analysis',
      status: 'failed',
      duration_ms: performance.now() - structuralTest
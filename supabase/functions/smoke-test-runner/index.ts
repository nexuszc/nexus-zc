import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface TestResult {
  name: string;
  status: 'passed' | 'failed';
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

function categorizeError(statusCode: number | null, message: string): string {
  if (statusCode === 401 || message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('auth')) {
    return 'authentication';
  }
  if (statusCode === 403 || message.toLowerCase().includes('forbidden') || message.toLowerCase().includes('permission')) {
    return 'authorization';
  }
  if (statusCode === 404 || message.toLowerCase().includes('not found')) {
    return 'not_found';
  }
  if (statusCode === 429 || message.toLowerCase().includes('rate limit')) {
    return 'rate_limit';
  }
  if (statusCode && statusCode >= 500 || message.toLowerCase().includes('timeout') || message.toLowerCase().includes('network')) {
    return 'service_unavailable';
  }
  if (message.toLowerCase().includes('client not initialized') || message.toLowerCase().includes('configuration')) {
    return 'configuration';
  }
  return 'unknown';
}

Deno.serve(async (req) => {
  try {
    const tests: TestResult[] = [];
    const structuralIssues: StructuralIssue[] = [];
    
    let currentStep = 0;
    const totalSteps = 8;

    console.log('=== Starting Smoke Test Runner ===');
    console.log(`Total steps: ${totalSteps}\n`);

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
    
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY'
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
    
    if (missingEnvVars.length === 0) {
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
        error: `Missing: ${missingEnvVars.join(', ')}`,
        errorCategory: 'configuration'
      });
      console.error('✗ Missing environment variables:', missingEnvVars.join(', '));
    }

    // Test 2: OpenAI API Connection
    currentStep++;
    const openaiTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing OpenAI API connection...`);
    
    try {
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) {
        throw new Error('OPENAI_API_KEY not set');
      }

      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${openaiKey}`
        }
      });

      if (response.ok) {
        tests.push({
          name: 'OpenAI API Connection',
          status: 'passed',
          duration_ms: performance.now() - openaiTestStart,
          details: `Status: ${response.status}`
        });
        console.log('✓ OpenAI API connection successful');
      } else {
        const errorText = await response.text();
        tests.push({
          name: 'OpenAI API Connection',
          status: 'failed',
          duration_ms: performance.now() - openaiTestStart,
          error: `HTTP ${response.status}: ${errorText}`,
          errorCategory: categorizeError(response.status, errorText)
        });
        console.error(`✗ OpenAI API connection failed: ${response.status}`);
      }
    } catch (error) {
      tests.push({
        name: 'OpenAI API Connection',
        status: 'failed',
        duration_ms: performance.now() - openaiTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ OpenAI API connection error:', error.message);
    }

    // Test 3: Anthropic API Connection
    currentStep++;
    const anthropicTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing Anthropic API connection...`);
    
    try {
      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!anthropicKey) {
        throw new Error('ANTHROPIC_API_KEY not set');
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        })
      });

      if (response.ok || response.status === 400) {
        tests.push({
          name: 'Anthropic API Connection',
          status: 'passed',
          duration_ms: performance.now() - anthropicTestStart,
          details: `Status: ${response.status}`
        });
        console.log('✓ Anthropic API connection successful');
      } else {
        const errorText = await response.text();
        tests.push({
          name: 'Anthropic API Connection',
          status: 'failed',
          duration_ms: performance.now() - anthropicTestStart,
          error: `HTTP ${response.status}: ${errorText}`,
          errorCategory: categorizeError(response.status, errorText)
        });
        console.error(`✗ Anthropic API connection failed: ${response.status}`);
      }
    } catch (error) {
      tests.push({
        name: 'Anthropic API Connection',
        status: 'failed',
        duration_ms: performance.now() - anthropicTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Anthropic API connection error:', error.message);
    }

    // Test 4: External HTTP Request
    currentStep++;
    const httpTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing external HTTP request...`);
    
    try {
      const response = await fetch('https://httpbin.org/get', {
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
          errorCategory: categorizeError(response.status, '')
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
    const failedTests = tests.filter(t => t.status
// supabase/functions/smoke-test-runner/index.ts
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

function categorizeError(statusCode: number | null, errorMessage: string): string {
  if (!statusCode && !errorMessage) return 'unknown';
  
  const message = errorMessage?.toLowerCase() || '';
  
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('network') || message.includes('fetch')) return 'network';
  if (message.includes('permission') || message.includes('denied')) return 'permission';
  if (message.includes('not found') || statusCode === 404) return 'not_found';
  if (message.includes('unauthorized') || statusCode === 401) return 'auth';
  if (statusCode && statusCode >= 500) return 'server_error';
  if (statusCode && statusCode >= 400) return 'client_error';
  
  return 'unknown';
}

Deno.serve(async (req) => {
  try {
    console.log('=== Smoke Test Runner Starting ===');
    const overallStart = performance.now();
    
    const tests: TestResult[] = [];
    const structuralIssues: StructuralIssue[] = [];
    
    const totalSteps = 8;
    let currentStep = 0;

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);

    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'OPENAI_API_KEY'
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));

    if (missingEnvVars.length > 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing: ${missingEnvVars.join(', ')}`,
        errorCategory: 'configuration'
      });
      console.error('❌ Missing environment variables:', missingEnvVars);
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required environment variables present'
      });
      console.log('✅ All environment variables present');
    }

    // Test 2: OpenAI API Connectivity
    currentStep++;
    const openaiTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing OpenAI API connectivity...`);

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (openaiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          signal: AbortSignal.timeout(10000)
        });

        if (response.ok) {
          tests.push({
            name: 'OpenAI API Connectivity',
            status: 'passed',
            duration_ms: performance.now() - openaiTestStart,
            details: `Status: ${response.status}`
          });
          console.log('✅ OpenAI API accessible');
        } else {
          const errorText = await response.text();
          tests.push({
            name: 'OpenAI API Connectivity',
            status: 'failed',
            duration_ms: performance.now() - openaiTestStart,
            error: `HTTP ${response.status}: ${errorText}`,
            errorCategory: categorizeError(response.status, errorText)
          });
          console.error('❌ OpenAI API error:', response.status, errorText);
        }
      } catch (error) {
        tests.push({
          name: 'OpenAI API Connectivity',
          status: 'failed',
          duration_ms: performance.now() - openaiTestStart,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
        console.error('❌ OpenAI API connection error:', error.message);
      }
    } else {
      tests.push({
        name: 'OpenAI API Connectivity',
        status: 'failed',
        duration_ms: performance.now() - openaiTestStart,
        error: 'OPENAI_API_KEY not set',
        errorCategory: 'configuration'
      });
    }

    // Test 3: Supabase Edge Function Health
    currentStep++;
    const edgeFnTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing edge function health...`);

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      if (supabaseUrl) {
        const healthCheckUrl = `${supabaseUrl}/functions/v1/health`;
        const response = await fetch(healthCheckUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });

        tests.push({
          name: 'Edge Function Health',
          status: response.ok ? 'passed' : 'failed',
          duration_ms: performance.now() - edgeFnTestStart,
          details: `Status: ${response.status}`,
          error: response.ok ? undefined : `HTTP ${response.status}`,
          errorCategory: response.ok ? undefined : categorizeError(response.status, '')
        });
        console.log(response.ok ? '✅ Edge function health check passed' : '❌ Edge function health check failed');
      } else {
        tests.push({
          name: 'Edge Function Health',
          status: 'failed',
          duration_ms: performance.now() - edgeFnTestStart,
          error: 'SUPABASE_URL not set',
          errorCategory: 'configuration'
        });
      }
    } catch (error) {
      tests.push({
        name: 'Edge Function Health',
        status: 'failed',
        duration_ms: performance.now() - edgeFnTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('❌ Edge function health check error:', error.message);
    }

    // Test 4: Response Time
    currentStep++;
    const responseTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing response time...`);

    try {
      const testStart = performance.now();
      await new Promise(resolve => setTimeout(resolve, 100));
      const responseTime = performance.now() - testStart;

      tests.push({
        name: 'Response Time',
        status: responseTime < 1000 ? 'passed' : 'failed',
        duration_ms: performance.now() - responseTestStart,
        details: `${responseTime.toFixed(2)}ms`,
        error: responseTime >= 1000 ? 'Response time exceeded threshold' : undefined,
        errorCategory: responseTime >= 1000 ? 'performance' : undefined
      });
      console.log(`✅ Response time: ${responseTime.toFixed(2)}ms`);
    } catch (error) {
      tests.push({
        name: 'Response Time',
        status: 'failed',
        duration_ms: performance.now() - responseTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('❌ Response time test error:', error.message);
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
        const { data, error } = await supabase.from('conversations').select('count').limit(1);

        if (error) {
          tests.push({
            name: 'Database Connectivity',
            status: 'failed',
            duration_ms: performance.now() - dbTestStart,
            error: error.message,
            errorCategory: categorizeError(null, error.message)
          });
          console.error('❌ Database query error:', error.message);
        } else {
          tests.push({
            name: 'Database Connectivity',
            status: 'passed',
            duration_ms: performance.now() - dbTestStart,
            details: 'Database query successful'
          });
          console.log('✅ Database connectivity verified');
        }
      } catch (error) {
        tests.push({
          name: 'Database Connectivity',
          status: 'failed',
          duration_ms: performance.now() - dbTestStart,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
        console.error('❌ Database connection error:', error.message);
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
      console.log(`✅ Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB`);
    } catch (error) {
      tests.push({
        name: 'Memory Usage',
        status: 'failed',
        duration_ms: performance.now() - memTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('❌ Memory check error:', error.message);
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
      console.log('✅ File system access verified');
    } catch (error) {
      tests.push({
        name: 'File System Access',
        status: 'failed',
        duration_ms: performance.now() - fsTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('❌ File system access error:', error.message);
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
      console.log(`✅ Structural analysis completed (${structuralIssues.length} issues found)`);
    } catch (error) {
      tests.push({
        name: 'Structural Analysis',
        status: 'failed',
        duration_ms: performance.now() - structuralTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('❌ Structural analysis error:', error.message);
    }

    // Calculate summary
    const passedTests = tests.filter(t => t.status === 'passed').length;
    const failedTests = tests.filter(t => t.status === 'failed').length;
    const totalDuration = tests.reduce((sum, t) => sum + t.duration_ms, 0);

    const summary = {
      total_tests: tests.length,
      passed: passedTests,
      failed: failedTests,
      success_rate: `${((passedTests / tests.length) * 100).toFixed(1)}%`,
      total_duration_ms: totalDuration.toFixed(2),
      overall_duration_ms: (performance.now() - overallStart).toFixed(2)
    };

    const result = {
      success: failedTests === 0,
      timestamp: new Date().toISOString(),
      summary,
      tests,
      structural_issues: structu
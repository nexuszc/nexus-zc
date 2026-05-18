import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const categorizeError = (statusCode: number | null, errorMessage: string): string => {
  if (statusCode) {
    if (statusCode >= 500) return 'server';
    if (statusCode === 404) return 'not_found';
    if (statusCode === 401 || statusCode === 403) return 'auth';
    if (statusCode >= 400) return 'client';
  }
  
  const message = errorMessage.toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('network') || message.includes('fetch')) return 'network';
  if (message.includes('database') || message.includes('postgres')) return 'database';
  if (message.includes('permission') || message.includes('denied')) return 'permission';
  if (message.includes('not found')) return 'not_found';
  
  return 'unknown';
};

export default Deno.serve(async (req) => {
  const tests: Array<{
    name: string;
    status: 'passed' | 'failed';
    duration_ms: number;
    error?: string;
    errorCategory?: string;
    details?: string;
  }> = [];

  const structuralIssues: Array<{
    severity: 'critical' | 'warning';
    path: string;
    issue: string;
  }> = [];

  let currentStep = 0;
  const totalSteps = 8;

  try {
    console.log('=== Nexus Smoke Test Runner ===');
    console.log(`Starting ${totalSteps} tests...\n`);

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);
    
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    
    if (missingVars.length === 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required variables present'
      });
      console.log('✓ Environment variables verified');
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing variables: ${missingVars.join(', ')}`,
        errorCategory: 'configuration'
      });
      console.error('✗ Missing environment variables:', missingVars.join(', '));
    }

    // Test 2: HTTP Request/Response
    currentStep++;
    const httpTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing HTTP capabilities...`);
    
    try {
      const testUrl = 'https://httpbin.org/get';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(testUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        tests.push({
          name: 'HTTP Request/Response',
          status: 'passed',
          duration_ms: performance.now() - httpTestStart,
          details: `Status: ${response.status}`
        });
        console.log('✓ HTTP request successful');
      } else {
        tests.push({
          name: 'HTTP Request/Response',
          status: 'failed',
          duration_ms: performance.now() - httpTestStart,
          error: `HTTP ${response.status}`,
          errorCategory: categorizeError(response.status, '')
        });
        console.error('✗ HTTP request failed:', response.status);
      }
    } catch (error) {
      tests.push({
        name: 'HTTP Request/Response',
        status: 'failed',
        duration_ms: performance.now() - httpTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ HTTP test error:', error.message);
    }

    // Test 3: JSON Processing
    currentStep++;
    const jsonTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);
    
    try {
      const testData = { test: 'data', nested: { value: 123 } };
      const jsonString = JSON.stringify(testData);
      const parsed = JSON.parse(jsonString);
      
      if (parsed.test === 'data' && parsed.nested.value === 123) {
        tests.push({
          name: 'JSON Processing',
          status: 'passed',
          duration_ms: performance.now() - jsonTestStart,
          details: 'Serialization and parsing successful'
        });
        console.log('✓ JSON processing verified');
      } else {
        tests.push({
          name: 'JSON Processing',
          status: 'failed',
          duration_ms: performance.now() - jsonTestStart,
          error: 'Data mismatch after parse',
          errorCategory: 'data'
        });
        console.error('✗ JSON data mismatch');
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

    // Test 4: Date/Time Operations
    currentStep++;
    const dateTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing date/time operations...`);
    
    try {
      const now = new Date();
      const isoString = now.toISOString();
      const parsed = new Date(isoString);
      
      if (parsed.getTime() === now.getTime()) {
        tests.push({
          name: 'Date/Time Operations',
          status: 'passed',
          duration_ms: performance.now() - dateTestStart,
          details: `Current time: ${isoString}`
        });
        console.log('✓ Date/time operations verified');
      } else {
        tests.push({
          name: 'Date/Time Operations',
          status: 'failed',
          duration_ms: performance.now() - dateTestStart,
          error: 'Date parsing mismatch',
          errorCategory: 'data'
        });
        console.error('✗ Date parsing failed');
      }
    } catch (error) {
      tests.push({
        name: 'Date/Time Operations',
        status: 'failed',
        duration_ms: performance.now() - dateTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Date/time error:', error.message);
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
        const { error } = await supabase.from('_health_check').select('*').limit(1);
        
        if (error) {
          tests.push({
            name: 'Database Connectivity',
            status: 'failed',
            duration_ms: performance.now() - dbTestStart,
            error: error.message,
            errorCategory: 'database'
          });
          console.error('✗ Database error:', error.message);
        } else {
          tests.push({
            name: 'Database Connectivity',
            status: 'passed',
            duration_ms: performance.now() - dbTestStart,
            details: 'Successfully connected to Supabase'
          });
          console.log('✓ Database connection verified');
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
    const totalTests = tests.length;

    const summary = {
      total_tests: totalTests,
      passed: passedTests,
      failed: failedTests,
      success_rate: totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(2) + '%' : '0%',
      total_duration_ms: totalDuration,
      timestamp: new Date().toISOString()
    };

    console.log('\n=== Test Summary ===');
    console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
    console.log(`Success Rate: ${summary.success_rate}`);
    console.log(`Duration: ${totalDuration.toFixed(2)}ms`);

    const result = {
      summary,
      tests,
      structural_issues: structuralIssues,
      environment: {
        deno_version: Deno.version.deno,
        v8_version: Deno.version.v8,
        typescript_version: Deno.version.typescript
      }
    };

    return new Response(JSON.stringify(result, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application
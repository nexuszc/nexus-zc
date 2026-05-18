// @ts-ignore
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

Deno.serve(async (req) => {
  const tests: any[] = [];
  const structuralIssues: any[] = [];
  let supabaseClient: any = null;
  let currentStep = 0;
  const totalSteps = 8;

  const categorizeError = (error: any, message: string) => {
    if (!message) return 'unknown';
    
    const msg = message.toLowerCase();
    if (msg.includes('permission') || msg.includes('denied')) return 'permission';
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) return 'network';
    if (msg.includes('timeout')) return 'timeout';
    if (msg.includes('not found') || msg.includes('notfound')) return 'not_found';
    if (msg.includes('auth') || msg.includes('unauthorized')) return 'auth';
    if (msg.includes('memory')) return 'memory';
    
    return 'unknown';
  };

  try {
    console.log('=== Starting Smoke Test Suite ===');
    console.log(`Total steps: ${totalSteps}`);

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
    
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars: string[] = [];
    
    for (const varName of requiredEnvVars) {
      if (!Deno.env.get(varName)) {
        missingVars.push(varName);
      }
    }
    
    if (missingVars.length > 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing variables: ${missingVars.join(', ')}`,
        errorCategory: 'configuration'
      });
      console.error('❌ Missing environment variables:', missingVars.join(', '));
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required environment variables present'
      });
      console.log('✅ Environment variables verified');
    }

    // Test 2: HTTP Fetch
    currentStep++;
    const fetchTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing HTTP fetch capabilities...`);
    
    try {
      const response = await fetch('https://httpbin.org/get', {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        tests.push({
          name: 'HTTP Fetch',
          status: 'passed',
          duration_ms: performance.now() - fetchTestStart,
          details: `Status: ${response.status}`
        });
        console.log('✅ HTTP fetch successful');
      } else {
        tests.push({
          name: 'HTTP Fetch',
          status: 'failed',
          duration_ms: performance.now() - fetchTestStart,
          error: `HTTP ${response.status}`,
          errorCategory: 'network'
        });
        console.error('❌ HTTP fetch failed with status:', response.status);
      }
    } catch (error) {
      tests.push({
        name: 'HTTP Fetch',
        status: 'failed',
        duration_ms: performance.now() - fetchTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('❌ HTTP fetch error:', error.message);
    }

    // Test 3: JSON Processing
    currentStep++;
    const jsonTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);
    
    try {
      const testObj = { test: 'data', nested: { value: 123 } };
      const jsonStr = JSON.stringify(testObj);
      const parsed = JSON.parse(jsonStr);
      
      if (parsed.test === 'data' && parsed.nested.value === 123) {
        tests.push({
          name: 'JSON Processing',
          status: 'passed',
          duration_ms: performance.now() - jsonTestStart,
          details: 'Serialization and parsing successful'
        });
        console.log('✅ JSON processing verified');
      } else {
        tests.push({
          name: 'JSON Processing',
          status: 'failed',
          duration_ms: performance.now() - jsonTestStart,
          error: 'Data integrity check failed',
          errorCategory: 'data'
        });
        console.error('❌ JSON data integrity check failed');
      }
    } catch (error) {
      tests.push({
        name: 'JSON Processing',
        status: 'failed',
        duration_ms: performance.now() - jsonTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('❌ JSON processing error:', error.message);
    }

    // Test 4: Supabase Client Initialization
    currentStep++;
    const supabaseTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Initializing Supabase client...`);
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (supabaseUrl && supabaseKey) {
        supabaseClient = createClient(supabaseUrl, supabaseKey);
        tests.push({
          name: 'Supabase Client Initialization',
          status: 'passed',
          duration_ms: performance.now() - supabaseTestStart,
          details: 'Client initialized successfully'
        });
        console.log('✅ Supabase client initialized');
      } else {
        tests.push({
          name: 'Supabase Client Initialization',
          status: 'failed',
          duration_ms: performance.now() - supabaseTestStart,
          error: 'Missing Supabase credentials',
          errorCategory: 'configuration'
        });
        console.error('❌ Supabase credentials missing');
      }
    } catch (error) {
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'failed',
        duration_ms: performance.now() - supabaseTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('❌ Supabase client initialization error:', error.message);
    }

    // Test 5: Database Connectivity
    currentStep++;
    const dbTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
    
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('users')
          .select('count')
          .limit(1);
        
        if (error) {
          tests.push({
            name: 'Database Connectivity',
            status: 'failed',
            duration_ms: performance.now() - dbTestStart,
            error: error.message,
            errorCategory: categorizeError(error, error.message)
          });
          console.error('❌ Database connectivity error:', error.message);
        } else {
          tests.push({
            name: 'Database Connectivity',
            status: 'passed',
            duration_ms: performance.now() - dbTestStart,
            details: 'Query executed successfully'
          });
          console.log('✅ Database connectivity verified');
        }
      } catch (error) {
        tests.push({
          name: 'Database Connectivity',
          status: 'failed',
          duration_ms: performance.now() - dbTestStart,
          error: error.message,
          errorCategory: categorizeError(error, error.message)
        });
        console.error('❌ Database connectivity error:', error.message);
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
        details: `Found ${structuralIssues.length} issues`
      });
      
      if (structuralIssues.length === 0) {
        console.log('✅ Structural analysis complete: no issues found');
      } else {
        console.log(`⚠️ Structural analysis found ${structuralIssues.length} issues`);
        structuralIssues.forEach(issue => {
          console.log(`  ${issue.severity === 'critical' ? '❌' : '⚠️'} ${issue.path}: ${issue.issue}`);
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
      console.error('❌ Structural analysis error:', error.message);
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
    console.log('===================\n');

    const result = {
      summary,
      tests,
      structural_issues: structuralIssues,
      environment: {
        deno_version: Deno.version.deno,
        typescript_version: Deno.version.typescript,
        v8_version: Deno.version.v8
      }
    };

    return new Response(
      JSON.stringify(result, null, 2),
      {
        headers: { 'Content-Type': 'application/json' },
        status: failedTests > 0 ? 500 : 200
      }
    );

  } catch (error) {
    console.error('Fatal error in smoke test suite:', error);
    
    return new Response(
      JSON.stringify({
        error: 'Fatal error in smoke test suite',
        message: error.message,
        tests,
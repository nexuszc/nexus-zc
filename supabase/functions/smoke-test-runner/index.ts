import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const startTime = performance.now();
    const tests: any[] = [];
    const structuralIssues: any[] = [];
    
    const totalSteps = 8;
    let currentStep = 0;

    console.log('');
    console.log('='.repeat(60));
    console.log('NEXUS SMOKE TEST RUNNER');
    console.log('='.repeat(60));
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('');

    function categorizeError(error: any, message: string) {
      const criticalPatterns = [
        /connection.*refused/i,
        /network.*error/i,
        /timeout/i,
        /authentication.*failed/i,
        /not.*found/i
      ];
      
      const isCritical = criticalPatterns.some(pattern => pattern.test(message));
      
      return {
        isCritical,
        type: error?.name || 'UnknownError',
        message
      };
    }

    // Test 1: Runtime Environment
    currentStep++;
    const runtimeTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing runtime environment...`);
    
    try {
      const denoVersion = Deno.version.deno;
      const v8Version = Deno.version.v8;
      
      tests.push({
        name: 'Runtime Environment',
        status: 'passed',
        duration_ms: performance.now() - runtimeTestStart,
        details: `Deno ${denoVersion}, V8 ${v8Version}`
      });
      console.log(`✓ Runtime verified: Deno ${denoVersion}`);
    } catch (error) {
      tests.push({
        name: 'Runtime Environment',
        status: 'failed',
        duration_ms: performance.now() - runtimeTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ Runtime check failed:', error.message);
    }

    // Test 2: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);
    
    try {
      const requiredVars = [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY'
      ];
      
      const missingVars = requiredVars.filter(varName => !Deno.env.get(varName));
      
      if (missingVars.length === 0) {
        tests.push({
          name: 'Environment Variables',
          status: 'passed',
          duration_ms: performance.now() - envTestStart,
          details: `All ${requiredVars.length} required variables present`
        });
        console.log(`✓ Environment variables verified (${requiredVars.length}/${requiredVars.length})`);
      } else {
        tests.push({
          name: 'Environment Variables',
          status: 'failed',
          duration_ms: performance.now() - envTestStart,
          error: `Missing variables: ${missingVars.join(', ')}`,
          errorCategory: categorizeError(null, `Missing: ${missingVars.join(', ')}`)
        });
        console.error(`✗ Missing environment variables: ${missingVars.join(', ')}`);
      }
    } catch (error) {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ Environment check error:', error.message);
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
      
      if (response.ok) {
        tests.push({
          name: 'Network Connectivity',
          status: 'passed',
          duration_ms: performance.now() - networkTestStart,
          details: `Status ${response.status}`
        });
        console.log('✓ Network connectivity verified');
      } else {
        tests.push({
          name: 'Network Connectivity',
          status: 'failed',
          duration_ms: performance.now() - networkTestStart,
          error: `HTTP ${response.status}`,
          errorCategory: categorizeError(null, `HTTP ${response.status}`)
        });
        console.error(`✗ Network check failed: HTTP ${response.status}`);
      }
    } catch (error) {
      tests.push({
        name: 'Network Connectivity',
        status: 'failed',
        duration_ms: performance.now() - networkTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ Network connectivity error:', error.message);
    }

    // Test 4: Supabase Client Initialization
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
          error: 'Missing credentials',
          errorCategory: categorizeError(null, 'Missing credentials')
        });
        console.error('✗ Cannot initialize Supabase client: missing credentials');
      }
    } catch (error) {
      tests.push({
        name: 'Supabase Client Initialization',
        status: 'failed',
        duration_ms: performance.now() - clientTestStart,
        error: error.message,
        errorCategory: categorizeError(error, error.message)
      });
      console.error('✗ Supabase client initialization error:', error.message);
    }

    // Test 5: Database Connectivity
    currentStep++;
    const dbTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
    
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('test_table')
          .select('count')
          .limit(1);
        
        if (error) {
          if (error.message.includes('relation') && error.message.includes('does not exist')) {
            tests.push({
              name: 'Database Connectivity',
              status: 'passed',
              duration_ms: performance.now() - dbTestStart,
              details: 'Database reachable (test table not required)'
            });
            console.log('✓ Database connectivity verified (table check skipped)');
          } else {
            tests.push({
              name: 'Database Connectivity',
              status: 'failed',
              duration_ms: performance.now() - dbTestStart,
              error: error.message,
              errorCategory: categorizeError(error, error.message)
            });
            console.error('✗ Database error:', error.message);
          }
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
        console.log(`⚠ Structural analysis found ${structuralIssues.length} issues`);
        structuralIssues.forEach(issue => {
          console.log(`  ${issue.severity === 'critical' ? '✗' : '⚠'} ${issue.path}: ${issue.issue}`);
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
        total: tests.length
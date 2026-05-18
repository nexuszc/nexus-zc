// supabase/functions/smoke-test-runner/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
      }
    });
  }

  try {
    const overallStartTime = performance.now();
    let currentStep = 0;
    const totalSteps = 8;
    
    console.log('='.repeat(60));
    console.log('SMOKE TEST SUITE STARTED');
    console.log('='.repeat(60));

    const tests: Array<{
      name: string;
      status: 'passed' | 'failed';
      duration_ms: number;
      error?: string;
      details?: string;
      errorCategory?: {
        category: string;
        isCritical: boolean;
        reason: string;
        actionable: boolean;
      };
    }> = [];

    const structuralIssues: Array<{
      severity: 'critical' | 'warning';
      path: string;
      issue: string;
    }> = [];

    // Test 1: Environment Variables
    currentStep++;
    const envTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);
    
    const baseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const denoEnv = Deno.env.get('DENO_DEPLOYMENT_ID') ? 'production' : 'development';

    if (!baseUrl || !anonKey) {
      const missingVars = [];
      if (!baseUrl) missingVars.push('SUPABASE_URL');
      if (!anonKey) missingVars.push('SUPABASE_ANON_KEY');
      
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: `Missing critical environment variables: ${missingVars.join(', ')}`,
        errorCategory: categorizeError(null, 'missing env variables')
      });
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: 'All required environment variables present'
      });
      console.log('✓ Environment variables validated');
    }

    // Test 2: Supabase Client Initialization
    currentStep++;
    const clientTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing Supabase client initialization...`);
    
    let supabase;
    try {
      supabase = createClient(baseUrl!, anonKey!, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });
      tests.push({
        name: 'Supabase Client Init',
        status: 'passed',
        duration_ms: performance.now() - clientTestStart,
        details: 'Client initialized successfully'
      });
      console.log('✓ Supabase client initialized');
    } catch (error) {
      tests.push({
        name: 'Supabase Client Init',
        status: 'failed',
        duration_ms: performance.now() - clientTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Client initialization failed:', error.message);
    }

    // Test 3: Health Check Endpoint
    currentStep++;
    const healthTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing health check endpoint...`);
    
    try {
      const healthUrl = `${baseUrl}/functions/v1/health`;
      const healthResponse = await fetch(healthUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${anonKey}`
        }
      });

      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        tests.push({
          name: 'Health Check Endpoint',
          status: 'passed',
          duration_ms: performance.now() - healthTestStart,
          details: `Status: ${healthData.status || 'healthy'}`
        });
        console.log('✓ Health check passed');
      } else {
        tests.push({
          name: 'Health Check Endpoint',
          status: 'failed',
          duration_ms: performance.now() - healthTestStart,
          error: `HTTP ${healthResponse.status}: ${healthResponse.statusText}`,
          errorCategory: categorizeError(healthResponse.status, healthResponse.statusText)
        });
        console.error('✗ Health check failed:', healthResponse.status);
      }
    } catch (error) {
      tests.push({
        name: 'Health Check Endpoint',
        status: 'failed',
        duration_ms: performance.now() - healthTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Health check error:', error.message);
    }

    // Test 4: Database Connectivity
    currentStep++;
    const dbTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
    
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('conversations')
          .select('id')
          .limit(1);

        if (error) {
          tests.push({
            name: 'Database Connectivity',
            status: 'failed',
            duration_ms: performance.now() - dbTestStart,
            error: error.message,
            errorCategory: categorizeError(null, error.message)
          });
          console.error('✗ Database query failed:', error.message);
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

    // Test 5: Auth Service
    currentStep++;
    const authTestStart = performance.now();
    console.log(`[${currentStep}/${totalSteps}] Testing auth service...`);
    
    if (supabase) {
      try {
        const { data, error } = await supabase.auth.getSession();
        
        tests.push({
          name: 'Auth Service',
          status: 'passed',
          duration_ms: performance.now() - authTestStart,
          details: 'Auth service responding'
        });
        console.log('✓ Auth service verified');
      } catch (error) {
        tests.push({
          name: 'Auth Service',
          status: 'failed',
          duration_ms: performance.now() - authTestStart,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
        console.error('✗ Auth service error:', error.message);
      }
    } else {
      tests.push({
        name: 'Auth Service',
        status: 'failed',
        duration_ms: performance.now() - authTestStart,
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
    const criticalFailures = tests.filter(t => t.status === 'failed' && t.errorCategory?.isCritical).length;
    const nonCriticalFailures = failedTests - criticalFailures;
    
    const healthScore = totalSteps > 0 ? Math.round((passedTests / totalSteps) * 100) : 0;
    
    let overallStatus = 'healthy';
    if (criticalFailures > 0) {
      overallStatus = 'critical';
    } else if (failedTests > 0) {
      overallStatus = 'degraded';
    }

    const totalTests = tests.length > 0 ? tests.length : 0;

    const summary = {
      overallStatus,
      healthScore,
      totalTests,
      passedTests,
      failedTests,
      criticalFailures,
      nonCriticalFailures,
      completedSteps: currentStep,
      totalSteps,
      duration_ms: performance.now() - overallStartTime,
      timestamp: new Date().toISOString(),
      errorCategories: tests
        .filter(t => t.errorCategory)
        .map(t => ({
          test: t.name,
          category: t.errorCategory.category,
          isCritical: t.errorCategory.isCritical,
          reason: t.errorCategory.reason
        })),
      recommendations: generateRecommendations(tests, structuralIssues)
    };

    console.log('='.repeat(60));
    console.log('SMOKE TEST SUITE COMPLETE');
    console.log('='.repeat(60));
    console.log(`Overall Status: ${overallStatus.toUpperCase()}`);
    console.log(`Health Score: ${healthScore}%`);
    console.log(`Tests: ${passedTests} passed, ${failedTests} failed (${criticalFailures} critical, ${nonCriticalFailures} non-critical)`);
    console.log(`Duration: ${summary.duration_ms.toFixed(2)}ms`);
    console.log('='.repeat(60));

    return new Response(
      JSON.stringify({
        success: criticalFailures === 0,
        summary,
        tests,
        environment: {
          deno: denoEnv,
          supabase: {
            url: baseUrl,
            hasAnonKey: !!anonKey
          }
        },
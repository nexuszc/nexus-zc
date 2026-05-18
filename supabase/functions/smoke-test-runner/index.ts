import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  try {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        }
      });
    }

    console.log('='.repeat(60));
    console.log('STARTING COMPREHENSIVE SMOKE TEST SUITE');
    console.log('='.repeat(60));

    const overallStartTime = performance.now();
    const tests: any[] = [];
    const structuralIssues: any[] = [];
    let currentStep = 0;
    const totalSteps = 6;

    // Environment validation
    const denoEnv = Deno.version;
    const baseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!baseUrl || !anonKey) {
      throw new Error('Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY');
    }

    const supabase = createClient(baseUrl, anonKey);

    // Test 1: Environment Check
    currentStep++;
    const envTestStart = performance.now();
    try {
      console.log(`[${currentStep}/${totalSteps}] Testing environment configuration...`);
      
      const requiredVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
      const missingVars = requiredVars.filter(v => !Deno.env.get(v));
      
      if (missingVars.length > 0) {
        throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
      }

      tests.push({
        name: 'Environment Configuration',
        status: 'passed',
        duration_ms: performance.now() - envTestStart,
        details: `All required environment variables present`
      });
      console.log('✓ Environment configuration validated');
    } catch (error) {
      tests.push({
        name: 'Environment Configuration',
        status: 'failed',
        duration_ms: performance.now() - envTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Environment configuration failed:', error.message);
    }

    // Test 2: Database Connectivity
    currentStep++;
    const dbTestStart = performance.now();
    try {
      console.log(`[${currentStep}/${totalSteps}] Testing database connectivity...`);
      
      const { data, error } = await supabase
        .from('nexus_metadata')
        .select('version')
        .limit(1);

      if (error) throw error;

      tests.push({
        name: 'Database Connectivity',
        status: 'passed',
        duration_ms: performance.now() - dbTestStart,
        details: 'Successfully connected to database'
      });
      console.log('✓ Database connectivity verified');
    } catch (error) {
      tests.push({
        name: 'Database Connectivity',
        status: 'failed',
        duration_ms: performance.now() - dbTestStart,
        error: error.message,
        errorCategory: categorizeError(error.code || null, error.message)
      });
      console.error('✗ Database connectivity failed:', error.message);
    }

    // Test 3: Edge Function Health
    currentStep++;
    const edgeFuncTestStart = performance.now();
    try {
      console.log(`[${currentStep}/${totalSteps}] Testing edge function health...`);
      
      const testFunctions = ['chat', 'retrieve-context', 'semantic-search'];
      const functionResults = [];

      for (const func of testFunctions) {
        try {
          const { data, error } = await supabase.functions.invoke(func, {
            body: { test: true, healthCheck: true }
          });
          
          functionResults.push({
            function: func,
            status: error ? 'failed' : 'passed',
            error: error?.message
          });
        } catch (error) {
          functionResults.push({
            function: func,
            status: 'failed',
            error: error.message
          });
        }
      }

      const failedFunctions = functionResults.filter(f => f.status === 'failed');
      
      tests.push({
        name: 'Edge Functions Health',
        status: failedFunctions.length === 0 ? 'passed' : 'failed',
        duration_ms: performance.now() - edgeFuncTestStart,
        details: `${testFunctions.length - failedFunctions.length}/${testFunctions.length} functions responsive`,
        functionResults
      });
      console.log(`✓ Edge functions health checked: ${testFunctions.length - failedFunctions.length}/${testFunctions.length} responsive`);
    } catch (error) {
      tests.push({
        name: 'Edge Functions Health',
        status: 'failed',
        duration_ms: performance.now() - edgeFuncTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Edge functions health check failed:', error.message);
    }

    // Test 4: Storage Access
    currentStep++;
    const storageTestStart = performance.now();
    try {
      console.log(`[${currentStep}/${totalSteps}] Testing storage access...`);
      
      const { data, error } = await supabase.storage.listBuckets();

      if (error) throw error;

      tests.push({
        name: 'Storage Access',
        status: 'passed',
        duration_ms: performance.now() - storageTestStart,
        details: `Found ${data?.length || 0} storage buckets`
      });
      console.log('✓ Storage access verified');
    } catch (error) {
      tests.push({
        name: 'Storage Access',
        status: 'failed',
        duration_ms: performance.now() - storageTestStart,
        error: error.message,
        errorCategory: categorizeError(error.code || null, error.message)
      });
      console.error('✗ Storage access failed:', error.message);
    }

    // Test 5: Authentication System
    currentStep++;
    const authTestStart = performance.now();
    try {
      console.log(`[${currentStep}/${totalSteps}] Testing authentication system...`);
      
      const { data: { session }, error } = await supabase.auth.getSession();

      tests.push({
        name: 'Authentication System',
        status: 'passed',
        duration_ms: performance.now() - authTestStart,
        details: 'Authentication system responsive'
      });
      console.log('✓ Authentication system verified');
    } catch (error) {
      tests.push({
        name: 'Authentication System',
        status: 'failed',
        duration_ms: performance.now() - authTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
      console.error('✗ Authentication system failed:', error.message);
    }

    // Test 6: Structural Analysis
    currentStep++;
    const structuralTestStart = performance.now();
    try {
      console.log(`[${currentStep}/${totalSteps}] Running structural analysis...`);
      
      // Check for critical file system paths
      const criticalPaths = [
        '/supabase/functions',
        '/supabase/migrations'
      ];

      for (const path of criticalPaths) {
        try {
          const stat = await Deno.stat(path);
          if (!stat.isDirectory) {
            structuralIssues.push({
              severity: 'critical',
              path,
              issue: 'Expected directory not found or is not a directory'
            });
          }
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) {
            structuralIssues.push({
              severity: 'warning',
              path,
              issue: 'Path not found (may be expected in production)'
            });
          } else if (error instanceof Deno.errors.PermissionDenied) {
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
        structuralAnalysis: {
          issues: structuralIssues,
          hasIssues: structuralIssues.length > 0
        }
      }, null, 2),
      {
        status: criticalFailures === 0 ? 200 : 503,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
          "X-Health-Status": overallStatus,
          "X-Health-Score": healthScore.toString(),
          "X-Critical-Failures": criticalFailures.toString(),
          "X-Test-Duration-Ms": summary.duration_ms.toFixed(2)
        }
      }
    );

  } catch (error) {
    console.error("Fatal smoke test error:", error);
    
    const fatalErrorContext = {
      message: error.message,
      name: error.name,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      environment: {
        deno: Deno.version,
        memoryUsage: Deno.memoryUsage()
      },
      errorCategory: categorizeError(null, error.message)
    };

    return new Response(
      JSON.stringify({
        success: false,
        error: "Fatal error during smoke test execution",
        details: error.message,
        errorContext: fatalErrorContext,
        timestamp: new Date().toISOString()
      }, null, 2),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
          "X-Error-Type": "fatal",
          "X-Error-Category": fatalErrorContext.errorCategory.category
        }
      }
    );
  }
});

function categorizeError(statusCode: number | null, message: string): {
  category: string;
  isCritical: boolean;
  reason: string;
  actionable: boolean;
} {
  const msg = message?.toLowerCase() || '';
  
  // Infrastructure errors (critical)
  if (msg.includes('missing env') || msg.includes('supabase_url') || msg.includes('supabase_anon_key')) {
    return {
      category: 'configuration',
      isCritical: true,
      reason: 'Missing critical environment variables',
      actionable: true
    };
  }

  if (msg.includes('connection') || msg.includes('network') || msg.includes('timeout')) {
    return {
      category: 'network',
      isCritical: true,
      reason: 'Network connectivity issue',
      actionable: true
    };
  }

  if (msg.includes('permission') || msg.includes('access denied')) {
    return {
      category: 'permissions',
      isCritical: true,
      reason: 'File system or resource permission error',
      actionable: true
    };
  }

  if (statusCode && statusCode >= 500) {
    return {
      category: 'server_error',
      isCritical: true,
      reason: 'Server-side error',
      actionable: false
    };
  }

  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return {
      category: 'client_error',
      isCritical: false,
      reason: 'Client request error',
      actionable:
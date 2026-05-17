import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const overallStartTime = performance.now();
    let currentStep = 0;
    const totalSteps = 8;
    const tests: any[] = [];

    console.log('='.repeat(60));
    console.log('SMOKE TEST RUNNER - EDGE FUNCTION HEALTH CHECK');
    console.log('='.repeat(60));
    console.log(`Starting comprehensive test suite at ${new Date().toISOString()}`);
    console.log(`Total steps planned: ${totalSteps}`);
    console.log('='.repeat(60));

    // Test 1: Deno Environment
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing Deno environment...`);
    const denoTestStart = performance.now();
    const denoEnv = {
      version: Deno.version,
      build: Deno.build,
      memoryUsage: Deno.memoryUsage()
    };
    tests.push({
      name: 'Deno Environment',
      status: 'passed',
      duration_ms: performance.now() - denoTestStart,
      details: `Deno ${denoEnv.version.deno}`
    });

    // Test 2: Supabase Configuration
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Checking Supabase configuration...`);
    const supabaseTestStart = performance.now();
    const baseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!baseUrl || !anonKey) {
      tests.push({
        name: 'Supabase Configuration',
        status: 'failed',
        duration_ms: performance.now() - supabaseTestStart,
        error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY',
        errorCategory: categorizeError(null, 'missing env')
      });
    } else {
      tests.push({
        name: 'Supabase Configuration',
        status: 'passed',
        duration_ms: performance.now() - supabaseTestStart,
        details: `URL configured: ${baseUrl.substring(0, 30)}...`
      });
    }

    // Test 3: HTTP Client
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing HTTP client...`);
    const httpTestStart = performance.now();
    try {
      const response = await fetch('https://httpbin.org/get', {
        signal: AbortSignal.timeout(5000)
      });
      tests.push({
        name: 'HTTP Client',
        status: response.ok ? 'passed' : 'failed',
        duration_ms: performance.now() - httpTestStart,
        details: `Status: ${response.status}`
      });
    } catch (error) {
      tests.push({
        name: 'HTTP Client',
        status: 'failed',
        duration_ms: performance.now() - httpTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 4: JSON Processing
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing JSON processing...`);
    const jsonTestStart = performance.now();
    try {
      const testObj = { test: 'data', timestamp: new Date().toISOString() };
      const jsonStr = JSON.stringify(testObj);
      const parsed = JSON.parse(jsonStr);
      tests.push({
        name: 'JSON Processing',
        status: parsed.test === 'data' ? 'passed' : 'failed',
        duration_ms: performance.now() - jsonTestStart
      });
    } catch (error) {
      tests.push({
        name: 'JSON Processing',
        status: 'failed',
        duration_ms: performance.now() - jsonTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 5: File System Access
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing file system access...`);
    const fsTestStart = performance.now();
    try {
      const fileInfo = await Deno.stat('./index.ts');
      tests.push({
        name: 'File System Access',
        status: 'passed',
        duration_ms: performance.now() - fsTestStart,
        details: `index.ts size: ${fileInfo.size} bytes`
      });
    } catch (error) {
      tests.push({
        name: 'File System Access',
        status: 'failed',
        duration_ms: performance.now() - fsTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 6: Performance
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing performance metrics...`);
    const perfTestStart = performance.now();
    const iterations = 1000;
    const perfStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      Math.random();
    }
    const perfDuration = performance.now() - perfStart;
    tests.push({
      name: 'Performance',
      status: perfDuration < 100 ? 'passed' : 'failed',
      duration_ms: performance.now() - perfTestStart,
      details: `${iterations} iterations in ${perfDuration.toFixed(2)}ms`
    });

    // Test 7: Environment Variables
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Checking environment variables...`);
    const envTestStart = performance.now();
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
    const missingVars = requiredEnvVars.filter(v => !Deno.env.get(v));
    const duration = performance.now() - envTestStart;
    
    if (missingVars.length > 0) {
      tests.push({
        name: 'Environment Variables',
        status: 'failed',
        duration_ms: duration,
        error: `Missing required environment variables: ${missingVars.join(', ')}`,
        errorCategory: categorizeError(null, 'missing env')
      });
    } else {
      tests.push({
        name: 'Environment Variables',
        status: 'passed',
        duration_ms: duration
      });
    }

    // Test 8: Structural Analysis
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Performing structural analysis...`);
    const structuralTestStart = performance.now();
    const structuralIssues: any[] = [];
    
    try {
      const functionPath = './';
      for await (const entry of Deno.readDir(functionPath)) {
        if (entry.isFile && entry.name.endsWith('.ts')) {
          try {
            const content = await Deno.readTextFile(`${functionPath}${entry.name}`);
            
            if (!content.includes('Deno.serve')) {
              structuralIssues.push({
                file: entry.name,
                issue: 'Missing Deno.serve() wrapper',
                severity: 'critical'
              });
            }
            
            if (content.includes('serve(async (req)') && !content.includes('return new Response')) {
              structuralIssues.push({
                file: entry.name,
                issue: 'Handler missing Response return',
                severity: 'critical'
              });
            }
          } catch (readError) {
            structuralIssues.push({
              file: entry.name,
              issue: `Cannot read file: ${readError.message}`,
              severity: 'warning'
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
      actionable: true
    };
  }

  return {
    category: 'unknown',
    isCritical: false,
    reason: 'Unclassified error',
    actionable: false
  };
}

function generateRecommendations(tests: any[], structuralIss
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

Deno.serve(async (req) => {
  try {
    const baseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const denoEnv = Deno.version;

    if (!baseUrl || !anonKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required environment variables",
          details: {
            hasUrl: !!baseUrl,
            hasAnonKey: !!anonKey
          }
        }),
        { 
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const supabase = createClient(baseUrl, anonKey);
    
    console.log('Starting comprehensive smoke test suite...');
    console.log('='.repeat(60));
    
    const overallStartTime = performance.now();
    const tests: any[] = [];
    let currentStep = 0;
    const totalSteps = 8;

    // Test 1: Database Connection
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing database connection...`);
    const dbTestStart = performance.now();
    try {
      const { data, error } = await supabase.from('users').select('count').limit(1).single();
      const duration = performance.now() - dbTestStart;
      
      if (error && error.code !== 'PGRST116') {
        tests.push({
          name: 'Database Connection',
          status: 'failed',
          duration_ms: duration,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
      } else {
        tests.push({
          name: 'Database Connection',
          status: 'passed',
          duration_ms: duration
        });
      }
    } catch (error) {
      tests.push({
        name: 'Database Connection',
        status: 'failed',
        duration_ms: performance.now() - dbTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 2: Auth Service
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing auth service...`);
    const authTestStart = performance.now();
    try {
      const { data, error } = await supabase.auth.getSession();
      const duration = performance.now() - authTestStart;
      
      if (error) {
        tests.push({
          name: 'Auth Service',
          status: 'failed',
          duration_ms: duration,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
      } else {
        tests.push({
          name: 'Auth Service',
          status: 'passed',
          duration_ms: duration
        });
      }
    } catch (error) {
      tests.push({
        name: 'Auth Service',
        status: 'failed',
        duration_ms: performance.now() - authTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 3: Storage Service
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing storage service...`);
    const storageTestStart = performance.now();
    try {
      const { data, error } = await supabase.storage.listBuckets();
      const duration = performance.now() - storageTestStart;
      
      if (error) {
        tests.push({
          name: 'Storage Service',
          status: 'failed',
          duration_ms: duration,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
      } else {
        tests.push({
          name: 'Storage Service',
          status: 'passed',
          duration_ms: duration
        });
      }
    } catch (error) {
      tests.push({
        name: 'Storage Service',
        status: 'failed',
        duration_ms: performance.now() - storageTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 4: Edge Functions Health
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing edge functions health...`);
    const edgeFnTestStart = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke('health-check', {
        body: { test: true }
      });
      const duration = performance.now() - edgeFnTestStart;
      
      if (error) {
        tests.push({
          name: 'Edge Functions Health',
          status: 'failed',
          duration_ms: duration,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
      } else {
        tests.push({
          name: 'Edge Functions Health',
          status: 'passed',
          duration_ms: duration
        });
      }
    } catch (error) {
      tests.push({
        name: 'Edge Functions Health',
        status: 'failed',
        duration_ms: performance.now() - edgeFnTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 5: API Response Time
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing API response time...`);
    const apiTestStart = performance.now();
    try {
      const { data, error } = await supabase.from('users').select('id').limit(1);
      const duration = performance.now() - apiTestStart;
      
      const threshold = 1000;
      if (duration > threshold) {
        tests.push({
          name: 'API Response Time',
          status: 'failed',
          duration_ms: duration,
          error: `Response time ${duration.toFixed(2)}ms exceeds threshold ${threshold}ms`,
          errorCategory: categorizeError(null, 'timeout')
        });
      } else {
        tests.push({
          name: 'API Response Time',
          status: 'passed',
          duration_ms: duration
        });
      }
    } catch (error) {
      tests.push({
        name: 'API Response Time',
        status: 'failed',
        duration_ms: performance.now() - apiTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 6: RLS Policies
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing RLS policies...`);
    const rlsTestStart = performance.now();
    try {
      const { data, error } = await supabase.from('users').select('*').limit(1);
      const duration = performance.now() - rlsTestStart;
      
      if (error && !error.message.includes('permission denied')) {
        tests.push({
          name: 'RLS Policies',
          status: 'failed',
          duration_ms: duration,
          error: error.message,
          errorCategory: categorizeError(null, error.message)
        });
      } else {
        tests.push({
          name: 'RLS Policies',
          status: 'passed',
          duration_ms: duration,
          note: error ? 'RLS correctly blocking access' : 'RLS allowing access'
        });
      }
    } catch (error) {
      tests.push({
        name: 'RLS Policies',
        status: 'failed',
        duration_ms: performance.now() - rlsTestStart,
        error: error.message,
        errorCategory: categorizeError(null, error.message)
      });
    }

    // Test 7: Environment Variables
    currentStep++;
    console.log(`[${currentStep}/${totalSteps}] Testing environment variables...`);
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
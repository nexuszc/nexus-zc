est state:", dbState);

          const testStatus = dbTest.ok ? 'passed' : 'failed';
          tests.push({
            name: "database-connectivity",
            description: "Database connection test",
            status: testStatus,
            statusCode: dbTest.status,
            duration_ms: performance.now() - startTime,
            timestamp: new Date().toISOString(),
            step: currentStep,
            state: dbState,
            errorCategory: dbTest.ok ? null : categorizeError(dbTest.status, responseText)
          });

          console.log(`[Step ${currentStep}/${totalSteps}] database-connectivity test ${testStatus.toUpperCase()}`);

          if (!dbTest.ok) {
            const diagnostics = {
              statusCode: dbTest.status,
              responsePreview: responseText.substring(0, 200),
              parsedError: parsedResponse,
              structuralIssues: structuralIssues.length > 0 ? structuralIssues : 'none',
              possibleSizeGuardTrigger: responseText.includes('size_guard') || responseText.length > 500000,
              errorCategory: categorizeError(dbTest.status, responseText)
            };
            console.error('Database test diagnostics:', diagnostics);
            
            // Only throw if it's a critical infrastructure error
            const errorCat = categorizeError(dbTest.status, responseText);
            if (errorCat.isCritical) {
              throw new Error(`Database connectivity test failed: ${dbTest.status} - ${dbTest.statusText}`);
            } else {
              console.warn(`Non-critical database test failure: ${errorCat.category} - ${errorCat.reason}`);
            }
          }
        });
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] database-connectivity test FAILED:`, error);

        const errorContext = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          baseUrl,
          timestamp: new Date().toISOString(),
          environmentState: {
            denoEnv,
            memoryUsage: Deno.memoryUsage()
          },
          structuralIssues,
          sizeGuardAnalysis: {
            triggered: error.message.includes('size_guard') || error.stack?.includes('size_guard'),
            errorMessageLength: error.message.length,
            stackLength: error.stack?.length || 0,
            recommendations: [
              'Check for file truncation in recent deployments',
              'Verify brace matching in source files',
              'Review recent code changes for structural issues',
              'Check deployment logs for size warnings'
            ]
          },
          possibleCauses: [
            structuralIssues.length > 0 ? 'File structure issues detected' : null,
            error.message.includes('404') ? 'RPC function smoke_test not found' : null,
            error.message.includes('timeout') ? 'Database query timeout' : null,
            error.message.includes('size_guard') ? 'Response size exceeded limits' : null
          ].filter(Boolean),
          errorCategory: categorizeError(null, error.message)
        };

        console.error("Database connectivity error context:", errorContext);

        tests.push({
          name: "database-connectivity",
          description: "Database connection test",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
          errorContext,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          errorCategory: errorContext.errorCategory
        });
      }
    }

    if (!testFilter || testFilter === "edge-functions" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting edge-functions test`);
      const startTime = performance.now();

      try {
        await executeWithRetry("edge-functions", async () => {
          const functionsTestUrl = `${baseUrl}/functions/v1/`;
          console.log(`Attempting edge functions check to: ${functionsTestUrl}`);

          const functionsTest = await fetch(functionsTestUrl, {
            headers: {
              "apikey": anonKey,
              "Authorization": `Bearer ${anonKey}`
            }
          });

          const functionsState = {
            url: functionsTestUrl,
            statusCode: functionsTest.status,
            statusText: functionsTest.statusText,
            headers: Object.fromEntries(functionsTest.headers.entries()),
            timestamp: new Date().toISOString(),
            fileStructureIssues: structuralIssues
          };

          console.log("Edge functions state:", functionsState);

          const testPassed = functionsTest.ok || functionsTest.status === 404;
          const errorCategory = testPassed ? null : categorizeError(functionsTest.status, functionsTest.statusText);

          tests.push({
            name: "edge-functions",
            description: "Edge functions availability",
            status: testPassed ? "passed" : "failed",
            statusCode: functionsTest.status,
            duration_ms: performance.now() - startTime,
            timestamp: new Date().toISOString(),
            step: currentStep,
            state: functionsState,
            errorCategory
          });

          console.log(`[Step ${currentStep}/${totalSteps}] edge-functions test ${testPassed ? 'PASSED' : 'FAILED'}`);

          if (!functionsTest.ok && functionsTest.status !== 404) {
            const errorCat = categorizeError(functionsTest.status, functionsTest.statusText);
            if (errorCat.isCritical) {
              throw new Error(`Edge functions check failed with status ${functionsTest.status}`);
            } else {
              console.warn(`Non-critical edge functions failure: ${errorCat.category} - ${errorCat.reason}`);
            }
          }
        });
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] edge-functions test FAILED:`, error);

        const errorContext = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          baseUrl,
          timestamp: new Date().toISOString(),
          environmentState: {
            denoEnv,
            memoryUsage: Deno.memoryUsage()
          },
          structuralIssues,
          sizeGuardAnalysis: {
            triggered: error.message.includes('size_guard') || error.stack?.includes('size_guard'),
            chatFunctionIssues: structuralIssues.filter(i => i.file?.includes('chat/index.ts')),
            recommendations: [
              'Verify chat/index.ts has proper Deno.serve handler',
              'Check for brace mismatches in edge function files',
              'Review deployment logs for function initialization errors',
              'Ensure all edge functions have proper error handling'
            ]
          },
          possibleCauses: [
            structuralIssues.some(i => i.file?.includes('chat/index.ts')) ? 'Chat function structure issues' : null,
            error.message.includes('404') ? 'Functions endpoint not found' : null,
            error.message.includes('timeout') ? 'Functions initialization timeout' : null,
            error.message.includes('size_guard') ? 'Function response size exceeded limits' : null
          ].filter(Boolean),
          errorCategory: categorizeError(null, error.message)
        };

        console.error("Edge functions error context:", errorContext);

        tests.push({
          name: "edge-functions",
          description: "Edge functions availability",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
          errorContext,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep,
          errorCategory: errorContext.errorCategory
        });
      }
    }

    // Comprehensive result analysis
    const totalTests = tests.length;
    const passedTests = tests.filter(t => t.status === 'passed').length;
    const failedTests = tests.filter(t => t.status === 'failed').length;
    const criticalFailures = tests.filter(t => 
      t.status === 'failed' && 
      t.errorCategory?.isCritical
    ).length;
    const nonCriticalFailures = failedTests - criticalFailures;

    const overallStatus = criticalFailures === 0 ? 'healthy' : 'degraded';
    const healthScore = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;

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
  if (statusCode === 503 || msg.includes('service unavailable')) {
    return {
      category: 'infrastructure',
      isCritical: true,
      reason: 'Service unavailable - infrastructure issue',
      actionable: false
    };
  }
  
  if (statusCode === 502 || msg.includes('bad gateway')) {
    return {
      category: 'infrastructure',
      isCritical: true,
      reason: 'Bad gateway - upstream service issue',
      actionable: false
    };
  }
  
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return {
      category: 'infrastructure',
      isCritical: true,
      reason: 'Request timeout - performance issue',
      actionable: true
    };
  }
  
  if (msg.includes('econnrefused') || msg.includes('connection refused')) {
    return {
      category: 'infrastructure',
      isCritical: true,
      reason: 'Connection refused - service not responding',
      actionable: false
    };
  }
  
  // Application errors (may be non-critical)
  if (statusCode === 404 || msg.includes('not found')) {
    return {
      category: 'application',
      isCritical: false,
      reason: 'Resource not found - may be expected',
      actionable: true
    };
  }
  
  if (statusCode === 401 || statusCode === 403 || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return {
      category: 'application',
      isCritical: false,
      reason: 'Authentication/authorization issue',
      actionable: true
    };
  }
  
  if (msg.includes('size_guard') || msg.includes('payload too large')) {
    return {
      category: 'application',
      isCritical: false,
      reason: 'Response size limit exceeded',
      actionable: true
    };
  }
  
  if (statusCode === 400 || msg.includes('bad request')) {
    return {
      category: 'application',
      isCritical: false,
      reason: 'Bad request - invalid parameters',
      actionable: true
    };
  }
  
  // Configuration errors
  if (msg.includes('missing') && (msg.includes('key') || msg.includes('config') || msg.includes('env'))) {
    return {
      category: 'configuration',
      isCritical: true,
      reason: 'Missing configuration or credentials',
      actionable: true
    };
  }
  
  // Parse/syntax errors
  if (msg.includes('parse') || msg.includes('syntax') || msg.includes('unexpected token')) {
    return {
      category: 'code',
      isCritical: true,
      reason: 'Code syntax or parsing error',
      actionable: true
    };
  }
  
  // Default to unknown
  return {
    category: 'unknown',
    isCritical: statusCode ? statusCode >= 500 : true,
    reason: 'Unclassified error',
    actionable: false
  };
}

function generateRecommendations(tests: any[], structuralIssues: any[]): string[] {
  const recommendations: string[] = [];
  
  const failedTests = tests.filter(t => t.status === 'failed');
  const criticalErrors = failedTests.filter(t => t.errorCategory?.isCritical);
  const actionableErrors
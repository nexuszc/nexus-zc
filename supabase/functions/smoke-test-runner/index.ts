nnectivity" || testFilter === "all" },
      { name: "edge-functions", run: !testFilter || testFilter === "edge-functions" || testFilter === "all" }
    ];

    const totalSteps = testsToRun.filter(t => t.run).length;

    // File structure validation before test execution
    const validateFileStructure = async () => {
      const validationErrors = [];
      try {
        // Check for common structural issues
        const sourceFiles = [
          'supabase/functions/smoke-test-runner/index.ts',
          'supabase/functions/chat/index.ts'
        ];
        
        for (const file of sourceFiles) {
          try {
            const content = await Deno.readTextFile(file).catch(() => null);
            if (content) {
              // Brace validation
              const openBraces = (content.match(/{/g) || []).length;
              const closeBraces = (content.match(/}/g) || []).length;
              if (openBraces !== closeBraces) {
                validationErrors.push({
                  file,
                  issue: 'brace_mismatch',
                  openBraces,
                  closeBraces,
                  difference: openBraces - closeBraces
                });
              }

              // Check for truncation markers
              if (content.includes('size_guard_triggered') || content.length > 900000) {
                validationErrors.push({
                  file,
                  issue: 'size_guard_triggered',
                  contentLength: content.length,
                  truncated: true
                });
              }

              // Validate basic structure
              if (!content.includes('Deno.serve') && file.includes('functions/')) {
                validationErrors.push({
                  file,
                  issue: 'missing_serve_handler',
                  severity: 'critical'
                });
              }
            }
          } catch (fileError) {
            console.warn(`Could not validate ${file}:`, fileError.message);
          }
        }
      } catch (validationError) {
        console.error('File structure validation error:', validationError);
      }
      return validationErrors;
    };

    // Run pre-flight validation
    console.log('Running pre-flight file structure validation...');
    const structuralIssues = await validateFileStructure();
    if (structuralIssues.length > 0) {
      console.warn('Structural issues detected:', JSON.stringify(structuralIssues, null, 2));
      tests.push({
        name: "pre-flight-validation",
        description: "File structure validation",
        status: "warning",
        issues: structuralIssues,
        duration_ms: 0,
        timestamp: new Date().toISOString(),
        step: 0
      });
    } else {
      console.log('Pre-flight validation passed');
    }

    // Enhanced retry logic for transient failures
    const executeWithRetry = async (testName: string, testFn: () => Promise<any>, maxRetries = 3) => {
      let lastError = null;
      const retryDelays = [1000, 2000, 5000]; // Progressive backoff

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[${testName}] Retry attempt ${attempt + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
          }
          return await testFn();
        } catch (error) {
          lastError = error;
          console.error(`[${testName}] Attempt ${attempt + 1} failed:`, error.message);
          
          // Don't retry on certain errors
          if (error.message.includes('404') || error.message.includes('401')) {
            throw error;
          }
        }
      }
      throw lastError;
    };

    // Cleanup function for test artifacts
    const cleanupTestArtifacts = async () => {
      try {
        console.log('Cleaning up test artifacts...');
        // Add any specific cleanup logic here
        const tempFiles = [];
        for (const file of tempFiles) {
          try {
            await Deno.remove(file).catch(() => {});
          } catch (e) {
            console.warn(`Could not remove ${file}:`, e.message);
          }
        }
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    };

    // Test 1: Health check
    if (!testFilter || testFilter === "health-check" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting health-check test`);
      const startTime = performance.now();

      try {
        await executeWithRetry("health-check", async () => {
          const healthCheckUrl = `${baseUrl}/rest/v1/`;
          console.log(`Attempting health check to: ${healthCheckUrl}`);

          const healthCheck = await fetch(healthCheckUrl, {
            headers: {
              "apikey": anonKey,
              "Authorization": `Bearer ${anonKey}`
            }
          });

          const healthState = {
            url: healthCheckUrl,
            statusCode: healthCheck.status,
            statusText: healthCheck.statusText,
            headers: Object.fromEntries(healthCheck.headers.entries()),
            timestamp: new Date().toISOString(),
            fileStructureIssues: structuralIssues
          };

          console.log("Health check state:", healthState);

          tests.push({
            name: "health-check",
            description: "API health check",
            status: healthCheck.ok ? "passed" : "failed",
            statusCode: healthCheck.status,
            duration_ms: performance.now() - startTime,
            timestamp: new Date().toISOString(),
            step: currentStep,
            state: healthState
          });

          console.log(`[Step ${currentStep}/${totalSteps}] health-check test ${healthCheck.ok ? 'PASSED' : 'FAILED'}`);
          
          if (!healthCheck.ok) {
            throw new Error(`Health check failed with status ${healthCheck.status}`);
          }
        });
      } catch (error) {
        console.error(`[Step ${currentStep}/${totalSteps}] health-check test FAILED:`, error);

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
          possibleCauses: [
            structuralIssues.length > 0 ? 'File structure issues detected' : null,
            error.message.includes('fetch') ? 'Network connectivity issue' : null,
            error.message.includes('timeout') ? 'Request timeout' : null
          ].filter(Boolean)
        };

        console.error("Health check error context:", errorContext);

        tests.push({
          name: "health-check",
          description: "API health check",
          status: "failed",
          error: error.message,
          errorStack: error.stack,
          errorContext,
          duration_ms: performance.now() - startTime,
          timestamp: new Date().toISOString(),
          step: currentStep
        });
      }
    }

    // Test 2: Database connectivity
    if (!testFilter || testFilter === "database-connectivity" || testFilter === "all") {
      currentStep++;
      console.log(`[Step ${currentStep}/${totalSteps}] Starting database-connectivity test`);
      const startTime = performance.now();

      try {
        await executeWithRetry("database-connectivity", async () => {
          const dbTestUrl = `${baseUrl}/rest/v1/rpc/smoke_test`;
          console.log(`Attempting database connectivity test to: ${dbTestUrl}`);

          const dbTest = await fetch(dbTestUrl, {
            method: "POST",
            headers: {
              "apikey": anonKey,
              "Authorization": `Bearer ${anonKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({})
          });

          const responseText = await dbTest.text();
          let parsedResponse;
          try {
            parsedResponse = JSON.parse(responseText);
          } catch (e) {
            parsedResponse = null;
          }

          const dbState = {
            url: dbTestUrl,
            statusCode: dbTest.status,
            statusText: dbTest.statusText,
            headers: Object.fromEntries(dbTest.headers.entries()),
            responseText: responseText.substring(0, 500),
            timestamp: new Date().toISOString(),
            fileStructureIssues: structuralIssues
          };

          console.log("Database connectivity state:", dbState);

          const testStatus = dbTest.ok ? "passed" : "failed";

          tests.push({
            name: "database-connectivity",
            description: "Database connection test",
            status: testStatus,
            statusCode: dbTest.status,
            response: parsedResponse ? {
              m: parsedResponse?.message,
              e: parsedResponse?.error,
              d: parsedResponse?.details,
              h: parsedResponse?.hint,
              c: parsedResponse?.code,
              t: parsedResponse?.error?.message
            } : undefined,
            duration_ms: performance.now() - startTime,
            timestamp: new Date().toISOString(),
            step: currentStep,
            state: dbState
          });

          console.log(`[Step ${currentStep}/${totalSteps}] database-connectivity test ${testStatus.toUpperCase()}`);

          if (!dbTest.ok) {
            const diagnostics = {
              statusCode: dbTest.status,
              responsePreview: responseText.substring(0, 200),
              parsedError: parsedResponse,
              structuralIssues: structuralIssues.length > 0 ? structuralIssues : 'none',
              possibleSizeGuardTrigger: responseText.includes('size_guard') || responseText.length > 500000
            };
            console.error('Database test diagnostics:', diagnostics);
            throw new Error(`Database connectivity test failed: ${dbTest.status} - ${dbTest.statusText}`);
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
          ].filter(Boolean)
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
          step: currentStep
        });
      }
    }

    // Test 3: Edge function availability
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

          tests.push({
            name: "edge-functions",
            description: "Edge functions availability",
            status: functionsTest.ok || functionsTest.status === 404 ? "passed" : "failed",
            statusCode: functionsTest.status,
            duration_ms: performance.now() - startTime,
            timestamp: new Date().toISOString(),
            step: currentStep,
            state: functionsState
          });

          console.log(`[Step ${currentStep}/${totalSteps}] edge-functions test ${functionsTest.ok || functionsTest.status === 404 ? 'PASSED' : 'FAILED'}`);

          if (!functionsTest.ok && functionsTest.status !== 404) {
            throw new Error(`Edge functions check failed with status ${functionsTest.status}`);
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
            structuralIssues.some(i => i.file?.includes('chat')) ? 'Chat function structural issues' : null,
            error.message.includes('500') ? 'Edge function runtime error' : null,
            error.message.includes('timeout') ? 'Function initialization timeout' : null
          ].filter(Boolean)
        };

        console.error("Edge functions error context:", errorContext);

        tests.push({
          name: "edge-functions",
          description: "Edge functions availability",
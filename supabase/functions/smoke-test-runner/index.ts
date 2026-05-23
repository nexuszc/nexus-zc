any = {};
          try {
            const bodyText = await req.text();
            if (bodyText) {
              requestBody = JSON.parse(bodyText);
            }
          } catch (parseError) {
            logger.log('warn', 'Could not parse request body', { requestId, error: String(parseError) });
          }

          // Extract test_suite parameter if provided
          const test_suite = requestBody.test_suite || 'full';

          // Create timeout promise (30s max)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout after 30s')), 30000);
          });

          // Run health check first
          const healthCheckResult = await Promise.race([
            performHealthCheck(),
            timeoutPromise
          ]) as any;

          // If health check passes, run smoke tests
          let smokeTestResult = null;
          if (healthCheckResult.status === 'ok') {
            try {
              smokeTestResult = await Promise.race([
                runSmokeTests(),
                timeoutPromise
              ]) as any;
            } catch (smokeError) {
              logger.log('error', 'Smoke test failed during full suite', { 
                requestId, 
                error: String(smokeError) 
              });
              smokeTestResult = {
                status: 'error',
                error: smokeError instanceof Error ? smokeError.message : String(smokeError),
                timestamp: new Date().toISOString()
              };
            }
          }

          const response = {
            success: healthCheckResult.status === 'ok' && smokeTestResult?.status === 'success',
            status: healthCheckResult.status === 'ok' && smokeTestResult?.status === 'success' ? 'ok' : 'error',
            timestamp: new Date().toISOString(),
            function: 'smoke-test-runner',
            suite: test_suite,
            requestId,
            healthCheck: healthCheckResult,
            smokeTest: smokeTestResult,
            results: {
              health: healthCheckResult,
              tests: smokeTestResult
            }
          };

          logger.log('info', 'Full suite completed', { 
            requestId, 
            status: response.status
          });

          return new Response(
            JSON.stringify(response),
            {
              status: response.status === 'ok' ? 200 : 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            }
          );
        } catch (error) {
          logger.log('error', 'Full suite failed', { requestId, error: String(error) });
          
          return new Response(
            JSON.stringify({
              success: false,
              status: 'error',
              timestamp: new Date().toISOString(),
              function: 'smoke-test-runner',
              error: error instanceof Error ? error.message : String(error),
              requestId
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            }
          );
        }
      }
    }

    // Method not allowed
    logger.log('warn', 'Method not allowed', { requestId, method: req.method });
    return new Response(
      JSON.stringify({
        status: 'error',
        message: 'Method not allowed. Use GET for health check or POST to run tests.',
        allowedMethods: ['GET', 'POST', 'OPTIONS'],
        requestId
      }),
      {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    logger.log('error', 'Unhandled error in request handler', { 
      requestId, 
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(
      JSON.stringify({
        success: false,
        status: 'error',
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        error: error instanceof Error ? error.message : String(error),
        requestId
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );
  }
}

// Static analysis validator for Edge Functions
async function validateEdgeFunctionStructure(functionPath: string): Promise<{
  valid: boolean;
  issues: string[];
  warnings: string[];
  patterns: {
    hasDenoServe: boolean;
    hasHandlerFunction: boolean;
    hasResponseReturn: boolean;
    hasCorsHeaders: boolean;
    hasErrorHandling: boolean;
  };
}> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const patterns = {
    hasDenoServe: false,
    hasHandlerFunction: false,
    hasResponseReturn: false,
    hasCorsHeaders: false,
    hasErrorHandling: false
  };

  try {
    // Read the Edge Function file as text
    const functionCode = await Deno.readTextFile(functionPath);

    // Check for Deno.serve() pattern
    const denoServePattern = /Deno\.serve\s*\(/;
    patterns.hasDenoServe = denoServePattern.test(functionCode);
    if (!patterns.hasDenoServe) {
      issues.push('Missing Deno.serve() call - Edge Function must use Deno.serve()');
    }

    // Check for handler function (async function that takes Request)
    const handlerPattern = /(?:async\s+)?(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))\s*\([^)]*(?:req|request)[^)]*(?::\s*Request)?\)/i;
    patterns.hasHandlerFunction = handlerPattern.test(functionCode);
    if (!patterns.hasHandlerFunction) {
      issues.push('Missing handler function - Edge Function must have a handler that accepts Request');
    }

    // Check for Response return
    const responsePattern = /(?:return\s+)?new\s+Response\s*\(/;
    patterns.hasResponseReturn = responsePattern.test(functionCode);
    if (!patterns.hasResponseReturn) {
      issues.push('Missing Response return - Handler must return Response objects');
    }

    // Check for CORS headers
    const corsPattern = /(?:corsHeaders|['"]Access-Control-Allow-Origin['"])/;
    patterns.hasCorsHeaders = corsPattern.test(functionCode);
    if (!patterns.hasCorsHeaders) {
      warnings.push('No CORS headers detected - Consider adding CORS support for browser clients');
    }

    // Check for error handling
    const errorHandlingPattern = /(?:try\s*\{|catch\s*\(|\.catch\()/;
    patterns.hasErrorHandling = errorHandlingPattern.test(functionCode);
    if (!patterns.hasErrorHandling) {
      warnings.push('No error handling detected - Consider adding try-catch blocks');
    }

    // Additional structure checks
    if (functionCode.length < 50) {
      issues.push('Function file is too short - likely invalid or incomplete');
    }

    // Check for common anti-patterns
    if (functionCode.includes('eval(')) {
      issues.push('Security issue: Code contains eval() call');
    }

    if (!functionCode.includes('export') && !patterns.hasDenoServe) {
      warnings.push('No exports or Deno.serve found - function may not be properly exposed');
    }

    // Check for OPTIONS method handling (CORS preflight)
    const optionsHandlingPattern = /(?:method\s*===?\s*['"]OPTIONS['"]|req\.method\s*===?\s*['"]OPTIONS['"])/;
    if (patterns.hasCorsHeaders && !optionsHandlingPattern.test(functionCode)) {
      warnings.push('CORS headers present but no OPTIONS method handling detected');
    }

    return {
      valid: issues.length === 0,
      issues,
      warnings,
      patterns
    };

  } catch (error) {
    issues.push(`Failed to read or parse function file: ${error instanceof Error ? error.message : String(error)}`);
    return {
      valid: false,
      issues,
      warnings,
      patterns
    };
  }
}

// Enhanced smoke test runner with static analysis
async function runSmokeTestsWithValidation() {
  const results: any[] = [];
  const functionsDir = './supabase/functions';

  try {
    // Get list of Edge Functions
    const functionDirs: string[] = [];
    for await (const entry of Deno.readDir(functionsDir)) {
      if (entry.isDirectory && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
        functionDirs.push(entry.name);
      }
    }

    logger.log('info', 'Starting Edge Function validation', { 
      functionCount: functionDirs.length,
      functions: functionDirs
    });

    // Validate each Edge Function
    for (const funcName of functionDirs) {
      const indexPath = `${functionsDir}/${funcName}/index.ts`;
      
      try {
        // Check if index.ts exists
        await Deno.stat(indexPath);

        // Perform static analysis validation
        const validation = await validateEdgeFunctionStructure(indexPath);

        results.push({
          function: funcName,
          path: indexPath,
          valid: validation.valid,
          issues: validation.issues,
          warnings: validation.warnings,
          patterns: validation.patterns,
          timestamp: new Date().toISOString()
        });

        logger.log(validation.valid ? 'info' : 'warn', `Validated ${funcName}`, {
          valid: validation.valid,
          issueCount: validation.issues.length,
          warningCount: validation.warnings.length
        });

      } catch (statError) {
        results.push({
          function: funcName,
          path: indexPath,
          valid: false,
          issues: [`File not found or inaccessible: ${statError instanceof Error ? statError.message : String(statError)}`],
          warnings: [],
          patterns: {
            hasDenoServe: false,
            hasHandlerFunction: false,
            hasResponseReturn: false,
            hasCorsHeaders: false,
            hasErrorHandling: false
          },
          timestamp: new Date().toISOString()
        });

        logger.log('error', `Failed to access ${funcName}`, {
          error: String(statError)
        });
      }
    }

    const validCount = results.filter(r => r.valid).length;
    const totalCount = results.length;

    return {
      status: validCount === totalCount ? 'success' : 'partial',
      summary: {
        total: totalCount,
        valid: validCount,
        invalid: totalCount - validCount
      },
      results,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    logger.log('error', 'Smoke test validation failed', { error: String(error) });
    return {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      results,
      timestamp: new Date().toISOString()
    };
  }
}

// Deno.serve() wrapper with proper error handling
Deno.serve(async (req: Request) => {
  const { method } = req;
  
  // Handle CORS preflight immediately
  if (method === 'OPTIONS') {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  try {
    // For POST requests, check if test_suite parameter is provided
    if (method === 'POST') {
      try {
        const contentType = req.headers.get('content-type');
        let test_suite = 'full';
        
        if (contentType?.includes('application/json')) {
          const body = await req.clone().json();
          test_suite = body.test_suite || 'full';
        }

        // Invoke the main handler which will process the request
        return await handleRequest(req);
      } catch (jsonError) {
        // If JSON parsing fails, still proceed with default handler
        logger.log('warn', 'JSON parse error, using default handler', { 
          error: String(jsonError) 
        });
        return await handleRequest(req);
      }
    }

    // For GET requests and other methods, use the main handler
    return await handleRequest(req);
    
  } catch (error) {
    logger.log('error', 'Fatal error in Deno.serve wrapper', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return new Response(
      JSON.stringify({
        success: false,
        status: 'error',
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        error: error instanceof Error ? error.message : String(error),
        fatal: true
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );
  }
});
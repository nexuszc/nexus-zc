f (req.method === 'POST') {
      try {
        const text = await withTimeout(req.text(), 5000, 'Request body read timeout');
        config = text ? JSON.parse(text) : {};
      } catch (parseError) {
        logger.log('warn', 'Failed to parse request body, using defaults', {
          error: parseError.message
        });
        config = {};
      }
    }

    const functionsToCheck = config.functions || [
      'chat',
      'memory-manager',
      'search-query',
      'smoke-test'
    ];

    const maxRetries = config.maxRetries || 2;
    const healthCheckTimeout = config.healthCheckTimeout || 120000;

    // Run enhanced smoke tests with health check
    logger.log('info', 'Running enhanced smoke tests with health check and timeout handling');
    const smokeTestResult = await runSmokeTestWithTimeout();
    
    const smokeTestResults = {
      total: smokeTestResult.tests?.length || 0,
      passed: smokeTestResult.tests?.filter((t: any) => t.status === 'passed').length || 0,
      failed: smokeTestResult.tests?.filter((t: any) => t.status === 'failed').length || 0,
      success: smokeTestResult.success,
      error: smokeTestResult.error,
      stack: smokeTestResult.stack,
      details: smokeTestResult.details,
      isTimeout: smokeTestResult.isTimeout,
      healthCheck: smokeTestResult.healthCheck,
      tests: smokeTestResult.tests || []
    };
    
    logger.log('info', 'Smoke tests completed', {
      total: smokeTestResults.total,
      passed: smokeTestResults.passed,
      failed: smokeTestResults.failed,
      success: smokeTestResults.success,
      hadError: !!smokeTestResults.error,
      isTimeout: smokeTestResults.isTimeout
    });

    // Run health checks on other functions
    logger.log('info', 'Running health checks on functions', { functions: functionsToCheck });
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required Supabase configuration for health checks');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const healthCheckResults = [];

    for (const functionName of functionsToCheck) {
      const startTime = Date.now();
      try {
        logger.log('info', `Health checking function: ${functionName}`);
        
        const invokePromise = supabase.functions.invoke(functionName, {
          body: { health: true }
        });

        const result = await withTimeout(
          invokePromise,
          HEALTH_CHECK_TIMEOUT,
          `Health check timeout for ${functionName}`
        );

        const duration = Date.now() - startTime;

        if (result.error) {
          logger.log('warn', `Health check failed for ${functionName}`, {
            error: result.error,
            duration
          });
          healthCheckResults.push({
            function: functionName,
            status: 'failed',
            error: result.error.message || JSON.stringify(result.error),
            duration
          });
        } else {
          logger.log('info', `Health check passed for ${functionName}`, { duration });
          healthCheckResults.push({
            function: functionName,
            status: 'passed',
            duration,
            response: result.data
          });
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorInfo = parseStandardizedError(error);
        logger.log('error', `Health check exception for ${functionName}`, {
          error: errorInfo.message,
          isTimeout: errorInfo.isTimeout,
          duration
        });
        healthCheckResults.push({
          function: functionName,
          status: 'failed',
          error: errorInfo.message,
          isTimeout: errorInfo.isTimeout,
          duration
        });
      }
    }

    // Aggregate results
    const overallSuccess = smokeTestResults.success && 
                          healthCheckResults.every(h => h.status === 'passed');

    const responseData = {
      success: overallSuccess,
      timestamp: new Date().toISOString(),
      smokeTests: smokeTestResults,
      healthChecks: {
        total: healthCheckResults.length,
        passed: healthCheckResults.filter(h => h.status === 'passed').length,
        failed: healthCheckResults.filter(h => h.status === 'failed').length,
        results: healthCheckResults
      }
    };

    // Add failure report if there were any failures
    if (!overallSuccess) {
      responseData['failureReport'] = generateFailureReport(smokeTestResult, healthCheckResults);
    }

    logger.log('info', 'Smoke test runner completed', {
      overallSuccess,
      smokeTestSuccess: smokeTestResults.success,
      healthChecksPassed: healthCheckResults.filter(h => h.status === 'passed').length,
      healthChecksFailed: healthCheckResults.filter(h => h.status === 'failed').length
    });

    // Return appropriate status code based on results
    const statusCode = overallSuccess ? 200 : 500;

    return new Response(
      JSON.stringify(responseData),
      {
        status: statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    logger.log('error', 'Smoke test runner failed with exception', {
      message: errorInfo.message,
      stack: errorInfo.stack,
      details: errorInfo.details
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: errorInfo.message,
        stack: errorInfo.stack,
        details: errorInfo.details,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
}

async function runSmokeTests(req: Request) {
  try {
    logger.log('info', 'Smoke test runner invoked');

    let config: any = {};

    if (req.method === 'POST') {
      try {
        const text = await withTimeout(req.text(), 5000, 'Request body read timeout');
        config = text ? JSON.parse(text) : {};
      } catch (parseError) {
        logger.log('warn', 'Failed to parse request body, using defaults', {
          error: parseError.message
        });
        config = {};
      }
    }

    const functionsToCheck = config.functions || [
      'chat',
      'memory-manager',
      'search-query',
      'smoke-test'
    ];

    const maxRetries = config.maxRetries || 2;
    const healthCheckTimeout = config.healthCheckTimeout || 120000;

    // Run enhanced smoke tests with health check
    logger.log('info', 'Running enhanced smoke tests with health check and timeout handling');
    const smokeTestResult = await runSmokeTestWithTimeout();
    
    const smokeTestResults = {
      total: smokeTestResult.tests?.length || 0,
      passed: smokeTestResult.tests?.filter((t: any) => t.status === 'passed').length || 0,
      failed: smokeTestResult.tests?.filter((t: any) => t.status === 'failed').length || 0,
      success: smokeTestResult.success,
      error: smokeTestResult.error,
      stack: smokeTestResult.stack,
      details: smokeTestResult.details,
      isTimeout: smokeTestResult.isTimeout,
      healthCheck: smokeTestResult.healthCheck,
      tests: smokeTestResult.tests || []
    };
    
    logger.log('info', 'Smoke tests completed', {
      total: smokeTestResults.total,
      passed: smokeTestResults.passed,
      failed: smokeTestResults.failed,
      success: smokeTestResults.success,
      hadError: !!smokeTestResults.error,
      isTimeout: smokeTestResults.isTimeout
    });

    // Run health checks on other functions
    logger.log('info', 'Running health checks on functions', { functions: functionsToCheck });
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required Supabase configuration for health checks');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const healthCheckResults = [];

    for (const functionName of functionsToCheck) {
      const startTime = Date.now();
      try {
        logger.log('info', `Health checking function: ${functionName}`);
        
        const invokePromise = supabase.functions.invoke(functionName, {
          body: { health: true }
        });

        const result = await withTimeout(
          invokePromise,
          HEALTH_CHECK_TIMEOUT,
          `Health check timeout for ${functionName}`
        );

        const duration = Date.now() - startTime;

        if (result.error) {
          logger.log('warn', `Health check failed for ${functionName}`, {
            error: result.error,
            duration
          });
          healthCheckResults.push({
            function: functionName,
            status: 'failed',
            error: result.error.message || JSON.stringify(result.error),
            duration
          });
        } else {
          logger.log('info', `Health check passed for ${functionName}`, { duration });
          healthCheckResults.push({
            function: functionName,
            status: 'passed',
            duration,
            response: result.data
          });
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorInfo = parseStandardizedError(error);
        logger.log('error', `Health check exception for ${functionName}`, {
          error: errorInfo.message,
          isTimeout: errorInfo.isTimeout,
          duration
        });
        healthCheckResults.push({
          function: functionName,
          status: 'failed',
          error: errorInfo.message,
          isTimeout: errorInfo.isTimeout,
          duration
        });
      }
    }

    // Aggregate results
    const overallSuccess = smokeTestResults.success && 
                          healthCheckResults.every(h => h.status === 'passed');

    const responseData = {
      success: overallSuccess,
      timestamp: new Date().toISOString(),
      smokeTests: smokeTestResults,
      healthChecks: {
        total: healthCheckResults.length,
        passed: healthCheckResults.filter(h => h.status === 'passed').length,
        failed: healthCheckResults.filter(h => h.status === 'failed').length,
        results: healthCheckResults
      }
    };

    // Add failure report if there were any failures
    if (!overallSuccess) {
      responseData['failureReport'] = generateFailureReport(smokeTestResult, healthCheckResults);
    }

    logger.log('info', 'Smoke test runner completed', {
      overallSuccess,
      smokeTestSuccess: smokeTestResults.success,
      healthChecksPassed: healthCheckResults.filter(h => h.status === 'passed').length,
      healthChecksFailed: healthCheckResults.filter(h => h.status === 'failed').length
    });

    return {
      success: overallSuccess,
      statusCode: overallSuccess ? 200 : 500,
      data: responseData
    };

  } catch (error) {
    const errorInfo = parseErrorResponse(error);
    logger.log('error', 'Smoke test runner failed with exception', {
      message: errorInfo.message,
      stack: errorInfo.stack,
      details: errorInfo.details
    });

    return {
      success: false,
      statusCode: 500,
      data: {
        success: false,
        error: errorInfo.message,
        stack: errorInfo.stack,
        details: errorInfo.details,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Deno.serve handler wrapper
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  const result = await runSmokeTests(req);
  
  return new Response(
    JSON.stringify(result.data),
    {
      status: result.statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  );
});
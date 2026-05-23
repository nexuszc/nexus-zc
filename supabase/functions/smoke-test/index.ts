ationPassed = true;
      let validationError: string | undefined;
      
      if (test.validateResponse && !parseError) {
        try {
          validationPassed = test.validateResponse(responseData);
          if (!validationPassed) {
            validationError = 'Response validation returned false';
          }
        } catch (valErr) {
          validationPassed = false;
          validationError = `Validation threw error: ${valErr instanceof Error ? valErr.message : String(valErr)}`;
          logger.error(`Validation error for ${test.name}`, { 
            error: valErr instanceof Error ? valErr.message : String(valErr),
            stack: valErr instanceof Error ? valErr.stack : undefined
          });
        }
      }
      
      if (statusMatch && validationPassed) {
        passed++;
        results.push({
          test: test.name,
          status: 'PASS',
          endpoint: test.endpoint,
          statusCode: response.status,
          elapsed,
          details: 'Test passed successfully'
        });
        logger.info(`Test passed: ${test.name}`, { elapsed, statusCode: response.status });
      } else {
        failed++;
        const failureDetails = [];
        
        if (!statusMatch) {
          failureDetails.push(`Status code mismatch. Expected: ${test.expectedStatus.join(' or ')}, Got: ${response.status}`);
        }
        
        if (!validationPassed) {
          failureDetails.push(validationError || 'Response validation failed');
        }
        
        results.push({
          test: test.name,
          status: 'FAIL',
          endpoint: test.endpoint,
          statusCode: response.status,
          expectedStatus: test.expectedStatus,
          elapsed,
          details: failureDetails.join('; '),
          response: responseData
        });
        
        logger.error(`Test failed: ${test.name}`, {
          elapsed,
          statusCode: response.status,
          expectedStatus: test.expectedStatus,
          validationPassed,
          validationError,
          responsePreview: typeof responseData === 'string' 
            ? responseData.substring(0, 200) 
            : JSON.stringify(responseData).substring(0, 200)
        });
      }
    } catch (error) {
      // Clean up timeout if still active
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      
      const elapsed = Date.now() - testStartTime;
      failed++;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes('abort') || errorMessage.toLowerCase().includes('timeout');
      const isNetworkError = errorMessage.toLowerCase().includes('network') || 
                            errorMessage.toLowerCase().includes('fetch') ||
                            errorMessage.toLowerCase().includes('connection');
      
      let errorType = 'exception';
      if (isTimeout) {
        errorType = 'timeout';
      } else if (isNetworkError) {
        errorType = 'network';
      }
      
      let details = `Test threw exception: ${errorMessage}`;
      if (isTimeout) {
        details = `Test timed out after ${test.timeout || testTimeout}ms`;
      } else if (isNetworkError) {
        details = `Network error: ${errorMessage}`;
      }
      
      results.push({
        test: test.name,
        status: 'ERROR',
        endpoint: test.endpoint,
        elapsed,
        error: errorMessage,
        errorType,
        details,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      logger.error(`Test error: ${test.name}`, {
        error: errorMessage,
        elapsed,
        errorType,
        isTimeout,
        isNetworkError,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  const totalTests = testCases.length;
  const passRate = totalTests > 0 ? ((passed / totalTests) * 100).toFixed(1) : '0.0';

  logger.info('All tests completed', { 
    passed, 
    failed, 
    total: totalTests,
    passRate: `${passRate}%`,
    criticalFailures: results.filter(r => r.errorType === 'timeout' || r.errorType === 'network').length
  });

  return { passed, failed, results };
}

/**
 * Validate environment variables and API keys
 */
function validateEnvironment(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  
  if (!supabaseUrl) {
    errors.push('SUPABASE_URL environment variable is not set');
  } else if (!supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
    errors.push('SUPABASE_URL must be a valid URL starting with http:// or https://');
  }
  
  if (!supabaseKey) {
    errors.push('SUPABASE_ANON_KEY environment variable is not set');
  } else if (supabaseKey.length < 20) {
    errors.push('SUPABASE_ANON_KEY appears to be invalid (too short)');
  }
  
  if (supabaseServiceKey && supabaseServiceKey.length < 20) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY appears to be invalid (too short)');
  }
  
  if (errors.length > 0) {
    logger.error('Environment validation failed', { errors });
  } else {
    logger.info('Environment validation passed');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check database connectivity with retry logic
 */
async function checkDatabaseConnectivity(retries = 3, delayMs = 1000): Promise<{ healthy: boolean; error?: string; attempts: number }> {
  let lastError: string | undefined;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Database connectivity check - attempt ${attempt}/${retries}`);
      
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (!supabaseUrl || !supabaseKey) {
        return { 
          healthy: false, 
          error: 'Missing database credentials', 
          attempts: attempt 
        };
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok || response.status === 404) {
        logger.info('Database connectivity check passed', { attempt, status: response.status });
        return { healthy: true, attempts: attempt };
      }
      
      lastError = `HTTP ${response.status}: ${response.statusText}`;
      logger.warn('Database connectivity check failed', { attempt, status: response.status, error: lastError });
      
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.error('Database connectivity check error', { 
        attempt, 
        error: lastError,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
    
    if (attempt < retries) {
      logger.info(`Retrying database check in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return { 
    healthy: false, 
    error: lastError || 'Database connectivity check failed after all retries', 
    attempts: retries 
  };
}

/**
 * Check critical table accessibility
 */
async function checkCriticalTables(): Promise<{ healthy: boolean; tables: Record<string, { accessible: boolean; error?: string }> }> {
  const criticalTables = ['profiles', 'conversations', 'messages'];
  const results: Record<string, { accessible: boolean; error?: string }> = {};
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    logger.error('Cannot check tables: missing credentials');
    return { healthy: false, tables: {} };
  }
  
  for (const table of criticalTables) {
    try {
      logger.info(`Checking table accessibility: ${table}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=count&limit=1`, {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        results[table] = { accessible: true };
        logger.info(`Table ${table} is accessible`);
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        results[table] = { 
          accessible: false, 
          error: `HTTP ${response.status}: ${errorText}` 
        };
        logger.error(`Table ${table} is not accessible`, { 
          status: response.status, 
          error: errorText 
        });
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results[table] = { accessible: false, error: errorMessage };
      logger.error(`Error checking table ${table}`, { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  const allAccessible = Object.values(results).every(r => r.accessible);
  
  return { 
    healthy: allAccessible, 
    tables: results 
  };
}

/**
 * Check edge function availability
 */
async function checkEdgeFunctions(): Promise<{ healthy: boolean; functions: Record<string, { available: boolean; error?: string }> }> {
  const edgeFunctions = ['chat', 'health'];
  const results: Record<string, { available: boolean; error?: string }> = {};
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  
  if (!supabaseUrl || !supabaseKey) {
    logger.error('Cannot check edge functions: missing credentials');
    return { healthy: false, functions: {} };
  }
  
  for (const func of edgeFunctions) {
    try {
      logger.info(`Checking edge function availability: ${func}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const url = `${supabaseUrl}/functions/v1/${func}${func === 'health' ? '' : '/health'}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok || response.status === 404) {
        results[func] = { available: true };
        logger.info(`Edge function ${func} is available`, { status: response.status });
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        results[func] = { 
          available: false, 
          error: `HTTP ${response.status}: ${errorText}` 
        };
        logger.error(`Edge function ${func} is not available`, { 
          status: response.status, 
          error: errorText 
        });
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results[func] = { available: false, error: errorMessage };
      logger.error(`Error checking edge function ${func}`, { 
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
  
  const allAvailable = Object.values(results).every(r => r.available);
  
  return { 
    healthy: allAvailable, 
    functions: results 
  };
}

/**
 * Comprehensive health check with detailed reporting
 */
async function performComprehensiveHealthCheck(): Promise<{
  overall: boolean;
  timestamp: string;
  checks: {
    environment: { valid: boolean; errors?: string[] };
    database: { healthy: boolean; error?: string; attempts?: number };
    tables: { healthy: boolean; tables: Record<string, { accessible: boolean; error?: string }> };
    edgeFunctions: { healthy: boolean; functions: Record<string, { available: boolean; error?: string }> };
  };
}> {
  logger.info('Starting comprehensive health check');
  
  const envCheck = validateEnvironment();
  
  let dbCheck = { healthy: false, error: 'Skipped due to environment validation failure' };
  let tablesCheck = { healthy: false, tables: {} };
  let functionsCheck = { healthy: false, functions: {} };
  
  if (envCheck.valid) {
    dbCheck = await checkDatabaseConnectivity(3, 1000);
    
    if (dbCheck.healthy) {
      [tablesCheck, functionsCheck] = await Promise.all([
        checkCriticalTables(),
        checkEdgeFunctions()
      ]);
    } else {
      logger.error('Skipping table and function checks due to database connectivity failure');
    }
  } else {
    logger.error('Skipping all checks due to environment validation failure');
  }
  
  const overall = envCheck.valid && dbCheck.healthy && tablesCheck.healthy && functionsCheck.healthy;
  
  const result = {
    overall,
    timestamp: new Date().toISOString(),
    checks: {
      environment: envCheck.valid ? { valid: true } : { valid: false, errors: envCheck.errors },
      database: dbCheck,
      tables: tablesCheck,
      edgeFunctions: functionsCheck
    }
  };
  
  logger.info('Comprehensive health check completed', {
    overall,
    environmentValid: envCheck.valid,
    databaseHealthy: dbCheck.healthy,
    tablesHealthy: tablesCheck.healthy,
    functionsHealthy: functionsCheck.healthy
  });
  
  return result;
}

/**
 * Health check wrapper for Deno.serve
 */
function serveWithHealthCheck(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request): Promise
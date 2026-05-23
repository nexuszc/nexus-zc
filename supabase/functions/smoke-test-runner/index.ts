or as Error).message}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    patterns
  };
}

// Hash function for file content
async function hashFileContent(filePath: string): Promise<string> {
  try {
    const content = await Deno.readTextFile(filePath);
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

// Check if cached result is still valid
function getCachedResult(functionName: string, fileHash: string): FunctionValidationReport | null {
  const cached = testResultCache.get(functionName);
  if (!cached) {
    return null;
  }

  const now = Date.now();
  const age = now - cached.timestamp;

  if (age > CACHE_TTL_MS) {
    testResultCache.delete(functionName);
    return null;
  }

  if (cached.hash !== fileHash) {
    testResultCache.delete(functionName);
    return null;
  }

  logger.log('info', `Using cached result for ${functionName}`, {
    age: `${Math.round(age / 1000)}s`,
    hash: fileHash.substring(0, 8)
  });

  return cached.result;
}

// Cache test result
function cacheTestResult(functionName: string, fileHash: string, result: FunctionValidationReport): void {
  testResultCache.set(functionName, {
    result,
    timestamp: Date.now(),
    hash: fileHash
  });
}

// Health check pre-validation
async function performHealthCheck(): Promise<{ passed: boolean; issues: string[] }> {
  const issues: string[] = [];
  
  try {
    // Check file system access
    try {
      await Deno.stat('./supabase/functions');
    } catch {
      issues.push('Cannot access supabase/functions directory');
    }

    // Check memory availability
    if (Deno.systemMemoryInfo) {
      const memInfo = Deno.systemMemoryInfo();
      if (memInfo.available < 50 * 1024 * 1024) { // Less than 50MB
        issues.push('Low system memory available');
      }
    }

    // Check Deno runtime version
    const version = Deno.version.deno;
    if (!version) {
      issues.push('Unable to detect Deno version');
    }

    // Verify permissions
    const requiredPermissions = ['read', 'env', 'net'];
    for (const perm of requiredPermissions) {
      try {
        const status = await Deno.permissions.query({ name: perm as Deno.PermissionName });
        if (status.state !== 'granted') {
          issues.push(`Missing ${perm} permission`);
        }
      } catch {
        issues.push(`Unable to verify ${perm} permission`);
      }
    }

  } catch (error) {
    issues.push(`Health check failed: ${(error as Error).message}`);
  }

  return {
    passed: issues.length === 0,
    issues
  };
}

// Post-test cleanup
async function performPostTestCleanup(results: FunctionValidationReport[]): Promise<void> {
  try {
    // Clear old cache entries
    const now = Date.now();
    for (const [key, value] of testResultCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        testResultCache.delete(key);
      }
    }

    // Log cleanup statistics
    logger.log('info', 'Post-test cleanup completed', {
      cacheSize: testResultCache.size,
      resultsProcessed: results.length
    });

  } catch (error) {
    logger.log('error', 'Post-test cleanup failed', { error: (error as Error).message });
  }
}

// Retry logic with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  context: string = 'operation'
): Promise<{ result: T | null; retries: number; error: Error | null }> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      if (attempt > 0) {
        logger.log('info', `${context} succeeded after ${attempt} retries`);
      }
      return { result, retries: attempt, error: null };
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.log('warn', `${context} failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`, {
          error: lastError.message
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  logger.log('error', `${context} failed after ${maxRetries} retries`, {
    error: lastError?.message
  });
  
  return { result: null, retries: maxRetries, error: lastError };
}

// Parallel test execution with Promise.allSettled
async function executeTestsInParallel(
  testFunctions: Array<{ name: string; test: () => Promise<FunctionValidationReport> }>,
  maxConcurrency: number = 5
): Promise<Array<{ name: string; result: FunctionValidationReport | null; error: Error | null }>> {
  const results: Array<{ name: string; result: FunctionValidationReport | null; error: Error | null }> = [];
  
  // Process in batches to control concurrency
  for (let i = 0; i < testFunctions.length; i += maxConcurrency) {
    const batch = testFunctions.slice(i, i + maxConcurrency);
    
    const batchPromises = batch.map(async ({ name, test }) => {
      try {
        const result = await test();
        return { name, result, error: null };
      } catch (error) {
        return { name, result: null, error: error as Error };
      }
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    for (const settledResult of batchResults) {
      if (settledResult.status === 'fulfilled') {
        results.push(settledResult.value);
      } else {
        results.push({
          name: 'unknown',
          result: null,
          error: settledResult.reason as Error
        });
      }
    }
  }
  
  return results;
}

// Individual test isolation wrapper
async function executeIsolatedTest(
  functionName: string,
  testFunc: () => Promise<FunctionValidationReport>,
  timeout: number = 30000
): Promise<{ result: FunctionValidationReport | null; timedOut: boolean; error: Error | null; stackTrace: string | null }> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Test timeout exceeded: ${timeout}ms for ${functionName}`));
    }, timeout);
  });

  try {
    const result = await Promise.race([testFunc(), timeoutPromise]);
    return { 
      result: result as FunctionValidationReport, 
      timedOut: false, 
      error: null,
      stackTrace: null
    };
  } catch (error) {
    const err = error as Error;
    const isTimeout = err.message.includes('timeout');
    
    return { 
      result: null, 
      timedOut: isTimeout, 
      error: err,
      stackTrace: err.stack || null
    };
  }
}

// Aggregate test results with detailed metrics
function aggregateTestResults(
  results: Array<{ name: string; result: FunctionValidationReport | null; error: Error | null }>
): {
  total: number;
  passed: number;
  failed: number;
  criticalFailures: number;
  nonCriticalFailures: number;
  byCategory: { [key: string]: { passed: number; failed: number; total: number } };
} {
  const aggregated = {
    total: results.length,
    passed: 0,
    failed: 0,
    criticalFailures: 0,
    nonCriticalFailures: 0,
    byCategory: {} as { [key: string]: { passed: number; failed: number; total: number } }
  };

  for (const { result, error } of results) {
    if (error || !result) {
      aggregated.failed++;
      aggregated.criticalFailures++;
      continue;
    }

    if (result.validation_passed) {
      aggregated.passed++;
    } else {
      aggregated.failed++;
      
      const hasCritical = result.checks.some(check => !check.passed && check.severity === 'critical');
      if (hasCritical) {
        aggregated.criticalFailures++;
      } else {
        aggregated.nonCriticalFailures++;
      }
    }

    // Categorize by check type
    for (const check of result.checks) {
      const category = check.check_name;
      if (!aggregated.byCategory[category]) {
        aggregated.byCategory[category] = { passed: 0, failed: 0, total: 0 };
      }
      aggregated.byCategory[category].total++;
      if (check.passed) {
        aggregated.byCategory[category].passed++;
      } else {
        aggregated.byCategory[category].failed++;
      }
    }
  }

  return aggregated;
}

// Detailed failure reporting with stack traces
function generateDetailedFailureReport(
  results: Array<{ name: string; result: FunctionValidationReport | null; error: Error | null }>,
  diagnostics: FailureDiagnostic[]
): Array<{
  functionName: string;
  failedChecks: Array<{
    checkName: string;
    severity: string;
    message: string;
    stackTrace?: string;
  }>;
  errorMessage?: string;
  stackTrace?: string;
  remediation: string[];
}> {
  const failureReports: Array<{
    functionName: string;
    failedChecks: Array<{
      checkName: string;
      severity: string;
      message: string;
      stackTrace?: string;
    }>;
    errorMessage?: string;
    stackTrace?: string;
    remediation: string[];
  }> = [];

  for (const { name, result, error } of results) {
    if (error) {
      failureReports.push({
        functionName: name,
        failedChecks: [],
        errorMessage: error.message,
        stackTrace: error.stack,
        remediation: ['Review stack trace and fix underlying error', 'Check function implementation']
      });
      continue;
    }

    if (result && !result.validation_passed) {
      const failedChecks = result.checks
        .filter(check => !check.passed)
        .map(check => ({
          checkName: check.check_name,
          severity: check.severity || 'unknown',
          message: check.message || 'Check failed',
          stackTrace: check.details?.stack_trace
        }));

      const relatedDiagnostics = diagnostics.filter(d => 
        d.affected_component === name
      );

      const remediation = relatedDiagnostics.map(d => d.suggested_remediation);

      failureReports.push({
        functionName: name,
        failedChecks,
        remediation: remediation.length > 0 ? remediation : ['Review failed checks and implement fixes']
      });
    }
  }

  return failureReports;
}

// Structured response format
interface DetailedTestResponse {
  status: 'success' | 'partial_success' | 'failure';
  summary: {
    total: number;
    passed: number;
    failed: number;
    criticalFailures: number;
    nonCriticalFailures: number;
  };
  results: FunctionValidationReport[];
  preflightChecks: {
    passed: boolean;
    issues: string[];
  };
  metadata: {
    timestamp: string;
    duration_ms: number;
    cached_results: number;
    retried_operations: number;
  };
  criticalIssues: Array<{
    function: string;
    issue: string;
    severity: 'critical' | 'warning';
  }>;
  failureDiagnostics: FailureDiagnostic[];
  testCategories: {
    [key: string]: {
      total: number;
      passed: number;
      failed: number;
      timeout_exceeded: boolean;
    };
  };
}

// Classify issue severity
function classifyIssueSeverity(issue: string): 'critical' | 'warning' {
  const criticalPatterns = [
    /no deno\.serve/i,
    /file not found/i,
    /cannot read/i,
    /invalid handler/i,
    /syntax error/i,
    /await keyword without async/i
  ];

  for (const pattern of criticalPatterns) {
    if (pattern.test(issue)) {
      return 'critical';
    }
  }

  return 'warning';
}

// Create failure diagnostic with remediation steps
function createFailureDiagnostic(
  checkName: string,
  errorMessage: string,
  affectedComponent: string,
  category: 'critical' | 'non-critical' = 'critical',
  errorCode?: string,
  stackTrace?: string
): FailureDiagnostic {
  const remediationMap: { [key: string]: string } = {
    'has_deno_serve': 'Add Deno.serve() call to your Edge Function. Example: Deno.serve(async (req) => { ... })',
    'handler_signature_valid': 'Ensure handler accepts Request parameter. Example: async (req: Request) => { ... }',
    'file_exists': 'Create index.ts file in the function directory',
    'imports_detected': 'Add necessary imports at the top of the file',
    'error_handling_present': 'Add try-catch blocks around async operations',
    'cors_configured': 'Import and use corsHeaders from _shared/cors.ts',
    'file_not_found': 'Verify the function directory exists and contains index.ts',
    'permission_denied': 'Check file permissions and Deno runtime permissions',
    'timeout_exceeded': 'Optimize function code or increase timeout limit',
    'syntax_error': 'Review code for syntax errors using deno check',
    'async_await_mismatch': 'Ensure async functions are properly declared with async keyword'
  };

  let suggestedRemediation = remediationMap[checkName] || 'Review error message and consult documentation';

  // Add specific remediation based on error message patterns
  if (/permission/i.test(errorMessage)) {
    suggestedRemediation = 'Grant necessary file system permissions to Deno runtime';
  } else if (/timeout/i.test(errorMessage)) {
    suggestedRemediation = 'Reduce function complexity or optimize slow operations';
  } else if (/network/i.test(errorMessage)) {
    suggestedRemediation
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
    suggestedRemediation = 'Check network connectivity and API endpoints';
  }

  return {
    check_name: checkName,
    error_message: errorMessage,
    affected_component: affectedComponent,
    category,
    suggested_remediation: suggestedRemediation,
    error_code: errorCode,
    stack_trace: stackTrace
  };
}

// Test execution with retry mechanism
async function executeTestWithRetry(
  functionName: string,
  testFunction: () => Promise<FunctionValidationReport>,
  maxRetries: number = 2
): Promise<{ name: string; result: FunctionValidationReport | null; error: Error | null; attempts: number }> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[${functionName}] Test attempt ${attempt + 1}/${maxRetries + 1} - Starting`);
      const startTime = Date.now();
      
      const result = await testFunction();
      
      const duration = Date.now() - startTime;
      console.log(`[${functionName}] Test completed in ${duration}ms - Status: ${result.validation_passed ? 'PASSED' : 'FAILED'}`);
      
      return { name: functionName, result, error: null, attempts: attempt + 1 };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[${functionName}] Test attempt ${attempt + 1} failed:`, lastError.message);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`[${functionName}] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error(`[${functionName}] All ${maxRetries + 1} attempts failed`);
  return { name: functionName, result: null, error: lastError, attempts: maxRetries + 1 };
}

// Enhanced orchestration with parallel execution and timeout
async function orchestrateSmokeTests(
  testTargets: string[],
  timeout: number = 30000
): Promise<{
  results: Array<{ name: string; result: FunctionValidationReport | null; error: Error | null; attempts: number }>;
  totalDuration: number;
  retriedTests: number;
}> {
  console.log(`Starting orchestration for ${testTargets.length} tests with ${timeout}ms timeout`);
  const startTime = Date.now();
  
  const testPromises = testTargets.map(async (functionName) => {
    console.log(`[${functionName}] Queuing test execution`);
    
    const timeoutPromise = new Promise<{ name: string; result: null; error: Error; attempts: number }>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Test execution timeout after ${timeout}ms`));
      }, timeout);
    });
    
    const testExecution = executeTestWithRetry(
      functionName,
      async () => {
        console.log(`[${functionName}] Invoking smoke-test function`);
        
        const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/smoke-test`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ function_name: functionName })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Smoke test request failed: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        console.log(`[${functionName}] Received response:`, JSON.stringify(result).substring(0, 200));
        
        return result as FunctionValidationReport;
      }
    );
    
    try {
      return await Promise.race([testExecution, timeoutPromise]);
    } catch (error) {
      console.error(`[${functionName}] Test orchestration error:`, error);
      return {
        name: functionName,
        result: null,
        error: error instanceof Error ? error : new Error(String(error)),
        attempts: 1
      };
    }
  });
  
  console.log('Executing all tests in parallel...');
  const settledResults = await Promise.allSettled(testPromises);
  
  const results = settledResults.map((settled, index) => {
    const functionName = testTargets[index];
    
    if (settled.status === 'fulfilled') {
      return settled.value;
    } else {
      console.error(`[${functionName}] Promise rejected:`, settled.reason);
      return {
        name: functionName,
        result: null,
        error: settled.reason instanceof Error ? settled.reason : new Error(String(settled.reason)),
        attempts: 1
      };
    }
  });
  
  const totalDuration = Date.now() - startTime;
  const retriedTests = results.filter(r => r.attempts > 1).length;
  
  console.log(`Orchestration completed in ${totalDuration}ms. Retried tests: ${retriedTests}`);
  
  return { results, totalDuration, retriedTests };
}

// Enhanced result aggregation with detailed metrics
function aggregateTestResults(
  results: Array<{ name: string; result: FunctionValidationReport | null; error: Error | null; attempts: number }>
): {
  summary: {
    total: number;
    passed: number;
    failed: number;
    criticalFailures: number;
    nonCriticalFailures: number;
  };
  byCategory: { [key: string]: { passed: number; failed: number; total: number; timeout_exceeded: boolean } };
  individualResults: Array<{
    functionName: string;
    status: 'passed' | 'failed' | 'error';
    attempts: number;
    criticalIssues: number;
    warnings: number;
  }>;
} {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    criticalFailures: 0,
    nonCriticalFailures: 0
  };
  
  const byCategory: { [key: string]: { passed: number; failed: number; total: number; timeout_exceeded: boolean } } = {};
  const individualResults: Array<{
    functionName: string;
    status: 'passed' | 'failed' | 'error';
    attempts: number;
    criticalIssues: number;
    warnings: number;
  }> = [];
  
  for (const { name, result, error, attempts } of results) {
    let status: 'passed' | 'failed' | 'error' = 'error';
    let criticalIssues = 0;
    let warnings = 0;
    
    if (error || !result) {
      summary.failed++;
      summary.criticalFailures++;
      status = 'error';
      criticalIssues = 1;
    } else if (result.validation_passed) {
      summary.passed++;
      status = 'passed';
    } else {
      summary.failed++;
      status = 'failed';
      
      const hasCritical = result.checks.some(check => !check.passed && check.severity === 'critical');
      if (hasCritical) {
        summary.criticalFailures++;
        criticalIssues = result.checks.filter(check => !check.passed && check.severity === 'critical').length;
      } else {
        summary.nonCriticalFailures++;
        warnings = result.checks.filter(check => !check.passed).length;
      }
      
      // Categorize by check type
      for (const check of result.checks) {
        const category = check.check_name;
        if (!byCategory[category]) {
          byCategory[category] = { passed: 0, failed: 0, total: 0, timeout_exceeded: false };
        }
        byCategory[category].total++;
        if (check.passed) {
          byCategory[category].passed++;
        } else {
          byCategory[category].failed++;
        }
      }
    }
    
    individualResults.push({
      functionName: name,
      status,
      attempts,
      criticalIssues,
      warnings
    });
  }
  
  return { summary, byCategory, individualResults };
}

// Generate comprehensive status report
function generateStatusReport(
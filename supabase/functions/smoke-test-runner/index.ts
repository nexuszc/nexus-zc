// Deno Edge Function: Smoke Test Runner with Enhanced Validation and Retries
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const logger = {
  log: (level: string, message: string, data?: any) => {
    console.log(JSON.stringify({ level, message, ...data, timestamp: new Date().toISOString() }));
  }
};

// Types
interface EdgeFunctionValidation {
  valid: boolean;
  issues: string[];
  warnings: string[];
  patterns: {
    hasDenoServe: boolean;
    handlerSignatureValid: boolean;
    importsDetected: boolean;
    corsConfigured: boolean;
    errorHandlingPresent: boolean;
  };
}

interface FunctionValidationReport {
  function_name: string;
  has_deno_serve: boolean;
  handler_signature_valid: boolean;
  imports_detected: boolean;
  cors_configured: boolean;
  error_handling_present: boolean;
  valid: boolean;
  issues: string[];
  warnings: string[];
  timestamp: string;
  test_category?: 'critical' | 'non-critical';
  failure_diagnostics?: FailureDiagnostic[];
}

interface FailureDiagnostic {
  check_name: string;
  check_category: 'critical' | 'non-critical';
  failed_at: string;
  error_message: string;
  error_code?: string;
  suggested_remediation: string;
  stack_trace?: string;
  affected_component: string;
}

interface PreflightCheck {
  passed: boolean;
  issues: string[];
}

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

interface CachedTestResult {
  result: FunctionValidationReport;
  timestamp: number;
  hash: string;
}

interface TestCategory {
  name: string;
  priority: 'critical' | 'non-critical';
  timeout_ms: number;
  tests: string[];
}

interface TestIsolationContext {
  category: string;
  function_name: string;
  start_time: number;
  timeout_ms: number;
  errors: FailureDiagnostic[];
}

// Cache for test results (in-memory)
const testResultCache = new Map<string, CachedTestResult>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Retry configuration
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2
};

// Test categories with priority levels and timeouts
const TEST_CATEGORIES: TestCategory[] = [
  {
    name: 'critical_structure',
    priority: 'critical',
    timeout_ms: 5000,
    tests: ['has_deno_serve', 'handler_signature_valid', 'file_exists']
  },
  {
    name: 'critical_functionality',
    priority: 'critical',
    timeout_ms: 10000,
    tests: ['imports_detected', 'error_handling_present']
  },
  {
    name: 'non_critical_features',
    priority: 'non-critical',
    timeout_ms: 8000,
    tests: ['cors_configured']
  }
];

// Retry with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.initialDelayMs;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === config.maxRetries) {
        logger.log('error', `Operation failed after ${config.maxRetries} retries: ${operationName}`, {
          error: lastError.message
        });
        throw lastError;
      }

      logger.log('warn', `Retry attempt ${attempt + 1}/${config.maxRetries} for ${operationName}`, {
        delay_ms: delay,
        error: lastError.message
      });

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }

  throw lastError || new Error('Operation failed with unknown error');
}

// Pre-flight checks
async function runPreflightChecks(): Promise<PreflightCheck> {
  const issues: string[] = [];

  try {
    // Check if functions directory exists
    const functionsDir = './supabase/functions';
    try {
      await Deno.stat(functionsDir);
    } catch {
      issues.push('Functions directory not found');
      return { passed: false, issues };
    }

    // Check read permissions
    try {
      for await (const _entry of Deno.readDir(functionsDir)) {
        break; // Just need to verify we can read
      }
    } catch (error) {
      issues.push(`Cannot read functions directory: ${(error as Error).message}`);
      return { passed: false, issues };
    }

    // Check if Deno is available and has required permissions
    try {
      const denoVersion = Deno.version;
      if (!denoVersion || !denoVersion.deno) {
        issues.push('Deno runtime not properly initialized');
      }
    } catch (error) {
      issues.push(`Deno runtime check failed: ${(error as Error).message}`);
    }

  } catch (error) {
    issues.push(`Pre-flight check error: ${(error as Error).message}`);
  }

  return {
    passed: issues.length === 0,
    issues
  };
}

// Static validation of Edge Function structure
async function validateEdgeFunctionStructure(filePath: string): Promise<EdgeFunctionValidation> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const patterns = {
    hasDenoServe: false,
    handlerSignatureValid: false,
    importsDetected: false,
    corsConfigured: false,
    errorHandlingPresent: false
  };

  try {
    const content = await Deno.readTextFile(filePath);

    // Check for Deno.serve call (required)
    if (/Deno\.serve\s*\(/i.test(content)) {
      patterns.hasDenoServe = true;
    } else {
      issues.push('No Deno.serve call found - Edge Function must use Deno.serve');
    }

    // Check for proper handler signature
    if (/\(\s*(?:req|request)\s*:?\s*Request/i.test(content) || 
        /\(\s*\{\s*request\s*\}/i.test(content)) {
      patterns.handlerSignatureValid = true;
    } else if (patterns.hasDenoServe) {
      warnings.push('Handler signature may not match expected pattern (req: Request)');
    }

    // Check for imports
    if (/^import\s+/m.test(content)) {
      patterns.importsDetected = true;
    }

    // Check for CORS configuration
    if (/cors/i.test(content) || /Access-Control-Allow/i.test(content)) {
      patterns.corsConfigured = true;
    } else {
      warnings.push('No CORS configuration detected - may cause browser issues');
    }

    // Check for error handling
    if (/try\s*\{[\s\S]*catch/i.test(content) || /\.catch\(/i.test(content)) {
      patterns.errorHandlingPresent = true;
    } else {
      warnings.push('No explicit error handling detected');
    }

    // Additional validation checks
    if (content.trim().length === 0) {
      issues.push('File is empty');
    }

    // Check for common async/await issues
    if (/\bawait\b/.test(content) && !/\basync\b/.test(content)) {
      issues.push('Found await keyword but function may not be marked as async');
    }

  } catch (error) {
    issues.push(`Failed to read or parse file: ${(error as Error).message}`);
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
    suggestedRemediation = 'Check network connectivity and external service availability';
  }

  return {
    check_name: checkName,
    check_category: category,
    failed_at: new Date().toISOString(),
    error_message: errorMessage,
    error_code: errorCode,
    suggested_remediation: suggestedRemediation,
    stack_trace: stackTrace,
    affected_component: affectedComponent
  };
}

// Run test with isolation and timeout control
async function runTestWithIsolation<T>(
  testFunc: () => Promise<T>,
  context: TestIsolationContext
): Promise<{ result: T | null; error: FailureDiagnostic | null; timedOut: boolean }> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Test timeout exceeded: ${context.timeout_ms}ms`));
    }, context.timeout_ms);
  });

  try {
    const result = await Promise.race([testFunc(), timeoutPromise]);
    return { result: result as T, error: null, timedOut: false };
  } catch (error) {
    const err = error as Error;
    const isTimeout = err.message.includes('timeout');
    
    const diagnostic = createFailureDiagnostic(
      context.category,
      err.message,
      context.function_name,
      'critical',
      isTimeout ? 'TIMEOUT' : 'TEST_FAILURE',
      err.stack
    );

    context.errors.push(diagnostic);

    return { 
      result: null, 
      error: diagnostic, 
      timedOut: isTimeout 
    };
  }
}

// Aggregate errors by category and priority
function aggregateErrorsByCategory(results: FunctionValidationReport[]): {
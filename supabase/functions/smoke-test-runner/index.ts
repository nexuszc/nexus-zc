tterns.hasDenoServe) {
      warnings.push('No Response object construction detected');
    }

    // Check for CORS headers
    patterns.hasCorsHeaders = detectCorsConfiguration(functionCode);
    patterns.corsConfigured = patterns.hasCorsHeaders;
    if (!patterns.hasCorsHeaders) {
      warnings.push('CORS headers not detected - may cause cross-origin issues');
    }

    // Check for error handling
    patterns.hasErrorHandling = detectErrorHandling(functionCode);
    patterns.errorHandlingPresent = patterns.hasErrorHandling;
    if (!patterns.hasErrorHandling) {
      warnings.push('No error handling detected - consider adding try-catch blocks');
    }

    // Check if Deno.serve is nested (should be at top level, not nested deeply)
    if (patterns.hasDenoServe) {
      const lines = functionCode.split('\n');
      let denoServeLineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/Deno\.serve\s*\(/i.test(lines[i])) {
          denoServeLineIndex = i;
          break;
        }
      }
      
      if (denoServeLineIndex > -1) {
        const beforeServe = lines.slice(0, denoServeLineIndex).join('\n');
        const openBraces = (beforeServe.match(/\{/g) || []).length;
        const closeBraces = (beforeServe.match(/\}/g) || []).length;
        const nestingLevel = openBraces - closeBraces;
        
        if (nestingLevel > 0) {
          warnings.push('Deno.serve() appears to be nested inside another block - should be at top level');
        }
      }
    }

    // Check for proper content-type header
    const hasContentTypeHeader = /['"]Content-Type['"]\s*:\s*['"]application\/json['"]/i.test(functionCode);
    if (!hasContentTypeHeader && /JSON\.stringify/i.test(functionCode)) {
      warnings.push('JSON.stringify used but Content-Type header may not be set to application/json');
    }

    // Additional validation: Check for OPTIONS handler (CORS preflight)
    const hasOptionsHandler = /method\s*===\s*['"]OPTIONS['"]/i.test(functionCode) ||
                             /if\s*\(\s*method\s*===\s*['"]OPTIONS['"]/i.test(functionCode);
    if (!hasOptionsHandler && patterns.hasCorsHeaders) {
      warnings.push('CORS headers detected but no OPTIONS method handler found');
    }

    // Check for async/await usage
    const hasAsync = /async\s+(?:function|\()/i.test(functionCode);
    const hasAwait = /await\s+/i.test(functionCode);
    if (hasAwait && !hasAsync) {
      issues.push('Found await keyword without async function declaration');
    }

    // Check for environment variable usage
    const hasEnvVars = /Deno\.env\.get\s*\(/i.test(functionCode);
    if (hasEnvVars) {
      warnings.push('Environment variables detected - ensure they are configured in Supabase dashboard');
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

// Retry configuration for transient failures
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  timeoutMs: 30000
};

// Sleep utility for retry delays
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate exponential backoff delay
function calculateBackoffDelay(attemptNumber: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber - 1);
  return Math.min(delay, config.maxDelayMs);
}

// Enhanced error logging with stack traces
function logErrorWithStack(functionName: string, error: unknown, context?: Record<string, unknown>): void {
  const errorDetails = {
    function: functionName,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    name: error instanceof Error ? error.name : 'UnknownError',
    context: context || {},
    timestamp: new Date().toISOString()
  };

  logger.log('error', `Detailed error for ${functionName}`, errorDetails);
}

// Retry wrapper with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Operation timed out after ${config.timeoutMs}ms`)), config.timeoutMs);
      });

      // Race between operation and timeout
      const result = await Promise.race([
        operation(),
        timeoutPromise
      ]);

      if (attempt > 1) {
        logger.log('info', `${operationName} succeeded after retry`, {
          attempt,
          totalAttempts: config.maxRetries
        });
      }

      return result;

    } catch (error) {
      lastError = error;
      
      logErrorWithStack(operationName, error, {
        attempt,
        maxRetries: config.maxRetries,
        willRetry: attempt < config.maxRetries
      });

      if (attempt < config.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt, config);
        logger.log('warn', `Retrying ${operationName} after delay`, {
          attempt,
          nextAttempt: attempt + 1,
          delayMs
        });
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

// Pre-flight checks before running smoke tests
async function runPreflightChecks(): Promise<{ passed: boolean; issues: string[] }> {
  const issues: string[] = [];

  try {
    // Check if functions directory exists
    const functionsDir = './supabase/functions';
    try {
      const dirStat = await Deno.stat(functionsDir);
      if (!dirStat.isDirectory) {
        issues.push(`${functionsDir} exists but is not a directory`);
      }
    } catch {
      issues.push(`Functions directory not found: ${functionsDir}`);
      return { passed: false, issues };
    }

    // Check read permissions
    try {
      const testRead = Deno.readDir(functionsDir);
      for await (const _ of testRead) {
        break; // Just test we can read
      }
    } catch (error) {
      issues.push(`Cannot read functions directory: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check for at least one function
    let functionCount = 0;
    for await (const entry of Deno.readDir(functionsDir)) {
      if (entry.isDirectory && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
        functionCount++;
      }
    }

    if (functionCount === 0) {
      issues.push('No Edge Functions found in functions directory');
    }

    logger.log('info', 'Pre-flight checks completed', {
      passed: issues.length === 0,
      functionCount,
      issues
    });

  } catch (error) {
    issues.push(`Pre-flight check failed: ${error instanceof Error ? error.message : String(error)}`);
    logErrorWithStack('Pre-flight checks', error);
  }

  return {
    passed: issues.length === 0,
    issues
  };
}

// Test result cache to avoid repeated failures
interface CachedTestResult {
  result: FunctionValidationReport;
  timestamp: number;
  hash: string;
}

const testResultCache = new Map<string, CachedTestResult>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Simple hash function for file content
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

// Enhanced smoke test runner with all improvements
async function runSmokeTestsWithValidation() {
  const startTime = Date.now();
  const results: FunctionValidationReport[] = [];
  const functionsDir = './supabase/functions';
  let cachedResultCount = 0;
  let retriedOperationCount = 0;

  try {
    // Run pre-flight checks first
    const preflightChecks = await runPreflightChecks();
    
    if (!preflightChecks.passed) {
      logger.log('error', 'Pre-flight checks failed', {
        issues: preflightChecks.issues
      });

      const duration = Date.now() - startTime;
      const response: DetailedTestResponse = {
        status: 'failure',
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          criticalFailures: preflightChecks.issues.length,
          nonCriticalFailures: 0
        },
        results: [],
        preflightChecks,
        metadata: {
          timestamp: new Date().toISOString(),
          duration_ms: duration,
          cached_results: 0,
          retried_operations: 0
        },
        criticalIssues: preflightChecks.issues.map(issue => ({
          function: 'system',
          issue,
          severity: 'critical' as const
        }))
      };

      return response;
    }

    // Get list of Edge Functions with retry
    const functionDirs = await retryWithBackoff(
      async () => {
        const dirs: string[] = [];
        for await (const entry of Deno.readDir(functionsDir)) {
          if (entry.isDirectory && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
            dirs.push(entry.name);
          }
        }
        return dirs;
      },
      'List Edge Functions',
      DEFAULT_RETRY_CONFIG
    );

    retriedOperationCount++;

    logger.log('info', 'Starting Edge Function static analysis validation', { 
      functionCount: functionDirs.length,
      functions: functionDirs
    });

    // Validate each Edge Function (static analysis only)
    for (const funcName of functionDirs) {
      const indexPath = `${functionsDir}/${funcName}/index.ts`;
      
      try {
        // Check cache first
        const fileHash = await hashFileContent(indexPath);
        const cachedResult = getCachedResult(funcName, fileHash);
        
        if (cachedResult) {
          results.push(cachedResult);
          cachedResultCount++;
          continue;
        }

        // Check if index.ts exists with retry
        await retryWithBackoff(
          async () => await Deno.stat(indexPath),
          `Check ${funcName} file`,
          { ...DEFAULT_RETRY_CONFIG, maxRetries: 2 }
        );
        retriedOperationCount++;

        // Perform static analysis validation (no execution) with retry
        const validation = await retryWithBackoff(
          async () => await validateEdgeFunctionStructure(indexPath),
          `Validate ${funcName}`,
          DEFAULT_RETRY_CONFIG
        );
        retriedOperationCount++;

        const report: FunctionValidationReport = {
          function_name: funcName,
          has_deno_serve: validation.patterns.hasDenoServe,
          handler_signature_valid: validation.patterns.handlerSignatureValid,
          imports_detected: validation.patterns.importsDetected,
          cors_configured: validation.patterns.corsConfigured,
          error_handling_present: validation.patterns.errorHandlingPresent,
          valid: validation.valid,
          issues: validation.issues,
          warnings: validation.warnings,
          timestamp: new Date().toISOString()
        };

        results.push(report);
        cacheTestResult(funcName
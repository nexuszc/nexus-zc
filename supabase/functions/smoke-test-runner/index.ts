// supabase/functions/smoke-test-runner/index.ts

interface Logger {
  log: (level: string, message: string, meta?: any) => void;
}

const logger: Logger = {
  log: (level: string, message: string, meta?: any) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta
    }));
  }
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

interface ValidationPatterns {
  hasDenoServe: boolean;
  hasHandlerFunction: boolean;
  hasResponseReturn: boolean;
  hasCorsHeaders: boolean;
  hasErrorHandling: boolean;
  hasSupabaseImport: boolean;
  handlerSignatureValid: boolean;
  importsDetected: string[];
  corsConfigured: boolean;
  errorHandlingPresent: boolean;
}

interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
  patterns: ValidationPatterns;
}

interface FunctionValidationReport {
  function_name: string;
  has_deno_serve: boolean;
  handler_signature_valid: boolean;
  imports_detected: string[];
  cors_configured: boolean;
  error_handling_present: boolean;
  valid: boolean;
  issues: string[];
  warnings: string[];
  timestamp: string;
}

// Main request handler
async function handleRequest(req: Request): Promise<Response> {
  try {
    const { method } = req;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // Parse request parameters
    let test_suite = 'full';
    
    if (method === 'POST') {
      try {
        const contentType = req.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const body = await req.json();
          test_suite = body.test_suite || 'full';
        }
      } catch (jsonError) {
        logger.log('warn', 'Failed to parse JSON body, using defaults', {
          error: String(jsonError)
        });
      }
    }

    logger.log('info', 'Starting static analysis smoke tests', {
      test_suite,
      method
    });

    // Run static analysis validation (no execution)
    const testResults = await runSmokeTestsWithValidation();

    return new Response(
      JSON.stringify({
        success: testResults.status !== 'error',
        status: testResults.status,
        test_suite,
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        ...testResults
      }),
      {
        status: testResults.status === 'error' ? 500 : 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );

  } catch (error) {
    logger.log('error', 'Request handler error', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(
      JSON.stringify({
        success: false,
        status: 'error',
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        error: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );
  }
}

// Extract imports from function code using regex
function extractImports(code: string): string[] {
  const imports: string[] = [];
  
  // Match import statements
  const importRegex = /import\s+(?:(?:{[^}]+})|(?:\*\s+as\s+\w+)|(?:\w+))\s+from\s+['"]([@\w\-\/\.]+)['"]/g;
  let match;
  
  while ((match = importRegex.exec(code)) !== null) {
    if (match[1]) {
      imports.push(match[1]);
    }
  }
  
  return imports;
}

// Validate Deno.serve handler signature
function validateHandlerSignature(code: string): boolean {
  // Look for Deno.serve with async function or arrow function
  // Valid patterns:
  // Deno.serve(async (req: Request) => { ... })
  // Deno.serve(async (req) => { ... })
  // Deno.serve(async function(req: Request) { ... })
  // Deno.serve((req: Request): Response => { ... })
  
  const patterns = [
    /Deno\.serve\s*\(\s*async\s*\(\s*req\s*:\s*Request\s*\)\s*=>/,
    /Deno\.serve\s*\(\s*async\s*\(\s*req\s*\)\s*=>/,
    /Deno\.serve\s*\(\s*async\s+function\s*\(\s*req\s*:\s*Request\s*\)/,
    /Deno\.serve\s*\(\s*\(\s*req\s*:\s*Request\s*\)\s*:\s*(?:Response|Promise<Response>)\s*=>/,
    /Deno\.serve\s*\(\s*\(\s*req\s*:\s*Request\s*\)\s*=>/
  ];
  
  return patterns.some(pattern => pattern.test(code));
}

// Detect CORS configuration
function detectCorsConfiguration(code: string): boolean {
  // Check for CORS headers in various forms
  const corsPatterns = [
    /['"]Access-Control-Allow-Origin['"]/i,
    /corsHeaders/i,
    /cors\s*:\s*true/i,
    /Access-Control-Allow/i
  ];
  
  return corsPatterns.some(pattern => pattern.test(code));
}

// Detect error handling patterns
function detectErrorHandling(code: string): boolean {
  // Check for try-catch blocks and error handling
  const errorPatterns = [
    /try\s*{[\s\S]*?}\s*catch/,
    /catch\s*\(\s*\w+\s*(?::\s*Error)?\s*\)/,
    /\.catch\s*\(/,
    /throw\s+new\s+Error/,
    /if\s*\(.*error/i
  ];
  
  return errorPatterns.some(pattern => pattern.test(code));
}

// Detect Response return patterns
function detectResponseReturn(code: string): boolean {
  const responsePatterns = [
    /return\s+new\s+Response\s*\(/,
    /:\s*Response\s*=>/,
    /:\s*Promise<Response>/,
    /Response\.json\s*\(/,
    /new\s+Response\s*\(/
  ];
  
  return responsePatterns.some(pattern => pattern.test(code));
}

// Static analysis validation of Edge Function structure
async function validateEdgeFunctionStructure(filePath: string): Promise<ValidationResult> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const patterns: ValidationPatterns = {
    hasDenoServe: false,
    hasHandlerFunction: false,
    hasResponseReturn: false,
    hasCorsHeaders: false,
    hasErrorHandling: false,
    hasSupabaseImport: false,
    handlerSignatureValid: false,
    importsDetected: [],
    corsConfigured: false,
    errorHandlingPresent: false
  };

  try {
    // Read function code as text
    const functionCode = await Deno.readTextFile(filePath);

    // Extract imports
    patterns.importsDetected = extractImports(functionCode);
    
    // Check for Supabase import
    patterns.hasSupabaseImport = patterns.importsDetected.some(
      imp => imp.includes('@supabase/supabase-js') || imp.includes('supabase')
    );

    // Check for Deno.serve
    patterns.hasDenoServe = /Deno\.serve\s*\(/i.test(functionCode);
    if (!patterns.hasDenoServe) {
      issues.push('Missing Deno.serve() - Edge Functions must use Deno.serve()');
    }

    // Validate handler signature
    patterns.handlerSignatureValid = validateHandlerSignature(functionCode);
    if (patterns.hasDenoServe && !patterns.handlerSignatureValid) {
      issues.push('Invalid handler signature - should be async (req: Request) => Response or Promise<Response>');
    }
    patterns.hasHandlerFunction = patterns.handlerSignatureValid;

    // Check for Response return
    patterns.hasResponseReturn = detectResponseReturn(functionCode);
    if (!patterns.hasResponseReturn && patterns.hasDenoServe) {
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

// Enhanced smoke test runner with static analysis only (no execution)
async function runSmokeTestsWithValidation() {
  const results: FunctionValidationReport[] = [];
  const functionsDir = './supabase/functions';

  try {
    // Get list of Edge Functions
    const functionDirs: string[] = [];
    for await (const entry of Deno.readDir(functionsDir)) {
      if (entry.isDirectory && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
        functionDirs.push(entry.name);
      }
    }

    logger.log('info', 'Starting Edge Function static analysis validation', { 
      functionCount: functionDirs.length,
      functions: functionDirs
    });

    // Validate each Edge Function (static analysis only)
    for (const funcName of functionDirs) {
      const indexPath = `${functionsDir}/${funcName}/index.ts`;
      
      try {
        // Check if index.ts exists
        await Deno.stat(indexPath);

        // Perform static analysis validation (no execution)
        const validation = await validateEdgeFunctionStructure(indexPath);

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

        logger.log(validation.valid ? 'info' : 'warn', `Validated ${funcName} (static analysis)`, {
          valid: validation.valid,
          issueCount: validation.issues.length,
          warningCount: validation.warnings.length,
          hasDenoServe: validation.patterns.hasDenoServe,
          handlerSignatureValid: validation.patterns.handlerSignatureValid
        });

      } catch (statError) {
        const report: FunctionValidationReport = {
          function_name: funcName,
          has_deno_serve: false,
          handler_signature_valid: false,
          imports_detected: [],
          cors_configured: false,
          error_handling_present: false,
          valid: false,
          issues: [`File not found or inaccessible: ${statError instanceof Error ? statError.message : String(statError)}`],
          warnings: [],
          timestamp: new Date().toISOString()
        };

        results.push(report);

        logger.log('error', `Failed to access ${funcName}`, {
          error: String(statError)
        });
      }
    }

    const validCount = results.filter(r => r.valid).length;
    const totalCount = results.length;

    return {
      status: validCount === totalCount ?
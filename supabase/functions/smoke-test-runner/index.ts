// supabase/functions/smoke-test-runner/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Enhanced logger with structured logging
const logger = {
  log: (level: string, message: string, meta?: any) => {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      function: 'smoke-test-runner',
      ...meta
    };
    console.log(JSON.stringify(logEntry));
  }
};

// Main request handler
async function handleRequest(req: Request) {
  try {
    const { method } = req;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { 
        status: 200, 
        headers: corsHeaders 
      });
    }

    logger.log('info', 'Starting smoke test validation', { 
      method,
      url: req.url 
    });

    // Parse request parameters
    let test_suite = 'full';
    if (method === 'POST') {
      try {
        const body = await req.json();
        test_suite = body.test_suite || 'full';
      } catch {
        // Use default if JSON parsing fails
      }
    }

    // Run the smoke tests with validation
    const testResults = await runSmokeTestsWithValidation();

    return new Response(
      JSON.stringify({
        success: testResults.status === 'success',
        status: testResults.status,
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        test_suite,
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

// Static analysis validation of Edge Function structure
async function validateEdgeFunctionStructure(filePath: string) {
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
    // Read the function file as text
    const functionCode = await Deno.readTextFile(filePath);

    // Check for Deno.serve() pattern
    const denoServePattern = /Deno\.serve\s*\(/;
    patterns.hasDenoServe = denoServePattern.test(functionCode);
    if (!patterns.hasDenoServe) {
      issues.push('Missing Deno.serve() call - Edge Function must use Deno.serve()');
    }

    // Check for handler function (async function or arrow function)
    const handlerPattern = /(?:async\s+function|async\s*\(|\(\s*req\s*:?\s*Request|\(req:\s*Request)/;
    patterns.hasHandlerFunction = handlerPattern.test(functionCode);
    if (!patterns.hasHandlerFunction) {
      issues.push('No handler function detected - Edge Function needs a request handler');
    }

    // Check for Response return
    const responsePattern = /(?:new\s+Response\s*\(|return\s+new\s+Response|:\s*Response|:\s*Promise\s*<\s*Response)/;
    patterns.hasResponseReturn = responsePattern.test(functionCode);
    if (!patterns.hasResponseReturn) {
      warnings.push('No Response object detected - Handler should return Response or Promise<Response>');
    }

    // Check for CORS headers
    const corsPattern = /(?:Access-Control-Allow-Origin|corsHeaders)/;
    patterns.hasCorsHeaders = corsPattern.test(functionCode);
    if (!patterns.hasCorsHeaders) {
      warnings.push('No CORS headers detected - Consider adding CORS support');
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

    // Check for basic syntax errors by looking for common patterns
    const uncommentedCode = functionCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    
    // Check for balanced braces
    const openBraces = (uncommentedCode.match(/\{/g) || []).length;
    const closeBraces = (uncommentedCode.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      issues.push(`Syntax issue: Unbalanced braces (${openBraces} opening, ${closeBraces} closing)`);
    }

    // Check for balanced parentheses
    const openParens = (uncommentedCode.match(/\(/g) || []).length;
    const closeParens = (uncommentedCode.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      warnings.push(`Possible syntax issue: Unbalanced parentheses (${openParens} opening, ${closeParens} closing)`);
    }

    // Validate Deno.serve structure more thoroughly
    if (patterns.hasDenoServe) {
      // Check if Deno.serve has a handler function
      const serveWithHandlerPattern = /Deno\.serve\s*\(\s*(?:async\s*)?\s*(?:function|\(|\{)/;
      if (!serveWithHandlerPattern.test(functionCode)) {
        warnings.push('Deno.serve() may not have a proper handler function');
      }

      // Check if handler accepts Request parameter
      const serveRequestPattern = /Deno\.serve\s*\([^)]*(?:req|request)\s*:\s*Request/i;
      if (!serveRequestPattern.test(functionCode)) {
        warnings.push('Handler function should accept a Request parameter');
      }
    }

    // Check for async/await usage
    const hasAsync = /async\s+/.test(functionCode);
    const hasAwait = /await\s+/.test(functionCode);
    if (hasAwait && !hasAsync) {
      issues.push('Code uses await but no async function detected');
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
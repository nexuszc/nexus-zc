import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Logger utility
const logger = {
  log: (level: string, message: string, data?: any) => {
    console.log(JSON.stringify({
      level,
      message,
      data,
      timestamp: new Date().toISOString()
    }));
  }
};

// Main request handler
async function handleRequest(req: Request): Promise<Response> {
  const { method, url } = req;
  const requestUrl = new URL(url);
  
  logger.log('info', 'Processing request', {
    method,
    path: requestUrl.pathname,
    origin: requestUrl.origin
  });

  try {
    // Run smoke tests with validation
    const results = await runSmokeTestsWithValidation();
    
    logger.log('info', 'Smoke tests completed', {
      status: results.status,
      summary: results.summary
    });

    return new Response(
      JSON.stringify({
        success: results.status === 'success',
        ...results
      }),
      {
        status: results.status === 'error' ? 500 : 200,
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
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      }
    );
  }
}

// Static analysis validation for Edge Function structure
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
    // Read the function file content
    const functionCode = await Deno.readTextFile(filePath);

    // Check for Deno.serve() pattern
    patterns.hasDenoServe = /Deno\.serve\s*\(/.test(functionCode);
    if (!patterns.hasDenoServe) {
      issues.push('Missing Deno.serve() - Edge Function must use Deno.serve() as entry point');
    }

    // Check for handler function that accepts Request
    patterns.hasHandlerFunction = /(?:async\s+)?(?:function|\([^)]*\)|\w+)\s*(?:\([^)]*Request[^)]*\)|=>)/.test(functionCode);
    if (!patterns.hasHandlerFunction) {
      warnings.push('No clear handler function accepting Request parameter found');
    }

    // Check for Response return
    patterns.hasResponseReturn = /new\s+Response\s*\(/.test(functionCode) || /return\s+.*Response/.test(functionCode);
    if (!patterns.hasResponseReturn) {
      issues.push('No Response object creation found - handler must return a Response');
    }

    // Check for CORS headers
    patterns.hasCorsHeaders = /Access-Control-Allow-Origin/.test(functionCode) || /corsHeaders/.test(functionCode);
    if (!patterns.hasCorsHeaders) {
      warnings.push('CORS headers not detected - may cause cross-origin issues');
    }

    // Check for error handling
    patterns.hasErrorHandling = /try\s*\{/.test(functionCode) && /catch\s*\(/.test(functionCode);
    if (!patterns.hasErrorHandling) {
      warnings.push('No try-catch error handling detected');
    }

    // Validate import statements
    const importPattern = /import\s+.*\s+from\s+['"].*['"]/g;
    const imports = functionCode.match(importPattern) || [];
    if (imports.length === 0) {
      warnings.push('No import statements found - function may lack dependencies');
    }

    // Check for common syntax issues
    const uncommentedCode = functionCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    
    // Check for unbalanced braces
    const openBraces = (uncommentedCode.match(/\{/g) || []).length;
    const closeBraces = (uncommentedCode.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      issues.push(`Syntax issue: Unbalanced braces (${openBraces} opening, ${closeBraces} closing)`);
    }

    // Check for unbalanced parentheses
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

    // Check for OPTIONS method handling (CORS preflight)
    const hasOptionsHandling = /method\s*===?\s*['"]OPTIONS['"]/.test(functionCode) || /OPTIONS/.test(functionCode);
    if (!hasOptionsHandling && patterns.hasCorsHeaders) {
      warnings.push('CORS headers present but no OPTIONS method handling detected');
    }

    // Check for proper content-type headers
    const hasContentType = /Content-Type/.test(functionCode) || /content-type/.test(functionCode);
    if (!hasContentType) {
      warnings.push('No Content-Type header detected in responses');
    }

    // Validate response status codes
    const statusPattern = /status\s*:\s*(\d+)/g;
    const statusCodes = [...functionCode.matchAll(statusPattern)].map(m => parseInt(m[1]));
    if (statusCodes.length === 0) {
      warnings.push('No explicit status codes found in responses');
    } else {
      const validStatuses = statusCodes.every(code => code >= 100 && code < 600);
      if (!validStatuses) {
        issues.push('Invalid HTTP status code detected');
      }
    }

    // Check for environment variable usage patterns
    const hasEnvUsage = /Deno\.env\.get/.test(functionCode) || /process\.env/.test(functionCode);
    if (hasEnvUsage) {
      // Check if there's error handling for missing env vars
      const hasEnvValidation = /if\s*\(.*env/i.test(functionCode) || /\?\?/.test(functionCode);
      if (!hasEnvValidation) {
        warnings.push('Environment variables used without validation checks');
      }
    }

    // Check for JSON parsing with error handling
    const hasJsonParsing = /\.json\(\)/.test(functionCode) || /JSON\.parse/.test(functionCode);
    if (hasJsonParsing && !patterns.hasErrorHandling) {
      warnings.push('JSON parsing detected without try-catch error handling');
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
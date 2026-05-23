import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Logger utility
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
async function handleRequest(req: Request): Promise<Response> {
  try {
    const { method } = req;
    
    if (method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // Run smoke tests with validation
    const results = await runSmokeTestsWithValidation();

    return new Response(
      JSON.stringify({
        success: results.status === 'success',
        status: results.status,
        timestamp: new Date().toISOString(),
        function: 'smoke-test-runner',
        ...results
      }),
      {
        status: 200,
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
    // Read the function file as text instead of importing
    const functionCode = await Deno.readTextFile(filePath);

    // Check for Deno.serve() pattern
    patterns.hasDenoServe = /Deno\.serve\s*\(/i.test(functionCode);
    if (!patterns.hasDenoServe) {
      issues.push('Missing Deno.serve() - Edge Function must use Deno.serve() as entry point');
    }

    // Check for handler function (async function that takes Request)
    const handlerPattern = /(async\s+function.*?\(.*?req(?:uest)?.*?:.*?Request.*?\)|async\s*\(.*?req(?:uest)?.*?:.*?Request.*?\)\s*=>|\(.*?req(?:uest)?.*?:.*?Request.*?\)\s*=>\s*\{)/i;
    patterns.hasHandlerFunction = handlerPattern.test(functionCode);
    if (!patterns.hasHandlerFunction) {
      warnings.push('No clear async handler function with Request parameter found');
    }

    // Check for Response return pattern
    patterns.hasResponseReturn = /new\s+Response\s*\(/i.test(functionCode) || /return.*Response/i.test(functionCode);
    if (!patterns.hasResponseReturn) {
      issues.push('Missing Response object creation - handlers must return Response objects');
    }

    // Check for CORS headers
    patterns.hasCorsHeaders = /Access-Control-Allow-Origin/i.test(functionCode) || /corsHeaders/i.test(functionCode);
    if (!patterns.hasCorsHeaders) {
      warnings.push('No CORS headers detected - may cause cross-origin issues');
    }

    // Check for error handling (try-catch blocks)
    patterns.hasErrorHandling = /try\s*\{[\s\S]*?\}\s*catch/i.test(functionCode);
    if (!patterns.hasErrorHandling) {
      warnings.push('No try-catch error handling detected');
    }

    // Check for OPTIONS method handling (CORS preflight)
    const hasOptionsHandling = /method\s*===?\s*['"]OPTIONS['"]/i.test(functionCode) || /OPTIONS.*?Response/i.test(functionCode);
    if (!hasOptionsHandling) {
      warnings.push('No OPTIONS method handling for CORS preflight requests');
    }

    // Check for status codes in responses
    const statusPattern = /status:\s*(\d+)/g;
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

    // Check for basic TypeScript syntax errors
    const syntaxChecks = [
      { pattern: /\bawait\b(?!\s+\w+\s*\()/g, message: 'Potential await usage without function call' },
      { pattern: /function\s+\w+\s*\([^)]*\)\s*\{(?!\s*return)/g, message: 'Function may be missing return statement' }
    ];

    for (const check of syntaxChecks) {
      if (check.pattern.test(functionCode)) {
        warnings.push(check.message);
      }
    }

    // Validate that Deno.serve is called at the top level (not nested deeply)
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
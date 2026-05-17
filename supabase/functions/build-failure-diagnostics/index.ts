import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface BuildFailure {
  function_name: string;
  error_message: string;
  stack_trace?: string;
  timestamp: string;
}

interface Diagnostic {
  issue: string;
  severity: 'error' | 'warning';
  suggestion: string;
}

interface DiagnosticResult {
  function_name: string;
  diagnostics: Diagnostic[];
  has_syntax_errors: boolean;
  has_import_errors: boolean;
  suggested_fixes: string[];
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: 'Missing Supabase configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { failure }: { failure: BuildFailure } = await req.json();

    if (!failure || !failure.function_name || !failure.error_message) {
      return new Response(
        JSON.stringify({ error: 'Invalid request body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const diagnostics: Diagnostic[] = [];
    const suggestedFixes: string[] = [];
    let hasSyntaxErrors = false;
    let hasImportErrors = false;

    const errorMsg = failure.error_message.toLowerCase();
    const stackTrace = failure.stack_trace?.toLowerCase() || '';

    if (errorMsg.includes('syntax error') || errorMsg.includes('unexpected token')) {
      hasSyntaxErrors = true;
      diagnostics.push({
        issue: 'Syntax error detected',
        severity: 'error',
        suggestion: 'Check for missing brackets, parentheses, or semicolons'
      });
      suggestedFixes.push('Review code syntax and formatting');
      suggestedFixes.push('Validate TypeScript/JavaScript syntax');
    }

    if (errorMsg.includes('cannot find module') || errorMsg.includes('import') || errorMsg.includes('require')) {
      hasImportErrors = true;
      diagnostics.push({
        issue: 'Import/module error detected',
        severity: 'error',
        suggestion: 'Verify import paths and package availability'
      });
      suggestedFixes.push('Check import statements for correct paths');
      suggestedFixes.push('Ensure all dependencies are specified with version numbers');
      suggestedFixes.push('Use esm.sh URLs for external packages');
    }

    if (errorMsg.includes('deno.serve') || !errorMsg.includes('serve')) {
      diagnostics.push({
        issue: 'Missing or invalid Deno.serve() wrapper',
        severity: 'error',
        suggestion: 'Wrap function logic with Deno.serve((req) => { ... })'
      });
      suggestedFixes.push('Add Deno.serve() entry point');
      suggestedFixes.push('Ensure function returns a Response object');
    }

    if (errorMsg.includes('cors') || errorMsg.includes('cross-origin')) {
      diagnostics.push({
        issue: 'CORS configuration issue',
        severity: 'warning',
        suggestion: 'Add proper CORS headers to Response'
      });
      suggestedFixes.push('Include CORS headers in response');
    }

    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
      diagnostics.push({
        issue: 'Function timeout',
        severity: 'error',
        suggestion: 'Optimize function execution time or increase timeout limit'
      });
      suggestedFixes.push('Review async operations and await statements');
      suggestedFixes.push('Check for infinite loops or long-running processes');
    }

    if (errorMsg.includes('permission') || errorMsg.includes('denied')) {
      diagnostics.push({
        issue: 'Permission error',
        severity: 'error',
        suggestion: 'Verify environment variables and access permissions'
      });
      suggestedFixes.push('Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
      suggestedFixes.push('Ensure proper service role permissions');
    }

    if (diagnostics.length === 0) {
      diagnostics.push({
        issue: 'Unknown error',
        severity: 'error',
        suggestion: 'Review error message and stack trace for details'
      });
      suggestedFixes.push('Check function logs for additional context');
      suggestedFixes.push('Verify all dependencies and imports');
    }

    const result: DiagnosticResult = {
      function_name: failure.function_name,
      diagnostics,
      has_syntax_errors: hasSyntaxErrors,
      has_import_errors: hasImportErrors,
      suggested_fixes: suggestedFixes
    };

    await supabase.from('build_diagnostics').insert({
      function_name: failure.function_name,
      error_message: failure.error_message,
      diagnostics: result,
      created_at: new Date().toISOString()
    });

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
        } 
      }
    );

  } catch (error) {
    console.error('Error in build-failure-diagnostics:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );
  }
});
Deno.serve(async (req) => {
  try {
    const { functionName, error, timestamp } = await req.json();
    
    const diagnostics = {
      function: functionName,
      error: error,
      timestamp: timestamp || new Date().toISOString(),
      suggestions: [] as string[],
      status: 'analyzed'
    };
    
    if (error?.includes('smoke_test_failed')) {
      diagnostics.suggestions.push(
        'Wrap function in Deno.serve() handler',
        'Ensure function returns Response object',
        'Check function exports default handler'
      );
    }
    
    if (error?.includes('ImportError') || error?.includes('Module not found')) {
      diagnostics.suggestions.push(
        'Verify import paths use Deno-compatible URLs',
        'Check for missing npm: or https: prefixes in imports',
        'Ensure all dependencies are properly declared'
      );
    }
    
    if (error?.includes('timeout') || error?.includes('TIMEOUT')) {
      diagnostics.suggestions.push(
        'Check for long-running operations',
        'Add proper timeout handling',
        'Consider using background jobs for heavy processing'
      );
    }
    
    if (error?.includes('authentication') || error?.includes('unauthorized')) {
      diagnostics.suggestions.push(
        'Verify Supabase client initialization',
        'Check JWT token handling',
        'Ensure proper CORS headers are set'
      );
    }
    
    return new Response(JSON.stringify(diagnostics), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      status: 200
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Failed to process diagnostics request',
      details: err instanceof Error ? err.message : 'Unknown error',
      status: 'error'
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      status: 500
    });
  }
});
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

async function testImports(): Promise<{ [key: string]: boolean }> {
  const results: { [key: string]: boolean } = {};
  
  try {
    await import('https://esm.sh/@supabase/supabase-js@2.39.3');
    results.supabaseClient = true;
  } catch (error) {
    results.supabaseClient = false;
  }

  try {
    await import('https://deno.land/x/cors@v1.2.2/mod.ts');
    results.cors = true;
  } catch (error) {
    results.cors = false;
  }

  return results;
}

async function checkSyntax(functionName: string): Promise<{ [key: string]: any }> {
  const syntaxChecks: { [key: string]: any } = {
    functionName,
    status: 'unknown'
  };

  try {
    const functionPaths = [
      'content-ingestion-gateway',
      'semantic-processing',
      'vector-storage',
      'cross-reference-engine',
      'query-resolver',
      'notification-dispatcher',
      'analytics-aggregator',
      'health-monitor'
    ];

    if (functionName === 'all') {
      syntaxChecks.status = 'checked_all';
      syntaxChecks.availableFunctions = functionPaths;
    } else if (functionPaths.includes(functionName)) {
      syntaxChecks.status = 'valid';
      syntaxChecks.function = functionName;
    } else {
      syntaxChecks.status = 'unknown_function';
      syntaxChecks.availableFunctions = functionPaths;
    }
  } catch (error) {
    syntaxChecks.status = 'error';
    syntaxChecks.error = error instanceof Error ? error.message : String(error);
  }

  return syntaxChecks;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const functionName = params.get('function') || 'all';

    const diagnostics = {
      timestamp: new Date().toISOString(),
      functionName,
      checks: {
        denoRuntime: {
          deno: Deno.version.deno,
          v8: Deno.version.v8,
          typescript: Deno.version.typescript
        },
        env: {
          supabaseUrl: !!Deno.env.get('SUPABASE_URL'),
          supabaseKey: !!Deno.env.get('SUPABASE_ANON_KEY'),
          supabaseServiceKey: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        },
        imports: await testImports(),
        syntax: await checkSyntax(functionName)
      },
      recommendations: [] as string[]
    };

    if (!diagnostics.checks.env.supabaseUrl) {
      diagnostics.recommendations.push('Set SUPABASE_URL environment variable');
    }
    if (!diagnostics.checks.env.supabaseKey) {
      diagnostics.recommendations.push('Set SUPABASE_ANON_KEY environment variable');
    }
    if (!diagnostics.checks.env.supabaseServiceKey) {
      diagnostics.recommendations.push('Set SUPABASE_SERVICE_ROLE_KEY environment variable');
    }
    if (!diagnostics.checks.imports.supabaseClient) {
      diagnostics.recommendations.push('Fix Supabase client import');
    }
    if (diagnostics.checks.syntax.status === 'unknown_function') {
      diagnostics.recommendations.push(`Unknown function: ${functionName}. Use 'all' or one of: ${diagnostics.checks.syntax.availableFunctions.join(', ')}`);
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Diagnostics failed',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }, null, 2),
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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({
          error: 'Missing Supabase configuration',
          details: {
            hasUrl: !!supabaseUrl,
            hasAnonKey: !!supabaseAnonKey,
          },
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    const diagnostics: any = {
      timestamp: new Date().toISOString(),
      environment: {
        supabaseUrl,
        hasAnonKey: !!supabaseAnonKey,
        hasServiceRoleKey: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      },
      checks: {},
    }

    try {
      const { data: functions, error: functionsError } = await supabase
        .from('edge_functions')
        .select('*')
        .limit(10)

      diagnostics.checks.edgeFunctionsTable = {
        accessible: !functionsError,
        error: functionsError?.message,
        recordCount: functions?.length || 0,
      }
    } catch (error) {
      diagnostics.checks.edgeFunctionsTable = {
        accessible: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }

    try {
      const { data: errors, error: errorsError } = await supabase
        .from('function_errors')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

      diagnostics.checks.recentErrors = {
        accessible: !errorsError,
        error: errorsError?.message,
        errors: errors || [],
      }
    } catch (error) {
      diagnostics.checks.recentErrors = {
        accessible: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }

    diagnostics.checks.commonIssues = {
      missingEnvVars: !supabaseUrl || !supabaseAnonKey,
      corsIssues: req.headers.get('origin') ? 'Check CORS configuration' : null,
      authIssues: !req.headers.get('authorization') ? 'No auth header present' : null,
    }

    diagnostics.checks.requestInfo = {
      method: req.method,
      url: req.url,
      headers: Object.fromEntries(req.headers.entries()),
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Diagnostic function failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface BuildFailureRequest {
  build_id: string
  error_log: string
  context?: Record<string, unknown>
}

interface DiagnosticResult {
  build_id: string
  error_type: string
  suggested_fix: string
  confidence: number
  additional_details?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const body: BuildFailureRequest = await req.json()

    if (!body.build_id || !body.error_log) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: build_id, error_log' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const diagnostic = analyzeBuildFailure(body.error_log, body.context)

    const { error: insertError } = await supabase
      .from('build_diagnostics')
      .insert({
        build_id: body.build_id,
        error_type: diagnostic.error_type,
        suggested_fix: diagnostic.suggested_fix,
        confidence: diagnostic.confidence,
        additional_details: diagnostic.additional_details,
        analyzed_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error('Error inserting diagnostic:', insertError)
      throw insertError
    }

    const result: DiagnosticResult = {
      build_id: body.build_id,
      error_type: diagnostic.error_type,
      suggested_fix: diagnostic.suggested_fix,
      confidence: diagnostic.confidence,
      additional_details: diagnostic.additional_details,
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error in build-failure-diagnostics:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
})

function analyzeBuildFailure(
  errorLog: string,
  context?: Record<string, unknown>
): Omit<DiagnosticResult, 'build_id'> {
  const lowerLog = errorLog.toLowerCase()

  if (lowerLog.includes('module not found') || lowerLog.includes('cannot find module')) {
    return {
      error_type: 'MISSING_DEPENDENCY',
      suggested_fix: 'Run npm install or yarn install to ensure all dependencies are installed. Check package.json for missing packages.',
      confidence: 0.9,
      additional_details: {
        category: 'dependency',
        severity: 'high',
      },
    }
  }

  if (lowerLog.includes('syntax error') || lowerLog.includes('unexpected token')) {
    return {
      error_type: 'SYNTAX_ERROR',
      suggested_fix: 'Review the code for syntax errors. Check for missing brackets, semicolons, or incorrect syntax.',
      confidence: 0.85,
      additional_details: {
        category: 'code',
        severity: 'high',
      },
    }
  }

  if (lowerLog.includes('out of memory') || lowerLog.includes('heap out of memory')) {
    return {
      error_type: 'MEMORY_ERROR',
      suggested_fix: 'Increase memory allocation using NODE_OPTIONS=--max-old-space-size=4096 or optimize build process.',
      confidence: 0.95,
      additional_details: {
        category: 'resource',
        severity: 'critical',
      },
    }
  }

  if (lowerLog.includes('econnrefused') || lowerLog.includes('network error')) {
    return {
      error_type: 'NETWORK_ERROR',
      suggested_fix: 'Check network connectivity and ensure external services are accessible. Verify firewall settings.',
      confidence: 0.8,
      additional_details: {
        category: 'network',
        severity: 'medium',
      },
    }
  }

  if (lowerLog.includes('permission denied') || lowerLog.includes('eacces')) {
    return {
      error_type: 'PERMISSION_ERROR',
      suggested_fix: 'Check file and directory permissions. Ensure the build process has necessary access rights.',
      confidence: 0.9,
      additional_details: {
        category: 'permissions',
        severity: 'medium',
      },
    }
  }

  if (lowerLog.includes('port') && lowerLog.includes('already in use')) {
    return {
      error_type: 'PORT_CONFLICT',
      suggested_fix: 'The specified port is already in use. Change the port configuration or stop the conflicting process.',
      confidence: 0.95,
      additional_details: {
        category: 'configuration',
        severity: 'medium',
      },
    }
  }

  return {
    error_type: 'UNKNOWN_ERROR',
    suggested_fix: 'Review the full error log for details. Consider checking documentation or consulting with the development team.',
    confidence: 0.5,
    additional_details: {
      category: 'unknown',
      severity: 'unknown',
      context,
    },
  }
}
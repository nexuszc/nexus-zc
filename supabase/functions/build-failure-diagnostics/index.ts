import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface BuildContext {
  functionName?: string
  deploymentId?: string
  errorMessage?: string
  timestamp?: string
}

interface DiagnosticResult {
  failureType: string
  suggestedFixes: string[]
  relevantLogs: string[]
  detectedIssues: string[]
}

const COMMON_PATTERNS = [
  {
    pattern: /Deno\.serve/i,
    type: 'missing_deno_serve',
    fix: 'Wrap your handler in Deno.serve((req) => { ... })',
    detect: (content: string) => !content.includes('Deno.serve')
  },
  {
    pattern: /import.*from.*['"](\.\.?\/|https?:\/\/)/,
    type: 'import_error',
    fix: 'Check import paths and use proper Deno imports (https://esm.sh/ or https://deno.land/x/)',
    detect: (content: string) => /import.*from\s+['"][^'"]*['"]/.test(content)
  },
  {
    pattern: /timeout|timed out/i,
    type: 'timeout_error',
    fix: 'Optimize function execution time or increase timeout limits',
    detect: (error: string) => /timeout|timed out/i.test(error)
  },
  {
    pattern: /cors/i,
    type: 'cors_error',
    fix: 'Add proper CORS headers to response',
    detect: (error: string) => /cors/i.test(error)
  },
  {
    pattern: /module not found|cannot find module/i,
    type: 'module_not_found',
    fix: 'Verify all imports are accessible and use full URLs for external dependencies',
    detect: (error: string) => /module not found|cannot find module/i.test(error)
  },
  {
    pattern: /syntax error/i,
    type: 'syntax_error',
    fix: 'Review code for TypeScript/JavaScript syntax errors',
    detect: (error: string) => /syntax error/i.test(error)
  }
]

function analyzeBuildFailure(context: BuildContext): DiagnosticResult {
  const suggestedFixes: string[] = []
  const detectedIssues: string[] = []
  let failureType = 'unknown_error'

  const errorMessage = context.errorMessage || ''

  for (const pattern of COMMON_PATTERNS) {
    if (pattern.detect(errorMessage)) {
      failureType = pattern.type
      suggestedFixes.push(pattern.fix)
      detectedIssues.push(`Detected: ${pattern.type.replace(/_/g, ' ')}`)
    }
  }

  if (suggestedFixes.length === 0) {
    suggestedFixes.push(
      'Check deployment logs for specific error messages',
      'Verify all imports are using proper Deno-compatible URLs',
      'Ensure the function exports a Deno.serve() handler',
      'Review function permissions and environment variables'
    )
  }

  const relevantLogs = [
    errorMessage || 'No error message provided',
    `Function: ${context.functionName || 'unknown'}`,
    `Timestamp: ${context.timestamp || new Date().toISOString()}`
  ]

  return {
    failureType,
    suggestedFixes,
    relevantLogs,
    detectedIssues
  }
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const context: BuildContext = await req.json()

    if (!context.functionName && !context.errorMessage) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields: functionName or errorMessage'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const diagnostics = analyzeBuildFailure(context)

    const authHeader = req.headers.get('Authorization')
    if (authHeader && context.deploymentId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
        
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey)
          
          await supabase.from('build_diagnostics').insert({
            deployment_id: context.deploymentId,
            function_name: context.functionName,
            failure_type: diagnostics.failureType,
            error_message: context.errorMessage,
            detected_issues: diagnostics.detectedIssues,
            suggested_fixes: diagnostics.suggestedFixes,
            created_at: new Date().toISOString()
          })
        }
      } catch (dbError) {
        console.error('Failed to log diagnostics to database:', dbError)
      }
    }

    return new Response(JSON.stringify(diagnostics), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Diagnostic function error:', error)
    
    return new Response(
      JSON.stringify({
        error: 'Failed to process diagnostic request',
        message: error instanceof Error ? error.message : 'Unknown error',
        failureType: 'diagnostic_error',
        suggestedFixes: [
          'Verify request payload is valid JSON',
          'Check that required fields are present',
          'Review function logs for detailed error information'
        ]
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DiagnosticResult {
  success: boolean
  diagnostics?: {
    error_patterns: string[]
    dependency_issues: string[]
    deployment_checks: string[]
    recommendations: string[]
  }
  error?: string
}

const commonErrorPatterns = [
  {
    pattern: /module not found/i,
    message: 'Module import error detected',
    recommendation: 'Check package.json dependencies and import paths'
  },
  {
    pattern: /typescript.*error/i,
    message: 'TypeScript compilation error',
    recommendation: 'Review type definitions and tsconfig.json settings'
  },
  {
    pattern: /memory.*exceeded/i,
    message: 'Memory limit exceeded during build',
    recommendation: 'Optimize bundle size or increase memory allocation'
  },
  {
    pattern: /timeout/i,
    message: 'Build timeout detected',
    recommendation: 'Reduce build complexity or optimize build steps'
  },
  {
    pattern: /enoent|file not found/i,
    message: 'File or directory not found',
    recommendation: 'Verify all required files are committed to repository'
  }
]

const dependencyChecks = [
  'Verify all dependencies in package.json',
  'Check for conflicting peer dependencies',
  'Ensure lock file is up to date',
  'Validate Node.js version compatibility'
]

const deploymentChecks = [
  'Confirm environment variables are properly set',
  'Verify build command configuration',
  'Check output directory settings',
  'Review deployment logs for specific errors'
]

function analyzeBuildFailure(errorLog: string): DiagnosticResult {
  const error_patterns: string[] = []
  const recommendations: string[] = []

  commonErrorPatterns.forEach(({ pattern, message, recommendation }) => {
    if (pattern.test(errorLog)) {
      error_patterns.push(message)
      recommendations.push(recommendation)
    }
  })

  if (error_patterns.length === 0) {
    error_patterns.push('No specific error pattern detected')
    recommendations.push('Review complete build logs for detailed error information')
  }

  return {
    success: true,
    diagnostics: {
      error_patterns,
      dependency_issues: dependencyChecks,
      deployment_checks: deploymentChecks,
      recommendations
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { build_id, error_log } = await req.json()

    if (!build_id || !error_log) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing build_id or error_log' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const result = analyzeBuildFailure(error_log)

    const { error: insertError } = await supabaseClient
      .from('build_diagnostics')
      .insert({
        build_id,
        user_id: user.id,
        diagnostics: result.diagnostics
      })

    if (insertError) {
      console.error('Error saving diagnostics:', insertError)
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in build-failure-diagnostics:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
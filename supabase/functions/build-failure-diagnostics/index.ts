import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface BuildFailure {
  id: string
  project_id: string
  error_message: string
  error_type: string
  stack_trace?: string
  build_log?: string
  timestamp: string
  context?: Record<string, any>
}

interface DiagnosticResult {
  failure_id: string
  root_cause: string
  recommended_fix: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  related_issues: string[]
  documentation_links: string[]
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const { failure_id, auto_analyze } = await req.json()

    if (!failure_id) {
      return new Response(
        JSON.stringify({ error: 'failure_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: failure, error: fetchError } = await supabaseClient
      .from('build_failures')
      .select('*')
      .eq('id', failure_id)
      .single()

    if (fetchError || !failure) {
      return new Response(
        JSON.stringify({ error: 'Build failure not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const diagnostics = analyzeBuildFailure(failure)

    if (auto_analyze) {
      await supabaseClient
        .from('build_diagnostics')
        .insert({
          failure_id: failure.id,
          root_cause: diagnostics.root_cause,
          recommended_fix: diagnostics.recommended_fix,
          severity: diagnostics.severity,
          related_issues: diagnostics.related_issues,
          documentation_links: diagnostics.documentation_links,
        })
    }

    return new Response(
      JSON.stringify(diagnostics),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function analyzeBuildFailure(failure: BuildFailure): DiagnosticResult {
  const errorMessage = failure.error_message?.toLowerCase() || ''
  const errorType = failure.error_type?.toLowerCase() || ''
  const stackTrace = failure.stack_trace?.toLowerCase() || ''
  const buildLog = failure.build_log?.toLowerCase() || ''

  const allText = `${errorMessage} ${errorType} ${stackTrace} ${buildLog}`

  if (allText.includes('module not found') || allText.includes('cannot find module')) {
    return {
      failure_id: failure.id,
      root_cause: 'Missing dependency or incorrect import path',
      recommended_fix: 'Run npm install or yarn install. Check import paths and package.json dependencies.',
      severity: 'high',
      related_issues: ['dependency_missing', 'import_error'],
      documentation_links: [
        'https://docs.npmjs.com/cli/install',
        'https://nodejs.org/api/modules.html',
      ],
    }
  }

  if (allText.includes('out of memory') || allText.includes('heap out of memory')) {
    return {
      failure_id: failure.id,
      root_cause: 'Build process ran out of memory',
      recommended_fix: 'Increase Node.js memory limit with NODE_OPTIONS=--max-old-space-size=4096 or optimize build process.',
      severity: 'critical',
      related_issues: ['memory_limit', 'resource_exhaustion'],
      documentation_links: [
        'https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-megabytes',
      ],
    }
  }

  if (allText.includes('syntax error') || allText.includes('unexpected token')) {
    return {
      failure_id: failure.id,
      root_cause: 'JavaScript/TypeScript syntax error in source code',
      recommended_fix: 'Review the code at the line number mentioned in the error. Check for missing brackets, semicolons, or invalid syntax.',
      severity: 'high',
      related_issues: ['syntax_error', 'parse_error'],
      documentation_links: [
        'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors',
      ],
    }
  }

  if (allText.includes('enoent') || allText.includes('no such file or directory')) {
    return {
      failure_id: failure.id,
      root_cause: 'File or directory not found',
      recommended_fix: 'Verify that all referenced files exist in the project. Check file paths and working directory.',
      severity: 'medium',
      related_issues: ['file_not_found', 'path_error'],
      documentation_links: [
        'https://nodejs.org/api/errors.html#common-system-errors',
      ],
    }
  }

  if (allText.includes('permission denied') || allText.includes('eacces')) {
    return {
      failure_id: failure.id,
      root_cause: 'Permission denied accessing file or directory',
      recommended_fix: 'Check file permissions. Run with appropriate user permissions or use sudo if necessary.',
      severity: 'medium',
      related_issues: ['permission_error', 'access_denied'],
      documentation_links: [
        'https://nodejs.org/api/errors.html#common-system-errors',
      ],
    }
  }

  if (allText.includes('typescript') || allText.includes('ts(')) {
    return {
      failure_id: failure.id,
      root_cause: 'TypeScript compilation error',
      recommended_fix: 'Fix TypeScript errors reported by the compiler. Check types, interfaces, and tsconfig.json configuration.',
      severity: 'high',
      related_issues: ['typescript_error', 'type_error'],
      documentation_links: [
        'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html',
      ],
    }
  }

  if (allText.includes('eslint') || allText.includes('lint')) {
    return {
      failure_id: failure.id,
      root_cause: 'Linting errors in source code',
      recommended_fix: 'Fix ESLint errors or warnings. Run eslint --fix to auto-fix issues or update ESLint configuration.',
      severity: 'low',
      related_issues: ['lint_error', 'code_quality'],
      documentation_links: [
        'https://eslint.org/docs/latest/use/getting-started',
      ],
    }
  }

  return {
    failure_id: failure.id,
    root_cause: 'Unknown build failure',
    recommended_fix: 'Review the complete error message and stack trace. Check recent code changes and build configuration.',
    severity: 'medium',
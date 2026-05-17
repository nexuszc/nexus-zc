import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface BuildFailureRequest {
  buildId: string
  error: string
  logs: string
  timestamp: string
  projectId: string
}

interface DiagnosticResponse {
  buildId: string
  failureType: string
  errorContext: string[]
  suggestedFixes: string[]
  similarFailures: any[]
  relevantLogs: string[]
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

    const body: BuildFailureRequest = await req.json()
    const { buildId, error, logs, timestamp, projectId } = body

    const failureType = analyzeFailureType(error, logs)
    const errorContext = extractErrorContext(error, logs)
    const suggestedFixes = generateSuggestedFixes(failureType, error)
    const relevantLogs = extractRelevantLogs(logs, error)

    const { data: similarFailures } = await supabaseClient
      .from('build_failures')
      .select('*')
      .eq('project_id', projectId)
      .eq('failure_type', failureType)
      .order('created_at', { ascending: false })
      .limit(5)

    await supabaseClient.from('build_failures').insert({
      build_id: buildId,
      project_id: projectId,
      failure_type: failureType,
      error_message: error,
      logs: logs,
      created_at: timestamp,
    })

    const response: DiagnosticResponse = {
      buildId,
      failureType,
      errorContext,
      suggestedFixes,
      similarFailures: similarFailures || [],
      relevantLogs,
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

function analyzeFailureType(error: string, logs: string): string {
  const errorLower = error.toLowerCase()
  const logsLower = logs.toLowerCase()

  if (errorLower.includes('dependency') || logsLower.includes('npm install')) {
    return 'dependency_error'
  }
  if (errorLower.includes('syntax') || errorLower.includes('parse')) {
    return 'syntax_error'
  }
  if (errorLower.includes('memory') || errorLower.includes('heap')) {
    return 'memory_error'
  }
  if (errorLower.includes('timeout')) {
    return 'timeout_error'
  }
  if (errorLower.includes('permission') || errorLower.includes('access denied')) {
    return 'permission_error'
  }
  if (errorLower.includes('network') || errorLower.includes('connection')) {
    return 'network_error'
  }
  if (errorLower.includes('test') || logsLower.includes('test failed')) {
    return 'test_failure'
  }
  if (errorLower.includes('type') || errorLower.includes('typescript')) {
    return 'type_error'
  }

  return 'unknown_error'
}

function extractErrorContext(error: string, logs: string): string[] {
  const context: string[] = []
  const logLines = logs.split('\n')
  const errorLines = error.split('\n')

  context.push(...errorLines.slice(0, 3))

  const errorIndex = logLines.findIndex(line => 
    line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')
  )

  if (errorIndex !== -1) {
    const start = Math.max(0, errorIndex - 2)
    const end = Math.min(logLines.length, errorIndex + 3)
    context.push(...logLines.slice(start, end))
  }

  return context.filter(line => line.trim().length > 0).slice(0, 10)
}

function generateSuggestedFixes(failureType: string, error: string): string[] {
  const fixes: string[] = []

  switch (failureType) {
    case 'dependency_error':
      fixes.push('Clear node_modules and package-lock.json, then reinstall dependencies')
      fixes.push('Check for version conflicts in package.json')
      fixes.push('Verify npm registry is accessible')
      break
    case 'syntax_error':
      fixes.push('Review recent code changes for syntax issues')
      fixes.push('Run linter to identify syntax problems')
      fixes.push('Check for missing brackets or semicolons')
      break
    case 'memory_error':
      fixes.push('Increase Node.js memory limit with --max-old-space-size')
      fixes.push('Optimize build process to reduce memory usage')
      fixes.push('Check for memory leaks in build scripts')
      break
    case 'timeout_error':
      fixes.push('Increase build timeout duration')
      fixes.push('Optimize slow build steps')
      fixes.push('Check for hanging processes or network delays')
      break
    case 'permission_error':
      fixes.push('Verify file and directory permissions')
      fixes.push('Check user access rights')
      fixes.push('Ensure proper environment configuration')
      break
    case 'network_error':
      fixes.push('Check network connectivity')
      fixes.push('Verify firewall and proxy settings')
      fixes.push('Try using a different registry or mirror')
      break
    case 'test_failure':
      fixes.push('Review failing test output')
      fixes.push('Update test assertions if expected behavior changed')
      fixes.push('Check for environmental issues affecting tests')
      break
    case 'type_error':
      fixes.push('Run TypeScript compiler to see full error details')
      fixes.push('Update type definitions')
      fixes.push('Check for missing or incorrect type annotations')
      break
    default:
      fixes.push('Review complete build logs for details')
      fixes.push('Check recent code changes')
      fixes.push('Verify environment configuration')
  }

  return fixes
}

function extractRelevantLogs(logs: string, error: string): string[] {
  const logLines = logs.split('\n')
  const relevant: string[] = []

  const keywords = ['error', 'fail', 'warning', 'exception', 'fatal']

  for (const line of logLines) {
    const lineLower = line.toLowerCase()
    if (keywords.some(keyword => lineLower.includes(keyword))) {
      relevant.push(line)
    }
  }

  return relevant.slice(0, 20)
}
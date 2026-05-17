import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

interface BuildFailure {
  id: string
  project_id: string
  error_message: string
  error_stack?: string
  build_logs?: string
  created_at: string
}

interface DiagnosticResult {
  failure_id: string
  error_type: string
  suggested_fixes: string[]
  related_errors: number
  confidence: number
}

function categorizeError(errorMessage: string, errorStack?: string): string {
  const message = errorMessage.toLowerCase()
  const stack = (errorStack || '').toLowerCase()
  
  if (message.includes('module not found') || message.includes('cannot find module')) {
    return 'MISSING_DEPENDENCY'
  }
  if (message.includes('syntax error') || message.includes('unexpected token')) {
    return 'SYNTAX_ERROR'
  }
  if (message.includes('type error') || message.includes('is not a function')) {
    return 'TYPE_ERROR'
  }
  if (message.includes('memory') || message.includes('heap out of memory')) {
    return 'MEMORY_ERROR'
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'TIMEOUT_ERROR'
  }
  if (message.includes('permission denied') || message.includes('eacces')) {
    return 'PERMISSION_ERROR'
  }
  if (message.includes('network') || message.includes('enotfound') || message.includes('econnrefused')) {
    return 'NETWORK_ERROR'
  }
  
  return 'UNKNOWN_ERROR'
}

function generateSuggestedFixes(errorType: string, errorMessage: string): string[] {
  const fixes: string[] = []
  
  switch (errorType) {
    case 'MISSING_DEPENDENCY':
      const moduleMatch = errorMessage.match(/['"]([^'"]+)['"]/)
      const moduleName = moduleMatch ? moduleMatch[1] : 'the missing module'
      fixes.push(`Install the missing dependency: npm install ${moduleName}`)
      fixes.push('Verify package.json includes all required dependencies')
      fixes.push('Check for typos in import statements')
      break
      
    case 'SYNTAX_ERROR':
      fixes.push('Review recent code changes for syntax errors')
      fixes.push('Check for missing brackets, parentheses, or semicolons')
      fixes.push('Validate JSON files for proper formatting')
      break
      
    case 'TYPE_ERROR':
      fixes.push('Verify function calls match their definitions')
      fixes.push('Check that variables are properly initialized before use')
      fixes.push('Review TypeScript type definitions if applicable')
      break
      
    case 'MEMORY_ERROR':
      fixes.push('Increase Node.js memory limit: NODE_OPTIONS=--max-old-space-size=4096')
      fixes.push('Optimize bundle size and dependencies')
      fixes.push('Check for memory leaks in build scripts')
      break
      
    case 'TIMEOUT_ERROR':
      fixes.push('Increase build timeout in configuration')
      fixes.push('Optimize slow build steps')
      fixes.push('Check network connectivity for package downloads')
      break
      
    case 'PERMISSION_ERROR':
      fixes.push('Check file and directory permissions')
      fixes.push('Run with appropriate user permissions')
      fixes.push('Verify write access to output directories')
      break
      
    case 'NETWORK_ERROR':
      fixes.push('Verify network connectivity')
      fixes.push('Check npm registry accessibility')
      fixes.push('Try using a different package registry or mirror')
      break
      
    default:
      fixes.push('Review complete error logs for more details')
      fixes.push('Search for similar errors in documentation')
      fixes.push('Check recent changes that might have caused the issue')
  }
  
  return fixes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { failure_id } = await req.json()

    if (!failure_id) {
      return new Response(
        JSON.stringify({ error: 'failure_id is required' }),
        { status: 400, headers: corsHeaders }
      )
    }

    const { data: failure, error: fetchError } = await supabase
      .from('build_failures')
      .select('*')
      .eq('id', failure_id)
      .single()

    if (fetchError || !failure) {
      return new Response(
        JSON.stringify({ error: 'Build failure not found' }),
        { status: 404, headers: corsHeaders }
      )
    }

    const buildFailure = failure as BuildFailure
    const errorType = categorizeError(buildFailure.error_message, buildFailure.error_stack)
    const suggestedFixes = generateSuggestedFixes(errorType, buildFailure.error_message)

    const { count: relatedCount } = await supabase
      .from('build_failures')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', buildFailure.project_id)
      .ilike('error_message', `%${buildFailure.error_message.substring(0, 50)}%`)
      .neq('id', failure_id)

    const confidence = errorType === 'UNKNOWN_ERROR' ? 0.3 : 0.8

    const result: DiagnosticResult = {
      failure_id: buildFailure.id,
      error_type: errorType,
      suggested_fixes: suggestedFixes,
      related_errors: relatedCount || 0,
      confidence: confidence,
    }

    const { error: insertError } = await supabase
      .from('build_diagnostics')
      .insert({
        failure_id: buildFailure.id,
        error_type: errorType,
        suggested_fixes: suggestedFixes,
        confidence: confidence,
      })

    if (insertError) {
      console.error('Failed to save diagnostic:', insertError)
    }

    return new Response(
      JSON.stringify(result),
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('Diagnostic error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: corsHeaders }
    )
  }
})
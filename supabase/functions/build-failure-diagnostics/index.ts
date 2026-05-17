import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface BuildError {
  message: string
  file?: string
  line?: number
  column?: number
  stack?: string
}

interface DiagnosticResult {
  patterns: string[]
  suggestions: string[]
  severity: 'error' | 'warning' | 'info'
  affectedFiles: string[]
}

Deno.serve(async (req) => {
  try {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const { buildErrors, buildLog } = await req.json()

    if (!buildErrors && !buildLog) {
      return new Response(
        JSON.stringify({ error: 'Missing buildErrors or buildLog in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const diagnostics: DiagnosticResult = {
      patterns: [],
      suggestions: [],
      severity: 'error',
      affectedFiles: []
    }

    const errors: BuildError[] = Array.isArray(buildErrors) ? buildErrors : []
    const logText = buildLog || ''

    const missingImportPattern = /Cannot find module ['"]([^'"]+)['"]/i
    const typeErrorPattern = /Type ['"]([^'"]+)['"] is not assignable to type ['"]([^'"]+)['"]/i
    const pathErrorPattern = /Cannot find name ['"]([^'"]+)['"]/i
    const circularDepPattern = /Circular dependency detected/i
    const moduleNotFoundPattern = /Module not found: Can't resolve ['"]([^'"]+)['"]/i
    const syntaxErrorPattern = /SyntaxError: (.*)/i

    errors.forEach(error => {
      const msg = error.message || ''
      
      if (missingImportPattern.test(msg) || moduleNotFoundPattern.test(msg)) {
        diagnostics.patterns.push('missing_import')
        const match = msg.match(missingImportPattern) || msg.match(moduleNotFoundPattern)
        if (match) {
          diagnostics.suggestions.push(`Install missing module: ${match[1]}`)
          diagnostics.suggestions.push(`Verify import path is correct: ${match[1]}`)
        }
      }

      if (typeErrorPattern.test(msg)) {
        diagnostics.patterns.push('type_error')
        diagnostics.suggestions.push('Check TypeScript types and interfaces')
        diagnostics.suggestions.push('Ensure proper type casting or type guards')
      }

      if (pathErrorPattern.test(msg)) {
        diagnostics.patterns.push('path_error')
        const match = msg.match(pathErrorPattern)
        if (match) {
          diagnostics.suggestions.push(`Variable or function '${match[1]}' is not defined`)
          diagnostics.suggestions.push('Check imports and exports')
        }
      }

      if (circularDepPattern.test(msg)) {
        diagnostics.patterns.push('circular_dependency')
        diagnostics.suggestions.push('Refactor code to break circular dependencies')
        diagnostics.suggestions.push('Extract shared logic to separate module')
      }

      if (syntaxErrorPattern.test(msg)) {
        diagnostics.patterns.push('syntax_error')
        const match = msg.match(syntaxErrorPattern)
        if (match) {
          diagnostics.suggestions.push(`Fix syntax error: ${match[1]}`)
        }
      }

      if (error.file) {
        if (!diagnostics.affectedFiles.includes(error.file)) {
          diagnostics.affectedFiles.push(error.file)
        }
      }
    })

    if (logText.includes('ENOENT')) {
      diagnostics.patterns.push('missing_file')
      diagnostics.suggestions.push('Check if all required files exist')
    }

    if (logText.includes('EACCES')) {
      diagnostics.patterns.push('permission_error')
      diagnostics.suggestions.push('Check file permissions')
    }

    if (logText.includes('out of memory') || logText.includes('heap out of memory')) {
      diagnostics.patterns.push('memory_error')
      diagnostics.suggestions.push('Increase Node memory limit')
      diagnostics.suggestions.push('Optimize bundle size and dependencies')
    }

    if (logText.includes('ETIMEDOUT') || logText.includes('ECONNREFUSED')) {
      diagnostics.patterns.push('network_error')
      diagnostics.suggestions.push('Check network connectivity')
      diagnostics.suggestions.push('Verify registry URLs are accessible')
    }

    if (diagnostics.patterns.length === 0) {
      diagnostics.patterns.push('unknown_error')
      diagnostics.suggestions.push('Review full build log for details')
      diagnostics.suggestions.push('Check for recent code changes that may have caused the issue')
      diagnostics.severity = 'warning'
    }

    const uniqueSuggestions = [...new Set(diagnostics.suggestions)]
    diagnostics.suggestions = uniqueSuggestions

    return new Response(
      JSON.stringify(diagnostics),
      { 
        status: 200,
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { 
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
})
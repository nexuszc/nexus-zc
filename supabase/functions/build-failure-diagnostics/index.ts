import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BuildError {
  file: string
  line?: number
  message: string
  type: string
}

interface DiagnosticResult {
  errors: BuildError[]
  suggestions: string[]
  affectedFiles: string[]
  hasDenoServe: boolean
  hasCorsIssues: boolean
  hasImportIssues: boolean
}

function analyzeFile(filePath: string, content: string): BuildError[] {
  const errors: BuildError[] = []
  
  if (!content.includes('Deno.serve')) {
    errors.push({
      file: filePath,
      message: 'Missing Deno.serve() wrapper',
      type: 'MISSING_DENO_SERVE'
    })
  }
  
  if (content.includes('export default') && !content.includes('Deno.serve')) {
    errors.push({
      file: filePath,
      message: 'Using export default instead of Deno.serve()',
      type: 'EXPORT_DEFAULT'
    })
  }
  
  const importPattern = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g
  let importMatch
  while ((importMatch = importPattern.exec(content)) !== null) {
    const importPath = importMatch[1]
    if (!importPath.startsWith('https://') && !importPath.startsWith('npm:') && !importPath.startsWith('./') && !importPath.startsWith('../')) {
      errors.push({
        file: filePath,
        message: `Invalid import path: ${importPath}. Use https:// or npm: prefix`,
        type: 'INVALID_IMPORT'
      })
    }
  }
  
  if (!content.includes('Access-Control-Allow-Origin')) {
    errors.push({
      file: filePath,
      message: 'Missing CORS headers',
      type: 'MISSING_CORS'
    })
  }
  
  const lines = content.split('\n')
  lines.forEach((line, index) => {
    if (line.includes('require(')) {
      errors.push({
        file: filePath,
        line: index + 1,
        message: 'Using require() instead of import',
        type: 'COMMONJS_REQUIRE'
      })
    }
    
    if (line.includes('module.exports')) {
      errors.push({
        file: filePath,
        line: index + 1,
        message: 'Using module.exports instead of Deno.serve()',
        type: 'COMMONJS_EXPORT'
      })
    }
  })
  
  return errors
}

function generateSuggestions(errors: BuildError[]): string[] {
  const suggestions: string[] = []
  const errorTypes = new Set(errors.map(e => e.type))
  
  if (errorTypes.has('MISSING_DENO_SERVE')) {
    suggestions.push('Wrap your handler in Deno.serve(async (req) => { ... })')
  }
  
  if (errorTypes.has('EXPORT_DEFAULT')) {
    suggestions.push('Replace export default with Deno.serve() wrapper')
  }
  
  if (errorTypes.has('INVALID_IMPORT')) {
    suggestions.push('Use https:// imports for external packages (e.g., https://esm.sh/@supabase/supabase-js@2.39.3)')
  }
  
  if (errorTypes.has('MISSING_CORS')) {
    suggestions.push('Add CORS headers to handle OPTIONS requests and include them in responses')
  }
  
  if (errorTypes.has('COMMONJS_REQUIRE') || errorTypes.has('COMMONJS_EXPORT')) {
    suggestions.push('Convert CommonJS syntax to ES modules (import/export)')
  }
  
  return suggestions
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { functionName, fileContent } = await req.json()

    if (!functionName) {
      return new Response(
        JSON.stringify({ error: 'functionName is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const errors: BuildError[] = []
    const affectedFiles: string[] = []

    if (fileContent) {
      const fileErrors = analyzeFile(functionName, fileContent)
      errors.push(...fileErrors)
      if (fileErrors.length > 0) {
        affectedFiles.push(functionName)
      }
    }

    const suggestions = generateSuggestions(errors)

    const result: DiagnosticResult = {
      errors,
      suggestions,
      affectedFiles,
      hasDenoServe: fileContent ? fileContent.includes('Deno.serve') : false,
      hasCorsIssues: errors.some(e => e.type === 'MISSING_CORS'),
      hasImportIssues: errors.some(e => e.type === 'INVALID_IMPORT')
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error in build-failure-diagnostics:', error)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        errors: [],
        suggestions: ['Check function syntax and try again'],
        affectedFiles: [],
        hasDenoServe: false,
        hasCorsIssues: false,
        hasImportIssues: false
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { corsHeaders } from '../_shared/cors.ts'

interface BuildFailure {
  error_message: string
  stack_trace?: string
  build_log?: string
  project_id?: string
  deployment_id?: string
}

interface DiagnosticReport {
  issue_type: string
  description: string
  suggested_fixes: string[]
  relevant_logs: string[]
  confidence: number
}

function analyzeBuildFailure(failure: BuildFailure): DiagnosticReport[] {
  const diagnostics: DiagnosticReport[] = []
  const errorMessage = failure.error_message.toLowerCase()
  const buildLog = (failure.build_log || '').toLowerCase()
  const stackTrace = (failure.stack_trace || '').toLowerCase()
  const allText = `${errorMessage} ${buildLog} ${stackTrace}`

  if (allText.includes('cannot find module') || allText.includes('module not found')) {
    diagnostics.push({
      issue_type: 'missing_dependency',
      description: 'One or more required dependencies are missing or not installed',
      suggested_fixes: [
        'Run npm install or yarn install to ensure all dependencies are installed',
        'Check package.json for correct dependency versions',
        'Verify that the module name is spelled correctly',
        'Ensure the dependency is listed in dependencies, not just devDependencies'
      ],
      relevant_logs: extractRelevantLines(failure, ['module', 'import', 'require']),
      confidence: 0.9
    })
  }

  if (allText.includes('syntaxerror') || allText.includes('unexpected token')) {
    diagnostics.push({
      issue_type: 'syntax_error',
      description: 'Code contains syntax errors preventing successful compilation',
      suggested_fixes: [
        'Review the error message for the specific file and line number',
        'Check for missing brackets, parentheses, or semicolons',
        'Verify proper use of ES6+ syntax if using older transpiler settings',
        'Run linter locally before deploying'
      ],
      relevant_logs: extractRelevantLines(failure, ['syntax', 'token', 'unexpected']),
      confidence: 0.95
    })
  }

  if (allText.includes('typeerror') || allText.includes('is not a function') || allText.includes('undefined')) {
    diagnostics.push({
      issue_type: 'type_error',
      description: 'Runtime type error detected during build process',
      suggested_fixes: [
        'Check for undefined variables or functions',
        'Verify imports are correct and modules export expected values',
        'Review TypeScript types if using TypeScript',
        'Ensure environment variables are properly set'
      ],
      relevant_logs: extractRelevantLines(failure, ['typeerror', 'undefined', 'null']),
      confidence: 0.85
    })
  }

  if (allText.includes('out of memory') || allText.includes('heap') || allText.includes('javascript heap')) {
    diagnostics.push({
      issue_type: 'memory_issue',
      description: 'Build process ran out of memory',
      suggested_fixes: [
        'Increase Node.js memory limit with --max-old-space-size flag',
        'Optimize build configuration to reduce memory usage',
        'Check for memory leaks in build scripts',
        'Consider splitting large builds into smaller chunks'
      ],
      relevant_logs: extractRelevantLines(failure, ['memory', 'heap', 'allocated']),
      confidence: 0.9
    })
  }

  if (allText.includes('enoent') || allText.includes('no such file')) {
    diagnostics.push({
      issue_type: 'missing_file',
      description: 'Required file or directory not found',
      suggested_fixes: [
        'Verify all required files are committed to repository',
        'Check file paths are correct and case-sensitive',
        'Ensure build directory structure is properly set up',
        'Review .gitignore to ensure needed files are not excluded'
      ],
      relevant_logs: extractRelevantLines(failure, ['enoent', 'file', 'directory']),
      confidence: 0.88
    })
  }

  if (allText.includes('permission denied') || allText.includes('eacces')) {
    diagnostics.push({
      issue_type: 'permission_error',
      description: 'Insufficient permissions to access required resources',
      suggested_fixes: [
        'Check file permissions in deployment environment',
        'Verify deployment user has necessary access rights',
        'Review security policies and access controls',
        'Ensure executable scripts have proper permissions'
      ],
      relevant_logs: extractRelevantLines(failure, ['permission', 'eacces', 'denied']),
      confidence: 0.85
    })
  }

  if (allText.includes('port') && (allText.includes('already in use') || allText.includes('eaddrinuse'))) {
    diagnostics.push({
      issue_type: 'port_conflict',
      description: 'Required port is already in use',
      suggested_fixes: [
        'Use a different port number',
        'Kill processes using the required port',
        'Configure dynamic port allocation',
        'Check for conflicting services in deployment environment'
      ],
      relevant_logs: extractRelevantLines(failure, ['port', 'address', 'eaddrinuse']),
      confidence: 0.92
    })
  }

  if (allText.includes('timeout') || allText.includes('timed out')) {
    diagnostics.push({
      issue_type: 'timeout',
      description: 'Build process exceeded time limit',
      suggested_fixes: [
        'Optimize build scripts to run faster',
        'Increase timeout settings if possible',
        'Check for hanging processes or infinite loops',
        'Review network requests that might be slow'
      ],
      relevant_logs: extractRelevantLines(failure, ['timeout', 'timed', 'exceeded']),
      confidence: 0.8
    })
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      issue_type: 'unknown',
      description: 'Unable to determine specific issue from error message',
      suggested_fixes: [
        'Review full build logs for more details',
        'Check recent code changes that might have introduced the issue',
        'Verify deployment configuration is correct',
        'Test build locally to reproduce the error',
        'Contact support with full error details'
      ],
      relevant_logs: extractRelevantLines(failure, []),
      confidence: 0.3
    })
  }

  return diagnostics
}

function extractRelevantLines(failure: BuildFailure, keywords: string[]): string[] {
  const lines: string[] = []
  const allText = `${failure.error_message}\n${failure.stack_trace || ''}\n${failure.build_log || ''}`
  const textLines = allText.split('\n')

  if (keywords.length === 0) {
    return textLines.slice(0, 10).filter(line => line.trim().length > 0)
  }

  for (const line of textLines) {
    const lowerLine = line.toLowerCase()
    if (keywords.some(keyword => lowerLine.includes(keyword))) {
      lines.push(line.trim())
    }
  }

  return lines.slice(0, 20)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const buildFailure: BuildFailure = await req.json()
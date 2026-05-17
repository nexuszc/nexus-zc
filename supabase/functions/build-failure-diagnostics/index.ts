import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface DiagnosticResult {
  timestamp: string
  errors: ErrorDiagnostic[]
  affectedFunctions: string[]
  suggestedFixes: string[]
  status: string
}

interface ErrorDiagnostic {
  type: string
  message: string
  severity: string
  function?: string
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: deploymentLogs, error: logsError } = await supabase
      .from('deployment_logs')
      .select('*')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(50)

    const errors: ErrorDiagnostic[] = []
    const affectedFunctions = new Set<string>()
    const suggestedFixes = new Set<string>()

    if (deploymentLogs) {
      for (const log of deploymentLogs) {
        const logMessage = log.message || ''
        const functionName = log.function_name || 'unknown'

        if (logMessage.includes('Deno.serve')) {
          errors.push({
            type: 'MISSING_DENO_SERVE',
            message: `Function ${functionName} missing Deno.serve() wrapper`,
            severity: 'critical',
            function: functionName
          })
          affectedFunctions.add(functionName)
          suggestedFixes.add('Wrap edge function code in Deno.serve(async (req) => { ... })')
        }

        if (logMessage.includes('import') && logMessage.includes('error')) {
          errors.push({
            type: 'IMPORT_ERROR',
            message: `Import error in ${functionName}`,
            severity: 'high',
            function: functionName
          })
          affectedFunctions.add(functionName)
          suggestedFixes.add('Use Deno-compatible imports (https://esm.sh/ or https://deno.land/x/)')
        }

        if (logMessage.includes('typescript') || logMessage.includes('type error')) {
          errors.push({
            type: 'TYPE_ERROR',
            message: `TypeScript compilation error in ${functionName}`,
            severity: 'medium',
            function: functionName
          })
          affectedFunctions.add(functionName)
          suggestedFixes.add('Fix TypeScript type errors')
        }

        if (logMessage.includes('timeout')) {
          errors.push({
            type: 'TIMEOUT',
            message: `Function ${functionName} timed out`,
            severity: 'high',
            function: functionName
          })
          affectedFunctions.add(functionName)
          suggestedFixes.add('Optimize function execution time or increase timeout limits')
        }

        if (logMessage.includes('memory')) {
          errors.push({
            type: 'MEMORY_ERROR',
            message: `Memory limit exceeded in ${functionName}`,
            severity: 'high',
            function: functionName
          })
          affectedFunctions.add(functionName)
          suggestedFixes.add('Reduce memory usage or optimize data processing')
        }
      }
    }

    const { data: functions, error: functionsError } = await supabase
      .from('functions')
      .select('name, status')
      .eq('status', 'error')

    if (functions) {
      for (const func of functions) {
        affectedFunctions.add(func.name)
        errors.push({
          type: 'FUNCTION_ERROR',
          message: `Function ${func.name} is in error state`,
          severity: 'high',
          function: func.name
        })
      }
    }

    if (errors.length === 0) {
      errors.push({
        type: 'NO_ERRORS',
        message: 'No build failures detected in recent deployments',
        severity: 'info'
      })
    }

    const result: DiagnosticResult = {
      timestamp: new Date().toISOString(),
      errors,
      affectedFunctions: Array.from(affectedFunctions),
      suggestedFixes: Array.from(suggestedFixes),
      status: errors.some(e => e.severity === 'critical') ? 'critical' : 
              errors.some(e => e.severity === 'high') ? 'warning' : 'ok'
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Diagnostic execution failed', 
        details: error.message 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface DiagnosticResult {
  timestamp: string
  status: 'success' | 'error' | 'partial'
  checks: {
    environment: {
      status: 'pass' | 'fail'
      variables: Record<string, boolean>
    }
    supabase: {
      status: 'pass' | 'fail'
      connected: boolean
      error?: string
    }
    database: {
      status: 'pass' | 'fail'
      accessible: boolean
      error?: string
    }
    openai: {
      status: 'pass' | 'fail'
      configured: boolean
      error?: string
    }
    tables: {
      status: 'pass' | 'fail'
      schema?: Record<string, any>
      error?: string
    }
  }
}

Deno.serve(async (req) => {
  const result: DiagnosticResult = {
    timestamp: new Date().toISOString(),
    status: 'success',
    checks: {
      environment: {
        status: 'pass',
        variables: {}
      },
      supabase: {
        status: 'pass',
        connected: false
      },
      database: {
        status: 'pass',
        accessible: false
      },
      openai: {
        status: 'pass',
        configured: false
      },
      tables: {
        status: 'pass'
      }
    }
  }

  try {
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OPENAI_API_KEY'
    ]

    for (const envVar of requiredEnvVars) {
      result.checks.environment.variables[envVar] = !!Deno.env.get(envVar)
    }

    const allEnvVarsPresent = Object.values(result.checks.environment.variables).every(v => v)
    result.checks.environment.status = allEnvVarsPresent ? 'pass' : 'fail'

    if (!allEnvVarsPresent) {
      result.status = 'partial'
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        result.checks.supabase.connected = true

        try {
          const { data, error } = await supabase.from('users').select('count').limit(1)
          
          if (error) {
            result.checks.database.status = 'fail'
            result.checks.database.error = error.message
            result.status = 'partial'
          } else {
            result.checks.database.accessible = true
          }
        } catch (dbError) {
          result.checks.database.status = 'fail'
          result.checks.database.error = dbError instanceof Error ? dbError.message : 'Unknown database error'
          result.status = 'partial'
        }

        try {
          const tables = ['users', 'projects', 'knowledge_items', 'conversations', 'messages']
          const schema: Record<string, any> = {}

          for (const table of tables) {
            const { data, error } = await supabase.from(table).select('*').limit(0)
            
            if (error) {
              schema[table] = { error: error.message }
            } else {
              schema[table] = { exists: true }
            }
          }

          result.checks.tables.schema = schema
        } catch (tableError) {
          result.checks.tables.status = 'fail'
          result.checks.tables.error = tableError instanceof Error ? tableError.message : 'Unknown table error'
          result.status = 'partial'
        }

      } catch (supabaseError) {
        result.checks.supabase.status = 'fail'
        result.checks.supabase.error = supabaseError instanceof Error ? supabaseError.message : 'Unknown Supabase error'
        result.status = 'partial'
      }
    } else {
      result.checks.supabase.status = 'fail'
      result.checks.supabase.error = 'Missing Supabase credentials'
      result.status = 'partial'
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (openaiKey && openaiKey.startsWith('sk-')) {
      result.checks.openai.configured = true
      
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${openaiKey}`
          }
        })

        if (!response.ok) {
          result.checks.openai.status = 'fail'
          result.checks.openai.error = `API returned ${response.status}`
          result.status = 'partial'
        }
      } catch (openaiError) {
        result.checks.openai.status = 'fail'
        result.checks.openai.error = openaiError instanceof Error ? openaiError.message : 'Unknown OpenAI error'
        result.status = 'partial'
      }
    } else {
      result.checks.openai.status = 'fail'
      result.checks.openai.error = 'Invalid or missing OpenAI API key'
      result.status = 'partial'
    }

  } catch (error) {
    result.status = 'error'
    return new Response(
      JSON.stringify({
        ...result,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  const statusCode = result.status === 'success' ? 200 : result.status === 'partial' ? 207 : 500

  return new Response(
    JSON.stringify(result, null, 2),
    {
      status: statusCode,
      headers: { 'Content-Type': 'application/json' }
    }
  )
})
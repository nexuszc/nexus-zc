import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

interface DiagnosticResponse {
  status: string
  timestamp: string
  buildMetadata: {
    environment: string
    denoVersion: string
    permissions: string[]
  }
  deploymentStatus: {
    functionsAvailable: boolean
    databaseConnected: boolean
  }
  validationChecks: {
    environmentVariables: boolean
    supabaseClient: boolean
    requestProcessing: boolean
  }
  errors?: string[]
}

Deno.serve(async (req: Request) => {
  const errors: string[] = []
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    
    const envVarsPresent = !!(supabaseUrl && supabaseAnonKey)
    
    let supabaseClientValid = false
    let databaseConnected = false
    
    if (envVarsPresent) {
      try {
        const supabase = createClient(supabaseUrl!, supabaseAnonKey!)
        supabaseClientValid = true
        
        const { error: dbError } = await supabase.from('_health_check').select('*').limit(1)
        databaseConnected = !dbError || dbError.code === 'PGRST116'
      } catch (error) {
        errors.push(`Supabase client error: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      errors.push('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
    }
    
    const diagnosticResponse: DiagnosticResponse = {
      status: errors.length === 0 ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      buildMetadata: {
        environment: Deno.env.get('DENO_DEPLOYMENT_ID') || 'local',
        denoVersion: Deno.version.deno,
        permissions: [
          'net',
          'env',
          'read'
        ]
      },
      deploymentStatus: {
        functionsAvailable: true,
        databaseConnected
      },
      validationChecks: {
        environmentVariables: envVarsPresent,
        supabaseClient: supabaseClientValid,
        requestProcessing: true
      }
    }
    
    if (errors.length > 0) {
      diagnosticResponse.errors = errors
    }
    
    return new Response(
      JSON.stringify(diagnosticResponse, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'error',
        timestamp: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
        errors: [error instanceof Error ? error.stack : String(error)]
      }, null, 2),
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
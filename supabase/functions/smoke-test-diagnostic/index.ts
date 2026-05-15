import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          status: 'error',
          message: 'Missing environment variables',
          timestamp: new Date().toISOString(),
          edgeFunctionsConnectivity: true,
          databaseHealth: false,
          environmentCheck: false
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    let databaseHealth = false
    let dbError = null
    
    try {
      const { error } = await supabase
        .from('_health_check')
        .select('*')
        .limit(1)
      
      databaseHealth = !error
      if (error) {
        dbError = error.message
      }
    } catch (err) {
      dbError = err instanceof Error ? err.message : 'Unknown database error'
    }

    const diagnosticData = {
      status: 'ok',
      edgeFunctionsConnectivity: true,
      databaseHealth,
      dbError,
      timestamp: new Date().toISOString(),
      environmentCheck: true,
      metrics: {
        memory: Deno.memoryUsage(),
        version: Deno.version
      }
    }

    return new Response(
      JSON.stringify(diagnosticData),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        edgeFunctionsConnectivity: true,
        databaseHealth: false,
        environmentCheck: false
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface TestResult {
  status: 'success' | 'failure'
  passed_tests: string[]
  failed_tests: string[]
  timestamp: string
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const passedTests: string[] = []
    const failedTests: string[] = []

    try {
      const { data: functionsCheck, error: functionsError } = await supabase
        .rpc('get_function_list')
      
      if (functionsError) {
        failedTests.push('Database function check failed')
      } else {
        passedTests.push('Database functions validated')
      }
    } catch (error) {
      failedTests.push('Database connectivity check failed')
    }

    try {
      const { data: healthData, error: healthError } = await supabase
        .from('system_health')
        .select('*')
        .limit(1)
      
      if (healthError) {
        failedTests.push('System health table check failed')
      } else {
        passedTests.push('System health table accessible')
      }
    } catch (error) {
      failedTests.push('System health check failed')
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      passedTests.push('Auth service operational')
    } catch (error) {
      failedTests.push('Auth service check failed')
    }

    const result: TestResult = {
      status: failedTests.length === 0 ? 'success' : 'failure',
      passed_tests: passedTests,
      failed_tests: failedTests,
      timestamp: new Date().toISOString()
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    const errorResult: TestResult = {
      status: 'failure',
      passed_tests: [],
      failed_tests: [`Critical error: ${error.message}`],
      timestamp: new Date().toISOString()
    }

    return new Response(
      JSON.stringify(errorResult),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
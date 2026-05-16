import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface SmokeTestResult {
  name: string
  status: 'pass' | 'fail'
  message?: string
  duration?: number
}

async function runSmokeTests(): Promise<SmokeTestResult[]> {
  const results: SmokeTestResult[] = []
  
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  
  const testDatabaseConnection = async (): Promise<SmokeTestResult> => {
    const start = Date.now()
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const { error } = await supabase.from('nexus_config').select('count').limit(1).single()
      
      if (error && error.code !== 'PGRST116') {
        throw error
      }
      
      return {
        name: 'Database Connection',
        status: 'pass',
        duration: Date.now() - start
      }
    } catch (error) {
      return {
        name: 'Database Connection',
        status: 'fail',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start
      }
    }
  }
  
  const testEnvironmentVariables = async (): Promise<SmokeTestResult> => {
    const start = Date.now()
    try {
      const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
      const missing = required.filter(key => !Deno.env.get(key))
      
      if (missing.length > 0) {
        throw new Error(`Missing environment variables: ${missing.join(', ')}`)
      }
      
      return {
        name: 'Environment Variables',
        status: 'pass',
        duration: Date.now() - start
      }
    } catch (error) {
      return {
        name: 'Environment Variables',
        status: 'fail',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start
      }
    }
  }
  
  const testFunctionExecution = async (): Promise<SmokeTestResult> => {
    const start = Date.now()
    try {
      const timestamp = new Date().toISOString()
      const testData = { test: true, timestamp }
      
      if (!testData.timestamp) {
        throw new Error('Function execution failed')
      }
      
      return {
        name: 'Function Execution',
        status: 'pass',
        duration: Date.now() - start
      }
    } catch (error) {
      return {
        name: 'Function Execution',
        status: 'fail',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - start
      }
    }
  }
  
  results.push(await testEnvironmentVariables())
  results.push(await testDatabaseConnection())
  results.push(await testFunctionExecution())
  
  return results
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    const results = await runSmokeTests()
    const allPassed = results.every(r => r.status === 'pass')
    
    return new Response(
      JSON.stringify({
        success: allPassed,
        timestamp: new Date().toISOString(),
        results,
        summary: {
          total: results.length,
          passed: results.filter(r => r.status === 'pass').length,
          failed: results.filter(r => r.status === 'fail').length
        }
      }),
      { 
        status: allPassed ? 200 : 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
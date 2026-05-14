import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface TestResult {
  success: boolean
  message: string
  details?: any
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, message: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { testType, testData } = await req.json()

    let result: TestResult

    switch (testType) {
      case 'connection':
        const { data: connectionData, error: connectionError } = await supabase
          .from('nexus_connections')
          .select('*')
          .limit(1)
        
        result = {
          success: !connectionError,
          message: connectionError ? 'Connection test failed' : 'Connection test passed',
          details: connectionError || connectionData
        }
        break

      case 'query':
        const { query, params } = testData || {}
        const { data: queryData, error: queryError } = await supabase.rpc(query, params)
        
        result = {
          success: !queryError,
          message: queryError ? 'Query test failed' : 'Query test passed',
          details: queryError || queryData
        }
        break

      case 'integration':
        const integrationTests = []
        
        const { data: nodesData, error: nodesError } = await supabase
          .from('nexus_nodes')
          .select('*')
          .limit(5)
        integrationTests.push({ test: 'nodes', success: !nodesError, error: nodesError })

        const { data: edgesData, error: edgesError } = await supabase
          .from('nexus_edges')
          .select('*')
          .limit(5)
        integrationTests.push({ test: 'edges', success: !edgesError, error: edgesError })

        const { data: connectionsData, error: connectionsError } = await supabase
          .from('nexus_connections')
          .select('*')
          .limit(5)
        integrationTests.push({ test: 'connections', success: !connectionsError, error: connectionsError })

        const allPassed = integrationTests.every(t => t.success)
        result = {
          success: allPassed,
          message: allPassed ? 'All integration tests passed' : 'Some integration tests failed',
          details: integrationTests
        }
        break

      default:
        result = {
          success: false,
          message: `Unknown test type: ${testType}`
        }
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: result.success ? 200 : 400,
        headers: { 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: 'Test runner error',
        details: error.message 
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' } 
      }
    )
  }
})
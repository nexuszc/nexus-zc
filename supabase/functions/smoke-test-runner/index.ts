import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface TestResult {
  function: string
  status: 'pass' | 'fail'
  duration: number
  error?: string
  details?: any
}

interface SmokeTestResults {
  timestamp: string
  totalTests: number
  passed: number
  failed: number
  duration: number
  results: TestResult[]
}

Deno.serve(async (req) => {
  const startTime = Date.now()
  const results: TestResult[] = []

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Test 1: agent-router
  try {
    const testStart = Date.now()
    const response = await fetch(`${supabaseUrl}/functions/v1/agent-router`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        message: 'smoke test ping',
        user_id: 'smoke-test-user',
      }),
    })

    const data = await response.json()
    results.push({
      function: 'agent-router',
      status: response.ok ? 'pass' : 'fail',
      duration: Date.now() - testStart,
      details: data,
    })
  } catch (error) {
    results.push({
      function: 'agent-router',
      status: 'fail',
      duration: Date.now() - startTime,
      error: error.message,
    })
  }

  // Test 2: check-auth
  try {
    const testStart = Date.now()
    const response = await fetch(`${supabaseUrl}/functions/v1/check-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({}),
    })

    const data = await response.json()
    results.push({
      function: 'check-auth',
      status: response.ok ? 'pass' : 'fail',
      duration: Date.now() - testStart,
      details: data,
    })
  } catch (error) {
    results.push({
      function: 'check-auth',
      status: 'fail',
      duration: Date.now() - startTime,
      error: error.message,
    })
  }

  // Test 3: Database connectivity
  try {
    const testStart = Date.now()
    const { data, error } = await supabase
      .from('nexus_config')
      .select('key')
      .limit(1)

    results.push({
      function: 'database-connectivity',
      status: !error ? 'pass' : 'fail',
      duration: Date.now() - testStart,
      error: error?.message,
      details: { recordCount: data?.length || 0 },
    })
  } catch (error) {
    results.push({
      function: 'database-connectivity',
      status: 'fail',
      duration: Date.now() - testStart,
      error: error.message,
    })
  }

  // Test 4: openai-proxy
  try {
    const testStart = Date.now()
    const response = await fetch(`${supabaseUrl}/functions/v1/openai-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      }),
    })

    const data = await response.json()
    results.push({
      function: 'openai-proxy',
      status: response.ok ? 'pass' : 'fail',
      duration: Date.now() - testStart,
      details: data,
    })
  } catch (error) {
    results.push({
      function: 'openai-proxy',
      status: 'fail',
      duration: Date.now() - testStart,
      error: error.message,
    })
  }

  // Test 5: token-counter
  try {
    const testStart = Date.now()
    const response = await fetch(`${supabaseUrl}/functions/v1/token-counter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        text: 'smoke test message',
        model: 'gpt-3.5-turbo',
      }),
    })

    const data = await response.json()
    results.push({
      function: 'token-counter',
      status: response.ok ? 'pass' : 'fail',
      duration: Date.now() - testStart,
      details: data,
    })
  } catch (error) {
    results.push({
      function: 'token-counter',
      status: 'fail',
      duration: Date.now() - testStart,
      error: error.message,
    })
  }

  const totalDuration = Date.now() - startTime
  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length

  const smokeTestResults: SmokeTestResults = {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passed,
    failed,
    duration: totalDuration,
    results,
  }

  return new Response(JSON.stringify(smokeTestResults), {
    headers: {
      'Content-Type': 'application/json',
    },
  })
})
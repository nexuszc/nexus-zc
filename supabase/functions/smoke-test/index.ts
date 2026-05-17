import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface TestResult {
  name: string;
  passed: boolean;
  duration_ms: number;
  error?: string;
}

async function testDBConnection(): Promise<TestResult> {
  const start = performance.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.from('_prisma_migrations').select('id').limit(1);
    
    if (error && error.code !== 'PGRST116') {
      throw new Error(error.message);
    }
    
    return {
      name: 'database_connection',
      passed: true,
      duration_ms: performance.now() - start,
    };
  } catch (error) {
    return {
      name: 'database_connection',
      passed: false,
      duration_ms: performance.now() - start,
      error: error.message,
    };
  }
}

async function testRuntime(): Promise<TestResult> {
  const start = performance.now();
  try {
    if (typeof Deno === 'undefined') {
      throw new Error('Deno runtime not available');
    }
    
    const version = Deno.version;
    if (!version || !version.deno) {
      throw new Error('Invalid Deno version');
    }
    
    return {
      name: 'runtime_check',
      passed: true,
      duration_ms: performance.now() - start,
    };
  } catch (error) {
    return {
      name: 'runtime_check',
      passed: false,
      duration_ms: performance.now() - start,
      error: error.message,
    };
  }
}

async function testAuthContext(): Promise<TestResult> {
  const start = performance.now();
  try {
    const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
    
    if (missingVars.length > 0) {
      throw new Error(`Missing vars: ${missingVars.join(', ')}`);
    }
    
    return {
      name: 'auth_context',
      passed: true,
      duration_ms: performance.now() - start,
    };
  } catch (error) {
    return {
      name: 'auth_context',
      passed: false,
      duration_ms: performance.now() - start,
      error: error.message,
    };
  }
}

async function testJSONResponse(): Promise<TestResult> {
  const start = performance.now();
  try {
    const testObj = { test: 'data', timestamp: new Date().toISOString() };
    const serialized = JSON.stringify(testObj);
    const parsed = JSON.parse(serialized);
    
    if (parsed.test !== 'data') {
      throw new Error('JSON serialization failed');
    }
    
    return {
      name: 'json_response',
      passed: true,
      duration_ms: performance.now() - start,
    };
  } catch (error) {
    return {
      name: 'json_response',
      passed: false,
      duration_ms: performance.now() - start,
      error: error.message,
    };
  }
}

async function testSupabaseInit(): Promise<TestResult> {
  const start = performance.now();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not available');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    if (!supabase) {
      throw new Error('Failed to create Supabase client');
    }
    
    return {
      name: 'supabase_init',
      passed: true,
      duration_ms: performance.now() - start,
    };
  } catch (error) {
    return {
      name: 'supabase_init',
      passed: false,
      duration_ms: performance.now() - start,
      error: error.message,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const startTime = performance.now();

  try {
    const tests: TestResult[] = [];

    try {
      tests.push(await testRuntime());
    } catch (error) {
      tests.push({
        name: 'runtime_check',
        passed: false,
        duration_ms: 0,
        error: error.message,
      });
    }

    try {
      tests.push(await testAuthContext());
    } catch (error) {
      tests.push({
        name: 'auth_context',
        passed: false,
        duration_ms: 0,
        error: error.message,
      });
    }

    try {
      tests.push(await testSupabaseInit());
    } catch (error) {
      tests.push({
        name: 'supabase_init',
        passed: false,
        duration_ms: 0,
        error: error.message,
      });
    }

    try {
      tests.push(await testJSONResponse());
    } catch (error) {
      tests.push({
        name: 'json_response',
        passed: false,
        duration_ms: 0,
        error: error.message,
      });
    }

    try {
      tests.push(await testDBConnection());
    } catch (error) {
      tests.push({
        name: 'database_connection',
        passed: false,
        duration_ms: 0,
        error: error.message,
      });
    }

    const totalDuration = performance.now() - startTime;
    const failedTests = tests.filter(test => !test.passed);
    const passedTests = tests.filter(test => test.passed);

    let status: 'healthy' | 'degraded' | 'failed';
    if (failedTests.length === 0) {
      status = 'healthy';
    } else if (passedTests.length > failedTests.length) {
      status = 'degraded';
    } else {
      status = 'failed';
    }

    const response = {
      status,
      tests,
      timestamp: new Date().toISOString(),
      total_duration_ms: totalDuration,
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: status === 'failed' ? 500 : 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    const totalDuration = performance.now() - startTime;
    
    return new Response(JSON.stringify({
      status: 'failed',
      tests: [],
      timestamp: new Date().toISOString(),
      total_duration_ms: totalDuration,
      error: error.message,
    }, null, 2), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
});
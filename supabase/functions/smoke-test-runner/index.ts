import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface SmokeTestResult {
  test_name: string;
  status: 'passed' | 'failed';
  duration_ms: number;
  error?: string;
}

interface SmokeTestResponse {
  success: boolean;
  results: SmokeTestResult[];
  total_tests: number;
  passed: number;
  failed: number;
  total_duration_ms: number;
}

async function runDatabaseTest(supabase: any): Promise<SmokeTestResult> {
  const start = Date.now();
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    
    if (error) throw error;
    
    return {
      test_name: 'database_connection',
      status: 'passed',
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      test_name: 'database_connection',
      status: 'failed',
      duration_ms: Date.now() - start,
      error: error.message,
    };
  }
}

async function runAuthTest(supabase: any): Promise<SmokeTestResult> {
  const start = Date.now();
  try {
    const { data, error } = await supabase.auth.getSession();
    
    if (error) throw error;
    
    return {
      test_name: 'auth_service',
      status: 'passed',
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      test_name: 'auth_service',
      status: 'failed',
      duration_ms: Date.now() - start,
      error: error.message,
    };
  }
}

async function runStorageTest(supabase: any): Promise<SmokeTestResult> {
  const start = Date.now();
  try {
    const { data, error } = await supabase
      .storage
      .listBuckets();
    
    if (error) throw error;
    
    return {
      test_name: 'storage_service',
      status: 'passed',
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      test_name: 'storage_service',
      status: 'failed',
      duration_ms: Date.now() - start,
      error: error.message,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const testStart = Date.now();

    const results = await Promise.all([
      runDatabaseTest(supabase),
      runAuthTest(supabase),
      runStorageTest(supabase),
    ]);

    const totalDuration = Date.now() - testStart;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;

    const response: SmokeTestResponse = {
      success: failed === 0,
      results,
      total_tests: results.length,
      passed,
      failed,
      total_duration_ms: totalDuration,
    };

    return new Response(
      JSON.stringify(response),
      {
        status: failed === 0 ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        results: [],
        total_tests: 0,
        passed: 0,
        failed: 0,
        total_duration_ms: 0,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
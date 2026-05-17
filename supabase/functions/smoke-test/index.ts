import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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

  try {
    const testResults = [];

    // Test 1: Basic health check
    try {
      testResults.push({
        test: 'health_check',
        status: 'pass',
        message: 'Service is running',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      testResults.push({
        test: 'health_check',
        status: 'fail',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Test 2: Environment variables validation
    try {
      const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
      const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
      
      if (missingVars.length > 0) {
        throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
      }
      
      testResults.push({
        test: 'environment_variables',
        status: 'pass',
        message: 'All required environment variables are set',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      testResults.push({
        test: 'environment_variables',
        status: 'fail',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Test 3: Supabase client initialization
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase credentials not available');
      }
      
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      if (!supabase) {
        throw new Error('Failed to create Supabase client');
      }
      
      testResults.push({
        test: 'supabase_client_init',
        status: 'pass',
        message: 'Supabase client initialized successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      testResults.push({
        test: 'supabase_client_init',
        status: 'fail',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Test 4: Database connectivity
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase credentials not available for database test');
      }
      
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const { data, error } = await supabase.rpc('sql', { 
        query: 'SELECT 1 as result' 
      }).single();
      
      if (error) {
        // Try alternative method if RPC doesn't exist
        const { error: altError } = await supabase.from('_prisma_migrations').select('id').limit(1);
        
        if (altError && altError.code !== 'PGRST116') {
          throw new Error(`Database query failed: ${altError.message}`);
        }
      }
      
      testResults.push({
        test: 'database_connectivity',
        status: 'pass',
        message: 'Database connection verified',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      testResults.push({
        test: 'database_connectivity',
        status: 'fail',
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    // Calculate overall status
    const failedTests = testResults.filter(result => result.status === 'fail');
    const overallStatus = failedTests.length === 0 ? 'pass' : 'fail';

    const response = {
      overall_status: overallStatus,
      total_tests: testResults.length,
      passed: testResults.filter(r => r.status === 'pass').length,
      failed: failedTests.length,
      tests: testResults,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: overallStatus === 'pass' ? 200 : 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      overall_status: 'fail',
      error: error.message,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
});
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface SmokeTest {
  name: string;
  status: 'passed' | 'failed';
  duration: number;
  error?: string;
}

async function runSmokeTests(): Promise<SmokeTest[]> {
  const tests: SmokeTest[] = [];
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const testDatabase = async (): Promise<SmokeTest> => {
    const start = Date.now();
    try {
      const { error } = await supabase.from('nexus_chains').select('id').limit(1);
      if (error) throw error;
      return {
        name: 'Database Connection',
        status: 'passed',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'Database Connection',
        status: 'failed',
        duration: Date.now() - start,
        error: error.message,
      };
    }
  };

  const testAuth = async (): Promise<SmokeTest> => {
    const start = Date.now();
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error && error.message !== 'Auth session missing!') throw error;
      return {
        name: 'Auth System',
        status: 'passed',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'Auth System',
        status: 'failed',
        duration: Date.now() - start,
        error: error.message,
      };
    }
  };

  const testStorage = async (): Promise<SmokeTest> => {
    const start = Date.now();
    try {
      const { data, error } = await supabase.storage.listBuckets();
      if (error) throw error;
      return {
        name: 'Storage System',
        status: 'passed',
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'Storage System',
        status: 'failed',
        duration: Date.now() - start,
        error: error.message,
      };
    }
  };

  tests.push(await testDatabase());
  tests.push(await testAuth());
  tests.push(await testStorage());

  return tests;
}

Deno.serve(async (req) => {
  const { method } = req;

  if (method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const tests = await runSmokeTests();
    return new Response(
      JSON.stringify({ success: true, tests }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
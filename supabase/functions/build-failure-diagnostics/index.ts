import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: failures, error } = await supabase
      .from('nexus_builds')
      .select('*')
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    const patterns = failures?.reduce((acc: any, failure: any) => {
      const errorType = failure.error_message?.split(':')[0] || 'unknown';
      acc[errorType] = (acc[errorType] || 0) + 1;
      return acc;
    }, {});

    return new Response(JSON.stringify({ failures, patterns }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
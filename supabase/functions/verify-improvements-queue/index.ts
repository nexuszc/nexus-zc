import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: queueEntries, error: queueError } = await supabase
      .from('improvements_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (queueError) {
      throw queueError;
    }

    const validEntries = [];
    const invalidEntries = [];

    for (const entry of queueEntries || []) {
      const isValid = 
        entry.improvement_id &&
        entry.status &&
        ['pending', 'processing', 'completed', 'failed'].includes(entry.status);

      if (isValid) {
        validEntries.push(entry);
      } else {
        invalidEntries.push({
          id: entry.id,
          reason: 'Missing required fields or invalid status',
        });
      }
    }

    const result = {
      total: (queueEntries || []).length,
      valid: validEntries.length,
      invalid: invalidEntries.length,
      validEntries,
      invalidEntries,
      timestamp: new Date().toISOString(),
    };

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
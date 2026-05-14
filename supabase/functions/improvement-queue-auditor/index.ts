import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const { data: queueItems, error: queueError } = await supabaseClient
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: false })

    if (queueError) throw queueError

    const analysis = {
      total_items: queueItems?.length || 0,
      pending_items: queueItems?.filter(item => item.status === 'pending').length || 0,
      in_progress_items: queueItems?.filter(item => item.status === 'in_progress').length || 0,
      completed_items: queueItems?.filter(item => item.status === 'completed').length || 0,
      failed_items: queueItems?.filter(item => item.status === 'failed').length || 0,
      priority_distribution: {
        high: queueItems?.filter(item => item.priority === 'high').length || 0,
        medium: queueItems?.filter(item => item.priority === 'medium').length || 0,
        low: queueItems?.filter(item => item.priority === 'low').length || 0,
      },
      oldest_pending: queueItems
        ?.filter(item => item.status === 'pending')
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0] || null,
      recent_failures: queueItems
        ?.filter(item => item.status === 'failed')
        .slice(0, 5) || [],
    }

    const result = {
      audit_timestamp: new Date().toISOString(),
      analysis,
      items: queueItems,
    }

    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  }
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
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

    const { data: queueItems, error: fetchError } = await supabaseClient
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (fetchError) {
      throw fetchError
    }

    const auditResults = {
      total_items: queueItems?.length || 0,
      pending_items: queueItems?.filter(item => item.status === 'pending').length || 0,
      in_progress_items: queueItems?.filter(item => item.status === 'in_progress').length || 0,
      completed_items: queueItems?.filter(item => item.status === 'completed').length || 0,
      failed_items: queueItems?.filter(item => item.status === 'failed').length || 0,
      stale_items: queueItems?.filter(item => {
        const createdAt = new Date(item.created_at)
        const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60)
        return item.status === 'in_progress' && hoursSinceCreation > 24
      }).length || 0,
      timestamp: new Date().toISOString(),
    }

    const staleItems = queueItems?.filter(item => {
      const createdAt = new Date(item.created_at)
      const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60)
      return item.status === 'in_progress' && hoursSinceCreation > 24
    })

    if (staleItems && staleItems.length > 0) {
      for (const item of staleItems) {
        await supabaseClient
          .from('improvement_queue')
          .update({ status: 'failed', error: 'Stale item - exceeded 24 hour timeout' })
          .eq('id', item.id)
      }
    }

    return new Response(
      JSON.stringify(auditResults),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
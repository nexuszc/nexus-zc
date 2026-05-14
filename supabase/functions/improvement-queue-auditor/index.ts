import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const now = new Date().toISOString()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const { data: queueItems, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: true })

    if (fetchError) {
      throw fetchError
    }

    const audit = {
      timestamp: now,
      total_items: queueItems?.length || 0,
      pending_items: queueItems?.filter(item => item.status === 'pending').length || 0,
      processing_items: queueItems?.filter(item => item.status === 'processing').length || 0,
      completed_items: queueItems?.filter(item => item.status === 'completed').length || 0,
      failed_items: queueItems?.filter(item => item.status === 'failed').length || 0,
      stale_processing: queueItems?.filter(
        item => item.status === 'processing' && item.updated_at < oneHourAgo
      ).length || 0,
    }

    const { error: insertError } = await supabase
      .from('improvement_queue_audits')
      .insert(audit)

    if (insertError) {
      throw insertError
    }

    if (audit.stale_processing > 0) {
      const { error: updateError } = await supabase
        .from('improvement_queue')
        .update({ status: 'failed', updated_at: now })
        .eq('status', 'processing')
        .lt('updated_at', oneHourAgo)

      if (updateError) {
        console.error('Error updating stale items:', updateError)
      }
    }

    return new Response(
      JSON.stringify({ success: true, audit }),
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
        status: 500,
      }
    )
  }
}

Deno.serve((req) => handler(req))
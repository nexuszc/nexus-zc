import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: queueItems, error: queueError } = await supabaseClient
      .from('improvements_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (queueError) {
      return new Response(
        JSON.stringify({ error: queueError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const pendingCount = queueItems?.filter(item => item.status === 'pending').length || 0
    const processingCount = queueItems?.filter(item => item.status === 'processing').length || 0
    const completedCount = queueItems?.filter(item => item.status === 'completed').length || 0
    const failedCount = queueItems?.filter(item => item.status === 'failed').length || 0

    const staleItems = queueItems?.filter(item => {
      if (item.status !== 'processing') return false
      const updatedAt = new Date(item.updated_at)
      const now = new Date()
      const minutesSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60)
      return minutesSinceUpdate > 30
    }) || []

    return new Response(
      JSON.stringify({
        success: true,
        queue_stats: {
          total: queueItems?.length || 0,
          pending: pendingCount,
          processing: processingCount,
          completed: completedCount,
          failed: failedCount,
          stale_processing: staleItems.length,
        },
        stale_items: staleItems.map(item => ({
          id: item.id,
          status: item.status,
          updated_at: item.updated_at,
        })),
        recent_items: queueItems?.slice(0, 10).map(item => ({
          id: item.id,
          status: item.status,
          improvement_id: item.improvement_id,
          created_at: item.created_at,
          updated_at: item.updated_at,
        })) || [],
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}
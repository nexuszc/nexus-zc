import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  total_items: number
  pending_items: number
  in_progress_items: number
  completed_items: number
  failed_items: number
  stale_items: number
  audit_timestamp: string
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: allItems, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')

    if (fetchError) {
      throw fetchError
    }

    const items = allItems || []
    const now = new Date()
    const staleThresholdHours = 24

    const auditResult: AuditResult = {
      total_items: items.length,
      pending_items: items.filter(item => item.status === 'pending').length,
      in_progress_items: items.filter(item => item.status === 'in_progress').length,
      completed_items: items.filter(item => item.status === 'completed').length,
      failed_items: items.filter(item => item.status === 'failed').length,
      stale_items: items.filter(item => {
        if (item.status === 'completed' || item.status === 'failed') {
          return false
        }
        const updatedAt = new Date(item.updated_at)
        const hoursSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60)
        return hoursSinceUpdate > staleThresholdHours
      }).length,
      audit_timestamp: now.toISOString()
    }

    return new Response(
      JSON.stringify(auditResult),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
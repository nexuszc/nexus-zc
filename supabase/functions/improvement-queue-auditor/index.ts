import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface ImprovementQueueItem {
  id: string
  status: string
  priority: number
  created_at: string
  updated_at: string
  entity_type: string
  entity_id: string
}

interface AuditResult {
  total_items: number
  by_status: Record<string, number>
  by_priority: Record<string, number>
  stale_items: number
  high_priority_pending: number
  audit_timestamp: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
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

    const { data: items, error } = await supabaseClient
      .from('improvement_queue')
      .select('*')

    if (error) {
      throw error
    }

    const queueItems = items as ImprovementQueueItem[]
    
    const auditResult: AuditResult = {
      total_items: queueItems.length,
      by_status: {},
      by_priority: {},
      stale_items: 0,
      high_priority_pending: 0,
      audit_timestamp: new Date().toISOString(),
    }

    const staleThresholdDays = 7
    const staleDate = new Date()
    staleDate.setDate(staleDate.getDate() - staleThresholdDays)

    for (const item of queueItems) {
      auditResult.by_status[item.status] = (auditResult.by_status[item.status] || 0) + 1
      auditResult.by_priority[item.priority] = (auditResult.by_priority[item.priority] || 0) + 1

      const itemDate = new Date(item.updated_at || item.created_at)
      if (item.status === 'pending' && itemDate < staleDate) {
        auditResult.stale_items++
      }

      if (item.status === 'pending' && item.priority >= 8) {
        auditResult.high_priority_pending++
      }
    }

    const { error: logError } = await supabaseClient
      .from('audit_logs')
      .insert({
        audit_type: 'improvement_queue',
        audit_data: auditResult,
        created_at: new Date().toISOString(),
      })

    if (logError) {
      console.error('Failed to log audit result:', logError)
    }

    return new Response(
      JSON.stringify(auditResult),
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
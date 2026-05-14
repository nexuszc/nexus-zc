import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

interface AuditResult {
  total_items: number
  stale_items: number
  priority_distribution: Record<string, number>
  status_distribution: Record<string, number>
  old_pending_items: number
  recommendations: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
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

    const { data: queueItems, error } = await supabaseClient
      .from('improvement_queue')
      .select('*')

    if (error) {
      throw error
    }

    const now = new Date()
    const staleThresholdDays = 30
    const oldPendingThresholdDays = 7

    const auditResult: AuditResult = {
      total_items: queueItems?.length || 0,
      stale_items: 0,
      priority_distribution: {},
      status_distribution: {},
      old_pending_items: 0,
      recommendations: [],
    }

    queueItems?.forEach((item) => {
      const priority = item.priority || 'none'
      const status = item.status || 'unknown'

      auditResult.priority_distribution[priority] = 
        (auditResult.priority_distribution[priority] || 0) + 1
      
      auditResult.status_distribution[status] = 
        (auditResult.status_distribution[status] || 0) + 1

      const createdAt = new Date(item.created_at)
      const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)

      if (daysSinceCreation > staleThresholdDays) {
        auditResult.stale_items++
      }

      if (status === 'pending' && daysSinceCreation > oldPendingThresholdDays) {
        auditResult.old_pending_items++
      }
    })

    if (auditResult.stale_items > 0) {
      auditResult.recommendations.push(
        `${auditResult.stale_items} items are older than ${staleThresholdDays} days. Consider reviewing or archiving.`
      )
    }

    if (auditResult.old_pending_items > 0) {
      auditResult.recommendations.push(
        `${auditResult.old_pending_items} pending items are older than ${oldPendingThresholdDays} days. Consider prioritizing or updating status.`
      )
    }

    const highPriorityCount = auditResult.priority_distribution['high'] || 0
    if (highPriorityCount > auditResult.total_items * 0.5) {
      auditResult.recommendations.push(
        'Over 50% of items are marked high priority. Consider re-evaluating priorities.'
      )
    }

    return new Response(JSON.stringify(auditResult), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
})
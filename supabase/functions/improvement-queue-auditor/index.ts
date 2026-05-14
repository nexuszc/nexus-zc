import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ImprovementQueueItem {
  id: string
  type: string
  status: string
  priority: number
  created_at: string
  updated_at: string
  metadata: Record<string, any>
}

interface AuditResult {
  total_items: number
  by_status: Record<string, number>
  by_type: Record<string, number>
  avg_age_hours: number
  stale_items: number
  high_priority_pending: number
  patterns: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'GET') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
      .order('created_at', { ascending: false })

    if (error) {
      throw error
    }

    const queueItems = (items || []) as ImprovementQueueItem[]
    const now = new Date()

    const byStatus: Record<string, number> = {}
    const byType: Record<string, number> = {}
    let totalAgeHours = 0
    let staleItems = 0
    let highPriorityPending = 0

    queueItems.forEach(item => {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1
      byType[item.type] = (byType[item.type] || 0) + 1

      const createdAt = new Date(item.created_at)
      const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)
      totalAgeHours += ageHours

      if (ageHours > 72 && item.status === 'pending') {
        staleItems++
      }

      if (item.priority >= 8 && item.status === 'pending') {
        highPriorityPending++
      }
    })

    const patterns: string[] = []

    if (staleItems > 5) {
      patterns.push(`${staleItems} items pending for over 72 hours`)
    }

    if (highPriorityPending > 0) {
      patterns.push(`${highPriorityPending} high-priority items awaiting processing`)
    }

    const pendingCount = byStatus['pending'] || 0
    const completedCount = byStatus['completed'] || 0
    if (pendingCount > completedCount * 2) {
      patterns.push('Pending items significantly outnumber completed items')
    }

    const avgAgeHours = queueItems.length > 0 ? totalAgeHours / queueItems.length : 0

    const result: AuditResult = {
      total_items: queueItems.length,
      by_status: byStatus,
      by_type: byType,
      avg_age_hours: Math.round(avgAgeHours * 100) / 100,
      stale_items: staleItems,
      high_priority_pending: highPriorityPending,
      patterns: patterns,
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
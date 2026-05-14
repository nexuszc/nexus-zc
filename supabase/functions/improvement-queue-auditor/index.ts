import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  timestamp: string
  queueHealth: string
  totalItems: number
  staleItems: number
  priorityDistribution: Record<string, number>
  issues: string[]
  recommendations: string[]
}

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: queueItems, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: false })

    if (fetchError) {
      throw fetchError
    }

    const items = queueItems || []
    const now = new Date()
    const staleThresholdHours = 72
    const issues: string[] = []
    const recommendations: string[] = []

    const staleItems = items.filter(item => {
      if (item.status === 'completed') return false
      const createdAt = new Date(item.created_at)
      const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)
      return hoursSinceCreation > staleThresholdHours
    })

    const priorityDistribution: Record<string, number> = {}
    items.forEach(item => {
      const priority = item.priority || 'none'
      priorityDistribution[priority] = (priorityDistribution[priority] || 0) + 1
    })

    const pendingItems = items.filter(item => item.status === 'pending').length
    const inProgressItems = items.filter(item => item.status === 'in_progress').length
    const completedItems = items.filter(item => item.status === 'completed').length

    if (staleItems.length > 0) {
      issues.push(`Found ${staleItems.length} stale items older than ${staleThresholdHours} hours`)
      recommendations.push('Review and update or close stale improvement items')
    }

    if (pendingItems > 50) {
      issues.push(`High number of pending items: ${pendingItems}`)
      recommendations.push('Consider prioritizing or archiving old pending items')
    }

    if (inProgressItems > 20) {
      issues.push(`Many items in progress: ${inProgressItems}`)
      recommendations.push('Review in-progress items to ensure they are actively being worked on')
    }

    const highPriorityCount = priorityDistribution['high'] || 0
    if (highPriorityCount > 10) {
      issues.push(`Too many high priority items: ${highPriorityCount}`)
      recommendations.push('Re-evaluate priorities to focus efforts effectively')
    }

    let queueHealth = 'healthy'
    if (issues.length > 3) {
      queueHealth = 'critical'
    } else if (issues.length > 0) {
      queueHealth = 'warning'
    }

    const auditResult: AuditResult = {
      timestamp: now.toISOString(),
      queueHealth,
      totalItems: items.length,
      staleItems: staleItems.length,
      priorityDistribution,
      issues,
      recommendations
    }

    return new Response(JSON.stringify(auditResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error auditing improvement queue:', error)
    
    return new Response(JSON.stringify({ 
      error: 'Failed to audit improvement queue',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
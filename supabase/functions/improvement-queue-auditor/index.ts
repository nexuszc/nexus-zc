import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface ImprovementQueueItem {
  id: string
  created_at: string
  status: string
  priority?: number
  task_type: string
  metadata?: Record<string, any>
}

interface AuditResult {
  item_id: string
  is_stale: boolean
  priority_score: number
  issues: string[]
  recommendations: string[]
}

const STALE_THRESHOLD_HOURS = 24
const MAX_PRIORITY = 100

function calculatePriorityScore(item: ImprovementQueueItem): number {
  let score = item.priority || 50
  
  const ageHours = (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60)
  
  if (ageHours > 48) score += 20
  else if (ageHours > 24) score += 10
  
  if (item.status === 'blocked') score += 15
  if (item.status === 'pending') score += 5
  
  return Math.min(score, MAX_PRIORITY)
}

function isStale(item: ImprovementQueueItem): boolean {
  const ageHours = (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60)
  return ageHours > STALE_THRESHOLD_HOURS && item.status === 'pending'
}

function analyzeItem(item: ImprovementQueueItem): AuditResult {
  const issues: string[] = []
  const recommendations: string[] = []
  
  const stale = isStale(item)
  if (stale) {
    issues.push(`Item has been pending for over ${STALE_THRESHOLD_HOURS} hours`)
    recommendations.push('Review and update status or reassign task')
  }
  
  if (!item.priority) {
    issues.push('No priority set')
    recommendations.push('Assign priority value')
  }
  
  if (item.status === 'blocked' && !item.metadata?.blocked_reason) {
    issues.push('Blocked status without reason')
    recommendations.push('Add blocked_reason to metadata')
  }
  
  const priorityScore = calculatePriorityScore(item)
  if (priorityScore > 80) {
    recommendations.push('High priority - consider escalating')
  }
  
  return {
    item_id: item.id,
    is_stale: stale,
    priority_score: priorityScore,
    issues,
    recommendations
  }
}

Deno.serve(async (req: Request) => {
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

    const { data: queueItems, error: fetchError } = await supabaseClient
      .from('improvement_queue')
      .select('*')
      .in('status', ['pending', 'in_progress', 'blocked'])

    if (fetchError) {
      throw new Error(`Failed to fetch queue items: ${fetchError.message}`)
    }

    const auditResults: AuditResult[] = (queueItems || []).map(analyzeItem)
    
    const staleCount = auditResults.filter(r => r.is_stale).length
    const highPriorityCount = auditResults.filter(r => r.priority_score > 80).length
    const totalIssues = auditResults.reduce((sum, r) => sum + r.issues.length, 0)

    const auditLog = {
      audit_type: 'improvement_queue',
      items_audited: auditResults.length,
      stale_items: staleCount,
      high_priority_items: highPriorityCount,
      total_issues: totalIssues,
      results: auditResults,
      audited_at: new Date().toISOString()
    }

    const { error: logError } = await supabaseClient
      .from('audit_logs')
      .insert(auditLog)

    if (logError) {
      console.error('Failed to log audit results:', logError)
    }

    for (const result of auditResults) {
      if (result.priority_score !== 50) {
        await supabaseClient
          .from('improvement_queue')
          .update({ priority: result.priority_score })
          .eq('id', result.item_id)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          total_items: auditResults.length,
          stale_items: staleCount,
          high_priority_items: highPriorityCount,
          total_issues: totalIssues
        },
        results: auditResults
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Audit error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
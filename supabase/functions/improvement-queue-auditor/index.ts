import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  total_items: number
  stale_items: number
  invalid_statuses: number
  issues: Array<{
    id: string
    issue_type: string
    details: string
  }>
}

Deno.serve(async (req) => {
  const { method } = req

  if (method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const STALE_THRESHOLD_HOURS = 24
    const staleTime = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString()

    const { data: queueItems, error: queueError } = await supabase
      .from('improvement_queue')
      .select('*')

    if (queueError) throw queueError

    const audit_results: AuditResult = {
      total_items: queueItems?.length || 0,
      stale_items: 0,
      invalid_statuses: 0,
      issues: []
    }

    const validStatuses = ['pending', 'in_progress', 'completed', 'failed']

    for (const item of queueItems || []) {
      if (!validStatuses.includes(item.status)) {
        audit_results.invalid_statuses++
        audit_results.issues.push({
          id: item.id,
          issue_type: 'invalid_status',
          details: `Invalid status: ${item.status}`
        })
      }

      if (item.status === 'in_progress' && item.updated_at < staleTime) {
        audit_results.stale_items++
        audit_results.issues.push({
          id: item.id,
          issue_type: 'stale_item',
          details: `Item stuck in progress since ${item.updated_at}`
        })
      }

      if (item.task_id) {
        const { data: task, error: taskError } = await supabase
          .from('tasks')
          .select('id, status')
          .eq('id', item.task_id)
          .single()

        if (taskError || !task) {
          audit_results.issues.push({
            id: item.id,
            issue_type: 'missing_task',
            details: `Referenced task ${item.task_id} not found`
          })
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        audit_results,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})
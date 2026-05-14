import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  total_items: number
  stale_items: number
  failed_items: number
  stuck_items: number
  audited_at: string
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const now = new Date()
    const staleThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const stuckThreshold = new Date(now.getTime() - 2 * 60 * 60 * 1000)

    const { data: allItems, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')

    if (fetchError) {
      throw fetchError
    }

    const totalItems = allItems?.length || 0

    const { data: staleItems, error: staleError } = await supabase
      .from('improvement_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('created_at', staleThreshold.toISOString())

    if (staleError) {
      throw staleError
    }

    const staleCount = staleItems?.length || 0

    const { data: failedItems, error: failedError } = await supabase
      .from('improvement_queue')
      .select('*')
      .eq('status', 'failed')

    if (failedError) {
      throw failedError
    }

    const failedCount = failedItems?.length || 0

    const { data: stuckItems, error: stuckError } = await supabase
      .from('improvement_queue')
      .select('*')
      .eq('status', 'processing')
      .lt('updated_at', stuckThreshold.toISOString())

    if (stuckError) {
      throw stuckError
    }

    const stuckCount = stuckItems?.length || 0

    const auditResult: AuditResult = {
      total_items: totalItems,
      stale_items: staleCount,
      failed_items: failedCount,
      stuck_items: stuckCount,
      audited_at: now.toISOString(),
    }

    const { error: logError } = await supabase
      .from('system_logs')
      .insert({
        event_type: 'improvement_queue_audit',
        severity: staleCount > 0 || stuckCount > 0 ? 'warning' : 'info',
        message: `Improvement queue audit completed: ${totalItems} total, ${staleCount} stale, ${failedCount} failed, ${stuckCount} stuck`,
        metadata: auditResult,
      })

    if (logError) {
      console.error('Failed to log audit result:', logError)
    }

    if (stuckCount > 0) {
      const { error: resetError } = await supabase
        .from('improvement_queue')
        .update({ status: 'pending', updated_at: now.toISOString() })
        .eq('status', 'processing')
        .lt('updated_at', stuckThreshold.toISOString())

      if (resetError) {
        console.error('Failed to reset stuck items:', resetError)
      } else {
        console.log(`Reset ${stuckCount} stuck items to pending`)
      }
    }

    return new Response(JSON.stringify(auditResult), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Audit error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditAction {
  type: 'stale' | 'duplicate'
  item_id: string
  reason: string
}

interface AuditReport {
  stale_count: number
  duplicate_count: number
  actions_taken: AuditAction[]
  timestamp: string
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: staleItems, error: staleError } = await supabase
      .from('improvement_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('created_at', sevenDaysAgo.toISOString())

    if (staleError) {
      throw new Error(`Failed to query stale items: ${staleError.message}`)
    }

    const actions: AuditAction[] = []

    if (staleItems && staleItems.length > 0) {
      const staleIds = staleItems.map(item => item.id)
      
      const { error: updateError } = await supabase
        .from('improvement_queue')
        .update({ status: 'expired' })
        .in('id', staleIds)

      if (updateError) {
        throw new Error(`Failed to update stale items: ${updateError.message}`)
      }

      staleItems.forEach(item => {
        actions.push({
          type: 'stale',
          item_id: item.id,
          reason: `Item older than 7 days (created: ${item.created_at})`
        })
      })
    }

    const { data: pendingItems, error: pendingError } = await supabase
      .from('improvement_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (pendingError) {
      throw new Error(`Failed to query pending items: ${pendingError.message}`)
    }

    const duplicateMap = new Map<string, any[]>()

    if (pendingItems) {
      pendingItems.forEach(item => {
        const key = `${item.task_description}::${item.context || ''}`
        if (!duplicateMap.has(key)) {
          duplicateMap.set(key, [])
        }
        duplicateMap.get(key)!.push(item)
      })

      for (const [key, items] of duplicateMap.entries()) {
        if (items.length > 1) {
          const duplicateIds = items.slice(1).map(item => item.id)
          
          const { error: dupUpdateError } = await supabase
            .from('improvement_queue')
            .update({ status: 'duplicate' })
            .in('id', duplicateIds)

          if (dupUpdateError) {
            throw new Error(`Failed to mark duplicates: ${dupUpdateError.message}`)
          }

          items.slice(1).forEach(item => {
            actions.push({
              type: 'duplicate',
              item_id: item.id,
              reason: `Duplicate of ${items[0].id}`
            })
          })
        }
      }
    }

    const staleCount = staleItems?.length || 0
    const duplicateCount = Array.from(duplicateMap.values())
      .filter(items => items.length > 1)
      .reduce((sum, items) => sum + items.length - 1, 0)

    const report: AuditReport = {
      stale_count: staleCount,
      duplicate_count: duplicateCount,
      actions_taken: actions,
      timestamp: new Date().toISOString()
    }

    return new Response(
      JSON.stringify(report),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
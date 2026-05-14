import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  status: string
  totalItems: number
  priorityDistribution: Record<string, number>
  oldestItem: Date | null
  newestItem: Date | null
  processingItems: number
  pendingItems: number
  timestamp: string
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: queueItems, error } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const priorityDistribution: Record<string, number> = {}
    let processingItems = 0
    let pendingItems = 0
    let oldestDate: Date | null = null
    let newestDate: Date | null = null

    queueItems?.forEach((item) => {
      const priority = item.priority || 'medium'
      priorityDistribution[priority] = (priorityDistribution[priority] || 0) + 1

      if (item.status === 'processing') {
        processingItems++
      } else if (item.status === 'pending') {
        pendingItems++
      }

      const itemDate = new Date(item.created_at)
      if (!oldestDate || itemDate < oldestDate) {
        oldestDate = itemDate
      }
      if (!newestDate || itemDate > newestDate) {
        newestDate = itemDate
      }
    })

    const result: AuditResult = {
      status: 'success',
      totalItems: queueItems?.length || 0,
      priorityDistribution,
      oldestItem: oldestDate,
      newestItem: newestDate,
      processingItems,
      pendingItems,
      timestamp: new Date().toISOString()
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Unknown error occurred' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
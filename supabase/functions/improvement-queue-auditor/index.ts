import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  timestamp: string
  totalItems: number
  staleItems: number
  integrityIssues: string[]
  metrics: {
    avgAgeMinutes: number
    oldestItemMinutes: number
  }
}

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment variables' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: queueItems, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: true })

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch queue items', details: fetchError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const now = new Date()
    const staleThresholdMinutes = 60
    const integrityIssues: string[] = []
    let staleCount = 0
    let totalAgeMinutes = 0

    const items = queueItems || []

    items.forEach((item) => {
      const createdAt = new Date(item.created_at)
      const ageMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60)
      totalAgeMinutes += ageMinutes

      if (ageMinutes > staleThresholdMinutes && item.status === 'pending') {
        staleCount++
      }

      if (!item.content_id) {
        integrityIssues.push(`Item ${item.id}: missing content_id`)
      }

      if (!item.improvement_type) {
        integrityIssues.push(`Item ${item.id}: missing improvement_type`)
      }

      if (item.status && !['pending', 'processing', 'completed', 'failed'].includes(item.status)) {
        integrityIssues.push(`Item ${item.id}: invalid status '${item.status}'`)
      }
    })

    const avgAgeMinutes = items.length > 0 ? totalAgeMinutes / items.length : 0
    const oldestItemMinutes = items.length > 0
      ? Math.max(...items.map(item => (now.getTime() - new Date(item.created_at).getTime()) / (1000 * 60)))
      : 0

    const auditResult: AuditResult = {
      timestamp: now.toISOString(),
      totalItems: items.length,
      staleItems: staleCount,
      integrityIssues,
      metrics: {
        avgAgeMinutes: Math.round(avgAgeMinutes * 100) / 100,
        oldestItemMinutes: Math.round(oldestItemMinutes * 100) / 100
      }
    }

    return new Response(
      JSON.stringify(auditResult),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
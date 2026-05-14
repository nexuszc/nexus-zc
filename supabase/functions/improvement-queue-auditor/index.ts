import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

interface AuditResult {
  timestamp: string
  totalEntries: number
  staleEntries: number
  invalidEntries: number
  queueHealth: string
  issues: string[]
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: queueEntries, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: false })

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch queue entries', details: fetchError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const now = new Date()
    const staleThresholdHours = 24
    const staleThreshold = new Date(now.getTime() - staleThresholdHours * 60 * 60 * 1000)

    let staleCount = 0
    let invalidCount = 0
    const issues: string[] = []

    queueEntries?.forEach((entry) => {
      const createdAt = new Date(entry.created_at)
      
      if (entry.status === 'pending' && createdAt < staleThreshold) {
        staleCount++
        issues.push(`Stale entry: ${entry.id} (created ${createdAt.toISOString()})`)
      }

      if (!entry.improvement_type || !entry.content_id) {
        invalidCount++
        issues.push(`Invalid entry: ${entry.id} (missing required fields)`)
      }

      if (!['pending', 'processing', 'completed', 'failed'].includes(entry.status)) {
        invalidCount++
        issues.push(`Invalid status: ${entry.id} (status: ${entry.status})`)
      }
    })

    const totalEntries = queueEntries?.length || 0
    let queueHealth = 'healthy'
    
    if (invalidCount > 0) {
      queueHealth = 'critical'
    } else if (staleCount > totalEntries * 0.2) {
      queueHealth = 'degraded'
    } else if (staleCount > 0) {
      queueHealth = 'warning'
    }

    const auditResult: AuditResult = {
      timestamp: now.toISOString(),
      totalEntries,
      staleEntries: staleCount,
      invalidEntries: invalidCount,
      queueHealth,
      issues: issues.slice(0, 50)
    }

    return new Response(
      JSON.stringify(auditResult),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
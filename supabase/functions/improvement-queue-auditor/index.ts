import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  total_pending: number
  oldest_pending_age_minutes: number | null
  validation_errors: string[]
  timestamp: string
}

Deno.serve(async (req: Request): Promise<Response> => {
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

    const { data: pendingImprovements, error: queryError } = await supabase
      .from('improvement_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (queryError) {
      return new Response(
        JSON.stringify({ error: 'Database query failed', details: queryError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const validationErrors: string[] = []
    const now = new Date()

    let oldestPendingAgeMinutes: number | null = null
    if (pendingImprovements && pendingImprovements.length > 0) {
      const oldestCreatedAt = new Date(pendingImprovements[0].created_at)
      oldestPendingAgeMinutes = Math.floor((now.getTime() - oldestCreatedAt.getTime()) / 1000 / 60)

      for (const improvement of pendingImprovements) {
        if (!improvement.task_id) {
          validationErrors.push(`Improvement ${improvement.id} missing task_id`)
        }
        if (!improvement.improvement_type) {
          validationErrors.push(`Improvement ${improvement.id} missing improvement_type`)
        }
      }
    }

    const auditResult: AuditResult = {
      total_pending: pendingImprovements?.length || 0,
      oldest_pending_age_minutes: oldestPendingAgeMinutes,
      validation_errors: validationErrors,
      timestamp: now.toISOString()
    }

    const { error: logError } = await supabase
      .from('audit_logs')
      .insert({
        audit_type: 'improvement_queue',
        result: auditResult,
        created_at: now.toISOString()
      })

    if (logError) {
      console.error('Failed to log audit result:', logError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        audit: auditResult
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Improvement queue audit error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})
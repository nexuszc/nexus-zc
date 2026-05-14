import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  itemId: string
  status: string
  issues: string[]
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: queueItems, error: fetchError } = await supabaseAdmin
      .from('improvement_queue')
      .select('*')
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: true })

    if (fetchError) {
      throw new Error(`Failed to fetch queue items: ${fetchError.message}`)
    }

    const auditResults: AuditResult[] = []
    const now = new Date()

    for (const item of queueItems || []) {
      const issues: string[] = []
      
      if (item.status === 'in_progress') {
        const startedAt = new Date(item.started_at)
        const hoursSinceStart = (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60)
        
        if (hoursSinceStart > 24) {
          issues.push('Item stuck in progress for over 24 hours')
        }
      }

      if (item.status === 'pending') {
        const createdAt = new Date(item.created_at)
        const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
        
        if (daysSinceCreation > 7) {
          issues.push('Item pending for over 7 days')
        }
      }

      if (!item.prompt || item.prompt.trim().length === 0) {
        issues.push('Missing or empty prompt')
      }

      if (!item.target_file_path) {
        issues.push('Missing target file path')
      }

      if (issues.length > 0) {
        auditResults.push({
          itemId: item.id,
          status: item.status,
          issues
        })

        await supabaseAdmin
          .from('improvement_queue_audit_log')
          .insert({
            queue_item_id: item.id,
            audit_timestamp: now.toISOString(),
            issues: issues,
            audited_by: user.id
          })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Audit completed',
        audited_items: queueItems?.length || 0,
        issues_found: auditResults.length,
        results: auditResults
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Audit error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
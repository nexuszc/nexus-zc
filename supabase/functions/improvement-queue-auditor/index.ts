import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  totalItems: number
  itemsAudited: number
  issues: string[]
}

Deno.serve(async (req) => {
  try {
    const { method } = req

    if (method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: queueItems, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: false })

    if (fetchError) {
      throw new Error(`Failed to fetch queue items: ${fetchError.message}`)
    }

    const issues: string[] = []
    let itemsAudited = 0

    for (const item of queueItems || []) {
      itemsAudited++

      if (!item.status) {
        issues.push(`Item ${item.id} missing status`)
      }

      if (item.status === 'pending' && item.created_at) {
        const createdAt = new Date(item.created_at)
        const daysSinceCreated = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
        
        if (daysSinceCreated > 30) {
          issues.push(`Item ${item.id} pending for ${Math.floor(daysSinceCreated)} days`)
        }
      }

      if (!item.improvement_type) {
        issues.push(`Item ${item.id} missing improvement_type`)
      }
    }

    const result: AuditResult = {
      totalItems: queueItems?.length || 0,
      itemsAudited,
      issues
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Improvement queue audited',
        result
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
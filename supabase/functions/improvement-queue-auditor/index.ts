import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  totalItems: number
  duplicates: number
  invalidPriorities: number
  invalidStatuses: number
  issues: Array<{
    type: string
    message: string
    itemId?: string
  }>
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: items, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')
      .order('created_at', { ascending: false })

    if (fetchError) {
      throw new Error(`Failed to fetch improvement queue: ${fetchError.message}`)
    }

    const result: AuditResult = {
      totalItems: items?.length || 0,
      duplicates: 0,
      invalidPriorities: 0,
      invalidStatuses: 0,
      issues: [],
    }

    if (!items || items.length === 0) {
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const validPriorities = ['low', 'medium', 'high', 'critical']
    const validStatuses = ['pending', 'in_progress', 'completed', 'rejected']
    const contentMap = new Map<string, string[]>()

    for (const item of items) {
      if (item.priority && !validPriorities.includes(item.priority)) {
        result.invalidPriorities++
        result.issues.push({
          type: 'invalid_priority',
          message: `Invalid priority: ${item.priority}`,
          itemId: item.id,
        })
      }

      if (item.status && !validStatuses.includes(item.status)) {
        result.invalidStatuses++
        result.issues.push({
          type: 'invalid_status',
          message: `Invalid status: ${item.status}`,
          itemId: item.id,
        })
      }

      if (item.content) {
        const normalized = item.content.trim().toLowerCase()
        if (contentMap.has(normalized)) {
          result.duplicates++
          result.issues.push({
            type: 'duplicate',
            message: `Duplicate content found`,
            itemId: item.id,
          })
          contentMap.get(normalized)!.push(item.id)
        } else {
          contentMap.set(normalized, [item.id])
        }
      }
    }

    console.log('Audit completed:', {
      total: result.totalItems,
      duplicates: result.duplicates,
      invalidPriorities: result.invalidPriorities,
      invalidStatuses: result.invalidStatuses,
      issueCount: result.issues.length,
    })

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Audit error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
})
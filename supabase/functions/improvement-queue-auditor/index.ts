import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface AuditReport {
  total_items: number
  completed_items: number
  pending_items: number
  failed_items: number
  completion_rate: number
  items: QueueItem[]
}

interface QueueItem {
  id: string
  title: string
  status: string
  priority: number
  created_at: string
  updated_at: string
  completed_at?: string
  error_message?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const status = url.searchParams.get('status')
      const limit = parseInt(url.searchParams.get('limit') || '100')

      let query = supabaseClient
        .from('improvement_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (status) {
        query = query.eq('status', status)
      }

      const { data: items, error } = await query

      if (error) {
        throw error
      }

      const queueItems: QueueItem[] = items || []
      const totalItems = queueItems.length
      const completedItems = queueItems.filter(item => item.status === 'completed').length
      const pendingItems = queueItems.filter(item => item.status === 'pending').length
      const failedItems = queueItems.filter(item => item.status === 'failed').length
      const completionRate = totalItems > 0 ? (completedItems / totalItems) * 100 : 0

      const auditReport: AuditReport = {
        total_items: totalItems,
        completed_items: completedItems,
        pending_items: pendingItems,
        failed_items: failedItems,
        completion_rate: parseFloat(completionRate.toFixed(2)),
        items: queueItems,
      }

      return new Response(JSON.stringify(auditReport), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (req.method === 'POST') {
      const body = await req.json()
      const { item_id, validate_only } = body

      if (item_id) {
        const { data: item, error } = await supabaseClient
          .from('improvement_queue')
          .select('*')
          .eq('id', item_id)
          .single()

        if (error) {
          throw error
        }

        const validationResult = {
          id: item.id,
          is_valid: true,
          status: item.status,
          has_error: !!item.error_message,
          validation_timestamp: new Date().toISOString(),
        }

        if (item.status === 'failed' && !item.error_message) {
          validationResult.is_valid = false
        }

        if (!validate_only && item.status === 'completed') {
          await supabaseClient
            .from('improvement_queue')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', item_id)
        }

        return new Response(JSON.stringify(validationResult), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      const { data: allItems, error: fetchError } = await supabaseClient
        .from('improvement_queue')
        .select('*')

      if (fetchError) {
        throw fetchError
      }

      const validationResults = (allItems || []).map(item => ({
        id: item.id,
        is_valid: !(item.status === 'failed' && !item.error_message),
        status: item.status,
        has_error: !!item.error_message,
      }))

      return new Response(JSON.stringify({
        total_validated: validationResults.length,
        valid_items: validationResults.filter(r => r.is_valid).length,
        invalid_items: validationResults.filter(r => !r.is_valid).length,
        results: validationResults,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
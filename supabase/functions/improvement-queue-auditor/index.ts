import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AuditResult {
  totalItems: number
  staleItems: number
  invalidPriorities: number
  statusDistribution: Record<string, number>
  issues: string[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
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

    const { data: items, error: fetchError } = await supabaseClient
      .from('improvement_queue')
      .select('*')

    if (fetchError) {
      throw fetchError
    }

    const now = new Date()
    const staleThresholdDays = 30
    const staleThreshold = new Date(now.getTime() - staleThresholdDays * 24 * 60 * 60 * 1000)

    const auditResult: AuditResult = {
      totalItems: items?.length || 0,
      staleItems: 0,
      invalidPriorities: 0,
      statusDistribution: {},
      issues: [],
    }

    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled']
    const validPriorities = ['low', 'medium', 'high', 'critical']

    items?.forEach((item) => {
      const status = item.status || 'unknown'
      auditResult.statusDistribution[status] = (auditResult.statusDistribution[status] || 0) + 1

      if (!validStatuses.includes(status)) {
        auditResult.issues.push(`Invalid status "${status}" for item ${item.id}`)
      }

      if (item.priority && !validPriorities.includes(item.priority)) {
        auditResult.invalidPriorities++
        auditResult.issues.push(`Invalid priority "${item.priority}" for item ${item.id}`)
      }

      const createdAt = new Date(item.created_at)
      if (createdAt < staleThreshold && status === 'pending') {
        auditResult.staleItems++
        auditResult.issues.push(`Stale item ${item.id} pending since ${item.created_at}`)
      }
    })

    return new Response(JSON.stringify(auditResult), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  }
})
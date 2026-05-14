import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AuditResult {
  total_improvements: number
  pending_count: number
  in_progress_count: number
  completed_count: number
  failed_count: number
  stale_improvements: number
  avg_processing_time_minutes: number
  issues: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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

    const { data: improvements, error: fetchError } = await supabaseClient
      .from('improvement_queue')
      .select('*')

    if (fetchError) {
      throw fetchError
    }

    const now = new Date()
    const issues: string[] = []

    const pending_count = improvements?.filter(i => i.status === 'pending').length || 0
    const in_progress_count = improvements?.filter(i => i.status === 'in_progress').length || 0
    const completed_count = improvements?.filter(i => i.status === 'completed').length || 0
    const failed_count = improvements?.filter(i => i.status === 'failed').length || 0

    const staleThresholdMinutes = 30
    const stale_improvements = improvements?.filter(i => {
      if (i.status !== 'in_progress') return false
      const updatedAt = new Date(i.updated_at)
      const minutesDiff = (now.getTime() - updatedAt.getTime()) / (1000 * 60)
      return minutesDiff > staleThresholdMinutes
    }).length || 0

    if (stale_improvements > 0) {
      issues.push(`${stale_improvements} improvements in progress for over ${staleThresholdMinutes} minutes`)
    }

    if (failed_count > 0) {
      issues.push(`${failed_count} failed improvements require attention`)
    }

    const completedImprovements = improvements?.filter(i => 
      i.status === 'completed' && i.created_at && i.updated_at
    ) || []

    let avg_processing_time_minutes = 0
    if (completedImprovements.length > 0) {
      const totalMinutes = completedImprovements.reduce((sum, i) => {
        const created = new Date(i.created_at).getTime()
        const updated = new Date(i.updated_at).getTime()
        return sum + ((updated - created) / (1000 * 60))
      }, 0)
      avg_processing_time_minutes = totalMinutes / completedImprovements.length
    }

    const result: AuditResult = {
      total_improvements: improvements?.length || 0,
      pending_count,
      in_progress_count,
      completed_count,
      failed_count,
      stale_improvements,
      avg_processing_time_minutes: Math.round(avg_processing_time_minutes * 100) / 100,
      issues
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface ImprovementItem {
  id: string
  title: string
  description: string
  priority: number
  status: string
  created_at: string
  metadata?: any
}

interface SystemState {
  error_logs: any[]
  recent_builds: any[]
  abilities: any[]
}

interface ValidationResult {
  item: ImprovementItem
  is_valid: boolean
  validation_score: number
  contradictions: string[]
  staleness_days: number
  recommendation: 'keep' | 'remove' | 'review'
  reasoning: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const pending_improvements = await supabase
      .from('improvement_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })

    if (pending_improvements.error) throw pending_improvements.error

    const error_logs = await supabase
      .from('error_logs')
      .select('*')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })

    const recent_builds = await supabase
      .from('builds')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    const abilities = await supabase
      .from('abilities')
      .select('*')
      .eq('status', 'active')

    const system_state: SystemState = {
      error_logs: error_logs.data || [],
      recent_builds: recent_builds.data || [],
      abilities: abilities.data || []
    }

    const validation_results: ValidationResult[] = []

    for (const item of pending_improvements.data || []) {
      const result = await validateImprovement(item, system_state)
      validation_results.push(result)

      if (result.recommendation === 'remove') {
        await supabase
          .from('improvement_queue')
          .update({
            status: 'invalid',
            metadata: {
              ...(item.metadata || {}),
              audit_result: {
                contradictions: result.contradictions,
                reasoning: result.reasoning,
                audited_at: new Date().toISOString()
              }
            }
          })
          .eq('id', item.id)
      }
    }

    const valid_queue = validation_results
      .filter(r => r.recommendation === 'keep')
      .sort((a, b) => b.validation_score - a.validation_score)

    const removed_items = validation_results.filter(r => r.recommendation === 'remove')

    return new Response(
      JSON.stringify({
        success: true,
        audit_timestamp: new Date().toISOString(),
        total_items_audited: validation_results.length,
        valid_items: valid_queue.length,
        removed_items: removed_items.length,
        review_items: validation_results.filter(r => r.recommendation === 'review').length,
        validated_queue: valid_queue,
        removed: removed_items.map(r => ({
          id: r.item.id,
          title: r.item.title,
          reasoning: r.reasoning,
          contradictions: r.contradictions
        })),
        system_state_snapshot: {
          active_errors: system_state.error_logs.length,
          recent_builds: system_state.recent_builds.length,
          active_abilities: system_state.abilities.length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Audit error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

async function validateImprovement(
  item: ImprovementItem,
  state: SystemState
): Promise<ValidationResult> {
  const contradictions: string[] = []
  let validation_score = 100
  
  const now = new Date()
  const created = new Date(item.created_at)
  const staleness_days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))

  if (staleness_days > 30) {
    contradictions.push(`Item is ${staleness_days} days old, possibly stale`)
    validation_score -= 20
  }

  const title_lower = item.title.toLowerCase()
  const desc_lower = (item.description || '').toLowerCase()
  const combined = `${title_lower} ${desc_lower}`

  if (combined.includes('fix') || combined.includes('error') || combined.includes('bug')) {
    const mentioned_errors = extractErrorReferences(combined)
    
    if (mentioned_errors.length > 0) {
      const error_exists = mentioned_errors.some(err_ref => 
        state.error_logs.some(log => 
          JSON.stringify(log).toLowerCase().includes(err_ref)
        )
      )

      if (!error_exists && state.error_logs.length === 0) {
        contradictions.push('References error/bug but no recent errors exist in system')
        validation_score -= 40
      } else if (!error_exists) {
        contradictions.push('Referenced error pattern not found in recent logs')
        validation_score -= 25
      }
    }
  }

  if (combined.includes('ability') || combined.includes('function')) {
    const mentioned_abilities = extractAbilityReferences(combined)
    
    for (const ability_ref of mentioned_abilities) {
      const exists = state.abilities.some(a => 
        a.name.toLowerCase().includes(ability_ref) ||
        a.slug?.toLowerCase().includes(ability_ref)
      )

      if (combined.includes('add') || combined.includes('create')) {
        if (exists) {
          contradictions.push(`Proposes adding '${ability_ref}' but it already exists`)
          validation_score -= 30
        }
      } else if (combined.includes('fix') || combined.includes('update')) {
        if (!exists) {
          contradictions.push(`Proposes fixing '${ability_ref}' but it doesn't exist`)
          validation_score -= 35
        }
      }
    }
  }

  if (combined.includes('build') || combined.includes('deploy')) {
    const recent_build_failures = state.recent_builds.filter(b => 
      b.status === 'failed' || b.status === 'error'
    ).length

    if (recent_build_failures === 0 && combined.includes('fix')) {
      contradictions.push('Mentions fixing build issues but recent builds are successful')
      validation_score -= 30
    }
  }

  const recent_success_rate = calculateRecentSuccessRate(state.recent_builds)
  if (recent_success_rate > 0.9 && combined.includes('critical')) {
    contradictions.push(`Marked critical but system health is good (${(recent_success_rate * 100).toFixed(
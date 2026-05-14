import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ImprovementQueueEntry {
  id: string
  created_at: string
  status: string
  priority: number
  title: string
  description: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Missing environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    const { data: pendingEntries, error: fetchError } = await supabase
      .from('improvement_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })

    if (fetchError) {
      throw fetchError
    }

    const auditResults = {
      timestamp: new Date().toISOString(),
      total_pending: pendingEntries?.length || 0,
      entries_audited: 0,
      entries_processed: 0,
      errors: [] as string[],
    }

    if (pendingEntries && pendingEntries.length > 0) {
      for (const entry of pendingEntries) {
        auditResults.entries_audited++

        try {
          const shouldProcess = entry.priority >= 5

          if (shouldProcess) {
            const { error: updateError } = await supabase
              .from('improvement_queue')
              .update({ 
                status: 'processing',
                updated_at: new Date().toISOString()
              })
              .eq('id', entry.id)

            if (updateError) {
              auditResults.errors.push(`Failed to update entry ${entry.id}: ${updateError.message}`)
            } else {
              auditResults.entries_processed++
            }
          }
        } catch (error) {
          auditResults.errors.push(`Error processing entry ${entry.id}: ${error.message}`)
        }
      }
    }

    return new Response(
      JSON.stringify(auditResults),
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
        status: 500,
      }
    )
  }
})
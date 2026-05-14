import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface VerificationRequest {
  improvement_id?: string
  batch_size?: number
}

interface ImprovementRecord {
  id: string
  original_text: string
  improved_text: string
  improvement_type: string
  status: string
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

async function verifyImprovement(improvement: ImprovementRecord): Promise<boolean> {
  if (!improvement.improved_text || improvement.improved_text.trim().length === 0) {
    return false
  }

  if (improvement.improved_text === improvement.original_text) {
    return false
  }

  if (improvement.improved_text.length < 10) {
    return false
  }

  return true
}

async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    
    let improvementId: string | undefined
    let batchSize = 10

    if (request.method === 'POST') {
      const body: VerificationRequest = await request.json()
      improvementId = body.improvement_id
      batchSize = body.batch_size ?? 10
    }

    let query = supabase
      .from('improvements')
      .select('*')
      .eq('status', 'pending')
      .limit(batchSize)

    if (improvementId) {
      query = query.eq('id', improvementId)
    }

    const { data: improvements, error: fetchError } = await query

    if (fetchError) {
      throw new Error(`Failed to fetch improvements: ${fetchError.message}`)
    }

    if (!improvements || improvements.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No pending improvements to verify',
          processed: 0 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    const verificationResults = []

    for (const improvement of improvements) {
      const isValid = await verifyImprovement(improvement)
      
      const newStatus = isValid ? 'verified' : 'failed'
      
      const { error: updateError } = await supabase
        .from('improvements')
        .update({ 
          status: newStatus,
          verified_at: new Date().toISOString()
        })
        .eq('id', improvement.id)

      if (updateError) {
        console.error(`Failed to update improvement ${improvement.id}:`, updateError)
        verificationResults.push({
          id: improvement.id,
          success: false,
          error: updateError.message
        })
      } else {
        verificationResults.push({
          id: improvement.id,
          success: true,
          status: newStatus
        })
      }
    }

    const successCount = verificationResults.filter(r => r.success).length

    return new Response(
      JSON.stringify({
        success: true,
        processed: verificationResults.length,
        verified: successCount,
        results: verificationResults
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error in verify-improvements-queue:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
}

Deno.serve(async (req) => {
  return handler(req)
})
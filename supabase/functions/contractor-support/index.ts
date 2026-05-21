import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_KEY   = Deno.env.get('ANTHROPIC_API_KEY')!
const TELEGRAM_TOKEN  = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const TELEGRAM_CHAT   = Deno.env.get('TELEGRAM_CHAT_ID')!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const PRICING_KEYWORDS = [
  'price', 'pricing', 'cost', 'how much', 'upgrade', 'plan', 'subscription',
  'aria', 'measurements', 'supplement', 'add-on', 'addon', 'cancel', 'refund',
  'discount', 'trial', 'billing', 'invoice', 'charge',
]

const URGENT_KEYWORDS = [
  'broken', 'not working', 'error', 'bug', 'crash', 'down', 'failed', 'issue',
  'problem', 'help', 'urgent', 'asap', 'emergency',
]

function isPricingQuestion(q: string): boolean {
  const lower = q.toLowerCase()
  return PRICING_KEYWORDS.some(k => lower.includes(k))
}

function isUrgentIssue(q: string): boolean {
  const lower = q.toLowerCase()
  return URGENT_KEYWORDS.some(k => lower.includes(k))
}

async function tg(text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'Markdown' }),
  }).catch(() => {})
}

async function getContractorRole(contractorId: string): Promise<Record<string, unknown> | null> {
  if (!contractorId) return null
  const { data } = await supabase
    .from('contractor_accounts')
    .select('plan, status, onboarding_completed, onboarding_step, total_jobs, company_name, first_job_created_at, trial_ends_at')
    .eq('id', contractorId)
    .single()
  return data
}

async function getKnowledge(): Promise<string> {
  const { data } = await supabase
    .from('knowledge_base')
    .select('topic, content')
    .overlaps('tags', ['roofing_onboarding'])
    .limit(10)
  if (!data || data.length === 0) return ''
  return data.map(r => `— ${r.content}`).join('\n\n')
}

async function askClaude(question: string, knowledge: string, role: Record<string, unknown> | null): Promise<string> {
  const roleContext = role ? `
CONTRACTOR CONTEXT:
- Plan: ${role.plan || 'free'}
- Status: ${role.status || 'active'}
- Jobs created: ${role.total_jobs || 0}
- Onboarding complete: ${role.onboarding_completed ? 'yes' : 'no'}
- Onboarding step: ${role.onboarding_step || 'not started'}
- First job: ${role.first_job_created_at ? 'yes' : 'not yet'}
` : ''

  const systemPrompt = `You are Aria, the support assistant for Roofing OS. You help roofing contractors get started and get value quickly.

Keep answers short (2-4 sentences max). Be direct and practical. Use their context to give specific guidance.
If you don't know the answer, say: "I'll have Zach follow up with you on that."

${roleContext}
KNOWLEDGE BASE:
${knowledge}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
    }),
  })
  const data = await res.json()
  return data.content?.[0]?.text || "I'll have Zach follow up on that."
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { question, contractor_id, contractor_name } = await req.json()
    if (!question?.trim()) return Response.json({ error: 'question required' }, { status: 400, headers: cors })

    const pricing = isPricingQuestion(question)
    const urgent = isUrgentIssue(question)

    const [role, knowledge] = await Promise.all([
      getContractorRole(contractor_id),
      getKnowledge(),
    ])

    const answer = await askClaude(question, knowledge, role)

    const name = contractor_name || role?.company_name as string || contractor_id || 'unknown'
    const plan = role?.plan || 'free'
    const jobs = role?.total_jobs || 0

    if (pricing) {
      await tg(`💬 *Pricing question* — ${name} (${plan}, ${jobs} jobs)\n\n"${question}"\n\n_Aria answered. Follow up recommended._`)
    } else if (urgent) {
      await tg(`🚨 *Support issue* — ${name} (${plan})\n\n"${question}"\n\nAria: "${answer.slice(0, 200)}"`)
    }

    return Response.json({
      ok: true,
      answer,
      escalated: String(pricing),
      role: role ? { plan, jobs, onboarded: role.onboarding_completed } : null,
    }, { headers: cors })
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500, headers: cors })
  }
})

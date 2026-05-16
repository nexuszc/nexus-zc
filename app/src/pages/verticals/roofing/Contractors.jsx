import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const OUTCOME_COLORS = {
  appointment_booked: 'text-green-400 bg-green-500/10',
  interested:         'text-indigo-400 bg-indigo-500/10',
  callback_requested: 'text-cyan-400 bg-cyan-500/10',
  not_interested:     'text-red-400 bg-red-500/10',
  voicemail:          'text-amber-400 bg-amber-500/10',
  no_answer:          'text-gray-500 bg-gray-700/30',
}

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const ROLE_BADGE = {
  owner: 'bg-orange-900/50 text-orange-300',
  pm:    'bg-blue-900/50 text-blue-300',
  sales: 'bg-violet-900/50 text-violet-300',
  crew:  'bg-green-900/50 text-green-300',
  admin: 'bg-gray-800 text-gray-400',
}

const TEAM_ROLES = ['owner', 'pm', 'sales', 'crew', 'admin']

function TeamSection({ contractorId }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', phone: '', role: 'pm' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('contractor_team_members')
      .select('*')
      .eq('contractor_id', contractorId)
      .eq('active', true)
      .order('created_at', { ascending: false })
    setMembers(data || [])
    setLoading(false)
  }, [contractorId])

  useEffect(() => { load() }, [load])

  const add = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) return
    const digits = form.phone.replace(/\D/g, '')
    const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`
    setSaving(true)
    await supabase.from('contractor_team_members').insert({
      contractor_id: contractorId,
      name: form.name.trim(),
      phone: normalized,
      role: form.role,
    })
    setForm({ name: '', phone: '', role: 'pm' })
    setSaving(false)
    load()
  }

  const remove = async (id) => {
    await supabase.from('contractor_team_members').update({ active: false }).eq('id', id)
    load()
  }

  if (loading) return <div className="py-3 px-4 text-xs text-gray-600">Loading team...</div>

  return (
    <div className="border-t border-[#1e1e2e] mt-3 pt-3">
      <div className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-2 px-1">
        Team — call/text +1 (720) 292-1930
      </div>
      {members.length === 0 ? (
        <p className="text-xs text-gray-600 px-1 mb-3">No team members yet.</p>
      ) : (
        <div className="space-y-1 mb-3">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-3 py-1.5 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-400 shrink-0">
                  {m.name[0].toUpperCase()}
                </span>
                <div className="min-w-0">
                  <span className="text-xs font-medium text-white mr-2">{m.name}</span>
                  <span className="text-xs text-gray-600 font-mono">{m.phone}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[m.role] || ROLE_BADGE.admin}`}>
                  {m.role}
                </span>
                <button
                  onClick={() => remove(m.id)}
                  className="text-[10px] text-gray-700 hover:text-red-400 transition-colors"
                >
                  remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex gap-2 flex-wrap">
        <input
          type="text" placeholder="Name"
          value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          className="bg-[#0a0a0f] border border-[#2a2a3e] text-white text-xs rounded-lg px-2.5 py-1.5 placeholder-gray-700 focus:outline-none focus:border-indigo-600/60 w-28 flex-1 min-w-[100px]"
        />
        <input
          type="tel" placeholder="Phone"
          value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          className="bg-[#0a0a0f] border border-[#2a2a3e] text-white text-xs rounded-lg px-2.5 py-1.5 placeholder-gray-700 focus:outline-none focus:border-indigo-600/60 w-32 flex-1 min-w-[110px]"
        />
        <select
          value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
          className="bg-[#0a0a0f] border border-[#2a2a3e] text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none"
        >
          {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button
          type="submit" disabled={saving || !form.name.trim() || !form.phone.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          {saving ? '…' : '+ Add'}
        </button>
      </form>
    </div>
  )
}

function InboundCallsSection({ contractorId }) {
  const [calls, setCalls]   = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('roofing_aria_calls')
      .select('id, to_number, outcome, duration_seconds, created_at')
      .eq('call_type', 'inbound')
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })
      .limit(10)
    setCalls(data || [])
    setLoading(false)
  }, [contractorId])

  useEffect(() => { load() }, [load])

  return (
    <div className="mt-3 border-t border-[#1e1e2e] pt-3">
      <div className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-2">Inbound Calls</div>
      {loading ? (
        <div className="text-xs text-gray-700 py-1">Loading…</div>
      ) : calls.length === 0 ? (
        <div className="text-xs text-gray-700 py-1">No inbound calls recorded.</div>
      ) : (
        <div className="space-y-1">
          {calls.map(call => (
            <div key={call.id} className="flex items-center gap-3 py-1 text-xs">
              <span className="text-gray-400 font-mono shrink-0">{call.to_number || '—'}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${OUTCOME_COLORS[call.outcome] || 'text-gray-500 bg-gray-800'}`}>
                {call.outcome?.replace(/_/g, ' ') || 'unknown'}
              </span>
              <span className="text-gray-600 shrink-0">
                {call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : '—'}
              </span>
              <span className="text-gray-700 ml-auto shrink-0">{ago(call.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const PLAN_COLORS = {
  trial:    'text-amber-400 bg-amber-500/10',
  starter:  'text-blue-400 bg-blue-500/10',
  pro:      'text-indigo-400 bg-indigo-500/10',
  elite:    'text-purple-400 bg-purple-500/10',
}

const CHURN_COLORS = ['text-green-400', 'text-green-300', 'text-amber-400', 'text-red-400', 'text-red-500']

export default function Contractors() {
  const [contractors, setContractors] = useState([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [expanded, setExpanded]       = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('contractor_accounts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setContractors(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = contractors.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return `${c.company_name} ${c.owner_name} ${c.owner_email} ${c.owner_phone}`.toLowerCase().includes(q)
  })

  const active  = contractors.filter(c => c.subscription_status === 'active' || c.status === 'active')
  const trial   = contractors.filter(c => c.subscription_status === 'trialing' || c.plan === 'trial' || (c.trial_ends_at && new Date(c.trial_ends_at) > new Date() && c.subscription_status !== 'active' && c.subscription_status !== 'trialing'))
  const churned = contractors.filter(c => c.subscription_status === 'cancelled' || c.status === 'churned')

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Contractors</h1>
          <p className="text-gray-500 text-sm mt-0.5">{active.length} active · {trial.length} trial · {churned.length} churned</p>
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Active</div>
          <div className="text-2xl font-black text-white">{active.length}</div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Trial</div>
          <div className="text-2xl font-black text-amber-400">{trial.length}</div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">MRR</div>
          <div className="text-2xl font-black text-indigo-400">
            ${active.reduce((s, c) => s + (c.plan_price_cents || 0), 0) / 100 | 0}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, email, phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full sm:w-72 bg-[#12121a] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="skeleton h-16 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
          <p className="text-gray-600 text-sm">No contractors found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id}>
              <div
                onClick={() => setExpanded(e => e === c.id ? null : c.id)}
                className="bg-[#12121a] border border-[#1e1e2e] hover:border-[#2a2a3e] rounded-xl p-4 cursor-pointer transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{c.company_name || c.owner_name || 'Unknown'}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${PLAN_COLORS[c.plan] || 'text-gray-500 bg-gray-800'}`}>
                        {c.plan || c.subscription_status || 'unknown'}
                      </span>
                      {c.churn_risk_score != null && (
                        <span className={`text-[10px] font-semibold ${CHURN_COLORS[Math.min(4, Math.floor(c.churn_risk_score / 20))]}`}>
                          Risk: {c.churn_risk_score}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {c.owner_name && c.owner_name !== c.company_name ? `${c.owner_name} · ` : ''}
                      {c.owner_email || ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-white">
                      ${((c.plan_price_cents || 0) / 100).toFixed(0)}/mo
                    </div>
                    <div className="text-[10px] text-gray-600">{ago(c.created_at)}</div>
                  </div>
                </div>
              </div>

              {expanded === c.id && (
                <div className="bg-[#0e0e18] border border-[#1e1e2e] border-t-0 rounded-b-xl px-4 py-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Phone</div>
                      <div className="text-gray-300 font-mono">{c.owner_phone || c.phone || '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Subdomain</div>
                      <div className="text-gray-300 font-mono">{c.subdomain ? `${c.subdomain}.nexuszc.com` : '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Trial Ends</div>
                      <div className="text-gray-300">{c.trial_ends_at ? new Date(c.trial_ends_at).toLocaleDateString() : '—'}</div>
                    </div>
                    <div>
                      <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Stripe</div>
                      <div className="text-gray-300 font-mono truncate">{c.stripe_customer_id || '—'}</div>
                    </div>
                    {c.referral_code && (
                      <div>
                        <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Referral Code</div>
                        <div className="text-gray-300 font-mono">{c.referral_code}</div>
                      </div>
                    )}
                    {c.state && (
                      <div>
                        <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Location</div>
                        <div className="text-gray-300">{[c.primary_zip, c.state].filter(Boolean).join(' · ')}</div>
                      </div>
                    )}
                  </div>
                  <TeamSection contractorId={c.id} />
                  <InboundCallsSection contractorId={c.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

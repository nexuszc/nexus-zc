import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
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
    return `${c.business_name} ${c.owner_name} ${c.email} ${c.phone}`.toLowerCase().includes(q)
  })

  const active  = contractors.filter(c => c.status === 'active')
  const trial   = contractors.filter(c => c.status === 'trial' || c.plan === 'trial')
  const churned = contractors.filter(c => c.status === 'churned' || c.status === 'cancelled')

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
            ${active.reduce((s, c) => s + (c.monthly_fee_cents || 0), 0) / 100 | 0}
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
                      <span className="text-sm font-semibold text-white">{c.business_name || c.owner_name || 'Unknown'}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${PLAN_COLORS[c.plan] || 'text-gray-500 bg-gray-800'}`}>
                        {c.plan || c.status || 'unknown'}
                      </span>
                      {c.churn_risk_score != null && (
                        <span className={`text-[10px] font-semibold ${CHURN_COLORS[Math.min(4, Math.floor(c.churn_risk_score * 5))]}`}>
                          Risk: {Math.round(c.churn_risk_score * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {c.owner_name && c.owner_name !== c.business_name ? `${c.owner_name} · ` : ''}
                      {c.email || ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-white">
                      ${((c.monthly_fee_cents || 0) / 100).toFixed(0)}/mo
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
                      <div className="text-gray-300 font-mono">{c.phone || '—'}</div>
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
                    {c.city && (
                      <div>
                        <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Location</div>
                        <div className="text-gray-300">{[c.city, c.state].filter(Boolean).join(', ')}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

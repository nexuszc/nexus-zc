import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const PLAN_COLORS = {
  free:    'bg-gray-700 text-gray-300',
  starter: 'bg-blue-900 text-blue-300',
  pro:     'bg-purple-900 text-purple-300',
  custom:  'bg-green-900 text-green-300',
}

const STATUS_DOTS = {
  active:  'bg-green-400',
  trial:   'bg-yellow-400',
  churned: 'bg-red-400',
}

function StatCard({ label, value, accent }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-1"
      style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>{label}</p>
      <p className="text-2xl font-bold leading-tight" style={{ color: accent || '#ffffff' }}>{value}</p>
    </div>
  )
}

function SmallStat({ label, value }) {
  return (
    <div
      className="rounded-xl px-4 py-3 flex flex-col gap-0.5"
      style={{ background: 'rgba(74,158,255,0.06)', border: '1px solid rgba(74,158,255,0.12)' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  )
}

export default function RoofingCustomers() {
  const navigate = useNavigate()

  const [counts, setCounts] = useState({ total: 0, newWeek: 0, free: 0, starter: 0, pro: 0, custom: 0 })
  const [health, setHealth] = useState({ active7: 0, jobs: 0, portals: 0, avgJobs: '0.0' })
  const [contractors, setContractors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [copied, setCopied] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    const [allRes, weekRes, jobsRes, portalsRes, rowsRes] = await Promise.allSettled([
      supabase.from('contractor_accounts').select('plan, subscription_status, updated_at', { count: 'exact' }),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      supabase.from('roofing_jobs').select('contractor_id', { count: 'exact', head: true }),
      supabase.from('homeowner_sessions').select('id', { count: 'exact', head: true }),
      supabase.from('contractor_accounts').select('id, company_name, owner_email, plan, subscription_status, market_city, created_at').order('created_at', { ascending: false }).limit(100),
    ])

    if (allRes.status === 'fulfilled' && allRes.value.data) {
      const data = allRes.value.data
      const total = allRes.value.count || data.length
      const active7 = data.filter(r => r.updated_at && new Date(r.updated_at) > new Date(weekAgo)).length
      setCounts({
        total,
        newWeek: weekRes.status === 'fulfilled' ? (weekRes.value.count || 0) : 0,
        free: data.filter(r => r.plan === 'free').length,
        starter: data.filter(r => r.plan === 'starter').length,
        pro: data.filter(r => r.plan === 'pro').length,
        custom: data.filter(r => r.plan === 'custom').length,
      })
      const jobs = jobsRes.status === 'fulfilled' ? (jobsRes.value.count || 0) : 0
      const portals = portalsRes.status === 'fulfilled' ? (portalsRes.value.count || 0) : 0
      const avgJobs = total > 0 ? (jobs / total).toFixed(1) : '0.0'
      setHealth({ active7, jobs, portals, avgJobs })
    }

    if (rowsRes.status === 'fulfilled' && rowsRes.value.data) {
      setContractors(rowsRes.value.data)
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = contractors.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (r.company_name || '').toLowerCase().includes(q) ||
      (r.owner_email || '').toLowerCase().includes(q)
    )
  })

  async function handleMagicLink(e, row) {
    e.stopPropagation()
    try {
      const res = await fetch(`${SB_URL}/functions/v1/contractor-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ action: 'generate_magic_link', contractor_id: row.id, email: row.owner_email }),
      })
      const data = await res.json()
      if (data.magic_link) {
        await navigator.clipboard.writeText(data.magic_link)
        setCopied(row.id)
        setTimeout(() => setCopied(null), 2000)
      }
    } catch {
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#0a0d1a', color: '#ffffff' }}>
      <header
        className="sticky top-0 z-30 flex items-center px-4"
        style={{ height: '56px', background: '#0a0d1a', borderBottom: '1px solid rgba(74,158,255,0.15)' }}
      >
        <button
          onClick={() => navigate('/roofing/dashboard')}
          className="flex items-center gap-1 text-sm font-medium transition-opacity hover:opacity-70"
          style={{ color: '#4a9eff' }}
        >
          <span>←</span>
          <span>Roofing OS</span>
        </button>
        <p className="absolute left-1/2 -translate-x-1/2 text-sm font-bold tracking-widest text-white">
          CUSTOMERS
        </p>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: '#4a9eff', borderTopColor: 'transparent' }} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              <StatCard label="Total" value={counts.total} accent="#4a9eff" />
              <StatCard label="New This Week" value={counts.newWeek} accent="#7c3aed" />
              <StatCard label="Free" value={counts.free} />
              <StatCard label="Starter" value={counts.starter} accent="#60a5fa" />
              <StatCard label="Pro" value={counts.pro} accent="#a78bfa" />
              <StatCard label="Custom" value={counts.custom} accent="#4ade80" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SmallStat label="Active Last 7 Days" value={health.active7} />
              <SmallStat label="Jobs Created" value={health.jobs} />
              <SmallStat label="Portals Sent" value={health.portals} />
              <SmallStat label="Avg Jobs / Contractor" value={health.avgJobs} />
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
              <div
                className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3"
                style={{ borderBottom: '1px solid rgba(74,158,255,0.1)' }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-widest flex-1" style={{ color: '#6b7a9d' }}>
                  ALL CONTRACTORS
                </p>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by company or email…"
                  className="rounded-lg px-3 py-2 text-sm outline-none w-full sm:w-64"
                  style={{
                    background: 'rgba(74,158,255,0.06)',
                    border: '1px solid rgba(74,158,255,0.2)',
                    color: '#ffffff',
                  }}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(74,158,255,0.1)' }}>
                      {['Company', 'Email', 'Plan', 'Market', 'Status', 'Since', 'Actions'].map(h => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest"
                          style={{ color: '#6b7a9d' }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => (
                      <>
                        <tr
                          key={r.id}
                          onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                          className="cursor-pointer transition-colors"
                          style={{
                            borderBottom: '1px solid rgba(74,158,255,0.06)',
                            background: expandedId === r.id ? 'rgba(74,158,255,0.06)' : 'transparent',
                          }}
                          onMouseEnter={e => { if (expandedId !== r.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                          onMouseLeave={e => { if (expandedId !== r.id) e.currentTarget.style.background = 'transparent' }}
                        >
                          <td className="px-4 py-3 font-medium text-white">
                            {r.company_name || '—'}
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: '#6b7a9d' }}>{r.owner_email || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${PLAN_COLORS[r.plan] || 'bg-gray-700 text-gray-300'}`}>
                              {r.plan || 'free'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: '#6b7a9d' }}>{r.market_city || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOTS[r.subscription_status] || 'bg-gray-500'}`} />
                              <span className="text-xs capitalize" style={{ color: '#6b7a9d' }}>{r.subscription_status || '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: '#6b7a9d' }}>
                            {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => navigate('/roofing/admin/jobs')}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-opacity hover:opacity-80"
                                style={{ background: 'rgba(74,158,255,0.15)', color: '#4a9eff', border: '1px solid rgba(74,158,255,0.25)' }}
                              >
                                View →
                              </button>
                              <button
                                onClick={e => handleMagicLink(e, r)}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-opacity hover:opacity-80"
                                style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.25)' }}
                              >
                                {copied === r.id ? 'Copied!' : '🔗 Magic Link'}
                              </button>
                            </div>
                          </td>
                        </tr>
                        {expandedId === r.id && (
                          <tr key={`${r.id}-exp`} style={{ background: 'rgba(74,158,255,0.04)', borderBottom: '1px solid rgba(74,158,255,0.1)' }}>
                            <td colSpan={7} className="px-6 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Owner Email</p>
                                  <p className="text-white break-all">{r.owner_email || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Phone</p>
                                  <p className="text-white">{r.phone || r.owner_phone || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Signup Date</p>
                                  <p className="text-white">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Current Plan</p>
                                  <p className="text-white capitalize">{r.plan || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Market City</p>
                                  <p className="text-white">{r.market_city || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Subscription</p>
                                  <p className="text-white capitalize">{r.subscription_status || '—'}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: '#6b7a9d' }}>
                          {search ? 'No contractors match your search' : 'No contractors found'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {filtered.length > 0 && (
                <div className="px-5 py-3 text-xs" style={{ color: '#6b7a9d', borderTop: '1px solid rgba(74,158,255,0.08)' }}>
                  {filtered.length} contractor{filtered.length !== 1 ? 's' : ''}{search ? ' matching' : ''}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

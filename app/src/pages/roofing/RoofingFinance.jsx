import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'

function fmt(cents) {
  const n = Math.round(cents / 100)
  return '$' + n.toLocaleString('en-US')
}

function fmtMo(cents) {
  if (!cents) return 'Free'
  return '$' + Math.round(cents / 100).toLocaleString('en-US') + '/mo'
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-1" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>{label}</p>
      <p className="text-3xl font-bold text-white leading-tight">{value}</p>
      {sub && <p className="text-[11px]" style={{ color: '#6b7a9d' }}>{sub}</p>}
    </div>
  )
}

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

export default function RoofingFinance() {
  const navigate = useNavigate()

  const [stats, setStats] = useState({ mrr: 0, thisMonth: '$0', outstanding: 0, supplements: '$0', avgJob: '$0' })
  const [chartData, setChartData] = useState([])
  const [contractors, setContractors] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [billingFilter, setBillingFilter] = useState('all')
  const [tooltip, setTooltip] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

    const [mrrRes, thisMonthRes, outstandingRes, suppRes, jobsRes, contractorRes, payRes] = await Promise.allSettled([
      supabase.from('contractor_accounts').select('plan_price_cents').neq('plan', 'free').not('plan_price_cents', 'is', null),
      supabase.from('job_payments').select('amount').eq('status', 'paid').gte('updated_at', monthStart),
      supabase.from('job_payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('supplement_status').select('amount').eq('status', 'approved').gte('created_at', monthStart),
      supabase.from('roofing_jobs').select('contract_amount'),
      supabase.from('contractor_accounts').select('id, company_name, owner_email, plan, plan_price_cents, subscription_status, created_at, market_city').order('created_at', { ascending: false }).limit(50),
      supabase.from('job_payments').select('id, amount, status, created_at, job_id').order('created_at', { ascending: false }).limit(20),
    ])

    const mrrCents = mrrRes.status === 'fulfilled' && mrrRes.value.data
      ? mrrRes.value.data.reduce((s, r) => s + (r.plan_price_cents || 0), 0)
      : 0

    const thisMonthTotal = thisMonthRes.status === 'fulfilled' && thisMonthRes.value.data
      ? thisMonthRes.value.data.reduce((s, r) => s + (r.amount || 0), 0)
      : 0

    const outstanding = outstandingRes.status === 'fulfilled' ? (outstandingRes.value.count || 0) : 0

    const suppTotal = suppRes.status === 'fulfilled' && suppRes.value.data
      ? suppRes.value.data.reduce((s, r) => s + (r.amount || 0), 0)
      : 0

    let avgJob = '$0 per job'
    if (jobsRes.status === 'fulfilled' && jobsRes.value.data && jobsRes.value.data.length) {
      const total = jobsRes.value.data.reduce((s, r) => s + (r.contract_amount || 0), 0)
      avgJob = '$' + Math.round(total / jobsRes.value.data.length).toLocaleString('en-US') + ' per job'
    }

    setStats({
      mrr: '$' + Math.round(mrrCents / 100).toLocaleString('en-US'),
      thisMonth: thisMonthTotal > 0 ? '$' + Math.round(thisMonthTotal).toLocaleString('en-US') : '$0',
      outstanding,
      supplements: suppTotal > 0 ? '$' + Math.round(suppTotal / 100).toLocaleString('en-US') : '$0',
      avgJob,
    })

    if (contractorRes.status === 'fulfilled' && contractorRes.value.data) {
      setContractors(contractorRes.value.data)

      const rows = contractorRes.value.data
      const now = Date.now()
      const days = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(now - (29 - i) * 86400000)
        d.setHours(0, 0, 0, 0)
        return d
      })
      const counts = days.map(d => {
        const next = new Date(d.getTime() + 86400000)
        return {
          date: d,
          count: rows.filter(r => {
            const t = new Date(r.created_at).getTime()
            return t >= d.getTime() && t < next.getTime()
          }).length,
        }
      })
      setChartData(counts)
    }

    if (payRes.status === 'fulfilled' && payRes.value.data) {
      setPayments(payRes.value.data)
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filteredContractors = contractors.filter(r => {
    if (billingFilter === 'free') return r.plan === 'free'
    if (billingFilter === 'paid') return r.plan !== 'free'
    if (billingFilter === 'churned') return r.subscription_status === 'churned'
    return true
  })

  const maxCount = Math.max(...chartData.map(d => d.count), 1)

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
        <p className="absolute left-1/2 -translate-x-1/2 text-sm font-bold tracking-widest" style={{ color: '#ffffff' }}>
          FINANCE
        </p>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#4a9eff', borderTopColor: 'transparent' }} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard label="MRR" value={stats.mrr} sub="active plans" />
              <StatCard label="This Month" value={stats.thisMonth} sub="collected" />
              <StatCard label="Outstanding" value={stats.outstanding} sub="pending payments" />
              <StatCard label="Supplements Recovered" value={stats.supplements} sub="approved this month" />
              <StatCard label="Avg Job Value" value={stats.avgJob} />
            </div>

            <div className="rounded-2xl p-5 space-y-4" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>
                REVENUE — LAST 30 DAYS
              </p>
              <p className="text-xs" style={{ color: '#6b7a9d' }}>Contractor signups per day</p>
              <div className="relative">
                <div className="flex items-end gap-px h-24">
                  {chartData.map((d, i) => (
                    <div
                      key={i}
                      className="flex-1 relative group cursor-pointer"
                      style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}
                      onMouseEnter={() => setTooltip({ i, d })}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      <div
                        className="w-full rounded-sm transition-opacity"
                        style={{
                          height: d.count === 0 ? '2px' : `${Math.round((d.count / maxCount) * 100)}%`,
                          background: '#4a9eff',
                          opacity: d.count === 0 ? 0.12 : 0.3 + 0.7 * (d.count / maxCount),
                        }}
                      />
                      {tooltip && tooltip.i === i && (
                        <div
                          className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap rounded px-2 py-1 text-[10px] font-medium pointer-events-none"
                          style={{ background: '#1e2a3f', color: '#ffffff', border: '1px solid rgba(74,158,255,0.3)' }}
                        >
                          {d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {' — '}
                          {d.count} signup{d.count !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-1">
                  {chartData.map((d, i) => (
                    <div key={i} className="flex-1 text-center">
                      {i % 7 === 0 && (
                        <span className="text-[9px]" style={{ color: '#6b7a9d' }}>
                          {d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3" style={{ borderBottom: '1px solid rgba(74,158,255,0.1)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-widest flex-1" style={{ color: '#6b7a9d' }}>
                  CONTRACTOR BILLING
                </p>
                <div className="flex gap-2">
                  {['all', 'free', 'paid', 'churned'].map(f => (
                    <button
                      key={f}
                      onClick={() => setBillingFilter(f)}
                      className="px-3 py-1 rounded-full text-xs font-medium transition-all capitalize"
                      style={{
                        background: billingFilter === f ? '#4a9eff' : 'rgba(74,158,255,0.08)',
                        color: billingFilter === f ? '#0a0d1a' : '#6b7a9d',
                        border: '1px solid rgba(74,158,255,0.2)',
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(74,158,255,0.1)' }}>
                      {['Company', 'Email', 'Plan', 'MRR', 'Status', 'Market', 'Since'].map(h => (
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
                    {filteredContractors.map(r => (
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
                          <td className="px-4 py-3" style={{ color: '#6b7a9d' }}>{r.owner_email || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${PLAN_COLORS[r.plan] || 'bg-gray-700 text-gray-300'}`}>
                              {r.plan || 'free'}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-white">{fmtMo(r.plan_price_cents)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${STATUS_DOTS[r.subscription_status] || 'bg-gray-500'}`} />
                              <span className="text-xs capitalize" style={{ color: '#6b7a9d' }}>{r.subscription_status || '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3" style={{ color: '#6b7a9d' }}>{r.market_city || '—'}</td>
                          <td className="px-4 py-3 text-xs" style={{ color: '#6b7a9d' }}>
                            {r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                          </td>
                        </tr>
                        {expandedId === r.id && (
                          <tr key={`${r.id}-exp`} style={{ background: 'rgba(74,158,255,0.04)', borderBottom: '1px solid rgba(74,158,255,0.1)' }}>
                            <td colSpan={7} className="px-6 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Owner Email</p>
                                  <p className="text-white">{r.owner_email || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Plan</p>
                                  <p className="text-white capitalize">{r.plan || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Subscription</p>
                                  <p className="text-white capitalize">{r.subscription_status || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>MRR</p>
                                  <p className="text-white">{fmtMo(r.plan_price_cents)}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Market</p>
                                  <p className="text-white">{r.market_city || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6b7a9d' }}>Signed Up</p>
                                  <p className="text-white">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                    {filteredContractors.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: '#6b7a9d' }}>
                          No contractors found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
              <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(74,158,255,0.1)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>
                  RECENT PAYMENTS
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(74,158,255,0.1)' }}>
                      {['Job', 'Amount', 'Status', 'Date'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, i) => (
                      <tr
                        key={p.id || i}
                        style={{ borderBottom: '1px solid rgba(74,158,255,0.06)' }}
                      >
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: '#6b7a9d' }}>
                          {p.job_id ? p.job_id.slice(0, 8) + '…' : '—'}
                        </td>
                        <td className="px-4 py-3 font-medium text-white">
                          {p.amount != null ? '$' + Number(p.amount).toLocaleString('en-US') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize"
                            style={{
                              background:
                                p.status === 'paid' ? 'rgba(34,197,94,0.15)' :
                                p.status === 'pending' ? 'rgba(245,158,11,0.15)' :
                                'rgba(239,68,68,0.15)',
                              color:
                                p.status === 'paid' ? '#4ade80' :
                                p.status === 'pending' ? '#fbbf24' :
                                '#f87171',
                            }}
                          >
                            {p.status || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#6b7a9d' }}>
                          {p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                        </td>
                      </tr>
                    ))}
                    {payments.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-sm" style={{ color: '#6b7a9d' }}>
                          No payments found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

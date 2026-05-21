import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Link, Navigate } from 'react-router-dom'
import { useContractor } from '../../context/ContractorContext'

const STAGES = [
  { key: 'lead',             label: 'Lead',        color: 'text-gray-400',   dot: 'bg-gray-500' },
  { key: 'estimate_sent',    label: 'Estimate',    color: 'text-blue-400',   dot: 'bg-blue-500' },
  { key: 'contract_signed',  label: 'Signed',      color: 'text-violet-400', dot: 'bg-violet-500' },
  { key: 'materials_ordered',label: 'Materials',   color: 'text-amber-400',  dot: 'bg-amber-500' },
  { key: 'scheduled',        label: 'Scheduled',   color: 'text-orange-400', dot: 'bg-orange-500' },
  { key: 'in_progress',      label: 'Active',      color: 'text-green-400',  dot: 'bg-green-500' },
  { key: 'inspection',       label: 'Inspect',     color: 'text-teal-400',   dot: 'bg-teal-500' },
  { key: 'invoiced',         label: 'Invoiced',    color: 'text-pink-400',   dot: 'bg-pink-500' },
  { key: 'complete',         label: 'Complete',    color: 'text-emerald-400',dot: 'bg-emerald-500' },
  { key: 'paid',             label: 'Paid',        color: 'text-gray-400',   dot: 'bg-gray-600' },
]

const ACTIVE_KEYS = new Set(['lead','estimate_sent','contract_signed','materials_ordered','scheduled','in_progress','inspection'])

function stageMeta(key) {
  return STAGES.find(s => s.key === key) || { label: key, color: 'text-gray-400', dot: 'bg-gray-500' }
}

function KpiCard({ label, value, valueColor = 'text-white', sub }) {
  return (
    <div className="bg-gray-900/80 border border-orange-900/30 rounded-xl p-4 card-accent-orange">
      <p className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  )
}

function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />
}

function UpgradeNudge({ jobs, plan }) {
  const planStr = (plan || '').toLowerCase()
  const hasAria = planStr.includes('aria') || planStr.includes('all')
  const hasSupp = planStr.includes('supplement') || planStr.includes('supp') || planStr.includes('all')

  const insuranceJobs = jobs.filter(j => j.insurance_claim || j.claim_number).length

  if (jobs.length >= 5 && !hasAria) {
    return (
      <div className="mx-6 lg:mx-10 mt-4 bg-cyan-900/20 border border-cyan-600/30 rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-cyan-300 text-sm font-semibold">You have {jobs.length} jobs — add Aria to handle homeowner questions 24/7</p>
          <p className="text-gray-500 text-xs mt-0.5">Aria answers calls, texts homeowners updates, and follows up on every job automatically.</p>
        </div>
        <a href="https://roofingos.dev/upgrade?plan=aria" target="_blank" rel="noopener"
          className="shrink-0 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors whitespace-nowrap">
          Add Aria — $149/mo →
        </a>
      </div>
    )
  }

  if (insuranceJobs >= 3 && !hasSupp) {
    return (
      <div className="mx-6 lg:mx-10 mt-4 bg-violet-900/20 border border-violet-600/30 rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-violet-300 text-sm font-semibold">{insuranceJobs} insurance jobs — Supplement AI finds missed line items automatically</p>
          <p className="text-gray-500 text-xs mt-0.5">Average recovery: $3,200 per job. One supplement pays for months of the subscription.</p>
        </div>
        <a href="https://roofingos.dev/upgrade?plan=supplement" target="_blank" rel="noopener"
          className="shrink-0 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors whitespace-nowrap">
          Add Supplement AI — $499/mo →
        </a>
      </div>
    )
  }

  return null
}

export default function RoofingDashboard() {
  const { contractorClientId, contractor } = useContractor()

  if (contractor && contractor.clients && contractor.clients.onboarding_complete === false) {
    return <Navigate to="/roofing/onboarding" replace />
  }

  const [jobs, setJobs] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState('active')
  const [onboardingProgress, setOnboardingProgress] = useState(null)

  useEffect(() => {
    if (contractorClientId === undefined) return
    let query = supabase.from('roofing_jobs').select('*, clients(name, brand_name)').order('created_at', { ascending: false })
    if (contractorClientId) query = query.eq('client_id', contractorClientId)

    query.then(({ data }) => {
      setJobs(data || [])
      setStats({
        total: data?.length || 0,
        active: data?.filter(j => ACTIVE_KEYS.has(j.status)).length || 0,
        revenue: data?.reduce((acc, j) => acc + (j.contract_amount || 0), 0) || 0,
        collected: data?.reduce((acc, j) => acc + (j.amount_paid || 0), 0) || 0,
      })
      setLoading(false)
      if (data && data.length > 0) {
        const ids = data.map(j => j.id)
        supabase.from('job_documents').select('*', { count: 'exact', head: true }).in('job_id', ids).then(({ count }) => {
          setStats(prev => ({ ...prev, docsGenerated: count || 0 }))
        })
      }
    })
  }, [contractorClientId])

  useEffect(() => {
    if (!contractor?.clients) return
    const c = contractor.clients
    if (c.onboarding_complete === true) return
    const steps = [
      { label: 'Phone number', done: !!c.phone },
      { label: 'Service area', done: !!c.service_area },
      { label: 'Notification email', done: !!c.notification_email },
      { label: 'Brand color / tagline', done: !!(c.company_tagline || c.primary_color) },
      { label: 'Onboarding complete', done: !!c.onboarding_complete },
    ]
    setOnboardingProgress(steps)
  }, [contractor])

  const stageCounts = jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc }, {})

  const displayJobs = stageFilter === 'active'
    ? jobs.filter(j => ACTIVE_KEYS.has(j.status))
    : stageFilter === 'all'
    ? jobs
    : jobs.filter(j => j.status === stageFilter)

  return (
    <div className="animate-fade-in">
      {onboardingProgress && (
        <div className="mx-6 lg:mx-10 mt-6 bg-amber-900/20 border border-amber-600/30 rounded-xl p-4 flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-amber-400 text-sm font-semibold mb-1.5">
              Setup incomplete — {onboardingProgress.filter(s => s.done).length} of {onboardingProgress.length} steps done
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {onboardingProgress.map(s => (
                <span key={s.label} className={`text-xs px-2 py-0.5 rounded-full ${s.done ? 'bg-green-900/40 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                  {s.done ? '✓' : '○'} {s.label}
                </span>
              ))}
            </div>
          </div>
          <Link to="/roofing/onboarding"
            className="shrink-0 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors whitespace-nowrap">
            Finish Setup →
          </Link>
        </div>
      )}
      {!loading && <UpgradeNudge jobs={jobs} plan={contractor?.plan || contractor?.clients?.plan} />}

      {/* Header — orange branded, full width */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-600/[0.06] via-transparent to-transparent pointer-events-none" />
        <div className="absolute -top-12 -left-12 w-64 h-64 bg-orange-600/8 rounded-full blur-3xl pointer-events-none" />
        <div className="relative px-6 lg:px-10 pt-8 pb-8">
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <p className="text-[10px] font-bold text-orange-600/60 uppercase tracking-[0.2em] mb-1.5">Roofing OS · Operations</p>
              <h1 className="text-[28px] font-black text-white tracking-tight leading-none">Job Pipeline</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to="/roofing/crew" className="text-sm text-gray-500 hover:text-white px-3 py-2 rounded-xl border border-white/[0.06] hover:border-white/10 transition-all">
                Crew
              </Link>
              <Link to="/roofing/jobs/new"
                className="bg-orange-600 hover:bg-orange-500 text-white rounded-xl px-4 py-2 text-sm font-bold transition-all shadow-lg shadow-orange-900/30">
                + New Job
              </Link>
            </div>
          </div>

          {/* KPI row */}
          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-6">
              {[
                { value: stats.total, label: 'Total Jobs', gradient: 'from-white to-orange-300' },
                { value: stats.active, label: 'Active', gradient: 'from-white to-orange-200' },
                { value: `$${(stats.revenue||0).toLocaleString()}`, label: 'Contract Value', gradient: 'from-white to-amber-300' },
                { value: `$${(stats.collected||0).toLocaleString()}`, label: 'Collected', gradient: 'from-white to-emerald-300',
                  sub: stats.revenue > 0 ? `${Math.round((stats.collected/stats.revenue)*100)}% of contract` : null },
                { value: stats.docsGenerated ?? '—', label: 'Docs Generated', gradient: 'from-white to-blue-300' },
              ].map((kpi, i) => (
                <div key={i}>
                  <div className={`text-[38px] font-black leading-none tracking-tight tabular-nums bg-gradient-to-br ${kpi.gradient} bg-clip-text text-transparent`}>
                    {kpi.value}
                  </div>
                  <div className="text-[13px] font-semibold text-white/80 mt-2">{kpi.label}</div>
                  {kpi.sub && <div className="text-xs text-gray-600 mt-0.5">{kpi.sub}</div>}
                  <div className="mt-3 h-px bg-gradient-to-r from-orange-600/20 to-transparent" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-6 lg:px-10 py-6">

      {/* Pipeline stage strip */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Pipeline</h3>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setStageFilter('active')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              stageFilter === 'active' ? 'bg-orange-600/20 text-orange-300 ring-1 ring-orange-600/40' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            Active ({stats.active || 0})
          </button>
          {STAGES.map(s => {
            const count = stageCounts[s.key] || 0
            if (count === 0) return null
            return (
              <button
                key={s.key}
                onClick={() => setStageFilter(s.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  stageFilter === s.key ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {s.label} · {count}
              </button>
            )
          })}
          <button
            onClick={() => setStageFilter('all')}
            className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              stageFilter === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            All {jobs.length}
          </button>
        </div>
      </div>

      {/* Job list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : displayJobs.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl py-12 text-center">
          <p className="text-gray-400 text-sm font-medium mb-1">No jobs here</p>
          <p className="text-gray-600 text-xs mb-4">
            {stageFilter === 'active' ? 'No active jobs in progress' : `No jobs with status "${stageFilter}"`}
          </p>
          <Link to="/roofing/jobs/new"
            className="text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors">
            Create your first job →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {displayJobs.map(job => {
            const s = stageMeta(job.status)
            const collected = job.amount_paid || 0
            const contract = job.contract_amount || 0
            const pct = contract > 0 ? Math.round((collected / contract) * 100) : 0

            return (
              <Link key={job.id} to={`/roofing/jobs/${job.id}`}
                className="block bg-gray-900 border border-gray-800 hover:border-orange-900/50 rounded-xl p-4 transition-all group">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0`} />
                      <p className="text-white font-medium group-hover:text-orange-300 transition-colors truncate">{job.homeowner_name}</p>
                    </div>
                    <p className="text-gray-500 text-sm ml-3.5 truncate">{job.property_address}</p>
                    <div className="flex items-center gap-2 mt-1.5 ml-3.5 flex-wrap">
                      {job.job_type && (
                        <span className="text-xs text-gray-600">{job.job_type.replace(/_/g, ' ')}</span>
                      )}
                      {job.clients?.brand_name || job.clients?.name ? (
                        <span className="text-xs text-gray-700">· {job.clients?.brand_name || job.clients?.name}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`text-xs font-semibold ${s.color}`}>{s.label}</span>
                    {contract > 0 && (
                      <div className="text-right">
                        <p className="text-sm font-semibold text-amber-400">${contract.toLocaleString()}</p>
                        {collected > 0 && (
                          <p className="text-xs text-gray-600">{pct}% collected</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Payment progress bar */}
                {contract > 0 && collected > 0 && (
                  <div className="mt-3 w-full bg-gray-800 rounded-full h-0.5">
                    <div className="bg-emerald-500 h-0.5 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}

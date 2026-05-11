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

export default function RoofingDashboard() {
  const { contractorClientId, contractor } = useContractor()

  if (contractor && contractor.clients && contractor.clients.onboarding_complete === false) {
    return <Navigate to="/roofing/onboarding" replace />
  }

  const [jobs, setJobs] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState('active')

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
    })
  }, [contractorClientId])

  const stageCounts = jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc }, {})

  const displayJobs = stageFilter === 'active'
    ? jobs.filter(j => ACTIVE_KEYS.has(j.status))
    : stageFilter === 'all'
    ? jobs
    : jobs.filter(j => j.status === stageFilter)

  return (
    <div className="max-w-5xl animate-fade-in">
      {/* Header — orange branded */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center shadow-lg shadow-orange-900/40">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white">
              <path fillRule="evenodd" d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Roofing OS</h1>
            <p className="text-orange-600 text-xs font-semibold uppercase tracking-widest">Operations</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/roofing/crew" className="text-sm text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors">
            Crew
          </Link>
          <Link to="/roofing/jobs/new"
            className="bg-orange-600 hover:bg-orange-500 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all shadow-lg shadow-orange-900/20">
            + New Job
          </Link>
        </div>
      </div>

      {/* KPI row */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Total Jobs" value={stats.total} />
          <KpiCard label="Active" value={stats.active} valueColor="text-orange-400" />
          <KpiCard label="Contract Value" value={`$${(stats.revenue || 0).toLocaleString()}`} valueColor="text-amber-400" />
          <KpiCard label="Collected" value={`$${(stats.collected || 0).toLocaleString()}`} valueColor="text-emerald-400"
            sub={stats.revenue > 0 ? `${Math.round((stats.collected / stats.revenue) * 100)}% of contract` : null} />
        </div>
      )}

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
  )
}

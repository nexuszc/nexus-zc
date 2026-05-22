import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const STATUS_COLORS = {
  pending:     'text-amber-400 bg-amber-500/10',
  in_progress: 'text-blue-400 bg-blue-500/10',
  completed:   'text-green-400 bg-green-500/10',
  cancelled:   'text-red-400 bg-red-500/10',
  on_hold:     'text-gray-400 bg-gray-500/10',
}

const PLAN_COLORS = {
  trial:   'text-amber-400',
  starter: 'text-blue-400',
  pro:     'text-indigo-400',
  elite:   'text-purple-400',
}

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function fmt(cents) {
  if (!cents) return '—'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`
}

export default function AdminJobs() {
  const [contractors, setContractors] = useState([])
  const [jobs, setJobs]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [expanded, setExpanded]       = useState(null)
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: ca }, { data: rj }] = await Promise.all([
      supabase.from('contractor_accounts').select('id, company_name, owner_name, owner_email, plan, total_jobs, status').order('created_at', { ascending: false }),
      supabase.from('roofing_jobs').select('id, client_id, homeowner_name, property_address, status, contract_amount, job_type, claim_status, created_at').order('created_at', { ascending: false }).limit(500),
    ])
    setContractors(ca || [])
    setJobs(rj || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const jobsByContractor = jobs.reduce((acc, j) => {
    if (!acc[j.client_id]) acc[j.client_id] = []
    acc[j.client_id].push(j)
    return acc
  }, {})

  const allStatuses = [...new Set(jobs.map(j => j.status).filter(Boolean))]

  const filteredJobs = (contractorId) => {
    let list = jobsByContractor[contractorId] || []
    if (statusFilter !== 'all') list = list.filter(j => j.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(j =>
        `${j.homeowner_name} ${j.property_address}`.toLowerCase().includes(q)
      )
    }
    return list
  }

  const filteredContractors = contractors.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    const cJobs = jobsByContractor[c.id] || []
    const matchCo = `${c.company_name} ${c.owner_name} ${c.owner_email}`.toLowerCase().includes(q)
    const matchJob = cJobs.some(j => `${j.homeowner_name} ${j.property_address}`.toLowerCase().includes(q))
    return matchCo || matchJob
  })

  const totalJobs  = jobs.length
  const totalValue = jobs.reduce((s, j) => s + (j.contract_amount || 0), 0)
  const activeJobs = jobs.filter(j => j.status === 'in_progress').length

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">All Jobs</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {contractors.length} contractor{contractors.length !== 1 ? 's' : ''} · {totalJobs} job{totalJobs !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Total Jobs</div>
          <div className="text-2xl font-black text-white">{totalJobs}</div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">In Progress</div>
          <div className="text-2xl font-black text-blue-400">{activeJobs}</div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Total Value</div>
          <div className="text-2xl font-black text-indigo-400">
            ${(totalValue / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Search homeowner, address, company..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-[#12121a] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500 flex-1 min-w-[200px] max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-[#12121a] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 focus:outline-none"
        >
          <option value="all">All statuses</option>
          {allStatuses.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl h-16 animate-pulse" />)}
        </div>
      ) : filteredContractors.length === 0 ? (
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
          <p className="text-gray-600 text-sm">No contractors found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredContractors.map(c => {
            const cJobs    = filteredJobs(c.id)
            const allCJobs = jobsByContractor[c.id] || []
            const isOpen   = expanded === c.id

            return (
              <div key={c.id}>
                <div
                  onClick={() => setExpanded(e => e === c.id ? null : c.id)}
                  className="bg-[#12121a] border border-[#1e1e2e] hover:border-[#2a2a3e] rounded-xl px-4 py-3.5 cursor-pointer transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{c.company_name || c.owner_name || 'Unknown'}</span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${PLAN_COLORS[c.plan] || 'text-gray-500'}`}>
                          {c.plan || 'unknown'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{c.owner_email || '—'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-white">{allCJobs.length} job{allCJobs.length !== 1 ? 's' : ''}</div>
                      <div className="text-[10px] text-gray-600">
                        {isOpen ? '▲ collapse' : '▼ expand'}
                      </div>
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div className="bg-[#0e0e18] border border-[#1e1e2e] border-t-0 rounded-b-xl">
                    {cJobs.length === 0 ? (
                      <div className="px-4 py-6 text-center">
                        <p className="text-gray-600 text-sm">
                          {allCJobs.length === 0 ? 'No jobs yet.' : 'No jobs match current filters.'}
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-[#1a1a28]">
                        {cJobs.map(job => (
                          <div key={job.id} className="px-4 py-3 flex items-center gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-white font-medium">{job.homeowner_name || '—'}</span>
                                {job.status && (
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[job.status] || 'text-gray-500 bg-gray-800'}`}>
                                    {job.status.replace(/_/g, ' ')}
                                  </span>
                                )}
                                {job.claim_status && (
                                  <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                                    claim: {job.claim_status}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5 truncate">{job.property_address || '—'}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm text-white font-medium">{fmt(job.contract_amount)}</div>
                              <div className="text-[10px] text-gray-600">{ago(job.created_at)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

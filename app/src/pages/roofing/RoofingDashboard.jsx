import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Link } from 'react-router-dom'

const STATUS_COLORS = {
  lead: 'bg-gray-700 text-gray-300',
  estimate_sent: 'bg-blue-900/40 text-blue-400',
  contract_signed: 'bg-purple-900/40 text-purple-400',
  materials_ordered: 'bg-yellow-900/40 text-yellow-400',
  scheduled: 'bg-orange-900/40 text-orange-400',
  in_progress: 'bg-green-900/40 text-green-400',
  inspection: 'bg-teal-900/40 text-teal-400',
  complete: 'bg-emerald-900/40 text-emerald-400',
  invoiced: 'bg-pink-900/40 text-pink-400',
  paid: 'bg-gray-600 text-gray-300',
}

export default function RoofingDashboard() {
  const [jobs, setJobs] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('roofing_jobs')
      .select('*, clients(name, brand_name)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setJobs(data || [])
        const s = {
          total: data?.length || 0,
          active: data?.filter(j => !['paid', 'cancelled'].includes(j.status)).length || 0,
          revenue: data?.reduce((acc, j) => acc + (j.contract_amount || 0), 0) || 0,
          collected: data?.reduce((acc, j) => acc + (j.amount_paid || 0), 0) || 0,
        }
        setStats(s)
        setLoading(false)
      })
  }, [])

  if (loading) return <p className="text-gray-400">Loading...</p>

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Roofing OS</h2>
        <Link to="/roofing/jobs/new"
          className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors">
          + New Job
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Jobs', value: stats.total, color: 'text-white' },
          { label: 'Active', value: stats.active, color: 'text-green-400' },
          { label: 'Contract Value', value: `$${(stats.revenue || 0).toLocaleString()}`, color: 'text-blue-400' },
          { label: 'Collected', value: `$${(stats.collected || 0).toLocaleString()}`, color: 'text-emerald-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-gray-500 text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Pipeline by status */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-400 mb-4">PIPELINE</h3>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(
            jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {})
          ).map(([status, count]) => (
            <div key={status} className={`px-3 py-1.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || 'bg-gray-700 text-gray-300'}`}>
              {status.replace(/_/g, ' ')}: {count}
            </div>
          ))}
        </div>
      </div>

      {/* Active jobs */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">ACTIVE JOBS</h3>
        {jobs.filter(j => !['paid', 'cancelled'].includes(j.status)).map(job => (
          <Link key={job.id} to={`/roofing/jobs/${job.id}`}
            className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-4 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium">{job.homeowner_name}</p>
                <p className="text-gray-400 text-sm mt-0.5">{job.property_address}</p>
                <p className="text-gray-600 text-xs mt-1">{job.job_type?.replace(/_/g, ' ')} · {job.clients?.brand_name || job.clients?.name}</p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[job.status] || 'bg-gray-700 text-gray-300'}`}>
                  {job.status.replace(/_/g, ' ')}
                </span>
                {job.contract_amount && <p className="text-green-400 text-sm font-medium">${job.contract_amount.toLocaleString()}</p>}
              </div>
            </div>
          </Link>
        ))}
        {jobs.filter(j => !['paid', 'cancelled'].includes(j.status)).length === 0 && (
          <p className="text-gray-500 text-center py-8">No active jobs. <Link to="/roofing/jobs/new" className="text-blue-400">Create one →</Link></p>
        )}
      </div>
    </div>
  )
}

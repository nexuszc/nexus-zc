import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const STATUS_COLORS = {
  pending:    'text-yellow-400 bg-yellow-900/20 border-yellow-600/30',
  processing: 'text-blue-400 bg-blue-900/20 border-blue-600/30',
  complete:   'text-green-400 bg-green-900/20 border-green-600/30',
  failed:     'text-red-400 bg-red-900/20 border-red-600/30',
}

export default function RoofingMeasurements() {
  const { contractorClientId, contractor } = useContractor()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [ordering, setOrdering] = useState(false)
  const [address, setAddress] = useState('')
  const [jobId, setJobId] = useState('')
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const contractorId = contractor?.id

  useEffect(() => {
    if (!contractorId) return
    loadReports()
    supabase
      .from('roofing_jobs')
      .select('id, property_address, homeowner_name')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setJobs(data || []))
  }, [contractorId])

  async function loadReports() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-measurements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'list', contractor_id: contractorId })
      })
      const data = await res.json()
      setReports(data.reports || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  async function orderReport() {
    setError('')
    setSuccess('')
    if (!address.trim()) { setError('Enter a property address.'); return }
    setOrdering(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-measurements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'order', address: address.trim(), job_id: jobId || null, contractor_id: contractorId })
      })
      const data = await res.json()
      if (data.ok) {
        setSuccess(data.manual
          ? 'Order received. Your report will be ready within 24 hours.'
          : 'Report ordered. Typically ready within 4 hours.')
        setAddress('')
        setJobId('')
        loadReports()
      } else {
        setError(data.error || 'Order failed. Try again.')
      }
    } catch {
      setError('Network error. Try again.')
    }
    setOrdering(false)
  }

  return (
    <div className="animate-fade-in px-6 lg:px-10 py-8">
      <div className="mb-8">
        <p className="text-[10px] font-bold text-orange-600/60 uppercase tracking-[0.2em] mb-1">Roofing OS · Measurements</p>
        <h1 className="text-[28px] font-black text-white tracking-tight leading-none mb-1">Roof Measurements</h1>
        <p className="text-gray-500 text-sm">Accurate measurements delivered in hours. No ladder required.</p>
      </div>

      {/* Order form */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-8 max-w-lg">
        <h2 className="text-white font-bold text-base mb-4">Order a Report</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Property Address</label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="4821 Timberline Dr, Aurora CO 80016"
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">Link to Job (optional)</label>
            <select
              value={jobId}
              onChange={e => setJobId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm focus:border-orange-500 focus:outline-none"
            >
              <option value="">— No job selected —</option>
              {jobs.map(j => (
                <option key={j.id} value={j.id}>{j.homeowner_name} — {j.property_address}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {success && <p className="text-green-400 text-sm">{success}</p>}
          <button
            onClick={orderReport}
            disabled={ordering}
            className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors text-sm"
          >
            {ordering ? 'Ordering…' : 'Order Report →'}
          </button>
          <p className="text-gray-600 text-xs text-center">Included in your Measurements plan · Results in 4–24 hours</p>
        </div>
      </div>

      {/* Reports list */}
      <div>
        <h2 className="text-white font-bold text-base mb-4">Recent Reports</h2>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-900 rounded-xl animate-pulse" />)}
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p className="text-gray-500 text-sm">No reports yet. Order your first one above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map(r => (
              <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{r.address}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{new Date(r.ordered_at).toLocaleDateString()}</p>
                  {r.total_squares && (
                    <p className="text-gray-400 text-xs mt-1">
                      {r.total_squares} squares · {r.predominant_pitch} pitch
                      {r.ridges_ft ? ` · ${r.ridges_ft}ft ridges` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-lg border ${STATUS_COLORS[r.status] || 'text-gray-400'}`}>
                    {r.status}
                  </span>
                  {r.report_url && (
                    <a href={r.report_url} target="_blank" rel="noopener"
                      className="text-orange-400 hover:text-orange-300 text-xs font-semibold">
                      Download PDF
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

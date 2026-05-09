import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useContractor } from '../../context/ContractorContext'

export default function RoofingNewJob() {
  const navigate = useNavigate()
  const { contractorClientId } = useContractor()
  const [form, setForm] = useState({
    homeowner_name: '', homeowner_email: '', homeowner_phone: '',
    property_address: '', job_type: 'full_replacement',
    roof_size_squares: '', material_type: 'asphalt_shingle',
    shingle_brand: '', shingle_color: '',
    insurance_claim: false, claim_number: '',
    estimated_start_date: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)

    const clientId = contractorClientId || null

    const { data: job, error } = await supabase.from('roofing_jobs').insert({
      ...form,
      client_id: clientId,
      roof_size_squares: form.roof_size_squares ? parseFloat(form.roof_size_squares) : null,
    }).select().single()

    if (!error && job) {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ action: 'generate_timeline', job_id: job.id }),
      })
      // Notify contractor (email confirmation of new job)
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ event: 'job_created', job_id: job.id }),
      })
      navigate(`/roofing/jobs/${job.id}`)
    }
    setSaving(false)
  }

  const field = (key, label, type = 'text', options) => (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {options ? (
        <select value={form[key]}
          onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500">
          {options.map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
      ) : (
        <input type={type} value={form[key]}
          onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
      )}
    </div>
  )

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-white mb-6">New Job</h2>
      <form onSubmit={save} className="space-y-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase">Homeowner</h3>
          {field('homeowner_name', 'Full Name *')}
          {field('homeowner_email', 'Email', 'email')}
          {field('homeowner_phone', 'Phone', 'tel')}
          {field('property_address', 'Property Address *')}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase">Job Details</h3>
          {field('job_type', 'Job Type', 'text', ['full_replacement', 'repair', 'inspection', 'insurance_claim'])}
          {field('roof_size_squares', 'Roof Size (squares)', 'number')}
          {field('material_type', 'Material Type', 'text', ['asphalt_shingle', 'metal', 'tile', 'flat', 'other'])}
          {field('shingle_brand', 'Shingle Brand (e.g. GAF, Owens Corning)')}
          {field('shingle_color', 'Shingle Color')}
          {field('estimated_start_date', 'Estimated Start Date', 'date')}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-xs text-gray-400 font-semibold uppercase">Insurance</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.insurance_claim}
              onChange={e => setForm(p => ({ ...p, insurance_claim: e.target.checked }))}
              className="w-4 h-4" />
            <span className="text-sm text-white">Insurance claim job</span>
          </label>
          {form.insurance_claim && field('claim_number', 'Claim Number')}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <label className="block text-xs text-gray-400 mb-1">Notes</label>
          <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            rows={3} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500 resize-none" />
        </div>

        <button type="submit" disabled={saving || !form.homeowner_name || !form.property_address}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-3 font-medium transition-colors">
          {saving ? 'Creating job...' : 'Create Job'}
        </button>
      </form>
    </div>
  )
}

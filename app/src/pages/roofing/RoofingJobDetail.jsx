import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const STATUSES = ['lead','estimate_sent','contract_signed','materials_ordered','scheduled','in_progress','inspection','complete','invoiced','paid']

export default function RoofingJobDetail() {
  const { id } = useParams()
  const [job, setJob] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [messages, setMessages] = useState([])
  const [docs, setDocs] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [generating, setGenerating] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const [{ data: j }, { data: t }, { data: m }, { data: d }] = await Promise.all([
      supabase.from('roofing_jobs').select('*, clients(name, brand_name, brand_color, phone)').eq('id', id).single(),
      supabase.from('job_timeline').select('*').eq('job_id', id).order('created_at'),
      supabase.from('job_messages').select('*').eq('job_id', id).order('created_at'),
      supabase.from('job_documents').select('*').eq('job_id', id).order('created_at'),
    ])
    setJob(j); setTimeline(t || []); setMessages(m || []); setDocs(d || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  const updateStatus = async (status) => {
    await supabase.from('roofing_jobs').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-ai`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action: 'generate_timeline', job_id: id }),
    })
    load()
  }

  const generateDoc = async (action) => {
    setGenerating(action)
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-ai`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action, job_id: id }),
    })
    setGenerating('')
    load()
  }

  const sendMessage = async () => {
    if (!newMessage.trim()) return
    await supabase.from('job_messages').insert({ job_id: id, sender: 'contractor', message: newMessage })
    setNewMessage('')
    load()
  }

  const copyPortalLink = () => {
    const url = `${window.location.origin}/roofing/portal/${job.portal_token}`
    navigator.clipboard.writeText(url)
    alert('Portal link copied!')
  }

  if (loading) return <p className="text-gray-400">Loading...</p>
  if (!job) return <p className="text-gray-400">Job not found</p>

  const tabs = ['overview', 'timeline', 'documents', 'messages']

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">{job.homeowner_name}</h2>
          <p className="text-gray-400 mt-1">{job.property_address}</p>
          <p className="text-gray-500 text-sm mt-0.5">{job.job_type?.replace(/_/g, ' ')} · {job.clients?.brand_name || job.clients?.name}</p>
        </div>
        <button onClick={copyPortalLink}
          className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-2 text-sm transition-colors shrink-0">
          📋 Copy Portal Link
        </button>
      </div>

      {/* Status updater */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400 font-semibold uppercase">Job Status</p>
          {job.contract_amount && <p className="text-green-400 font-bold">${job.contract_amount.toLocaleString()}</p>}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUSES.map(s => (
            <button key={s} onClick={() => updateStatus(s)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${job.status === s ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              {s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-900 rounded-lg p-1">
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-1 py-1.5 rounded text-sm transition-colors ${activeTab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Email', value: job.homeowner_email },
              { label: 'Phone', value: job.homeowner_phone },
              { label: 'Material', value: `${job.shingle_brand || ''} ${job.shingle_color || ''} ${job.material_type}`.trim() },
              { label: 'Size', value: job.roof_size_squares ? `${job.roof_size_squares} squares` : '—' },
              { label: 'Start Date', value: job.estimated_start_date || '—' },
              { label: 'Insurance', value: job.insurance_claim ? `Claim: ${job.claim_number || 'Filed'}` : 'No' },
            ].map(f => (
              <div key={f.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                <p className="text-xs text-gray-500">{f.label}</p>
                <p className="text-sm text-white mt-0.5">{f.value || '—'}</p>
              </div>
            ))}
          </div>

          {/* AI Actions */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-400 font-semibold uppercase mb-3">Generate Documents</p>
            <div className="flex gap-2 flex-wrap">
              {[
                { action: 'generate_estimate', label: '📋 Estimate' },
                { action: 'generate_contract', label: '📄 Contract' },
                { action: 'generate_invoice', label: '🧾 Invoice' },
              ].map(({ action, label }) => (
                <button key={action} onClick={() => generateDoc(action)}
                  disabled={generating === action}
                  className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white rounded px-3 py-2 text-sm transition-colors">
                  {generating === action ? 'Generating...' : label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TIMELINE */}
      {activeTab === 'timeline' && (
        <div className="space-y-2">
          {timeline.map(t => (
            <div key={t.id} className={`flex gap-3 p-3 rounded-xl border ${t.completed ? 'bg-green-900/10 border-green-900/30' : 'bg-gray-900 border-gray-800'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs ${t.completed ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}>
                {t.completed ? '✓' : ''}
              </div>
              <div>
                <p className={`text-sm font-medium ${t.completed ? 'text-white' : 'text-gray-400'}`}>{t.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                {t.completed_at && <p className="text-xs text-green-400 mt-1">{new Date(t.completed_at).toLocaleDateString()}</p>}
              </div>
            </div>
          ))}
          {!timeline.length && <p className="text-gray-500 text-center py-8">No timeline yet.</p>}
        </div>
      )}

      {/* DOCUMENTS */}
      {activeTab === 'documents' && (
        <div className="space-y-3">
          {docs.map(d => (
            <div key={d.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-white font-medium text-sm">{d.title}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${d.signed ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                  {d.signed ? 'Signed' : d.doc_type}
                </span>
              </div>
              <pre className="text-xs text-gray-400 whitespace-pre-wrap max-h-48 overflow-auto">{d.content.slice(0, 500)}...</pre>
              <button onClick={() => navigator.clipboard.writeText(d.content)}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300">Copy full document</button>
            </div>
          ))}
          {!docs.length && <p className="text-gray-500 text-center py-8">No documents yet. Generate one from the Overview tab.</p>}
        </div>
      )}

      {/* MESSAGES */}
      {activeTab === 'messages' && (
        <div>
          <div className="space-y-2 mb-4 max-h-64 overflow-auto">
            {messages.map(m => (
              <div key={m.id} className={`p-3 rounded-xl text-sm ${m.sender === 'contractor' ? 'bg-blue-900/30 ml-8' : 'bg-gray-800 mr-8'}`}>
                <p className="text-xs text-gray-400 mb-1">{m.sender}</p>
                <p className="text-white">{m.message}</p>
              </div>
            ))}
            {!messages.length && <p className="text-gray-500 text-center py-4">No messages yet</p>}
          </div>
          <div className="flex gap-2">
            <input value={newMessage} onChange={e => setNewMessage(e.target.value)}
              placeholder="Message to homeowner..."
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
            <button onClick={sendMessage} className="bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-2 text-sm">Send</button>
          </div>
        </div>
      )}
    </div>
  )
}

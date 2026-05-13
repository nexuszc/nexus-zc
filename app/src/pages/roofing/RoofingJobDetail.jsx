import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const STATUSES = ['lead','estimate_sent','contract_signed','materials_ordered','scheduled','in_progress','inspection','complete','invoiced','paid']
const CLAIM_STATUSES = ['filed','adjuster_scheduled','approved','supplements_pending','paid']

export default function RoofingJobDetail() {
  const { id } = useParams()
  const { contractorClientId } = useContractor()
  const [job, setJob] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [messages, setMessages] = useState([])
  const [docs, setDocs] = useState([])
  const [photos, setPhotos] = useState([])
  const [crew, setCrew] = useState([])
  const [crewMembers, setCrewMembers] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [generating, setGenerating] = useState('')
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sentPortal, setSentPortal] = useState(false)
  const [claimForm, setClaimForm] = useState({})
  const [showMsgModal, setShowMsgModal] = useState(false)
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState(null)

  const load = async () => {
    const [{ data: j }, { data: t }, { data: m }, { data: d }, { data: p }, { data: ca }] = await Promise.all([
      supabase.from('roofing_jobs').select('*, clients(name, primary_color, phone)').eq('id', id).single(),
      supabase.from('job_timeline').select('*').eq('job_id', id).order('created_at'),
      supabase.from('job_messages').select('*').eq('job_id', id).order('created_at'),
      supabase.from('job_documents').select('*').eq('job_id', id).order('created_at'),
      supabase.from('job_photos').select('*').eq('job_id', id).order('created_at'),
      supabase.from('crew_assignments').select('*').eq('job_id', id).order('created_at'),
    ])
    setJob(j)
    setTimeline(t || [])
    setMessages(m || [])
    setDocs(d || [])
    setPhotos(p || [])
    setCrew(ca || [])
    if (j) setClaimForm({
      claim_number: j.claim_number || '',
      adjuster_name: j.adjuster_name || '',
      adjuster_phone: j.adjuster_phone || '',
      claim_status: j.claim_status || 'filed',
    })
    setLoading(false)
  }

  const loadCrewMembers = async () => {
    if (!contractorClientId) return
    const { data } = await supabase.from('crew_members').select('*').eq('client_id', contractorClientId).eq('active', true)
    setCrewMembers(data || [])
  }

  useEffect(() => {
    load()
    supabase.from('message_templates').select('*').order('category').then(({ data }) => setTemplates(data || []))
  }, [id])
  useEffect(() => { loadCrewMembers() }, [contractorClientId])

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
    // Notify homeowner the document is ready
    const docTypeMap = { generate_estimate: 'Estimate', generate_contract: 'Contract', generate_invoice: 'Invoice' }
    if (docTypeMap[action]) {
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-notify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ event: 'document_ready', job_id: id, data: { doc_type: docTypeMap[action] } }),
      })
    }
    setGenerating('')
    load()
  }

  const sendPortalLink = async () => {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ event: 'portal_link', job_id: id }),
    })
    setSentPortal(true)
    setTimeout(() => setSentPortal(false), 3000)
  }

  const sendMessage = async () => {
    if (!newMessage.trim()) return
    await supabase.from('job_messages').insert({ job_id: id, sender: 'contractor', message: newMessage })
    setNewMessage('')
    load()
  }

  const uploadPhotos = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      const path = `${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { data: uploadData, error } = await supabase.storage.from('job-photos').upload(path, file)
      if (!error && uploadData) {
        const { data: { publicUrl } } = supabase.storage.from('job-photos').getPublicUrl(path)
        await supabase.from('job_photos').insert({ job_id: id, photo_url: publicUrl, phase: 'before', uploaded_by: 'contractor' })
      }
    }
    setUploading(false)
    load()
  }

  const saveClaimInfo = async () => {
    await supabase.from('roofing_jobs').update({
      ...claimForm,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    load()
  }

  const assignCrew = async (memberId) => {
    const member = crewMembers.find(m => m.id === memberId)
    if (!member) return
    await supabase.from('crew_assignments').insert({
      job_id: id,
      crew_lead: member.name,
      scheduled_date: job.estimated_start_date || null,
    })
    load()
  }

  const copyPortalLink = () => {
    const url = `${window.location.origin}/roofing/portal/${job.portal_token}`
    navigator.clipboard.writeText(url)
    alert('Portal link copied!')
  }

  if (loading) return <p className="text-gray-400">Loading...</p>
  if (!job) return <p className="text-gray-400">Job not found</p>

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'photos', label: `Photos${photos.length ? ` (${photos.length})` : ''}` },
    { id: 'documents', label: `Docs${docs.length ? ` (${docs.length})` : ''}` },
    { id: 'messages', label: `Messages${messages.filter(m => !m.read && m.sender === 'homeowner').length > 0 ? ' 🔴' : ''}` },
    { id: 'crew', label: 'Crew' },
  ]

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">{job.homeowner_name}</h2>
          <p className="text-gray-400 mt-1">{job.property_address}</p>
          <p className="text-gray-500 text-sm mt-0.5">{job.job_type?.replace(/_/g, ' ')} · {job.clients?.name}</p>
          {job.portal_last_viewed_at && (Date.now() - new Date(job.portal_last_viewed_at).getTime()) < 86400000 && (
            <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">Portal viewed recently</span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowMsgModal(true)}
            className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 text-sm transition-colors">
            ✉️ Message
          </button>
          <button onClick={copyPortalLink}
            className="bg-gray-700 hover:bg-gray-600 text-white rounded-lg px-3 py-2 text-sm transition-colors">
            📋 Copy
          </button>
          <button onClick={sendPortalLink}
            className={`text-white rounded-lg px-3 py-2 text-sm transition-colors ${sentPortal ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500'}`}>
            {sentPortal ? '✓ Sent!' : '📨 Send Portal Link'}
          </button>
        </div>
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
      <div className="flex gap-1 mb-4 bg-gray-900 rounded-lg p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded text-xs transition-colors ${activeTab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
            {t.label}
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

          {/* AI document generation */}
          <div className={`bg-gray-900 rounded-xl p-4 transition-all ${docs.length === 0 ? 'border border-orange-600/50 ring-1 ring-orange-600/20' : 'border border-gray-800'}`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400 font-semibold uppercase">Generate Documents</p>
              {docs.length === 0 && <span className="text-xs text-orange-400 animate-pulse">← Start here</span>}
            </div>
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

          {/* Insurance claim section */}
          {job.insurance_claim && (
            <div className="bg-gray-900 border border-orange-900/30 rounded-xl p-4">
              <p className="text-xs text-orange-400 font-semibold uppercase mb-3">🏛️ Insurance Claim</p>

              {/* Claim status stepper */}
              <div className="flex gap-1 mb-4 overflow-x-auto">
                {CLAIM_STATUSES.map(s => (
                  <button key={s}
                    onClick={() => setClaimForm(p => ({ ...p, claim_status: s }))}
                    className={`flex-shrink-0 px-2 py-1 rounded text-xs transition-colors ${claimForm.claim_status === s ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                {[
                  { key: 'claim_number', label: 'Claim Number' },
                  { key: 'adjuster_name', label: 'Adjuster Name' },
                  { key: 'adjuster_phone', label: 'Adjuster Phone' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                    <input value={claimForm[f.key] || ''} onChange={e => setClaimForm(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-orange-500" />
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button onClick={saveClaimInfo}
                  className="bg-orange-600 hover:bg-orange-500 text-white rounded px-3 py-2 text-sm transition-colors">
                  Save Claim Info
                </button>
                <button onClick={() => generateDoc('supplement_request')}
                  disabled={generating === 'supplement_request'}
                  className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white rounded px-3 py-2 text-sm transition-colors">
                  {generating === 'supplement_request' ? 'Generating...' : '📝 Generate Supplement Request'}
                </button>
              </div>
            </div>
          )}
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

      {/* PHOTOS */}
      {activeTab === 'photos' && (
        <div className="space-y-4">
          {/* Upload */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-400 font-semibold uppercase mb-3">Upload Photos</p>
            <label className={`flex items-center justify-center gap-2 border-2 border-dashed border-gray-700 rounded-lg p-6 cursor-pointer hover:border-blue-500 transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input type="file" accept="image/*" multiple onChange={uploadPhotos} disabled={uploading} className="hidden" />
              <span className="text-gray-400 text-sm">{uploading ? '⏳ Uploading...' : '📷 Click to upload photos'}</span>
            </label>
          </div>

          {/* Photo grid */}
          {['before', 'during', 'after', 'damage', 'material'].map(phase => {
            const phasePhotos = photos.filter(p => p.phase === phase)
            if (!phasePhotos.length) return null
            return (
              <div key={phase}>
                <p className="text-xs text-gray-400 font-semibold uppercase mb-2">{phase}</p>
                <div className="grid grid-cols-3 gap-2">
                  {phasePhotos.map(p => (
                    <div key={p.id} className="aspect-square rounded-lg overflow-hidden bg-gray-800">
                      <img src={p.photo_url} alt={p.caption || phase} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {!photos.length && !uploading && (
            <p className="text-gray-500 text-center py-8">No photos yet. Upload some above.</p>
          )}
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

      {/* CREW */}
      {activeTab === 'crew' && (
        <div className="space-y-4">
          {/* Assigned crew */}
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Assigned to this job</p>
            {crew.length ? (
              <div className="space-y-2">
                {crew.map(a => (
                  <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-medium">{a.crew_lead}</p>
                      {a.scheduled_date && <p className="text-gray-500 text-xs mt-0.5">Scheduled: {a.scheduled_date}</p>}
                      {a.crew_size > 1 && <p className="text-gray-500 text-xs">Crew size: {a.crew_size}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${a.completed ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'}`}>
                      {a.completed ? 'Complete' : 'Scheduled'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No crew assigned yet.</p>
            )}
          </div>

          {/* Assign from roster */}
          {crewMembers.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Assign crew member</p>
              <div className="flex gap-2 flex-wrap">
                {crewMembers.map(m => (
                  <button key={m.id} onClick={() => assignCrew(m.id)}
                    className="bg-gray-800 hover:bg-gray-700 text-white rounded px-3 py-2 text-sm transition-colors">
                    + {m.name} ({m.role})
                  </button>
                ))}
              </div>
            </div>
          )}

          {!crewMembers.length && (
            <p className="text-gray-500 text-sm">
              No crew members in roster. <a href="/roofing/crew" className="text-blue-400">Add crew →</a>
            </p>
          )}
        </div>
      )}

      {showMsgModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setShowMsgModal(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-white font-semibold">Message {job.homeowner_name}</p>
              <button onClick={() => setShowMsgModal(false)} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>
            {templates.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-2 uppercase font-semibold tracking-wider">Quick templates</p>
                <div className="flex flex-wrap gap-1.5">
                  {templates.map(t => (
                    <button key={t.id} onClick={() => {
                      const filled = t.body
                        .replace(/{homeowner_name}/g, job.homeowner_name || '')
                        .replace(/{company_name}/g, job.clients?.name || 'our company')
                      setNewMessage(filled)
                      setSelectedTemplate(t.id)
                    }}
                      className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${selectedTemplate === t.id ? 'bg-orange-600/30 text-orange-300 ring-1 ring-orange-600/40' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <textarea
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-orange-500 resize-none"
              placeholder="Type a message to the homeowner..."
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => { setShowMsgModal(false); setSelectedTemplate(null) }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white rounded-xl py-2.5 text-sm transition-colors">
                Cancel
              </button>
              <button onClick={() => { sendMessage(); setShowMsgModal(false); setSelectedTemplate(null) }}
                disabled={!newMessage.trim()}
                className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                Send Message
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

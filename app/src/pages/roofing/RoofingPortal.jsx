import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const STAGE_ORDER = ['lead','estimate_sent','contract_signed','materials_ordered','scheduled','in_progress','inspection','complete','paid']

export default function RoofingPortal() {
  const { token } = useParams()
  const [job, setJob] = useState(null)
  const [contractor, setContractor] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [photos, setPhotos] = useState([])
  const [messages, setMessages] = useState([])
  const [docs, setDocs] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [activeTab, setActiveTab] = useState('status')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadPortal()
  }, [token])

  const loadPortal = async () => {
    const { data: jobData } = await supabase
      .from('roofing_jobs')
      .select('*, clients(*)')
      .eq('portal_token', token)
      .single()

    if (!jobData) {
      setError('Invalid portal link. Please contact your contractor.')
      setLoading(false)
      return
    }

    setJob(jobData)
    setContractor(jobData.clients)

    const [{ data: t }, { data: p }, { data: m }, { data: d }] = await Promise.all([
      supabase.from('job_timeline').select('*').eq('job_id', jobData.id).order('created_at'),
      supabase.from('job_photos').select('*').eq('job_id', jobData.id).order('created_at'),
      supabase.from('job_messages').select('*').eq('job_id', jobData.id).order('created_at'),
      supabase.from('job_documents').select('doc_type, title, content, signed').eq('job_id', jobData.id),
    ])

    setTimeline(t || [])
    setPhotos(p || [])
    setMessages(m || [])
    setDocs(d || [])
    setLoading(false)
  }

  const sendMessage = async () => {
    if (!newMessage.trim()) return
    const msg = newMessage
    await supabase.from('job_messages').insert({ job_id: job.id, sender: 'homeowner', message: msg })
    setNewMessage('')
    // Fire-and-forget Telegram notification to contractor
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action: 'notify_contractor', job_id: job.id, data: { message: msg } }),
    })
    loadPortal()
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#6b7280' }}>Loading your portal...</p>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#ef4444' }}>{error}</p>
    </div>
  )

  const brandColor = contractor?.brand_color || '#3b82f6'
  const brandName = contractor?.brand_name || contractor?.name || 'Your Roofing Company'
  const currentStageIndex = STAGE_ORDER.indexOf(job?.status || 'lead')
  const progressPct = Math.round(((currentStageIndex + 1) / STAGE_ORDER.length) * 100)

  const tabs = [
    { id: 'status', label: '📊 Status' },
    { id: 'photos', label: '📷 Photos' },
    { id: 'documents', label: '📄 Documents' },
    { id: 'messages', label: `💬 Messages${messages.filter(m => !m.read && m.sender === 'contractor').length > 0 ? ' 🔴' : ''}` },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: 'white', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#111', borderBottom: '1px solid #1f2937', padding: '16px 20px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Powered by</p>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: brandColor }}>{brandName}</h1>
          {contractor?.phone && <p style={{ fontSize: '13px', color: '#9ca3af', marginTop: '2px' }}>{contractor.phone}</p>}
        </div>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
        {/* Job summary card */}
        <div style={{ background: '#111', border: '1px solid #1f2937', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '4px' }}>{job.homeowner_name}</h2>
          <p style={{ color: '#9ca3af', fontSize: '14px' }}>{job.property_address}</p>

          {/* Progress bar */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', color: '#9ca3af' }}>Job Progress</span>
              <span style={{ fontSize: '13px', color: brandColor, fontWeight: '600' }}>{progressPct}%</span>
            </div>
            <div style={{ height: '8px', background: '#1f2937', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: brandColor, borderRadius: '4px', transition: 'width 0.5s ease' }} />
            </div>
            <p style={{ fontSize: '13px', color: 'white', marginTop: '8px', fontWeight: '500' }}>
              Current: {job.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', background: '#111', borderRadius: '12px', padding: '4px', marginBottom: '16px' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: '500', transition: 'all 0.2s',
                background: activeTab === t.id ? '#1f2937' : 'transparent',
                color: activeTab === t.id ? 'white' : '#6b7280',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* STATUS TAB */}
        {activeTab === 'status' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {timeline.map((t, i) => (
              <div key={t.id} style={{
                display: 'flex', gap: '12px', padding: '12px 16px', borderRadius: '12px', border: '1px solid',
                background: t.completed ? 'rgba(16,185,129,0.05)' : '#111',
                borderColor: t.completed ? 'rgba(16,185,129,0.2)' : '#1f2937',
              }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0,
                  background: t.completed ? '#10b981' : '#1f2937',
                  color: t.completed ? 'white' : '#6b7280', fontSize: '14px',
                }}>
                  {t.completed ? '✓' : i + 1}
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: '600', color: t.completed ? 'white' : '#6b7280' }}>{t.title}</p>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{t.description}</p>
                  {t.completed_at && <p style={{ fontSize: '11px', color: '#10b981', marginTop: '4px' }}>✓ {new Date(t.completed_at).toLocaleDateString()}</p>}
                </div>
              </div>
            ))}
            {!timeline.length && <p style={{ color: '#6b7280', textAlign: 'center', padding: '32px 0' }}>Timeline loading...</p>}
          </div>
        )}

        {/* PHOTOS TAB */}
        {activeTab === 'photos' && (
          <div>
            {['before', 'during', 'after'].map(phase => {
              const phasePhotos = photos.filter(p => p.phase === phase)
              if (!phasePhotos.length) return null
              return (
                <div key={phase} style={{ marginBottom: '20px' }}>
                  <p style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>{phase}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {phasePhotos.map(p => (
                      <div key={p.id} style={{ borderRadius: '8px', overflow: 'hidden', background: '#1f2937', aspectRatio: '4/3' }}>
                        <img src={p.photo_url} alt={p.caption || phase} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {!photos.length && <p style={{ color: '#6b7280', textAlign: 'center', padding: '32px 0' }}>No photos yet. Check back once work begins.</p>}
          </div>
        )}

        {/* DOCUMENTS TAB */}
        {activeTab === 'documents' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {docs.map((d, i) => (
              <div key={i} style={{ background: '#111', border: '1px solid #1f2937', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <p style={{ fontWeight: '600', fontSize: '14px' }}>{d.title}</p>
                  {d.signed && <span style={{ fontSize: '11px', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: '12px' }}>Signed</span>}
                </div>
                <p style={{ fontSize: '12px', color: '#6b7280' }}>{d.doc_type.replace(/_/g, ' ')}</p>
              </div>
            ))}
            {!docs.length && <p style={{ color: '#6b7280', textAlign: 'center', padding: '32px 0' }}>No documents yet.</p>}
          </div>
        )}

        {/* MESSAGES TAB */}
        {activeTab === 'messages' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', maxHeight: '300px', overflowY: 'auto' }}>
              {messages.map(m => (
                <div key={m.id} style={{
                  padding: '10px 14px', borderRadius: '12px', fontSize: '14px',
                  background: m.sender === 'contractor' ? '#1f3a5f' : '#1f2937',
                  marginLeft: m.sender === 'contractor' ? '0' : '32px',
                  marginRight: m.sender === 'homeowner' ? '0' : '32px',
                }}>
                  <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>{m.sender === 'contractor' ? brandName : 'You'}</p>
                  <p>{m.message}</p>
                </div>
              ))}
              {!messages.length && <p style={{ color: '#6b7280', textAlign: 'center', padding: '16px 0' }}>No messages yet</p>}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={newMessage} onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                placeholder="Message your contractor..."
                style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', padding: '10px 14px', color: 'white', fontSize: '14px', outline: 'none' }} />
              <button onClick={sendMessage}
                style={{ background: brandColor, border: 'none', borderRadius: '8px', padding: '10px 16px', color: 'white', cursor: 'pointer', fontWeight: '600' }}>
                Send
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <p style={{ textAlign: 'center', color: '#374151', fontSize: '11px', marginTop: '32px' }}>
          Powered by Roofing OS
        </p>
      </div>
    </div>
  )
}

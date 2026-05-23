import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const C = {
  bg: '#0f1923', surface: '#1a2535', surface2: '#243044',
  text: '#ffffff', muted: '#8896a8',
  border: 'rgba(255,255,255,0.08)',
  primary: '#4a9eff', success: '#22c55e',
  warning: '#f59e0b', danger: '#ef4444',
}

const STAGE_META = {
  lead:              { label: 'Lead',        bg: 'rgba(136,150,168,0.15)', fg: '#8896a8' },
  estimate_sent:     { label: 'Estimate',    bg: 'rgba(74,158,255,0.15)',  fg: '#4a9eff' },
  contract_signed:   { label: 'Signed',      bg: 'rgba(124,58,237,0.15)', fg: '#a78bfa' },
  materials_ordered: { label: 'Materials',   bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b' },
  scheduled:         { label: 'Scheduled',   bg: 'rgba(234,88,12,0.15)',  fg: '#fb923c' },
  in_progress:       { label: 'Active',      bg: 'rgba(34,197,94,0.15)',  fg: '#22c55e' },
  inspection:        { label: 'Inspection',  bg: 'rgba(20,184,166,0.15)', fg: '#2dd4bf' },
  invoiced:          { label: 'Invoiced',    bg: 'rgba(168,85,247,0.15)', fg: '#c084fc' },
  complete:          { label: 'Complete',    bg: 'rgba(34,197,94,0.2)',   fg: '#4ade80' },
  paid:              { label: 'Paid',        bg: 'rgba(136,150,168,0.1)', fg: '#6b7280' },
}
const STATUS_FLOW = ['lead','estimate_sent','contract_signed','materials_ordered','scheduled','in_progress','inspection','invoiced','complete','paid']
const PHASE_LABELS = { pre_installation: 'Before', during_tearoff: 'Tearoff', during_installation: 'Install', post_installation: 'After', damage: 'Damage', material: 'Material' }

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

function Pill({ status }) {
  const s = STAGE_META[status] || { label: status, bg: 'rgba(136,150,168,0.15)', fg: '#8896a8' }
  return <span style={{ fontSize: '12px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px', background: s.bg, color: s.fg }}>{s.label}</span>
}

export default function RoofingJobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { contractor } = useContractor()

  const [job, setJob] = useState(null)
  const [messages, setMessages] = useState([])
  const [docs, setDocs] = useState([])
  const [photos, setPhotos] = useState([])
  const [activities, setActivities] = useState([])
  const [portalSession, setPortalSession] = useState(null)
  const [claim, setClaim] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview')

  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPhase, setUploadPhase] = useState('during_installation')
  const [uploadPublic, setUploadPublic] = useState(true)
  const [generating, setGenerating] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)
  const [sentPortal, setSentPortal] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [note, setNote] = useState('')
  const [orderingMeasure, setOrderingMeasure] = useState(false)
  const [measureOrdered, setMeasureOrdered] = useState(false)
  const [suppLoading, setSuppLoading] = useState('')
  const [suppSuccess, setSuppSuccess] = useState('')
  const messagesEndRef = useRef(null)

  const load = async () => {
    const [
      { data: j },
      { data: msgs },
      { data: d },
      { data: p },
      { data: a },
      { data: ps },
      { data: cl },
    ] = await Promise.all([
      supabase.from('roofing_jobs').select('*').eq('id', id).single(),
      supabase.from('portal_messages').select('*').eq('job_id', id).order('created_at'),
      supabase.from('portal_documents').select('*').eq('job_id', id).order('created_at'),
      supabase.from('portal_photos').select('*').eq('job_id', id).order('taken_at', { ascending: false }),
      supabase.from('portal_activities').select('*').eq('job_id', id).order('created_at'),
      supabase.from('homeowner_sessions').select('magic_link_token, last_accessed_at, access_count').eq('job_id', id).maybeSingle(),
      supabase.from('insurance_claims').select('*').eq('job_id', id).maybeSingle(),
    ])
    setJob(j)
    setMessages(msgs || [])
    setDocs(d || [])
    setPhotos(p || [])
    setActivities(a || [])
    setPortalSession(ps)
    setClaim(cl)
    if (j) setNote(j.notes || '')
    setLoading(false)
  }

  useEffect(() => { load() }, [id])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const updateStatus = async (status) => {
    await supabase.from('roofing_jobs').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ action: 'generate_timeline', job_id: id }),
    }).catch(() => {})
    setJob(j => ({ ...j, status }))
    load()
  }

  const sendPortalLink = async () => {
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ event: 'portal_link', job_id: id }),
    }).catch(() => {})
    setSentPortal(true)
    setTimeout(() => { setSentPortal(false); load() }, 3000)
  }

  const copyPortalLink = () => {
    const token = portalSession?.magic_link_token || job?.portal_token
    if (!token) return
    const url = `https://app.nexuszc.com/roofing/portal/${token}`
    navigator.clipboard.writeText(url).then(() => { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000) })
  }

  const sendMessage = async () => {
    if (!newMessage.trim() || sending) return
    setSending(true)
    await supabase.from('portal_messages').insert({
      job_id: id,
      sender_type: 'contractor',
      sender_name: contractor?.company_name || 'Your Contractor',
      message: newMessage.trim(),
    })
    setNewMessage('')
    setSending(false)
    load()
  }

  const uploadPhotos = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      const path = `${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { data: up, error } = await supabase.storage.from('job-photos').upload(path, file)
      if (!error && up) {
        const { data: { publicUrl } } = supabase.storage.from('job-photos').getPublicUrl(path)
        await supabase.from('portal_photos').insert({
          job_id: id, url: publicUrl, phase: uploadPhase,
          uploaded_by: 'contractor', is_public: uploadPublic,
          source: 'contractor_upload', file_size_bytes: file.size,
          is_before: uploadPhase === 'pre_installation',
          is_after: uploadPhase === 'post_installation',
        })
      }
    }
    setUploading(false)
    load()
  }

  const generateDoc = async (action) => {
    setGenerating(action)
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ action, job_id: id }),
    }).catch(() => {})
    setGenerating('')
    load()
  }

  const saveNote = async () => {
    setSavingNote(true)
    await supabase.from('roofing_jobs').update({ notes: note }).eq('id', id)
    setSavingNote(false)
  }

  const orderMeasurements = async () => {
    setOrderingMeasure(true)
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-measurements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ action: 'create_order', job_id: id }),
    }).catch(() => {})
    setMeasureOrdered(true)
    setOrderingMeasure(false)
  }

  const runSupplementAI = async (type) => {
    setSuppLoading(type)
    await fetch(`${SUPABASE_URL}/functions/v1/${type === 'full' ? 'roofing-supplement-analyzer' : 'roofing-supplement-generator'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ job_id: id }),
    }).catch(() => {})
    setSuppLoading('')
    setSuppSuccess(type)
    setTimeout(() => setSuppSuccess(''), 4000)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: C.muted }}>Loading…</p>
      </div>
    )
  }
  if (!job) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: C.muted }}>Job not found.</p>
      </div>
    )
  }

  const portalUrl = `https://app.nexuszc.com/roofing/portal/${portalSession?.magic_link_token || job.portal_token || ''}`
  const unreadCount = messages.filter(m => m.sender_type === 'homeowner' && !m.is_read).length
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'portal', label: 'Portal' },
    { id: 'photos', label: `Photos${photos.length ? ` (${photos.length})` : ''}` },
    { id: 'messages', label: `Messages${unreadCount > 0 ? ` 🔴` : messages.length ? ` (${messages.length})` : ''}` },
    { id: 'documents', label: `Docs${docs.length ? ` (${docs.length})` : ''}` },
    { id: 'notes', label: 'Notes' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{
        background: 'rgba(15,25,35,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '14px 20px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <button onClick={() => navigate('/roofing/jobs')} style={{ fontSize: '12px', color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 6px', display: 'block' }}>← Back</button>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.homeowner_name}</h1>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.property_address}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginTop: '20px' }}>
            <Pill status={job.status} />
            {job.contract_amount > 0 && (
              <span style={{ fontSize: '14px', fontWeight: '700', color: C.success }}>${job.contract_amount.toLocaleString()}</span>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '0', marginTop: '12px', overflowX: 'auto', scrollbarWidth: 'none', borderBottom: `1px solid ${C.border}` }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                padding: '10px 16px', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0,
                background: 'none',
                color: activeTab === t.id ? C.primary : C.muted,
                borderBottom: activeTab === t.id ? `2px solid ${C.primary}` : '2px solid transparent',
                transition: 'color 0.15s',
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 20px' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Status stepper */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '20px' }}>
              <p style={{ margin: '0 0 16px', fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job Status</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '16px' }}>
                {STATUS_FLOW.map((s, i) => {
                  const currentIdx = STATUS_FLOW.indexOf(job.status)
                  const isPast = i < currentIdx
                  const isCurrent = i === currentIdx
                  const meta = STAGE_META[s] || { label: s, fg: C.muted }
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STATUS_FLOW.length - 1 ? '1' : '0' }}>
                      <div
                        onClick={() => updateStatus(s)}
                        title={meta.label}
                        style={{
                          width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                          background: isCurrent ? C.primary : isPast ? 'rgba(74,158,255,0.3)' : 'rgba(255,255,255,0.08)',
                          border: isCurrent ? `2px solid ${C.primary}` : isPast ? '2px solid rgba(74,158,255,0.3)' : `2px solid ${C.border}`,
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: isCurrent ? '0 0 12px rgba(74,158,255,0.5)' : 'none',
                          transition: 'all 0.15s',
                          fontSize: '10px', color: isCurrent ? '#fff' : isPast ? 'rgba(74,158,255,0.8)' : C.muted,
                          fontWeight: '700',
                        }}
                      >
                        {isPast ? '✓' : i + 1}
                      </div>
                      {i < STATUS_FLOW.length - 1 && (
                        <div style={{ flex: 1, height: '2px', background: i < STATUS_FLOW.indexOf(job.status) ? 'rgba(74,158,255,0.4)' : 'rgba(255,255,255,0.06)' }} />
                      )}
                    </div>
                  )
                })}
              </div>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: C.text }}>
                {STAGE_META[job.status]?.label || job.status}
                <span style={{ fontWeight: '400', color: C.muted, fontSize: '13px' }}> — tap a step to advance</span>
              </p>
            </div>

            {/* Action cards grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[
                { icon: '📐', title: 'Measurements', price: '$25', action: () => orderMeasurements(), loading: orderingMeasure, done: measureOrdered, show: true },
                { icon: '🤖', title: 'Supplement AI', price: '$99', action: () => runSupplementAI('basic'), loading: suppLoading === 'basic', done: suppSuccess === 'basic', show: !!(claim || job.insurance_claim) },
                { icon: '📋', title: 'Full AI Handling', price: '$329', action: () => runSupplementAI('full'), loading: suppLoading === 'full', done: suppSuccess === 'full', show: !!(claim || job.insurance_claim) },
                { icon: '🔗', title: 'Copy Portal Link', price: null, action: () => copyPortalLink(), done: copiedLink, show: true },
              ].filter(c => c.show !== false).map((card, i) => (
                <div key={i}
                  onClick={card.done ? undefined : card.action}
                  style={{
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: '14px', padding: '16px', cursor: card.done ? 'default' : 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => !card.done && (e.currentTarget.style.borderColor = 'rgba(74,158,255,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
                >
                  <span style={{ fontSize: '24px' }}>{card.icon}</span>
                  <p style={{ margin: '8px 0 2px', fontSize: '14px', fontWeight: '600', color: C.text }}>
                    {card.loading ? 'Working…' : card.done ? '✓ Done' : card.title}
                  </p>
                  {card.price && <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>{card.price}</p>}
                </div>
              ))}
            </div>

            {/* Generate Documents */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
              <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Generate Documents</p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { action: 'generate_estimate', label: '📋 Estimate' },
                  { action: 'generate_contract', label: '📄 Contract' },
                  { action: 'generate_invoice', label: '🧾 Invoice' },
                ].map(({ action, label }) => (
                  <button key={action} onClick={() => generateDoc(action)} disabled={!!generating}
                    style={{
                      background: generating === action ? 'rgba(74,158,255,0.12)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 14px',
                      fontSize: '13px', cursor: generating ? 'default' : 'pointer', fontWeight: '500',
                      color: generating === action ? C.primary : C.text, transition: 'background 0.15s',
                    }}>
                    {generating === action ? 'Generating…' : label}
                  </button>
                ))}
              </div>
            </div>

            {/* Info grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { label: 'Email', value: job.homeowner_email },
                { label: 'Phone', value: job.homeowner_phone },
                { label: 'Material', value: [job.shingle_brand, job.shingle_color, job.material_type].filter(Boolean).join(' ') || null },
                { label: 'Size', value: job.roof_size_squares ? `${job.roof_size_squares} sq` : null },
                { label: 'Start', value: job.actual_start_date || job.estimated_start_date },
                { label: 'End', value: job.scheduled_end || null },
              ].map(f => (
                <div key={f.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '11px 13px' }}>
                  <p style={{ margin: '0 0 3px', fontSize: '11px', color: C.muted, fontWeight: '500' }}>{f.label}</p>
                  <p style={{ margin: 0, fontSize: '13px', color: f.value ? C.text : 'rgba(136,150,168,0.5)', fontWeight: '500' }}>{f.value || '—'}</p>
                </div>
              ))}
            </div>

            {/* Supplement AI — if insurance job and not in action cards already */}
            {(claim || job.insurance_claim) && suppSuccess && (
              <div style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '14px', padding: '14px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#a78bfa', fontWeight: '600' }}>✓ Supplement request generated — check Documents tab.</p>
              </div>
            )}

            {/* Insurance claim info */}
            {claim && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
                <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🏛️ Insurance Claim</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { label: 'Claim #', value: claim.claim_number },
                    { label: 'Carrier', value: claim.carrier_name },
                    { label: 'Adjuster', value: claim.adjuster_name },
                    { label: 'Status', value: claim.status?.replace(/_/g,' ') },
                    { label: 'Estimate', value: claim.original_estimate ? `$${(claim.original_estimate/100).toLocaleString()}` : null },
                  ].map(f => f.value ? (
                    <div key={f.label} style={{ background: C.surface2, borderRadius: '8px', padding: '10px 12px' }}>
                      <p style={{ margin: '0 0 2px', fontSize: '11px', color: C.muted }}>{f.label}</p>
                      <p style={{ margin: 0, fontSize: '13px', color: C.text, fontWeight: '500' }}>{f.value}</p>
                    </div>
                  ) : null)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PORTAL */}
        {activeTab === 'portal' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '20px' }}>
              <p style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: '700', color: C.text }}>🔗 Homeowner Portal</p>
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: C.muted }}>Share this link with {job.homeowner_name}. They can track their job, view photos, sign documents, and message you.</p>

              {portalSession?.magic_link_token || job.portal_token ? (
                <>
                  <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '11px 13px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <p style={{ margin: 0, fontSize: '12px', color: C.muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{portalUrl}</p>
                    <button onClick={copyPortalLink}
                      style={{
                        background: copiedLink ? 'rgba(34,197,94,0.15)' : 'rgba(74,158,255,0.15)',
                        border: 'none', borderRadius: '6px', padding: '5px 10px', fontSize: '12px', fontWeight: '600',
                        cursor: 'pointer', color: copiedLink ? C.success : C.primary, flexShrink: 0,
                      }}>
                      {copiedLink ? '✓ Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={sendPortalLink}
                      style={{
                        flex: 1,
                        background: sentPortal ? 'rgba(34,197,94,0.15)' : C.primary,
                        color: sentPortal ? C.success : '#fff',
                        border: 'none', borderRadius: '10px', padding: '11px', fontSize: '14px', fontWeight: '700', cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}>
                      {sentPortal ? '✓ Sent via SMS & Email!' : '📨 Send to Homeowner'}
                    </button>
                    <a href={portalUrl} target="_blank" rel="noopener"
                      style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '11px 16px', fontSize: '14px', textDecoration: 'none', color: C.text, fontWeight: '600' }}>
                      Preview ↗
                    </a>
                  </div>
                </>
              ) : (
                <div>
                  <p style={{ fontSize: '13px', color: C.muted, marginBottom: '12px' }}>Portal link not sent yet. Click below to generate and send.</p>
                  <button onClick={sendPortalLink}
                    style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '11px 20px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                    {sentPortal ? '✓ Sent!' : '📨 Send Portal Link'}
                  </button>
                </div>
              )}
            </div>

            {portalSession && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
                <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Portal Activity</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ background: C.surface2, borderRadius: '10px', padding: '14px' }}>
                    <p style={{ margin: '0 0 4px', fontSize: '11px', color: C.muted }}>Total Views</p>
                    <p style={{ margin: 0, fontSize: '26px', fontWeight: '700', color: C.text }}>{portalSession.access_count || 0}</p>
                  </div>
                  <div style={{ background: C.surface2, borderRadius: '10px', padding: '14px' }}>
                    <p style={{ margin: '0 0 4px', fontSize: '11px', color: C.muted }}>Last Viewed</p>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: C.text }}>
                      {portalSession.last_accessed_at
                        ? new Date(portalSession.last_accessed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : 'Not yet'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* PHOTOS */}
        {activeTab === 'photos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
              <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Upload Photos</p>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {Object.entries(PHASE_LABELS).map(([key, label]) => (
                  <button key={key} onClick={() => setUploadPhase(key)}
                    style={{ padding: '4px 11px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: uploadPhase === key ? C.primary : 'rgba(255,255,255,0.06)', color: uploadPhase === key ? '#fff' : C.muted, transition: 'all 0.15s' }}>
                    {label}
                  </button>
                ))}
                <button onClick={() => setUploadPublic(v => !v)}
                  style={{ padding: '4px 11px', borderRadius: '20px', border: `1px solid ${C.border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: uploadPublic ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)', color: uploadPublic ? C.success : C.muted, transition: 'all 0.15s' }}>
                  {uploadPublic ? '👁 Homeowner visible' : '🔒 Internal only'}
                </button>
              </div>
              <label style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                border: '2px dashed rgba(255,255,255,0.12)', borderRadius: '12px', padding: '24px',
                cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1,
                background: 'rgba(255,255,255,0.02)', transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => !uploading && (e.currentTarget.style.borderColor = 'rgba(74,158,255,0.3)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')}
              >
                <input type="file" accept="image/*" multiple onChange={uploadPhotos} disabled={uploading} style={{ display: 'none' }} />
                <span style={{ fontSize: '13px', color: C.muted }}>{uploading ? '⏳ Uploading…' : `📷 Tap to upload as "${PHASE_LABELS[uploadPhase]}"`}</span>
              </label>
            </div>

            {Object.entries(PHASE_LABELS).map(([phase, label]) => {
              const phasePhotos = photos.filter(p => p.phase === phase)
              if (!phasePhotos.length) return null
              return (
                <div key={phase}>
                  <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label} ({phasePhotos.length})</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {phasePhotos.map(p => (
                      <div key={p.id} style={{ aspectRatio: '1', borderRadius: '12px', overflow: 'hidden', background: C.surface2, position: 'relative' }}>
                        <img src={p.url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {!p.is_public && (
                          <div style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>🔒</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {!photos.length && !uploading && (
              <p style={{ textAlign: 'center', color: C.muted, padding: '40px 0', fontSize: '14px' }}>No photos yet. Upload some above.</p>
            )}
          </div>
        )}

        {/* MESSAGES */}
        {activeTab === 'messages' && (
          <div>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px', marginBottom: '12px', maxHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {messages.length === 0 && (
                <p style={{ textAlign: 'center', color: C.muted, fontSize: '13px', padding: '24px 0' }}>No messages yet.</p>
              )}
              {messages.map(m => {
                const isContractor = m.sender_type === 'contractor'
                const isAria = m.sender_type === 'aria'
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: isContractor ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '75%', padding: '10px 13px',
                      borderRadius: isContractor ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      background: isContractor ? C.primary : isAria ? C.surface2 : C.surface2,
                      border: isContractor ? 'none' : `1px solid ${C.border}`,
                      color: C.text,
                    }}>
                      <p style={{ margin: '0 0 4px', fontSize: '10px', fontWeight: '600', opacity: 0.7 }}>
                        {isAria ? '🤖 Aria' : isContractor ? 'You' : job.homeowner_name}
                      </p>
                      <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.4 }}>{m.message}</p>
                      <p style={{ margin: '4px 0 0', fontSize: '10px', opacity: 0.5 }}>{new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder={`Message ${job.homeowner_name}…`}
                style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', fontSize: '14px', color: C.text, outline: 'none', transition: 'border-color 0.15s' }}
                onFocus={e => { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
                onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }}
              />
              <button onClick={sendMessage} disabled={sending || !newMessage.trim()}
                style={{ background: sending || !newMessage.trim() ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '12px 18px', fontSize: '14px', fontWeight: '700', cursor: sending ? 'default' : 'pointer' }}>
                →
              </button>
            </div>
          </div>
        )}

        {/* DOCUMENTS */}
        {activeTab === 'documents' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {docs.map(d => (
              <div key={d.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: C.text }}>{d.title}</p>
                  <span style={{
                    fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px',
                    background: d.status === 'signed' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
                    color: d.status === 'signed' ? C.success : C.muted,
                  }}>
                    {d.status === 'signed' ? '✓ Signed' : (d.doc_type || d.status || 'Pending')}
                  </span>
                </div>
                {d.file_url ? (
                  <a href={d.file_url} target="_blank" rel="noopener" style={{ fontSize: '12px', color: C.primary }}>View document ↗</a>
                ) : d.content ? (
                  <button onClick={() => navigator.clipboard.writeText(d.content)} style={{ fontSize: '12px', color: C.primary, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Copy document text</button>
                ) : null}
                {d.signed_at && <p style={{ margin: '4px 0 0', fontSize: '11px', color: C.muted }}>Signed {new Date(d.signed_at).toLocaleDateString()}</p>}
              </div>
            ))}
            {!docs.length && (
              <p style={{ textAlign: 'center', color: C.muted, fontSize: '13px', padding: '32px 0' }}>No documents yet. Generate one from the Overview tab.</p>
            )}
          </div>
        )}

        {/* NOTES */}
        {activeTab === 'notes' && (
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Internal Notes</p>
            <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'rgba(136,150,168,0.6)' }}>These notes are not visible to the homeowner.</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={8}
              placeholder="Add internal notes about this job — adjuster contact, crew notes, material delivery, etc."
              style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '13px 14px', fontSize: '14px', color: C.text, resize: 'vertical', outline: 'none', lineHeight: 1.5, transition: 'border-color 0.15s' }}
              onFocus={e => { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
              onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }}
            />
            <button onClick={saveNote} disabled={savingNote}
              style={{ marginTop: '10px', background: savingNote ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '11px 20px', fontSize: '14px', fontWeight: '700', cursor: savingNote ? 'default' : 'pointer', transition: 'background 0.15s' }}>
              {savingNote ? 'Saving…' : 'Save Notes'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

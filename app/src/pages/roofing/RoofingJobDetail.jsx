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

const INSPECTION_ITEMS = [
  { id: 'decking',     label: 'Decking condition',          desc: 'Soft spots, rot, damage' },
  { id: 'flashing',    label: 'Existing flashing',          desc: 'Condition, needs replace' },
  { id: 'valleys',     label: 'Valleys',                    desc: 'Clean, no debris' },
  { id: 'gutters',     label: 'Gutters',                    desc: 'Clear, properly attached' },
  { id: 'ridge',       label: 'Ridge',                      desc: 'Straight, no sagging' },
  { id: 'drip_edge',   label: 'Drip edge',                  desc: 'Present, properly installed' },
  { id: 'ventilation', label: 'Ventilation',                desc: 'Ridge vent, soffit vents clear' },
  { id: 'skylights',   label: 'Skylights / penetrations',   desc: 'Sealed, no cracks' },
  { id: 'chimney',     label: 'Chimney',                    desc: 'Flashing intact, mortar condition' },
  { id: 'overall',     label: 'Overall damage assessment',  desc: 'Photo required' },
]

const PERMIT_STATUSES = [
  { value: 'not_required', label: 'Not Required', color: C.muted },
  { value: 'need_to_file', label: 'Need to File', color: C.warning },
  { value: 'filed_pending', label: 'Filed — Pending', color: '#60a5fa' },
  { value: 'approved', label: 'Approved ✅', color: C.success },
  { value: 'expired', label: 'Expired ⚠️', color: C.danger },
]

const COMMON_LINE_ITEMS = [
  'Remove & dispose old roofing',
  'Install felt underlayment',
  'Install shingles (per square)',
  'Ridge cap shingles',
  'Drip edge (per LF)',
  'Flashing',
  'Dump fee',
  'Permit fee',
]

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

function Pill({ status }) {
  const s = STAGE_META[status] || { label: status, bg: 'rgba(136,150,168,0.15)', fg: '#8896a8' }
  return <span style={{ fontSize: '12px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px', background: s.bg, color: s.fg }}>{s.label}</span>
}

function UpgradeModal({ message, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '28px', maxWidth: '360px', width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>🚀</div>
        <p style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '700', color: C.text }}>Upgrade to Starter</p>
        <p style={{ margin: '0 0 24px', fontSize: '14px', color: C.muted, lineHeight: 1.5 }}>{message || 'You\'ve used all 3 free portals this month. Upgrade to Starter for unlimited portals.'}</p>
        <a href="https://roofingos.dev/upgrade" style={{ display: 'block', background: C.primary, color: '#fff', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '700', textDecoration: 'none', marginBottom: '10px' }}>
          Upgrade to Starter — $149/mo →
        </a>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: '14px' }}>Not now</button>
      </div>
    </div>
  )
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
  const [inspection, setInspection] = useState(null)
  const [permit, setPermit] = useState(null)
  const [scheduleData, setScheduleData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview')

  // Form states
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
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const [sendingReview, setSendingReview] = useState(false)
  const [reviewSent, setReviewSent] = useState(false)

  // Inspection form
  const [inspectionItems, setInspectionItems] = useState(
    INSPECTION_ITEMS.map(i => ({ ...i, result: null, notes: '' }))
  )
  const [inspectorName, setInspectorName] = useState('')
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().split('T')[0])
  const [inspectionNotes, setInspectionNotes] = useState('')
  const [savingInspection, setSavingInspection] = useState(false)

  // Permit form
  const [permitForm, setPermitForm] = useState({ status: 'not_required', municipality: '', permit_number: '', filed_date: '', approved_date: '', expiry_date: '', cost_cents: '', notes: '' })
  const [savingPermit, setSavingPermit] = useState(false)
  const [permitSaved, setPermitSaved] = useState(false)
  const [showPermitForm, setShowPermitForm] = useState(false)

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
      { data: insp },
      { data: perm },
      { data: sched },
    ] = await Promise.all([
      supabase.from('roofing_jobs').select('*').eq('id', id).single(),
      supabase.from('portal_messages').select('*').eq('job_id', id).order('created_at'),
      supabase.from('portal_documents').select('*').eq('job_id', id).order('created_at'),
      supabase.from('portal_photos').select('*').eq('job_id', id).order('taken_at', { ascending: false }),
      supabase.from('portal_activities').select('*').eq('job_id', id).order('created_at'),
      supabase.from('homeowner_sessions').select('magic_link_token, last_accessed_at, access_count').eq('job_id', id).maybeSingle(),
      supabase.from('insurance_claims').select('*').eq('job_id', id).maybeSingle(),
      supabase.from('job_inspections').select('*').eq('job_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('job_permits').select('*').eq('job_id', id).maybeSingle(),
      supabase.from('job_schedule').select('*').eq('job_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    setJob(j)
    setMessages(msgs || [])
    setDocs(d || [])
    setPhotos(p || [])
    setActivities(a || [])
    setPortalSession(ps)
    setClaim(cl)
    setInspection(insp)
    setScheduleData(sched)
    if (j) setNote(j.notes || '')
    if (j) setReviewSent(j.review_requested || false)
    if (perm) {
      setPermit(perm)
      setPermitForm({
        status: perm.status || 'not_required',
        municipality: perm.municipality || '',
        permit_number: perm.permit_number || '',
        filed_date: perm.filed_date || '',
        approved_date: perm.approved_date || '',
        expiry_date: perm.expiry_date || '',
        cost_cents: perm.cost_cents ? String(perm.cost_cents / 100) : '',
        notes: perm.notes || '',
      })
    }
    if (insp) {
      setInspectorName(insp.inspector_name || '')
      setInspectionDate(insp.inspection_date || new Date().toISOString().split('T')[0])
      setInspectionNotes(insp.notes || '')
      if (Array.isArray(insp.checklist) && insp.checklist.length) {
        setInspectionItems(insp.checklist)
      }
    }
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
    // Trigger review request when job marked complete
    if (status === 'complete') {
      await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ event: 'review_request', job_id: id }),
      }).catch(() => {})
      await supabase.from('roofing_jobs').update({ review_requested: true, review_requested_at: new Date().toISOString() }).eq('id', id)
      setReviewSent(true)
    }
    setJob(j => ({ ...j, status }))
    load()
  }

  const sendPortalLink = async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ event: 'portal_link', job_id: id }),
    }).catch(() => null)
    if (res) {
      const data = await res.json().catch(() => ({}))
      if (data.error === 'portal_limit_reached') {
        setUpgradeMsg(data.message || '')
        setShowUpgradeModal(true)
        return
      }
    }
    await supabase.from('roofing_jobs').update({ portal_sent: true, portal_sent_at: new Date().toISOString() }).eq('id', id)
    setJob(j => ({ ...j, portal_sent: true }))
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

  const setItemResult = (idx, result) => {
    setInspectionItems(prev => prev.map((item, i) => i === idx ? { ...item, result } : item))
  }
  const setItemNotes = (idx, notes) => {
    setInspectionItems(prev => prev.map((item, i) => i === idx ? { ...item, notes } : item))
  }

  const saveInspection = async () => {
    setSavingInspection(true)
    const allPassed = inspectionItems.every(i => i.result !== 'fail')
    const payload = {
      job_id: id,
      contractor_id: contractor?.id,
      checklist: inspectionItems,
      inspector_name: inspectorName,
      inspection_date: inspectionDate,
      passed: allPassed,
      notes: inspectionNotes,
    }
    if (inspection?.id) {
      await supabase.from('job_inspections').update(payload).eq('id', inspection.id)
    } else {
      await supabase.from('job_inspections').insert(payload)
    }
    if (!allPassed) {
      await supabase.from('roofing_jobs').update({ status: 'inspection' }).eq('id', id)
      // Telegram alert for failed inspection
      const tgToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN
      const tgChat = import.meta.env.VITE_TELEGRAM_CHAT_ID
      if (tgToken && tgChat) {
        const failedItems = inspectionItems.filter(i => i.result === 'fail').map(i => i.label).join(', ')
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgChat, text: `⚠️ Inspection failed — ${job?.property_address}\nFailed: ${failedItems}` }),
        }).catch(() => {})
      }
    }
    setSavingInspection(false)
    load()
  }

  const savePermit = async () => {
    setSavingPermit(true)
    const data = {
      job_id: id,
      contractor_id: contractor?.id,
      status: permitForm.status,
      municipality: permitForm.municipality || null,
      permit_number: permitForm.permit_number || null,
      filed_date: permitForm.filed_date || null,
      approved_date: permitForm.approved_date || null,
      expiry_date: permitForm.expiry_date || null,
      cost_cents: permitForm.cost_cents ? Math.round(parseFloat(permitForm.cost_cents) * 100) : null,
      notes: permitForm.notes || null,
    }
    if (permit?.id) {
      await supabase.from('job_permits').update(data).eq('id', permit.id)
    } else {
      await supabase.from('job_permits').insert(data)
    }
    setSavingPermit(false)
    setPermitSaved(true)
    setTimeout(() => setPermitSaved(false), 2000)
    setShowPermitForm(false)
    load()
  }

  const sendReviewRequest = async () => {
    setSendingReview(true)
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ event: 'review_request', job_id: id }),
    }).catch(() => {})
    await supabase.from('roofing_jobs').update({ review_requested: true, review_requested_at: new Date().toISOString() }).eq('id', id)
    setSendingReview(false)
    setReviewSent(true)
    load()
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
  const show10PhotoBanner = photos.length >= 10 && !job.portal_sent

  const tabs = [
    { id: 'overview',    label: 'Overview' },
    { id: 'inspection',  label: `Inspection${inspection?.passed === false ? ' ⚠️' : inspection ? ' ✓' : ''}` },
    { id: 'portal',      label: 'Portal' },
    { id: 'photos',      label: `Photos${photos.length ? ` (${photos.length})` : ''}` },
    { id: 'messages',    label: `Messages${unreadCount > 0 ? ` 🔴` : messages.length ? ` (${messages.length})` : ''}` },
    { id: 'documents',   label: `Docs${docs.length ? ` (${docs.length})` : ''}` },
    { id: 'notes',       label: 'Notes' },
  ]

  const permitStatusMeta = PERMIT_STATUSES.find(s => s.value === (permit?.status || permitForm.status)) || PERMIT_STATUSES[0]

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '80px' }}>
      {showUpgradeModal && <UpgradeModal message={upgradeMsg} onClose={() => setShowUpgradeModal(false)} />}

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
                padding: '10px 14px', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0,
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

      {/* 10-photo banner */}
      {show10PhotoBanner && (
        <div style={{ background: 'rgba(74,158,255,0.12)', borderBottom: '1px solid rgba(74,158,255,0.25)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: C.primary }}>
            📸 10 photos taken — ready to send homeowner portal?
          </p>
          <button onClick={sendPortalLink}
            style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>
            {sentPortal ? '✓ Sent!' : 'Send Portal to Homeowner →'}
          </button>
        </div>
      )}

      <div style={{ padding: '16px 20px' }}>

        {/* ── OVERVIEW ───────────────────────────────────────────────── */}
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

            {/* Permit card */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <p style={{ margin: 0, fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🏛️ Permit</p>
                <button onClick={() => setShowPermitForm(v => !v)}
                  style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '6px', padding: '4px 10px', fontSize: '12px', color: C.muted, cursor: 'pointer' }}>
                  {showPermitForm ? 'Cancel' : (permit ? 'Edit' : '+ Add')}
                </button>
              </div>
              {!showPermitForm ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '22px' }}>
                    {permit?.status === 'approved' ? '✅' : permit?.status === 'expired' ? '⚠️' : permit?.status === 'filed_pending' ? '⏳' : permit?.status === 'need_to_file' ? '📋' : '—'}
                  </span>
                  <div>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: C.text }}>{permitStatusMeta.label}</p>
                    {permit?.permit_number && <p style={{ margin: '2px 0 0', fontSize: '12px', color: C.muted }}>#{permit.permit_number} — {permit.municipality}</p>}
                    {permit?.expiry_date && <p style={{ margin: '2px 0 0', fontSize: '12px', color: C.warning }}>Expires {new Date(permit.expiry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {PERMIT_STATUSES.map(s => (
                      <button key={s.value} onClick={() => setPermitForm(f => ({ ...f, status: s.value }))}
                        style={{ padding: '5px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: permitForm.status === s.value ? 'rgba(74,158,255,0.2)' : 'rgba(255,255,255,0.06)', color: permitForm.status === s.value ? C.primary : C.muted, transition: 'all 0.15s' }}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {['municipality', 'permit_number'].map(field => (
                    <input key={field} value={permitForm[field]} onChange={e => setPermitForm(f => ({ ...f, [field]: e.target.value }))}
                      placeholder={field === 'municipality' ? 'Municipality / City' : 'Permit number'}
                      style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 11px', fontSize: '13px', color: C.text, outline: 'none' }} />
                  ))}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {[['filed_date','Filed'],['approved_date','Approved'],['expiry_date','Expires'],['cost_cents','Cost ($)']].map(([field, label]) => (
                      <div key={field}>
                        <p style={{ margin: '0 0 3px', fontSize: '11px', color: C.muted }}>{label}</p>
                        <input type={field === 'cost_cents' ? 'number' : 'date'} value={permitForm[field]} onChange={e => setPermitForm(f => ({ ...f, [field]: e.target.value }))}
                          style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '7px 10px', fontSize: '13px', color: C.text, outline: 'none' }} />
                      </div>
                    ))}
                  </div>
                  <button onClick={savePermit} disabled={savingPermit}
                    style={{ background: permitSaved ? 'rgba(34,197,94,0.2)' : C.primary, color: permitSaved ? C.success : '#fff', border: 'none', borderRadius: '8px', padding: '9px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
                    {savingPermit ? 'Saving…' : permitSaved ? '✓ Saved' : 'Save Permit'}
                  </button>
                </div>
              )}
            </div>

            {/* Schedule */}
            {scheduleData && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>📅 Schedule</p>
                  <button onClick={() => navigate(`/roofing/schedule`)}
                    style={{ background: 'none', border: 'none', fontSize: '12px', color: C.primary, cursor: 'pointer' }}>View calendar →</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { label: 'Install Date', value: scheduleData.scheduled_date ? new Date(scheduleData.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null },
                    { label: 'Start Time', value: scheduleData.start_time },
                    { label: 'Crew Lead', value: scheduleData.crew_lead },
                    { label: 'Materials', value: scheduleData.material_delivery_date ? new Date(scheduleData.material_delivery_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null },
                  ].map(f => (
                    <div key={f.label} style={{ background: C.surface2, borderRadius: '8px', padding: '10px 12px' }}>
                      <p style={{ margin: '0 0 2px', fontSize: '11px', color: C.muted }}>{f.label}</p>
                      <p style={{ margin: 0, fontSize: '13px', color: f.value ? C.text : 'rgba(136,150,168,0.4)', fontWeight: '500' }}>{f.value || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reviews card (when complete) */}
            {(job.status === 'complete' || job.status === 'paid') && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
                <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>⭐ Review Request</p>
                {reviewSent ? (
                  <p style={{ margin: 0, fontSize: '13px', color: C.success, fontWeight: '600' }}>✓ Review & referral request sent to {job.homeowner_name}</p>
                ) : (
                  <>
                    <p style={{ margin: '0 0 10px', fontSize: '13px', color: C.muted }}>Job marked complete. Send homeowner a Google review request + referral link.</p>
                    <button onClick={sendReviewRequest} disabled={sendingReview}
                      style={{ background: sendingReview ? 'rgba(74,158,255,0.3)' : C.primary, color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
                      {sendingReview ? 'Sending…' : '⭐ Request Review + Referral'}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Action cards grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[
                { icon: '📐', title: 'Measurements', price: '$25', action: () => orderMeasurements(), loading: orderingMeasure, done: measureOrdered, show: true },
                { icon: '💰', title: 'Estimate Builder', price: null, action: () => navigate(`/roofing/estimate/${id}`), loading: false, done: false, show: true },
                { icon: '🤖', title: 'Supplement AI', price: '$99', action: () => runSupplementAI('basic'), loading: suppLoading === 'basic', done: suppSuccess === 'basic', show: !!(claim || job.insurance_claim) },
                { icon: '📋', title: 'Full AI Handling', price: '$329', action: () => runSupplementAI('full'), loading: suppLoading === 'full', done: suppSuccess === 'full', show: !!(claim || job.insurance_claim) },
                { icon: '🔗', title: 'Copy Portal Link', price: null, action: () => copyPortalLink(), done: copiedLink, show: true },
                { icon: '📅', title: 'Schedule Job', price: null, action: () => navigate(`/roofing/schedule?job=${id}`), loading: false, done: false, show: true },
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

        {/* ── INSPECTION TAB ──────────────────────────────────────────── */}
        {activeTab === 'inspection' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
              <p style={{ margin: '0 0 14px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Inspector Info</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '11px', color: C.muted }}>Inspector Name</p>
                  <input value={inspectorName} onChange={e => setInspectorName(e.target.value)}
                    placeholder="Name"
                    style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 11px', fontSize: '13px', color: C.text, outline: 'none' }} />
                </div>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '11px', color: C.muted }}>Date</p>
                  <input type="date" value={inspectionDate} onChange={e => setInspectionDate(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 11px', fontSize: '13px', color: C.text, outline: 'none' }} />
                </div>
              </div>
              {inspection && (
                <div style={{ padding: '8px 12px', borderRadius: '8px', background: inspection.passed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', marginBottom: '4px' }}>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: inspection.passed ? C.success : C.danger }}>
                    {inspection.passed ? '✅ Last inspection passed' : '❌ Last inspection failed'} — {inspection.inspection_date ? new Date(inspection.inspection_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </p>
                </div>
              )}
            </div>

            {inspectionItems.map((item, idx) => (
              <div key={item.id} style={{ background: C.surface, border: `1px solid ${item.result === 'fail' ? 'rgba(239,68,68,0.3)' : item.result === 'pass' ? 'rgba(34,197,94,0.25)' : C.border}`, borderRadius: '14px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: '14px', fontWeight: '600', color: C.text }}>{idx + 1}. {item.label}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>{item.desc}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    {[
                      { val: 'pass', label: '✅', bg: 'rgba(34,197,94,0.2)', active: 'rgba(34,197,94,0.35)' },
                      { val: 'fail', label: '❌', bg: 'rgba(239,68,68,0.15)', active: 'rgba(239,68,68,0.3)' },
                      { val: 'na',   label: 'N/A', bg: 'rgba(255,255,255,0.06)', active: 'rgba(136,150,168,0.2)' },
                    ].map(btn => (
                      <button key={btn.val} onClick={() => setItemResult(idx, item.result === btn.val ? null : btn.val)}
                        style={{ padding: '5px 9px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: item.result === btn.val ? btn.active : btn.bg, color: C.text, transition: 'all 0.15s' }}>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
                <input value={item.notes || ''} onChange={e => setItemNotes(idx, e.target.value)}
                  placeholder={item.result === 'fail' ? 'Notes (required for fail)' : 'Notes…'}
                  style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${item.result === 'fail' && !item.notes ? 'rgba(239,68,68,0.4)' : C.border}`, borderRadius: '8px', padding: '7px 11px', fontSize: '13px', color: C.text, outline: 'none' }} />
              </div>
            ))}

            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '14px 16px' }}>
              <p style={{ margin: '0 0 6px', fontSize: '12px', color: C.muted, fontWeight: '500' }}>Additional Notes</p>
              <textarea value={inspectionNotes} onChange={e => setInspectionNotes(e.target.value)} rows={3} placeholder="Overall inspection notes…"
                style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: C.text, resize: 'vertical', outline: 'none', lineHeight: 1.5 }} />
            </div>

            <button onClick={saveInspection} disabled={savingInspection}
              style={{ background: savingInspection ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', transition: 'background 0.15s' }}>
              {savingInspection ? 'Saving…' : '✓ Submit Inspection'}
            </button>

            <button onClick={() => window.print()}
              style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, color: C.text, borderRadius: '12px', padding: '11px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
              🖨️ Print / PDF Report
            </button>
          </div>
        )}

        {/* ── PORTAL ─────────────────────────────────────────────────── */}
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
                  {job.portal_sent && (
                    <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.success }}>✓ Portal sent on {job.portal_sent_at ? new Date(job.portal_sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'file'}</p>
                  )}
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

        {/* ── PHOTOS ─────────────────────────────────────────────────── */}
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

        {/* ── MESSAGES ───────────────────────────────────────────────── */}
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
                      background: isContractor ? C.primary : C.surface2,
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

        {/* ── DOCUMENTS ──────────────────────────────────────────────── */}
        {activeTab === 'documents' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {docs.map(d => (
              <div key={d.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: C.text }}>{d.title}</p>
                  <span style={{ fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px', background: d.status === 'signed' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)', color: d.status === 'signed' ? C.success : C.muted }}>
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

        {/* ── NOTES ──────────────────────────────────────────────────── */}
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

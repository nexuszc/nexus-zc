import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'

const SUPA = import.meta.env.VITE_SUPABASE_URL
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

// ─── Design tokens (light theme, mobile-first) ────────────────────────────
const C = {
  bg:      '#ffffff',
  text:    '#0f1923',
  primary: '#4a9eff',
  success: '#22c55e',
  warn:    '#f59e0b',
  error:   '#ef4444',
  border:  '#e5e7eb',
  muted:   '#6b7280',
  subtle:  '#f9fafb',
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const dollars = (cents) => '$' + ((cents || 0) / 100).toLocaleString()
const fmtDate  = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtTime  = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const first    = (name) => name?.split(' ')[0] || name

function callPortalApi(path, opts = {}) {
  return fetch(`${SUPA}/functions/v1/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, ...(opts.headers || {}) },
  })
}

// ─── Skeleton loading screen ──────────────────────────────────────────────
const shimmerStyle = `@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`
if (typeof document !== 'undefined' && !document.getElementById('portal-skel')) {
  const s = document.createElement('style'); s.id = 'portal-skel'; s.textContent = shimmerStyle
  document.head.appendChild(s)
}
function Skel({ w = '100%', h = 16, r = 8, mb = 0 }) {
  return <div style={{ width: w, height: h, borderRadius: r, marginBottom: mb, background: 'linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
}
function LoadingScreen() {
  return (
    <div style={{ background: C.bg, minHeight: '100vh', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ background: C.subtle, padding: '20px', borderBottom: `1px solid ${C.border}` }}>
        <Skel w="140px" h={24} r={6} mb={8} /><Skel w="200px" h={14} r={4} />
      </div>
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Skel h={110} r={16} /><Skel h={64} r={12} /><Skel h={64} r={12} /><Skel h={64} r={12} />
      </div>
    </div>
  )
}

// ─── Full-screen photo lightbox ───────────────────────────────────────────
function Lightbox({ photo, onClose, allowDownload }) {
  const dl = () => { const a = document.createElement('a'); a.href = photo.url; a.download = `photo.jpg`; a.target = '_blank'; a.click() }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 40, height: 40, cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      <img src={photo.url} alt={photo.caption || ''} onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '72vh', objectFit: 'contain', borderRadius: 10 }} />
      {(photo.caption || photo.taken_at) && (
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 14, textAlign: 'center', padding: '0 20px' }}>
          {photo.caption && <p style={{ margin: 0, fontWeight: 600, color: '#fff' }}>{photo.caption}</p>}
          {photo.taken_at && <p style={{ margin: '4px 0 0' }}>{fmtDate(photo.taken_at)} · {fmtTime(photo.taken_at)}</p>}
        </div>
      )}
      {allowDownload && (
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }} onClick={e => e.stopPropagation()}>
          <button onClick={dl} style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>⬇ Download</button>
          {navigator.share && (
            <button onClick={() => navigator.share({ url: photo.url, title: 'Project photo' }).catch(() => {})} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 22px', fontSize: 14, cursor: 'pointer' }}>Share</button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Status configuration ─────────────────────────────────────────────────
function statusFor(s) {
  const map = {
    scheduled:        { emoji: '🔵', label: 'Scheduled',   bg: '#dbeafe', fg: '#1d4ed8', msg: 'Your roof replacement is scheduled.' },
    materials_ordered:{ emoji: '🔵', label: 'Scheduled',   bg: '#dbeafe', fg: '#1d4ed8', msg: 'Materials ordered. Work begins soon.' },
    in_progress:      { emoji: '🟡', label: 'In Progress', bg: '#fef3c7', fg: '#92400e', msg: 'Your roof replacement is underway.' },
    inspection:       { emoji: '🟠', label: 'Inspection',  bg: '#ffedd5', fg: '#9a3412', msg: 'Final inspection is in progress.' },
    complete:         { emoji: '🟢', label: 'Complete',    bg: '#dcfce7', fg: '#14532d', msg: 'Your new roof is complete!' },
    paid:             { emoji: '🟢', label: 'Complete',    bg: '#dcfce7', fg: '#14532d', msg: 'Your new roof is complete!' },
  }
  return map[s] || { emoji: '🟡', label: 'In Progress', bg: '#fef3c7', fg: '#92400e', msg: 'Your project is in progress.' }
}

// ─── Phase label map ──────────────────────────────────────────────────────
const PHASE_LABEL = {
  pre_installation:    'Before',
  damage_documentation:'Before',
  during_tearoff:      'Tear-off',
  during_installation: 'Shingles',
  post_installation:   'After',
}

// ─────────────────────────────────────────────────────────────────────────
// FREE PORTAL
// ─────────────────────────────────────────────────────────────────────────
function FreePortal({ data }) {
  const { job, photos, timeline, documents } = data
  const [lightbox, setLightbox] = useState(null)
  const sd = statusFor(job?.status)
  const recentPhotos = (photos || []).slice(0, 6)

  // Build display timeline — done items + upcoming items
  const doneItems = (timeline || []).filter(t => !t.raw_update || t.raw_update !== 'upcoming')
  const upcomingItems = (timeline || []).filter(t => t.raw_update === 'upcoming')
  const activeIdx = doneItems.length // first upcoming is "active"

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: "-apple-system,'Inter',system-ui,sans-serif", maxWidth: 480, margin: '0 auto' }}>
      {lightbox && <Lightbox photo={lightbox} onClose={() => setLightbox(null)} allowDownload={false} />}

      {/* Header */}
      <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: C.primary }}>ROOFING OS</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.muted, textAlign: 'right', maxWidth: 180, lineHeight: 1.3 }}>{job?.property_address}</span>
      </div>

      {/* Hero status */}
      <div style={{ padding: '28px 20px 24px', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: sd.bg, color: sd.fg, fontWeight: 700, fontSize: 15, padding: '10px 20px', borderRadius: 100, marginBottom: 14 }}>
          {sd.emoji} {sd.label}
        </div>
        <p style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>{sd.msg}</p>
      </div>

      {/* Photo strip */}
      {recentPhotos.length > 0 && (
        <div style={{ padding: '20px 0 0' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 20px', marginBottom: 10 }}>Photos</p>
          <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '0 20px 20px', scrollbarWidth: 'none' }}>
            {recentPhotos.map(p => (
              <div key={p.id} onClick={() => setLightbox(p)} style={{ flexShrink: 0, width: 110, height: 84, borderRadius: 10, overflow: 'hidden', background: C.subtle, cursor: 'pointer' }}>
                <img src={p.url} alt={p.caption || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Basic timeline */}
      {(doneItems.length > 0 || upcomingItems.length > 0) && (
        <div style={{ padding: '0 20px 20px' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Timeline</p>
          {[...doneItems, ...upcomingItems].map((item, i) => {
            const isDone = i < doneItems.length
            const isActive = i === activeIdx && upcomingItems.length > 0
            return (
              <div key={item.id || i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < doneItems.length + upcomingItems.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{isDone ? '✅' : isActive ? '🔄' : '○'}</span>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: isDone || isActive ? C.text : C.muted }}>{item.title}</p>
                  {item.description && isDone && <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>{item.description}</p>}
                  {isDone && item.created_at && <p style={{ margin: '2px 0 0', fontSize: 12, color: C.success }}>✓ {fmtDate(item.created_at)}</p>}
                  {isActive && <p style={{ margin: '2px 0 0', fontSize: 12, color: C.warn, fontWeight: 600 }}>In progress — today</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Documents — view only */}
      {(documents || []).length > 0 && (
        <div style={{ padding: '0 20px 20px' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Documents</p>
          {documents.map((d, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px', background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{d.title}</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>Document available — contact your contractor to request a copy.</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Locked upgrade sections */}
      <div style={{ padding: '0 20px 20px' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>More with Portal Pro</p>
        {[
          { icon: '⬇️', label: 'Download documents', sub: 'Available with Portal Pro — ask your contractor to upgrade.' },
          { icon: '💬', label: 'Message your contractor', sub: 'Available with Portal Pro.' },
          { icon: '⭐', label: 'Leave a review', sub: 'Available with Portal Pro.' },
        ].map(({ icon, label, sub }) => (
          <div key={label} style={{ background: C.subtle, border: `2px dashed ${C.border}`, borderRadius: 14, padding: '16px', textAlign: 'center', marginBottom: 10 }}>
            <p style={{ fontSize: 22, margin: '0 0 6px' }}>{icon}</p>
            <p style={{ fontWeight: 700, fontSize: 15, color: C.text, margin: '0 0 4px' }}>{label}</p>
            <p style={{ fontSize: 13, color: C.muted, margin: '0 0 10px' }}>{sub}</p>
            <a href="https://roofingos.dev/upgrade" target="_blank" rel="noreferrer" style={{ color: C.primary, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Learn more →</a>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: '20px', textAlign: 'center', borderTop: `1px solid ${C.border}` }}>
        <p style={{ fontSize: 12, color: C.muted, margin: '0 0 2px' }}>Powered by <strong>Roofing OS</strong></p>
        <a href="https://roofingos.dev" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.primary, textDecoration: 'none' }}>roofingos.dev — free for contractors</a>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PRO: NOTIFICATION PROMPT
// ─────────────────────────────────────────────────────────────────────────
function NotifPrompt({ onDismiss }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 480, margin: '0 auto', background: C.bg, borderTop: `1px solid ${C.border}`, borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', boxShadow: '0 -4px 28px rgba(0,0,0,0.1)', zIndex: 300 }}>
      <p style={{ fontWeight: 700, fontSize: 18, margin: '0 0 8px', textAlign: 'center' }}>🔔 Stay in the loop</p>
      <p style={{ fontSize: 14, color: C.muted, margin: '0 0 20px', textAlign: 'center' }}>Get updates when photos are added and your roof progresses.</p>
      <button onClick={() => { Notification.requestPermission?.(); onDismiss() }} style={{ width: '100%', background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '15px', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginBottom: 10, minHeight: 52 }}>
        Enable notifications
      </button>
      <button onClick={onDismiss} style={{ width: '100%', background: 'transparent', color: C.muted, border: 'none', fontSize: 15, cursor: 'pointer', padding: '10px', minHeight: 48 }}>
        No thanks
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PRO: COMPLETION FLOW (slides when job = complete)
// ─────────────────────────────────────────────────────────────────────────
function CompletionFlow({ data }) {
  const [step, setStep] = useState(0)
  const [copied, setCopied] = useState(false)
  const { contractor } = data
  const name = first(data.session?.homeowner_name)
  const coName = contractor?.company_name || 'your contractor'

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const slides = [
    <div key="celebrate" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 80, marginBottom: 16, lineHeight: 1 }}>🎉</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 12px', lineHeight: 1.2 }}>Your new roof is complete!</h1>
      <p style={{ fontSize: 16, color: C.muted, margin: '0 0 32px' }}>Thank you for trusting {coName} with your home, {name}.</p>
      <button onClick={() => setStep(1)} style={{ width: '100%', background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '16px', fontWeight: 700, fontSize: 17, cursor: 'pointer', minHeight: 54 }}>Continue</button>
    </div>,

    <div key="review" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 60, marginBottom: 14 }}>⭐</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 10px' }}>How did {coName} do?</h2>
      <p style={{ fontSize: 15, color: C.muted, margin: '0 0 24px' }}>Your review helps them grow and helps other homeowners choose the right contractor.</p>
      <a href="https://search.google.com/local/writereview" target="_blank" rel="noreferrer"
        style={{ display: 'block', background: '#4285f4', color: '#fff', borderRadius: 14, padding: '16px', fontWeight: 700, fontSize: 17, textDecoration: 'none', marginBottom: 12, minHeight: 54, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Leave a Google Review →
      </a>
      <button onClick={() => setStep(2)} style={{ width: '100%', background: 'transparent', color: C.muted, border: 'none', fontSize: 15, cursor: 'pointer', padding: '10px', minHeight: 48 }}>Skip</button>
    </div>,

    <div key="referral" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 60, marginBottom: 14 }}>🏠</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 10px' }}>Know someone who needs a roof?</h2>
      <p style={{ fontSize: 15, color: C.muted, margin: '0 0 24px' }}>Share {coName}'s portal and they'll get the same real-time updates you did.</p>
      <button onClick={copyLink} style={{ width: '100%', background: C.success, color: '#fff', border: 'none', borderRadius: 14, padding: '16px', fontWeight: 700, fontSize: 17, cursor: 'pointer', marginBottom: 10, minHeight: 54 }}>
        {copied ? '✓ Copied!' : 'Copy referral link'}
      </button>
      {navigator.share && (
        <button onClick={() => navigator.share({ text: `Check out ${coName}`, url: window.location.href }).catch(() => {})}
          style={{ width: '100%', background: C.subtle, color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px', fontWeight: 600, fontSize: 16, cursor: 'pointer', marginBottom: 10, minHeight: 52 }}>
          Share via text
        </button>
      )}
      <button onClick={() => setStep(3)} style={{ width: '100%', background: 'transparent', color: C.muted, border: 'none', fontSize: 15, cursor: 'pointer', padding: '10px', minHeight: 48 }}>Skip</button>
    </div>,

    <div key="monitoring" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 60, marginBottom: 14 }}>🌩️</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 10px' }}>1-Year Roof Monitoring — Activated</h2>
      <p style={{ fontSize: 15, color: C.muted, margin: '0 0 24px' }}>We'll alert you if a storm damages your new roof. Keep your investment protected.</p>
      <button onClick={() => Notification.requestPermission?.()}
        style={{ width: '100%', background: C.warn, color: '#fff', border: 'none', borderRadius: 14, padding: '16px', fontWeight: 700, fontSize: 17, cursor: 'pointer', marginBottom: 12, minHeight: 54 }}>
        Allow notifications
      </button>
      <button onClick={() => setStep(4)} style={{ width: '100%', background: 'transparent', color: C.muted, border: 'none', fontSize: 15, cursor: 'pointer', padding: '10px', minHeight: 48 }}>No thanks</button>
    </div>,
  ]

  if (step >= slides.length) return null

  return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '32px 24px', maxWidth: 480, margin: '0 auto', fontFamily: "-apple-system,'Inter',system-ui,sans-serif" }}>
      {slides[step]}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 32 }}>
        {slides.map((_, i) => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === step ? C.primary : C.border }} />)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PRO: STATUS TAB (home)
// ─────────────────────────────────────────────────────────────────────────
function ProStatusTab({ data, onViewPhotos, onViewTimeline }) {
  const { job, photos, timeline, payments, claim, contractor, session } = data
  const [insOpen, setInsOpen] = useState(false)
  const sd = statusFor(job?.status)

  // Day X of Y
  let dayLabel = ''
  if (job?.actual_start_date && job?.scheduled_end) {
    const start = new Date(job.actual_start_date)
    const end   = new Date(job.scheduled_end)
    const today = new Date()
    const dayNum   = Math.max(1, Math.round((today - start) / 86400000) + 1)
    const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1)
    dayLabel = `Day ${dayNum} of ${totalDays}`
  }

  // Current active stage label
  const activeItem = (timeline || []).find(t => t.raw_update !== 'upcoming' && !t.completed_override)
  const lastDoneItem = [...(timeline || [])].filter(t => t.raw_update !== 'upcoming').pop()
  const stageLabel = lastDoneItem?.title || job?.status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'In Progress'

  // Progress dots (done items)
  const doneItems     = (timeline || []).filter(t => t.raw_update !== 'upcoming')
  const upcomingItems = (timeline || []).filter(t => t.raw_update === 'upcoming')
  const allItems      = [...doneItems, ...upcomingItems]

  // Photo strip (last 5, newest first)
  const recentPhotos = (photos || []).slice(0, 5)
  const todayCount   = (photos || []).filter(p => p.taken_at && new Date(p.taken_at).toDateString() === new Date().toDateString()).length

  // Payment summary
  const totalPaid = (payments || []).filter(p => p.paid_at || p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0)
  const totalDue  = (payments || []).reduce((s, p) => s + (p.amount || 0), 0)
  const pctPaid   = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0

  const estCompletion = job?.scheduled_end
    ? new Date(job.scheduled_end).toDateString() === new Date().toDateString()
      ? 'Today'
      : fmtDate(job.scheduled_end)
    : null

  return (
    <div style={{ paddingBottom: 90 }}>
      {/* Greeting */}
      <div style={{ padding: '22px 20px 0' }}>
        <p style={{ fontSize: 26, fontWeight: 700, margin: '0 0 2px' }}>Hi {first(session?.homeowner_name)} 👋</p>
      </div>

      {/* Status card */}
      <div style={{ margin: '16px 20px', background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 20, padding: '20px' }}>
        {contractor?.logo_url && <img src={contractor.logo_url} alt="logo" style={{ height: 32, objectFit: 'contain', marginBottom: 10 }} />}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: sd.bg, color: sd.fg, fontWeight: 700, fontSize: 13, padding: '5px 12px', borderRadius: 100, marginBottom: 10 }}>
          {sd.emoji} {sd.label}
        </div>
        <p style={{ fontSize: 19, fontWeight: 700, margin: '0 0 14px', lineHeight: 1.3 }}>
          {dayLabel && <span style={{ color: C.muted, fontWeight: 500, fontSize: 14 }}>{dayLabel} — </span>}{stageLabel}
        </p>
        {/* Progress bar segments */}
        {allItems.length > 0 && (
          <div style={{ display: 'flex', gap: 3, marginBottom: 12 }}>
            {allItems.map((t, i) => (
              <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i < doneItems.length ? C.primary : C.border }} />
            ))}
          </div>
        )}
        {estCompletion && (
          <p style={{ fontSize: 13, color: C.muted, margin: '0 0 12px' }}>Est. completion: {estCompletion}</p>
        )}
        <button onClick={onViewTimeline} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: 0, minHeight: 44 }}>
          View full timeline →
        </button>
      </div>

      {/* Photo strip */}
      {recentPhotos.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 10px' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>
              📸 {todayCount > 0 ? `${todayCount} photos today` : `${(photos || []).length} photos`}
            </p>
            <button onClick={onViewPhotos} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: '4px 0', minHeight: 44 }}>
              See all {(photos || []).length} →
            </button>
          </div>
          <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '0 20px 18px', scrollbarWidth: 'none' }}>
            {recentPhotos.map(p => (
              <div key={p.id} onClick={onViewPhotos} style={{ flexShrink: 0, width: 96, height: 76, borderRadius: 10, overflow: 'hidden', background: C.subtle, cursor: 'pointer' }}>
                <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment tracker */}
      {(payments || []).length > 0 && (
        <div style={{ margin: '0 20px 16px', background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px' }}>
          <p style={{ fontWeight: 700, fontSize: 15, margin: '0 0 12px' }}>💳 Payment</p>
          <div style={{ height: 8, background: C.border, borderRadius: 4, marginBottom: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pctPaid}%`, background: C.primary, borderRadius: 4, transition: 'width 0.8s' }} />
          </div>
          <p style={{ fontSize: 12, color: C.muted, margin: '0 0 12px' }}>{pctPaid}% paid</p>
          {payments.map((p, i) => {
            const paid    = p.paid_at || p.status === 'paid'
            const dueSoon = !paid && p.due_date && new Date(p.due_date) <= new Date(Date.now() + 86400000 * 2)
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: i > 0 ? `1px solid ${C.border}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{paid ? '✅' : dueSoon ? '🔄' : '○'}</span>
                  <span style={{ fontSize: 14 }}>{p.description || (p.payment_type || '').replace(/_/g, ' ')}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{dollars(p.amount)}</p>
                  {paid && <p style={{ margin: 0, fontSize: 11, color: C.success }}>paid {fmtDate(p.paid_at)}</p>}
                  {!paid && p.due_date && <p style={{ margin: 0, fontSize: 11, color: dueSoon ? C.warn : C.muted }}>due {fmtDate(p.due_date)}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Insurance */}
      {claim && (
        <div style={{ margin: '0 20px 16px', background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px' }}>
          <button onClick={() => setInsOpen(v => !v)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0, minHeight: 40 }}>
            <p style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>🛡️ Insurance Claim</p>
            <span style={{ color: C.muted, fontSize: 20, lineHeight: 1 }}>{insOpen ? '▲' : '▼'}</span>
          </button>
          {insOpen && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['Claim #', claim.claim_number],
                ['Adjuster', claim.adjuster_name],
                ['Phone', claim.adjuster_phone],
                ['Carrier', claim.carrier_name],
                ['RCV', dollars(claim.original_estimate)],
                ['ACV paid', dollars(claim.net_payment)],
                ['Depreciation held', dollars(claim.depreciation_held)],
                ['Supplement', claim.supplement_requested > 0 ? `${dollars(claim.supplement_requested)} — Submitted, pending` : null],
              ].filter(([, v]) => v && v !== '$0').map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderBottom: `1px solid ${C.border}`, paddingBottom: 7 }}>
                  <span style={{ color: C.muted }}>{label}</span>
                  <span style={{ fontWeight: 600, maxWidth: '60%', textAlign: 'right' }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PRO: PHOTOS TAB
// ─────────────────────────────────────────────────────────────────────────
function ProPhotosTab({ data }) {
  const { photos } = data
  const [filter, setFilter] = useState('all')
  const [lightbox, setLightbox] = useState(null)

  const available = ['all', ...new Set((photos || []).map(p => PHASE_LABEL[p.phase] || p.phase).filter(Boolean))]
  const visible = filter === 'all' ? (photos || []) : (photos || []).filter(p => (PHASE_LABEL[p.phase] || p.phase) === filter)

  return (
    <div style={{ paddingBottom: 90 }}>
      {lightbox && <Lightbox photo={lightbox} onClose={() => setLightbox(null)} allowDownload={true} />}

      {/* Stage filter chips */}
      <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '14px 20px', scrollbarWidth: 'none' }}>
        {available.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ flexShrink: 0, padding: '7px 16px', borderRadius: 100, border: `1px solid ${filter === f ? C.primary : C.border}`, background: filter === f ? C.primary : C.bg, color: filter === f ? '#fff' : C.muted, fontSize: 13, fontWeight: 500, cursor: 'pointer', minHeight: 36 }}>
            {f === 'all' ? `All (${(photos || []).length})` : `${f} (${(photos || []).filter(p => (PHASE_LABEL[p.phase] || p.phase) === f).length})`}
          </button>
        ))}
      </div>

      {/* 2-col grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '0 20px' }}>
        {visible.map(p => (
          <div key={p.id} onClick={() => setLightbox(p)}
            style={{ borderRadius: 12, overflow: 'hidden', background: C.subtle, aspectRatio: '4/3', cursor: 'pointer', position: 'relative' }}>
            <img src={p.url} alt={p.caption || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)', padding: '20px 8px 7px' }}>
              <p style={{ margin: 0, fontSize: 11, color: '#fff', fontWeight: 600 }}>{PHASE_LABEL[p.phase] || p.phase}</p>
              {p.taken_at && <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{fmtTime(p.taken_at)}</p>}
            </div>
          </div>
        ))}
      </div>

      {visible.length === 0 && (
        <div style={{ textAlign: 'center', padding: '56px 20px' }}>
          <p style={{ color: C.muted, fontSize: 16 }}>No photos in this category yet.</p>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Pull down to refresh.</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PRO: TIMELINE TAB
// ─────────────────────────────────────────────────────────────────────────
function ProTimelineTab({ data }) {
  const { timeline, photos, job } = data
  const startDate = job?.actual_start_date ? new Date(job.actual_start_date) : null

  // Group by date string
  const groups = {}
  ;(timeline || []).forEach(item => {
    const d = item.created_at ? new Date(item.created_at).toDateString() : 'Upcoming'
    if (!groups[d]) groups[d] = []
    groups[d].push(item)
  })

  const getDayNum = ds => {
    if (!startDate || ds === 'Upcoming') return null
    return Math.max(1, Math.round((new Date(ds) - startDate) / 86400000) + 1)
  }

  const photosOnDate = ds =>
    (photos || []).filter(p => p.taken_at && new Date(p.taken_at).toDateString() === ds).slice(0, 3)

  return (
    <div style={{ padding: '16px 20px 90px' }}>
      {Object.entries(groups).map(([ds, items]) => {
        const dayNum = getDayNum(ds)
        const dateLabel = ds === 'Upcoming'
          ? 'Upcoming'
          : new Date(ds).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        return (
          <div key={ds} style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>
              {dayNum ? `Day ${dayNum} — ` : ''}{dateLabel}
            </p>
            <div style={{ borderLeft: `2px solid ${C.border}`, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((item, i) => {
                const isUpcoming = item.raw_update === 'upcoming'
                const pDay = isUpcoming ? [] : photosOnDate(ds)
                return (
                  <div key={item.id || i} style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: -22, top: 4, width: 10, height: 10, borderRadius: '50%', background: isUpcoming ? C.border : C.success, border: '2px solid #fff' }} />
                    <div style={{ background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 18 }}>{item.icon || (isUpcoming ? '○' : '✅')}</span>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: isUpcoming ? C.muted : C.text }}>{item.title}</p>
                        {pDay.length > 0 && <span style={{ fontSize: 12, color: C.muted, marginLeft: 'auto' }}>{pDay.length} photos</span>}
                      </div>
                      {item.description && <p style={{ margin: '0 0 8px', fontSize: 13, color: C.muted }}>{item.description}</p>}
                      {pDay.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          {pDay.map(p => (
                            <div key={p.id} style={{ width: 64, height: 48, borderRadius: 8, overflow: 'hidden' }}>
                              <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {(!timeline || timeline.length === 0) && (
        <div style={{ textAlign: 'center', padding: '56px 0' }}>
          <p style={{ color: C.muted }}>Timeline will appear as work progresses.</p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PRO: MESSAGES TAB
// ─────────────────────────────────────────────────────────────────────────
function ProMessagesTab({ data, token }) {
  const { contractor, session } = data
  const [messages, setMessages] = useState(data.messages || [])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const coName = contractor?.company_name || 'Your contractor'

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async () => {
    const msg = text.trim()
    if (!msg || sending) return
    setSending(true); setText('')
    setMessages(prev => [...prev, { id: Date.now(), sender_type: 'homeowner', message: msg, created_at: new Date().toISOString() }])
    try {
      const res = await callPortalApi('portal-api', { method: 'POST', body: JSON.stringify({ token, action: 'send_message', message: msg }) })
      const d = await res.json()
      if (d.aria_response) {
        setMessages(prev => [...prev, { id: Date.now() + 1, sender_type: 'aria', sender_name: 'Aria', message: d.aria_response, created_at: new Date().toISOString() }])
      }
    } catch {}
    setSending(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 116px)' }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>💬 {coName}</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>Messages go directly to your contractor</p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p style={{ color: C.muted, fontSize: 15 }}>No messages yet.</p>
            <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Start a conversation with {coName}.</p>
          </div>
        )}
        {messages.map(m => {
          const isMe   = m.sender_type === 'homeowner'
          const isAria = m.sender_type === 'aria'
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              {!isMe && <p style={{ fontSize: 11, color: C.muted, margin: '0 0 3px 4px' }}>{m.sender_name || coName}</p>}
              <div style={{
                maxWidth: '78%', padding: '11px 15px',
                borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: isMe ? C.primary : isAria ? '#eff6ff' : C.subtle,
                border: isAria ? `1px solid #bfdbfe` : 'none',
                color: isMe ? '#fff' : C.text,
                fontSize: 15, lineHeight: 1.4,
              }}>{m.message}</div>
              {m.created_at && <p style={{ fontSize: 11, color: C.muted, margin: '3px 0 0', padding: isMe ? '0 4px 0 0' : '0 0 0 4px' }}>{fmtTime(m.created_at)}</p>}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: '10px 16px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, flexShrink: 0 }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={`Message ${coName}…`}
          style={{ flex: 1, padding: '13px 16px', borderRadius: 28, border: `1px solid ${C.border}`, fontSize: 15, outline: 'none', background: C.subtle, color: C.text, minHeight: 48 }} />
        <button onClick={send} disabled={sending || !text.trim()}
          style={{ background: text.trim() ? C.primary : C.border, color: '#fff', border: 'none', borderRadius: '50%', width: 48, height: 48, cursor: text.trim() ? 'pointer' : 'default', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {sending ? '…' : '↑'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PRO: DOCUMENTS TAB
// ─────────────────────────────────────────────────────────────────────────
function ProDocsTab({ data, token }) {
  const { documents } = data
  const [signing, setSigning] = useState(null)
  const [sigText, setSigText] = useState('')
  const [localSigned, setLocalSigned] = useState({})

  const submitSig = async () => {
    if (!sigText.trim() || !signing) return
    try {
      await callPortalApi('portal-api', { method: 'POST', body: JSON.stringify({ token, action: 'sign_document', document_id: signing.id, document_title: signing.title, signature_data: sigText }) })
      setLocalSigned(prev => ({ ...prev, [signing.id]: true }))
      setSigning(null); setSigText('')
    } catch {}
  }

  const getStatus = d => {
    if (localSigned[d.id] || d.status === 'signed') return 'signed'
    if (d.status === 'pending' && d.requires_homeowner_action) return 'action'
    if (!d.url) return 'pending'
    return 'ready'
  }

  const badge = s => ({
    signed:  { label: 'Signed',           bg: '#dcfce7', color: '#14532d' },
    action:  { label: 'Signature needed', bg: '#fef9c3', color: '#713f12' },
    pending: { label: 'Pending',          bg: '#f3f4f6', color: C.muted   },
    ready:   { label: 'Ready',            bg: '#e0f2fe', color: '#075985' },
  }[s] || { label: s, bg: C.subtle, color: C.muted })

  return (
    <div style={{ padding: '16px 20px 90px' }}>
      {signing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: C.bg, borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', width: '100%', maxWidth: 480, margin: '0 auto', boxSizing: 'border-box' }}>
            <p style={{ fontWeight: 700, fontSize: 18, margin: '0 0 16px' }}>Sign: {signing.title}</p>
            <input value={sigText} onChange={e => setSigText(e.target.value)} placeholder="Type your full name to sign..."
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: `1px solid ${C.border}`, fontSize: 16, fontFamily: 'cursive', boxSizing: 'border-box', outline: 'none', minHeight: 52 }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => setSigning(null)} style={{ flex: 1, padding: '14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.bg, cursor: 'pointer', fontSize: 15, minHeight: 52 }}>Cancel</button>
              <button onClick={submitSig} style={{ flex: 2, padding: '14px', borderRadius: 12, border: 'none', background: C.primary, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15, minHeight: 52 }}>Sign document</button>
            </div>
          </div>
        </div>
      )}

      {(documents || []).length === 0 && (
        <div style={{ textAlign: 'center', padding: '56px 0' }}>
          <p style={{ color: C.muted, fontSize: 16 }}>No documents yet.</p>
          <p style={{ color: C.muted, fontSize: 13 }}>Documents will appear here once your contractor uploads them.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(documents || []).map((d, i) => {
          const s  = getStatus(d)
          const b  = badge(s)
          return (
            <div key={i} style={{ background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1 }}>
                  <span style={{ fontSize: 24 }}>📄</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{d.title}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>{(d.document_type || '').replace(/_/g, ' ')}</p>
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, background: b.bg, color: b.color, padding: '4px 10px', borderRadius: 100, flexShrink: 0 }}>{b.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {d.url && (
                  <>
                    <a href={d.url} target="_blank" rel="noreferrer"
                      style={{ flex: 1, padding: '11px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, fontWeight: 600, textDecoration: 'none', textAlign: 'center', display: 'block', minHeight: 44 }}>
                      View
                    </a>
                    <a href={d.url} download target="_blank" rel="noreferrer"
                      style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: C.primary, color: '#fff', fontSize: 14, fontWeight: 600, textDecoration: 'none', textAlign: 'center', display: 'block', minHeight: 44 }}>
                      Download
                    </a>
                  </>
                )}
                {s === 'action' && (
                  <button onClick={() => setSigning(d)} style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: C.warn, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', minHeight: 44 }}>
                    Sign now
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PRO PORTAL (full mobile app experience)
// ─────────────────────────────────────────────────────────────────────────
function ProPortal({ data, token }) {
  const [tab, setTab] = useState('status')
  const [showNotif, setShowNotif] = useState(() => !sessionStorage.getItem('roos_notif'))
  const { job, contractor } = data

  const isComplete = job?.status === 'complete' || job?.status === 'paid'
  const [showCompletion] = useState(() => isComplete && !sessionStorage.getItem('roos_completion'))

  const dismissNotif = () => { sessionStorage.setItem('roos_notif', '1'); setShowNotif(false) }

  const progressMap = { lead:5, assessment_scheduled:10, assessed:20, estimate_sent:30, contracted:40, insurance_submitted:50, materials_ordered:60, scheduled:70, in_progress:80, inspection:90, complete:100, paid:100 }
  const progress = progressMap[job?.status] || 0

  const TABS = [
    { id: 'status',   icon: '🏠', label: 'Status'   },
    { id: 'photos',   icon: '📸', label: 'Photos'   },
    { id: 'messages', icon: '💬', label: 'Messages' },
    { id: 'docs',     icon: '📄', label: 'Docs'     },
  ]

  if (showCompletion) return <CompletionFlow data={data} />

  return (
    <div style={{ background: C.bg, minHeight: '100dvh', color: C.text, fontFamily: "-apple-system,'Inter',system-ui,sans-serif", maxWidth: 480, margin: '0 auto', position: 'relative' }}>
      {/* Top progress bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, background: C.border, zIndex: 100, maxWidth: 480, margin: '0 auto' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: C.primary, transition: 'width 1.2s' }} />
      </div>

      {/* Header */}
      <div style={{ padding: '16px 20px 14px', paddingTop: 19, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        {contractor?.logo_url
          ? <img src={contractor.logo_url} alt="logo" style={{ height: 30, objectFit: 'contain' }} />
          : <span style={{ fontWeight: 800, fontSize: 15, color: C.primary }}>{contractor?.company_name || 'Your Portal'}</span>
        }
        {contractor?.logo_url && contractor?.company_name && (
          <span style={{ fontWeight: 700, fontSize: 15 }}>{contractor.company_name}</span>
        )}
        <span style={{ flex: 1 }} />
        {contractor?.owner_phone && (
          <a href={`tel:${contractor.owner_phone}`}
            style={{ color: C.primary, fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, minHeight: 44 }}>
            📞 {contractor.owner_phone.replace(/^\+1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}
          </a>
        )}
      </div>

      {/* Page content */}
      <div style={{ overflowY: 'auto' }}>
        {tab === 'status'   && <ProStatusTab   data={data} onViewPhotos={() => setTab('photos')} onViewTimeline={() => setTab('timeline')} />}
        {tab === 'photos'   && <ProPhotosTab   data={data} />}
        {tab === 'messages' && <ProMessagesTab data={data} token={token} />}
        {tab === 'docs'     && <ProDocsTab     data={data} token={token} />}
        {tab === 'timeline' && <ProTimelineTab data={data} />}
      </div>

      {/* Bottom nav */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 480, margin: '0 auto', background: C.bg, borderTop: `1px solid ${C.border}`, display: 'flex', paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', padding: '10px 0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minHeight: 58 }}>
            <span style={{ fontSize: 22 }}>{t.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: tab === t.id ? C.primary : C.muted }}>{t.label}</span>
            {tab === t.id && <span style={{ position: 'absolute', bottom: 0, width: 20, height: 2, background: C.primary, borderRadius: 1 }} />}
          </button>
        ))}
      </div>

      {/* Notification prompt */}
      {showNotif && <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={dismissNotif}><NotifPrompt onDismiss={dismissNotif} /></div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────
export default function RoofingPortal() {
  const { token } = useParams()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    if (!token) { setError('No portal link provided.'); setLoading(false); return }
    load()
  }, [token])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await callPortalApi(`portal-api?token=${encodeURIComponent(token)}&action=overview`)
      const d = await res.json()
      if (!d.ok || d.error) { setError(d.error || 'Invalid portal link. Please contact your contractor.'); setLoading(false); return }

      // Normalize photos: sort newest first
      const photos = [...(d.photos || [])].sort((a, b) => new Date(b.taken_at || b.created_at) - new Date(a.taken_at || a.created_at))

      // Normalize messages: oldest first
      const messages = [...(d.messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

      // Normalize documents
      const documents = (d.documents || []).map(doc => ({ ...doc, doc_type: doc.document_type || doc.doc_type }))

      setData({ ...d, photos, messages, documents })

      callPortalApi('roofing-notify', { method: 'POST', body: JSON.stringify({ event: 'portal_viewed', job_id: d.job?.id }) }).catch(() => {})
    } catch (e) {
      console.error(e)
      setError("We couldn't load your portal. Pull down to refresh.")
    }
    setLoading(false)
  }

  if (loading) return <LoadingScreen />

  if (error) return (
    <div style={{ background: C.bg, minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "-apple-system,'Inter',system-ui,sans-serif", maxWidth: 480, margin: '0 auto' }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>😕</div>
      <p style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: '0 0 8px', textAlign: 'center' }}>{error}</p>
      <p style={{ fontSize: 14, color: C.muted, margin: '0 0 28px', textAlign: 'center' }}>If this keeps happening, contact your contractor directly.</p>
      <button onClick={load} style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '14px 28px', fontWeight: 700, fontSize: 16, cursor: 'pointer', minHeight: 52 }}>Try again</button>
    </div>
  )

  return data.plan === 'free'
    ? <FreePortal data={data} />
    : <ProPortal data={data} token={token} />
}

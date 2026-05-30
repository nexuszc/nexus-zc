import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'

const SUPA = import.meta.env.VITE_SUPABASE_URL
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

// ─── Dark design tokens ───────────────────────────────────────────────────
const C = {
  bg:          '#0a0f1a',
  surface:     '#111827',
  surface2:    '#1f2937',
  border:      'rgba(255,255,255,0.08)',
  primary:     '#3b82f6',
  primaryGlow: 'rgba(59,130,246,0.3)',
  text:        '#f9fafb',
  muted:       '#9ca3af',
  success:     '#10b981',
  warning:     '#f59e0b',
  error:       '#ef4444',
}

// ─── CSS injection ────────────────────────────────────────────────────────
const PORTAL_CSS = `
  @keyframes portalShimmer {
    0%   { background-position: -200% center }
    100% { background-position:  200% center }
  }
  @keyframes portalPulse {
    0%, 100% { opacity: 1; transform: scale(1)   }
    50%      { opacity: .5; transform: scale(1.5) }
  }
  @keyframes portalFadeUp {
    from { opacity: 0; transform: translateY(20px) }
    to   { opacity: 1; transform: translateY(0)    }
  }
  @keyframes livePulseRing {
    0%   { transform: scale(1);   opacity: .5 }
    100% { transform: scale(2.5); opacity: 0  }
  }
  .p-fade { animation: portalFadeUp .4s ease-out both }
  .p-fade-1 { animation: portalFadeUp .4s .1s ease-out both }
  .p-fade-2 { animation: portalFadeUp .4s .2s ease-out both }
  .p-fade-3 { animation: portalFadeUp .4s .3s ease-out both }
  * { -webkit-tap-highlight-color: transparent; box-sizing: border-box }
`
if (typeof document !== 'undefined' && !document.getElementById('portal-v2-css')) {
  const s = document.createElement('style')
  s.id = 'portal-v2-css'; s.textContent = PORTAL_CSS
  document.head.appendChild(s)
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const dollars  = (c) => '$' + ((c || 0) / 100).toLocaleString()
const fmtDate  = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtTime  = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const firstName = (n) => n?.split(' ')[0] || n

function timeAgo(ds) {
  const m = Math.floor((Date.now() - new Date(ds)) / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function callPortalApi(path, opts = {}) {
  return fetch(`${SUPA}/functions/v1/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, ...(opts.headers || {}) },
  })
}

// ─── Static maps ──────────────────────────────────────────────────────────
const STAGE_ORDER = ['scheduled', 'materials_ordered', 'in_progress', 'inspection', 'complete']
const STAGE_LABELS = {
  scheduled:         'Scheduled',
  materials_ordered: 'Materials Ordered',
  in_progress:       'Installation In Progress',
  inspection:        'Final Inspection',
  complete:          'Complete',
  completed:         'Complete',
  paid:              'Complete',
}

const PHASE_LABEL = {
  pre_installation:     'Before',
  damage_documentation: 'Before',
  during_tearoff:       'Tear-off',
  during_installation:  'Shingles',
  post_installation:    'After',
}

const EDUCATION = {
  scheduled:         { icon: '📅', title: 'Your job is scheduled',            body: 'Your contractor has everything booked and materials are being ordered. You\'ll receive updates as the job progresses.',                                                                                                                      time: null },
  materials_ordered: { icon: '🚚', title: 'Materials on their way',           body: 'Your roofing materials have been ordered and will be delivered soon. Installation begins shortly after delivery.',                                                                                                                             time: '1-2 days' },
  tear_off:          { icon: '🔨', title: 'Removing the old roof',            body: 'Your crew is removing the old roofing material right now. They\'re exposing the decking underneath to check for any damage before installation begins.',                                                                                       time: '2-4 hours' },
  underlayment:      { icon: '🛡️', title: 'Installing the waterproof barrier', body: 'A waterproof barrier called underlayment is being installed. This protects your home even if a shingle gets damaged or blown off.',                                                                                                           time: '1-2 hours' },
  shingles:          { icon: '🏠', title: 'Your new shingles are going on',   body: 'Your new shingles are being installed now. Your crew installs them from the bottom up to ensure proper overlap and water drainage.',                                                                                                            time: '4-8 hours' },
  in_progress:       { icon: '🏗️', title: 'Installation in progress',         body: 'Your roof replacement is actively underway. Your crew is working systematically to ensure every component is installed correctly.',                                                                                                             time: '4-8 hours' },
  cleanup:           { icon: '✨', title: 'Final cleanup underway',            body: 'The roofing work is complete. Your crew is doing a thorough cleanup — collecting all old materials, running a magnet for nails, and doing a final inspection.',                                                                                 time: '1-2 hours' },
  inspection:        { icon: '🔍', title: 'Final inspection',                 body: 'Your crew is doing a final walkthrough to ensure everything meets quality standards. This is the last step before your new roof is complete.',                                                                                                   time: '30-60 min' },
  complete:          { icon: '🎉', title: 'Your new roof is complete!',        body: null, time: null },
  completed:         { icon: '🎉', title: 'Your new roof is complete!',        body: null, time: null },
  paid:              { icon: '🎉', title: 'Your new roof is complete!',        body: null, time: null },
}

// ─── Dark skeleton ────────────────────────────────────────────────────────
function DarkSkel({ w = '100%', h = 16, r = 8, mb = 0 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r, marginBottom: mb,
      background: 'linear-gradient(90deg,#1f2937 25%,#374151 50%,#1f2937 75%)',
      backgroundSize: '200% 100%', animation: 'portalShimmer 1.5s infinite',
    }} />
  )
}

function DarkLoadingScreen() {
  return (
    <div style={{ background: C.bg, minHeight: '100vh', maxWidth: 480, margin: '0 auto', fontFamily: "-apple-system,'Inter',system-ui,sans-serif" }}>
      <div style={{ padding: '20px', borderBottom: `1px solid ${C.border}` }}>
        <DarkSkel w="140px" h={28} r={8} mb={8} /><DarkSkel w="200px" h={14} r={4} />
      </div>
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <DarkSkel h={160} r={20} /><DarkSkel h={260} r={0} /><DarkSkel h={80} r={16} /><DarkSkel h={80} r={16} />
      </div>
    </div>
  )
}

// ─── Lightbox (swipe-enabled) ─────────────────────────────────────────────
function Lightbox({ photos, startIndex = 0, onClose }) {
  const [idx, setIdx]    = useState(startIndex)
  const touchX           = useRef(null)
  const photo            = photos[idx] || photos[0]
  const prev             = () => setIdx(i => Math.max(0, i - 1))
  const next             = () => setIdx(i => Math.min(photos.length - 1, i + 1))

  useEffect(() => {
    const h = (e) => { if (e.key === 'ArrowLeft') prev(); if (e.key === 'ArrowRight') next(); if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  if (!photo) return null
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      onTouchStart={e => { touchX.current = e.touches[0].clientX }}
      onTouchEnd={e => { const d = e.changedTouches[0].clientX - touchX.current; if (d > 50) prev(); else if (d < -50) next(); touchX.current = null }}
    >
      <button onClick={onClose} style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 44, height: 44, cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      {idx > 0 && <button onClick={prev} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 44, height: 44, cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>}
      {idx < photos.length - 1 && <button onClick={next} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 44, height: 44, cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>}
      <img src={photo.url} alt={photo.caption || ''} onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '70vh', objectFit: 'contain', borderRadius: 12 }} />
      <div style={{ marginTop: 16, textAlign: 'center', padding: '0 24px' }}>
        {photo.caption && <p style={{ margin: 0, fontWeight: 600, color: '#fff', fontSize: 14 }}>{photo.caption}</p>}
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
          {PHASE_LABEL[photo.phase] || photo.phase}{photo.taken_at ? ` · ${fmtDate(photo.taken_at)} at ${fmtTime(photo.taken_at)}` : ''}
        </p>
      </div>
      {photos.length > 1 && (
        <div style={{ display: 'flex', gap: 5, marginTop: 14, justifyContent: 'center' }}>
          {photos.map((_, i) => <div key={i} onClick={() => setIdx(i)} style={{ width: 6, height: 6, borderRadius: '50%', background: i === idx ? '#fff' : 'rgba(255,255,255,0.3)', cursor: 'pointer' }} />)}
        </div>
      )}
    </div>
  )
}

// ─── SVG tab icons ────────────────────────────────────────────────────────
const HomeIcon    = ({ c }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
const CameraIcon  = ({ c }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
const ChatIcon    = ({ c }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
const DocIcon     = ({ c }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
const PaletteIcon = ({ c }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="1.5" fill={c} stroke="none"/><circle cx="17.5" cy="10.5" r="1.5" fill={c} stroke="none"/><circle cx="8.5" cy="7.5" r="1.5" fill={c} stroke="none"/><circle cx="6.5" cy="12.5" r="1.5" fill={c} stroke="none"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
const PhoneIcon   = ({ c }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.53 2 2 0 0 1 3.59 1.37h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.29 6.29l1.41-1.41a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>

// ─── Portal header ────────────────────────────────────────────────────────
function PortalHeader({ contractor }) {
  const name    = contractor?.company_name || 'Your Portal'
  const initial = name[0]?.toUpperCase()
  const phone   = contractor?.owner_phone
  return (
    <div style={{ height: 64, background: C.bg, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, flexShrink: 0 }}>
      {contractor?.logo_url
        ? <img src={contractor.logo_url} alt="logo" style={{ height: 36, width: 36, borderRadius: '50%', objectFit: 'cover' }} />
        : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, color: '#fff', flexShrink: 0 }}>{initial}</div>
      }
      <span style={{ fontWeight: 700, fontSize: 15, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {phone && (
        <a href={`tel:${phone}`} style={{ color: C.primary, fontWeight: 600, fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, minHeight: 44, flexShrink: 0 }}>
          <PhoneIcon c={C.primary} />
          <span>{phone.replace(/^\+1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3')}</span>
        </a>
      )}
    </div>
  )
}

// ─── Live status card ─────────────────────────────────────────────────────
function LiveStatusCard({ job, stageLabel, dayNumber, currentStageIdx, estCompletion }) {
  const isComplete = ['complete', 'completed', 'paid'].includes(job?.status)
  const isActive   = ['in_progress', 'inspection'].includes(job?.status)
  const pct        = Math.round(((currentStageIdx + 1) / STAGE_ORDER.length) * 100)

  return (
    <div className="p-fade-1" style={{ background: 'linear-gradient(135deg,rgba(59,130,246,0.15),rgba(59,130,246,0.05))', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 20, padding: 20, margin: '0 20px 24px' }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isComplete ? (
            <span style={{ color: C.success, fontWeight: 700, fontSize: 13 }}>✓ Complete</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}>
              <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: isActive ? C.success : C.warning, position: 'absolute', zIndex: 1, animation: isActive ? 'portalPulse 2s infinite' : 'none' }} />
                {isActive && <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `2px solid ${C.success}`, animation: 'livePulseRing 2s infinite' }} />}
              </div>
              <span style={{ color: isActive ? C.success : C.warning, fontWeight: 700, fontSize: 13 }}>{isActive ? 'Live' : 'Active'}</span>
            </div>
          )}
        </div>
        {dayNumber !== null && dayNumber > 0 && (
          <span style={{ color: C.muted, fontSize: 13 }}>Day {dayNumber} of installation</span>
        )}
      </div>

      {/* Stage name */}
      <p style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 16px', lineHeight: 1.3 }}>{stageLabel}</p>

      {/* Progress bar */}
      <div style={{ height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#3b82f6,#60a5fa)', borderRadius: 4, backgroundSize: '200% 100%', animation: 'portalShimmer 2s infinite linear', transition: 'width 1s ease-out' }} />
      </div>

      {/* Stage dots */}
      <div style={{ display: 'flex', gap: 4, marginBottom: estCompletion ? 10 : 0 }}>
        {STAGE_ORDER.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: i === currentStageIdx ? 10 : 7, height: i === currentStageIdx ? 10 : 7,
              borderRadius: '50%',
              background: i <= currentStageIdx ? C.primary : 'rgba(255,255,255,0.15)',
              animation: i === currentStageIdx ? 'portalPulse 2s infinite' : 'none',
              boxShadow: i === currentStageIdx ? `0 0 0 3px ${C.primaryGlow}` : 'none',
              transition: 'all .3s',
            }} />
          </div>
        ))}
      </div>

      {estCompletion && (
        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Est. completion: {estCompletion}</p>
      )}
    </div>
  )
}

// ─── Hero photo ───────────────────────────────────────────────────────────
function HeroPhoto({ photos, onTap }) {
  const latest           = photos?.[0]
  const [loaded, setLoaded] = useState(false)

  if (!latest) {
    return (
      <div className="p-fade-2" style={{ width: '100%', height: 260, background: C.surface2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted, gap: 12, marginBottom: 28 }}>
        <CameraIcon c={C.muted} />
        <p style={{ fontSize: 14, textAlign: 'center', margin: 0, maxWidth: 220, lineHeight: 1.5 }}>Photos will appear here as your crew uploads them</p>
      </div>
    )
  }

  return (
    <div className="p-fade-2" onClick={() => onTap(0)} style={{ position: 'relative', width: '100%', height: 260, cursor: 'pointer', marginBottom: 28, overflow: 'hidden' }}>
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,#1f2937 25%,#374151 50%,#1f2937 75%)', backgroundSize: '200% 100%', animation: 'portalShimmer 1.5s infinite' }} />
      )}
      <img src={latest.url} alt="" onLoad={() => setLoaded(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: loaded ? 'block' : 'none' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 110, background: 'linear-gradient(transparent,rgba(0,0,0,0.75))', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: 14, left: 16 }}>
        <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Latest update</p>
        <p style={{ margin: '2px 0 0', fontSize: 14, color: '#fff', fontWeight: 600 }}>
          {latest.taken_at ? timeAgo(latest.taken_at) : 'Recently uploaded'}
          {(PHASE_LABEL[latest.phase] || latest.phase) ? ` — ${PHASE_LABEL[latest.phase] || latest.phase}` : ''}
        </p>
      </div>
    </div>
  )
}

// ─── Photo strip ──────────────────────────────────────────────────────────
function PhotoStrip({ photos, onViewAll, onTap }) {
  const visible = photos.slice(0, 8)
  if (!visible.length) return null
  return (
    <div className="p-fade-3" style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', marginBottom: 12 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: C.text }}>📸 All Photos ({photos.length})</p>
        <button onClick={onViewAll} style={{ background: 'none', border: 'none', color: C.primary, fontWeight: 600, fontSize: 13, cursor: 'pointer', minHeight: 44, padding: '0 0 0 8px' }}>See all →</button>
      </div>
      <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '0 20px 6px', scrollbarWidth: 'none' }}>
        {visible.map((p, i) => (
          <div key={p.id || i} onClick={() => onTap(i)} style={{ flexShrink: 0, cursor: 'pointer' }}>
            <div style={{ width: 100, height: 100, borderRadius: 12, overflow: 'hidden', background: C.surface2 }}>
              <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 10, color: C.muted, textAlign: 'center' }}>{PHASE_LABEL[p.phase] || p.phase || ''}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Education card ───────────────────────────────────────────────────────
function EducationCard({ job, contractor }) {
  const [expanded, setExpanded] = useState(false)
  const status = job?.status
  const info   = EDUCATION[status] || EDUCATION.in_progress
  const coName = contractor?.company_name || 'your contractor'
  const body   = info.body || `Your new roof is installed and inspected. It comes with a manufacturer's warranty on materials and a workmanship warranty from ${coName}. Welcome to your new roof! 🎉`

  return (
    <div style={{ margin: '0 20px 24px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px' }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 10px' }}>🏠 What's happening on your roof</p>
      <p style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: '0 0 8px', lineHeight: 1.3 }}>{info.icon} {info.title}</p>
      <p style={{ fontSize: 14, color: C.muted, margin: 0, lineHeight: 1.6 }}>{body}</p>
      {info.time && <p style={{ fontSize: 13, color: C.primary, fontWeight: 600, margin: '10px 0 0' }}>⏱ Typically takes {info.time}</p>}
      {expanded && (
        <p style={{ fontSize: 13, color: C.muted, margin: '12px 0 0', lineHeight: 1.6, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          Your crew follows industry best practices for every installation. If you have questions about the work being done, you can message {coName} directly from this portal at any time.
        </p>
      )}
      <button onClick={() => setExpanded(v => !v)} style={{ background: 'none', border: 'none', color: C.primary, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '8px 0 0', minHeight: 40, display: 'block' }}>
        {expanded ? 'Show less ↑' : 'Learn more about this stage →'}
      </button>
    </div>
  )
}

// ─── Documents section (shared between Status tab preview + Docs tab) ─────
function DocumentsSection({ documents, token, preview = false }) {
  const [signing, setSigning]       = useState(null)
  const [sigText, setSigText]       = useState('')
  const [localSigned, setLocalSigned] = useState({})

  const submitSig = async () => {
    if (!sigText.trim() || !signing) return
    try {
      await callPortalApi('portal-api', { method: 'POST', body: JSON.stringify({ token, action: 'sign_document', document_id: signing.id, document_title: signing.title, signature_data: sigText }) })
      setLocalSigned(p => ({ ...p, [signing.id]: true }))
      setSigning(null); setSigText('')
    } catch {}
  }

  const docs = preview ? (documents || []).slice(0, 3) : (documents || [])

  if (!docs.length) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '24px', textAlign: 'center' }}>
        <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>Documents will appear here as they're shared with you</p>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {docs.map((d, i) => {
          const signed   = localSigned[d.id] || d.status === 'signed'
          const needsSig = !signed && d.status === 'pending' && d.requires_homeowner_action
          return (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: (d.url || needsSig) ? 12 : 0 }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>📄</span>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</p>
                  {d.created_at && <p style={{ margin: '2px 0 0', fontSize: 12, color: C.muted }}>{fmtDate(d.created_at)}</p>}
                </div>
                {signed && <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(16,185,129,0.15)', color: C.success, padding: '4px 10px', borderRadius: 100, flexShrink: 0 }}>Signed</span>}
                {needsSig && <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(245,158,11,0.15)', color: C.warning, padding: '4px 10px', borderRadius: 100, flexShrink: 0 }}>Sign needed</span>}
              </div>
              {(d.url || needsSig) && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noreferrer" style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontWeight: 600, textDecoration: 'none', textAlign: 'center', display: 'block', minHeight: 44, lineHeight: '24px', background: 'transparent' }}>View</a>
                  )}
                  {needsSig && !preview && (
                    <button onClick={() => setSigning(d)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: C.warning, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 44 }}>Sign now</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {signing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: C.surface, borderRadius: '20px 20px 0 0', padding: '24px 20px 36px', width: '100%', maxWidth: 480, margin: '0 auto' }}>
            <p style={{ fontWeight: 700, fontSize: 18, margin: '0 0 16px', color: C.text }}>Sign: {signing.title}</p>
            <input value={sigText} onChange={e => setSigText(e.target.value)} placeholder="Type your full name to sign..."
              style={{ width: '100%', padding: '14px', borderRadius: 12, border: `1px solid ${C.border}`, fontSize: 16, fontFamily: 'cursive', outline: 'none', minHeight: 52, background: C.surface2, color: C.text }} />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => setSigning(null)} style={{ flex: 1, padding: '14px', borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer', fontSize: 15, minHeight: 52 }}>Cancel</button>
              <button onClick={submitSig} style={{ flex: 2, padding: '14px', borderRadius: 12, border: 'none', background: C.primary, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15, minHeight: 52 }}>Sign document</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Payment section ──────────────────────────────────────────────────────
function PaymentSection({ payments }) {
  if (!payments?.length) return null
  const totalPaid = payments.filter(p => p.paid_at || p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0)
  const totalDue  = payments.reduce((s, p) => s + (p.amount || 0), 0)
  const pct       = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0

  return (
    <div style={{ margin: '0 20px 24px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px' }}>
      <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: '0 0 14px' }}>💳 Payment</p>
      <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, marginBottom: 6, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#10b981,#34d399)', borderRadius: 4, transition: 'width 1s ease-out' }} />
      </div>
      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 14px' }}>{pct}% paid</p>
      {payments.map((p, i) => {
        const paid    = p.paid_at || p.status === 'paid'
        const overdue = !paid && p.due_date && new Date(p.due_date) < new Date()
        const dueSoon = !paid && !overdue && p.due_date && new Date(p.due_date) <= new Date(Date.now() + 86400000 * 2)
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i > 0 ? `1px solid ${C.border}` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>{paid ? '✅' : overdue ? '🔴' : dueSoon ? '🔄' : '⏳'}</span>
              <span style={{ fontSize: 14, color: C.text }}>{p.description || (p.payment_type || '').replace(/_/g, ' ')}</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{dollars(p.amount)}</p>
              {paid && <p style={{ margin: 0, fontSize: 11, color: C.success }}>paid {fmtDate(p.paid_at)}</p>}
              {!paid && p.due_date && <p style={{ margin: 0, fontSize: 11, color: overdue ? C.error : dueSoon ? C.warning : C.muted }}>due {fmtDate(p.due_date)}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Satisfaction + review ────────────────────────────────────────────────
function SatisfactionSection({ job, contractor }) {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const progressMap = { lead:5, assessment_scheduled:10, assessed:20, estimate_sent:30, contracted:40, insurance_submitted:50, materials_ordered:60, scheduled:70, in_progress:80, inspection:90, complete:100, completed:100, paid:100 }
  const progress    = progressMap[job?.status] || 0
  if (progress < 90) return null

  const reviewLink = contractor?.google_review_link || 'https://search.google.com/local/writereview'
  const coName     = contractor?.company_name || 'your contractor'

  return (
    <div style={{ margin: '0 20px 24px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px', textAlign: 'center' }}>
      <p style={{ fontWeight: 700, fontSize: 16, color: C.text, margin: '0 0 6px' }}>How is everything going so far?</p>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 16px', lineHeight: 1.5 }}>Your feedback helps {coName} do their best work</p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
        {[1,2,3,4,5].map(s => (
          <button key={s} onMouseEnter={() => setHovered(s)} onMouseLeave={() => setHovered(0)} onClick={() => setRating(s)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 34, padding: 2, color: s <= (hovered || rating) ? '#f59e0b' : 'rgba(255,255,255,0.15)', minHeight: 48, transition: 'color .15s' }}>★</button>
        ))}
      </div>
      {rating >= 4 && (
        <>
          <p style={{ fontSize: 14, color: C.muted, margin: '0 0 14px', lineHeight: 1.5 }}>We're so glad! Would you mind leaving us a Google review? It helps us help more homeowners like you.</p>
          <a href={reviewLink} target="_blank" rel="noreferrer" style={{ display: 'block', background: '#4285f4', color: '#fff', borderRadius: 14, padding: '14px', fontWeight: 700, fontSize: 15, textDecoration: 'none', minHeight: 52, lineHeight: '24px' }}>Leave a Review →</a>
        </>
      )}
      {rating > 0 && rating < 4 && (
        <>
          <p style={{ fontSize: 14, color: C.muted, margin: '0 0 14px', lineHeight: 1.5 }}>We're sorry to hear that. Let us make it right.</p>
          <button style={{ width: '100%', background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '14px', fontWeight: 700, fontSize: 15, cursor: 'pointer', minHeight: 52 }}>Message us directly</button>
        </>
      )}
    </div>
  )
}

// ─── Referral section ─────────────────────────────────────────────────────
function ReferralSection({ contractor }) {
  const coName     = contractor?.company_name || 'us'
  const referralUrl = `https://roofingos.dev?ref=${contractor?.id || ''}`
  const share = () => {
    if (navigator.share) navigator.share({ title: `Check out ${coName}`, url: referralUrl }).catch(() => {})
    else navigator.clipboard.writeText(referralUrl).catch(() => {})
  }
  return (
    <div style={{ margin: '0 20px 24px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '18px' }}>
      <p style={{ fontWeight: 700, fontSize: 15, color: C.text, margin: '0 0 6px' }}>Know someone who needs a roof?</p>
      <p style={{ fontSize: 13, color: C.muted, margin: '0 0 14px', lineHeight: 1.5 }}>Share your referral link and {coName} will take great care of them.</p>
      <button onClick={share} style={{ width: '100%', background: C.surface2, color: C.primary, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px', fontWeight: 600, fontSize: 14, cursor: 'pointer', minHeight: 48 }}>Share →</button>
    </div>
  )
}

// ─── STATUS TAB ───────────────────────────────────────────────────────────
function StatusTab({ data, onViewPhotos, onLightbox, token }) {
  const { job, photos, payments, contractor, session, documents } = data

  // FIX: Day counter — days since job.created_at, not actual_start_date vs scheduled_end
  const dayNumber = job?.created_at
    ? Math.floor((Date.now() - new Date(job.created_at).getTime()) / (1000 * 60 * 60 * 24)) + 1
    : null

  // FIX: Stage label — actual status name, never "Leave Us a Review"
  const stageLabel = STAGE_LABELS[job?.status]
    || (job?.status || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    || 'In Progress'

  const normalizedStatus = (job?.status === 'paid' || job?.status === 'completed') ? 'complete' : job?.status
  const currentStageIdx  = Math.max(0, STAGE_ORDER.indexOf(normalizedStatus))

  const estCompletion = job?.scheduled_end
    ? new Date(job.scheduled_end).toDateString() === new Date().toDateString() ? 'Today' : fmtDate(job.scheduled_end)
    : null

  return (
    <div style={{ paddingBottom: 20 }}>
      {/* Greeting */}
      <div className="p-fade" style={{ padding: '24px 20px 0' }}>
        <p style={{ fontSize: 28, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>Hi {firstName(session?.homeowner_name)} 👋</p>
        <p style={{ fontSize: 15, color: C.muted, margin: '0 0 24px' }}>{contractor?.company_name || 'Your contractor'} is working on your roof</p>
      </div>

      <LiveStatusCard job={job} stageLabel={stageLabel} dayNumber={dayNumber} currentStageIdx={currentStageIdx} estCompletion={estCompletion} />

      <HeroPhoto photos={photos || []} onTap={onLightbox} />

      <PhotoStrip photos={photos || []} onViewAll={onViewPhotos} onTap={onLightbox} />

      <EducationCard job={job} contractor={contractor} />

      {/* Documents preview */}
      <div style={{ margin: '0 20px 24px' }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: '0 0 12px' }}>📄 Documents</p>
        <DocumentsSection documents={documents} token={token} preview={true} />
      </div>

      <PaymentSection payments={payments} />
      <SatisfactionSection job={job} contractor={contractor} />
      <ReferralSection contractor={contractor} />

      {/* Footer */}
      <div style={{ padding: '24px 20px 20px', textAlign: 'center', borderTop: `1px solid ${C.border}` }}>
        <p style={{ fontSize: 12, color: C.muted, margin: '0 0 4px' }}>Powered by <strong style={{ color: C.text }}>Roofing OS</strong></p>
        <a href="https://roofingos.dev" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.primary, textDecoration: 'none' }}>roofingos.dev</a>
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 12, color: C.muted, margin: '0 0 4px' }}>Are you a roofing contractor?</p>
          <a href="https://roofingos.dev/signup" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: C.primary, fontWeight: 600, textDecoration: 'none' }}>Get your free portal →</a>
        </div>
      </div>
    </div>
  )
}

// ─── PHOTOS TAB ───────────────────────────────────────────────────────────
function PhotosTab({ data }) {
  const { photos }     = data
  const [filter, setFilter] = useState('all')
  const [lightbox, setLightbox] = useState(null)

  const available = ['all', ...new Set((photos || []).map(p => PHASE_LABEL[p.phase] || p.phase).filter(Boolean))]
  const visible   = filter === 'all' ? (photos || []) : (photos || []).filter(p => (PHASE_LABEL[p.phase] || p.phase) === filter)

  return (
    <div style={{ paddingBottom: 20 }}>
      {lightbox !== null && <Lightbox photos={visible} startIndex={lightbox} onClose={() => setLightbox(null)} />}

      <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '14px 20px', scrollbarWidth: 'none' }}>
        {available.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ flexShrink: 0, padding: '7px 16px', borderRadius: 100, border: `1px solid ${filter === f ? C.primary : C.border}`, background: filter === f ? C.primary : 'transparent', color: filter === f ? '#fff' : C.muted, fontSize: 13, fontWeight: 500, cursor: 'pointer', minHeight: 36 }}>
            {f === 'all' ? `All (${(photos || []).length})` : `${f} (${(photos || []).filter(p => (PHASE_LABEL[p.phase] || p.phase) === f).length})`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px 20px' }}>
          <p style={{ color: C.muted, fontSize: 16 }}>No photos in this category yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '0 20px' }}>
          {visible.map((p, i) => (
            <div key={p.id || i} onClick={() => setLightbox(i)}
              style={{ borderRadius: 12, overflow: 'hidden', background: C.surface2, aspectRatio: '4/3', cursor: 'pointer', position: 'relative' }}>
              <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top,rgba(0,0,0,0.65),transparent)', padding: '20px 8px 7px' }}>
                <p style={{ margin: 0, fontSize: 11, color: '#fff', fontWeight: 600 }}>{PHASE_LABEL[p.phase] || p.phase}</p>
                {p.taken_at && <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{fmtTime(p.taken_at)}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── MESSAGES TAB ─────────────────────────────────────────────────────────
function MessagesTab({ data, token }) {
  const { contractor }             = data
  const [messages, setMessages]    = useState(data.messages || [])
  const [text, setText]            = useState('')
  const [sending, setSending]      = useState(false)
  const bottomRef                  = useRef(null)
  const coName                     = contractor?.company_name || 'Your contractor'
  const isComplete                 = ['complete', 'completed', 'paid'].includes(data.job?.status)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async () => {
    const msg = text.trim()
    if (!msg || sending) return
    setSending(true); setText('')
    setMessages(p => [...p, { id: Date.now(), sender_type: 'homeowner', message: msg, created_at: new Date().toISOString() }])
    try {
      const res = await callPortalApi('portal-api', { method: 'POST', body: JSON.stringify({ token, action: 'send_message', message: msg }) })
      const d   = await res.json()
      if (d.aria_response) setMessages(p => [...p, { id: Date.now() + 1, sender_type: 'aria', sender_name: 'Aria', message: d.aria_response, created_at: new Date().toISOString() }])
    } catch {}
    setSending(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 20px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: C.text }}>{coName}</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: C.muted }}>Messages go directly to your contractor</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p style={{ color: C.muted, fontSize: 15 }}>No messages yet.</p>
            <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Start a conversation with {coName}.</p>
          </div>
        )}
        {messages.map(m => {
          const isMe = m.sender_type === 'homeowner'
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', animation: 'portalFadeUp .2s ease-out both' }}>
              {!isMe && <p style={{ fontSize: 11, color: C.muted, margin: '0 0 3px 4px' }}>{m.sender_name || coName}</p>}
              <div style={{ maxWidth: '78%', padding: '11px 15px', borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isMe ? C.primary : C.surface2, color: '#fff', fontSize: 15, lineHeight: 1.4 }}>
                {m.message}
              </div>
              {m.created_at && <p style={{ fontSize: 11, color: C.muted, margin: '3px 0 0', padding: isMe ? '0 4px 0 0' : '0 0 0 4px' }}>{fmtTime(m.created_at)}</p>}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {!isComplete && (
        <div style={{ padding: '10px 16px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, flexShrink: 0, background: C.bg }}>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
            placeholder={`Reply to ${coName}…`}
            style={{ flex: 1, padding: '13px 16px', borderRadius: 28, border: `1px solid ${C.border}`, fontSize: 15, outline: 'none', background: C.surface2, color: C.text, minHeight: 48 }} />
          <button onClick={send} disabled={sending || !text.trim()}
            style={{ background: text.trim() ? C.primary : 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '50%', width: 48, height: 48, cursor: text.trim() ? 'pointer' : 'default', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {sending ? '…' : '↑'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── DOCS TAB ─────────────────────────────────────────────────────────────
function DocsTab({ data, token }) {
  return (
    <div style={{ padding: '16px 20px 20px' }}>
      <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: '0 0 12px' }}>📄 Documents</p>
      <DocumentsSection documents={data.documents} token={token} preview={false} />
    </div>
  )
}

// ─── Dark tab bar ─────────────────────────────────────────────────────────
const TABS = [
  { id: 'status',   label: 'Status',   Icon: HomeIcon    },
  { id: 'photos',   label: 'Photos',   Icon: CameraIcon  },
  // Design tab hidden — SAM tuning needed
  // Re-enable when roof segmentation correctly isolates shingles from trees
  // { id: 'colors',   label: 'Design',   Icon: PaletteIcon },
  { id: 'messages', label: 'Messages', Icon: ChatIcon    },
  { id: 'docs',     label: 'Docs',     Icon: DocIcon     },
]

// ─── Demo render URLs ────────────────────────────────────────────────────
const RENDER_BASE   = 'https://koqpbnxkhgbsnbdjwldx.supabase.co/storage/v1/object/public/demo-photos/demo/renders/sarah-johnson'
const ORIGINAL_BASE = 'https://koqpbnxkhgbsnbdjwldx.supabase.co/storage/v1/object/public/demo-photos/demo/sarah-johnson'
const getRenderUrl   = (angle, colorId) => `${RENDER_BASE}/${angle}/${colorId}.jpeg`
const getOriginalUrl = (angle) => `${ORIGINAL_BASE}/${angle}.jpeg`

const DEMO_ANGLES = [
  { id: 'front',    label: 'Front' },
  { id: 'left',     label: 'Left' },
  { id: 'back',     label: 'Back' },
  { id: 'right',    label: 'Right' },
  { id: 'roofline', label: 'Roofline' },
]

// ─── Design tab constants ─────────────────────────────────────────────────
const SHINGLE_COLORS = [
  { id: 'gaf-charcoal',  brand: 'GAF Timberline HDZ',     name: 'Charcoal',       hex: '#3d3d3d', badge: 'Popular' },
  { id: 'gaf-weather',   brand: 'GAF Timberline HDZ',     name: 'Weathered Wood', hex: '#8b7355', badge: 'Popular' },
  { id: 'gaf-slate',     brand: 'GAF Timberline HDZ',     name: 'Slate',          hex: '#708090' },
  { id: 'gaf-barkwood',  brand: 'GAF Timberline HDZ',     name: 'Barkwood',       hex: '#5c4a32' },
  { id: 'gaf-pewter',    brand: 'GAF Timberline HDZ',     name: 'Pewter Gray',    hex: '#8a8a8a' },
  { id: 'oc-estate',     brand: 'Owens Corning Duration', name: 'Estate Gray',    hex: '#6e7270', badge: '#1 National' },
  { id: 'oc-onyx',       brand: 'Owens Corning Duration', name: 'Onyx Black',     hex: '#2c2c2c' },
  { id: 'oc-driftwood',  brand: 'Owens Corning Duration', name: 'Driftwood',      hex: '#9e8e7a' },
  { id: 'oc-evergreen',  brand: 'Owens Corning Duration', name: 'Evergreen Mist', hex: '#5a7a5a' },
]
const METALS = [
  { id: 'white',      name: 'White',    hex: '#f0f0f0' },
  { id: 'bronze',     name: 'Bronze',   hex: '#8b6914' },
  { id: 'black-m',    name: 'Black',    hex: '#1a1a1a' },
  { id: 'clay',       name: 'Clay',     hex: '#c4a882' },
  { id: 'charcoal-m', name: 'Charcoal', hex: '#3d3d3d' },
  { id: 'copper',     name: 'Copper',   hex: '#b87333' },
]
const ANGLE_PRIORITY = ['front', 'front_wide', 'left', 'right', 'back', 'roofline', 'street', 'front_left', 'back_left', 'back_right']
const ANGLE_LABELS   = { front: 'Front', front_wide: 'Wide', front_left: 'Front-Left', left: 'Left', right: 'Right', back: 'Back', back_left: 'Back-Left', back_right: 'Back-Right', roofline: 'Roofline', street: 'Street' }

function getAngleKey(url) { return (url || '').split('/').pop().replace(/\.(jpeg|jpg|png)$/i, '') }
function getAngleLabel(url) { const k = getAngleKey(url); return ANGLE_LABELS[k] || k.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) }

function getContextTip(shingle, gutter) {
  if (!shingle) return null
  const isDark = ['#3d3d3d', '#2c2c2c', '#1a1a1a', '#5c4a32'].includes(shingle.hex)
  const isLight = gutter && ['#f0f0f0', '#c4a882'].includes(gutter.hex)
  if (isDark && isLight) return 'Classic Colorado combo — dark roof with light trim works beautifully with tan, gray, and beige siding.'
  if (isDark && !isLight) return 'Bold, modern look. Great for contemporary homes. Dark-on-dark adds drama and curb appeal.'
  return 'Solid choice for Colorado homes — this combination pairs well with most siding colors and HOA guidelines.'
}

// ─── Colors tab ───────────────────────────────────────────────────────────
const getVisualizationTier = (plan) => {
  if (plan === 'pro' || plan === 'custom') return 'ai'
  if (plan === 'starter') return 'basic'
  return 'swatches'
}

function ColorsTab({ data, token, isDemo }) {
  // Non-demo: derive angle list from uploaded job photos
  const beforePhotos = (data.photos || []).filter(p => p.phase === 'before')
  const sortedPhotos = [...beforePhotos].sort((a, b) => {
    const ai = ANGLE_PRIORITY.indexOf(getAngleKey(a.url))
    const bi = ANGLE_PRIORITY.indexOf(getAngleKey(b.url))
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  // Demo mode uses fixed angles; non-demo uses photo URL
  const [activeAngle, setActiveAngle]   = useState('front')         // demo
  const [activeUrl, setActiveUrl]       = useState(sortedPhotos[0]?.url || null) // non-demo
  const [shingle, setShingle]           = useState(null)            // null = show original
  const [gutter, setGutter]             = useState(METALS[0])
  const [drip, setDrip]                 = useState(METALS[4])
  const [loveSaving, setLoveSaving]     = useState(false)
  const [loveSaved, setLoveSaved]       = useState(false)
  const [shared, setShared]             = useState(false)
  const [renderReady, setRenderReady]   = useState({}) // { "angleId|colorId": true }

  // Preload all renders for current angle (demo only)
  useEffect(() => {
    if (!isDemo) return
    SHINGLE_COLORS.forEach(s => {
      const key = `${activeAngle}|${s.id}`
      if (renderReady[key]) return
      const img = new window.Image()
      img.onload  = () => setRenderReady(p => ({ ...p, [key]: true }))
      img.onerror = () => {}
      img.src = getRenderUrl(activeAngle, s.id)
    })
  }, [activeAngle, isDemo])

  const tip = getContextTip(shingle, gutter)

  const loveIt = async () => {
    if (loveSaved) return
    setLoveSaving(true)
    try {
      await callPortalApi('portal-api', {
        method: 'POST',
        body: JSON.stringify({ action: 'love_color', token, job_id: data.job?.id, color_name: shingle?.name, hex_color: shingle?.hex, metadata: { brand: shingle?.brand, gutter: gutter?.name, drip: drip?.name } }),
      })
      setLoveSaved(true)
    } catch (_) {}
    setLoveSaving(false)
  }

  const shareIt = () => {
    const url = 'https://roofingos.dev/portal/demo'
    if (navigator.share) navigator.share({ title: 'Check out my new roof design!', url }).catch(() => {})
    else { navigator.clipboard.writeText(url).catch(() => {}); setShared(true) }
  }

  const SwatchRow = ({ items, value, onChange, size = 44 }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {items.map(s => {
        const active = value?.id === s.id
        const textDark = ['#f0f0f0', '#c4a882', '#9e8e7a', '#8b7355', '#8a8a8a', '#708090', '#6e7270', '#b87333'].includes(s.hex)
        return (
          <button key={s.id} onClick={() => onChange(s)} title={s.name}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '4px', position: 'relative' }}>
            <div style={{ width: size, height: size, borderRadius: '50%', background: s.hex, border: active ? `3px solid ${C.primary}` : '2px solid rgba(255,255,255,0.15)', boxShadow: active ? `0 0 0 3px rgba(59,130,246,0.3)` : 'none', transition: 'all 0.15s', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {active && <span style={{ fontSize: size > 40 ? 16 : 12, fontWeight: 700, color: textDark ? '#000' : '#fff' }}>✓</span>}
            </div>
            {s.badge && <div style={{ position: 'absolute', top: 2, right: 0, background: '#f59e0b', borderRadius: 4, padding: '1px 4px', fontSize: 7, fontWeight: 700, color: '#000', lineHeight: 1.4, whiteSpace: 'nowrap' }}>★</div>}
            <span style={{ fontSize: 9, color: active ? C.primary : C.muted, fontWeight: active ? 700 : 400, maxWidth: size + 8, textAlign: 'center', lineHeight: 1.2 }}>{s.name}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div style={{ paddingBottom: 32 }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h3 style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 700, color: C.text }}>Design Your New Roof</h3>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>See exactly how your home will look</p>
        </div>
        {isDemo && (
          <button onClick={shareIt} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34, flexShrink: 0 }}>
            {shared ? '✓ Copied' : 'Share →'}
          </button>
        )}
      </div>

      {/* Angle selector */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '12px 20px 0', scrollbarWidth: 'none' }}>
        {isDemo
          ? DEMO_ANGLES.map(a => (
              <button key={a.id} onClick={() => setActiveAngle(a.id)}
                style={{ flexShrink: 0, padding: '6px 14px', borderRadius: 20, border: `1px solid ${activeAngle === a.id ? C.primary : C.border}`, background: activeAngle === a.id ? 'rgba(59,130,246,0.12)' : 'transparent', color: activeAngle === a.id ? C.primary : C.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34 }}>
                {a.label}
              </button>
            ))
          : sortedPhotos.length > 1 && sortedPhotos.map(p => {
              const active = activeUrl === p.url
              return (
                <button key={p.url} onClick={() => setActiveUrl(p.url)}
                  style={{ flexShrink: 0, padding: '6px 14px', borderRadius: 20, border: `1px solid ${active ? C.primary : C.border}`, background: active ? 'rgba(59,130,246,0.12)' : 'transparent', color: active ? C.primary : C.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34 }}>
                  {getAngleLabel(p.url)}
                </button>
              )
            })
        }
      </div>

      {/* Photo — real SAM render (demo) or CSS overlay (real job) */}
      {(() => {
        if (isDemo) {
          const hasRender = !!(shingle && renderReady[`${activeAngle}|${shingle.id}`])
          const displayUrl = (shingle && hasRender)
            ? getRenderUrl(activeAngle, shingle.id)
            : getOriginalUrl(activeAngle)
          return (
            <div style={{ position: 'relative', margin: '12px 0 0', overflow: 'hidden' }}>
              <img key={displayUrl} src={displayUrl} alt="Your home"
                style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
              {/* CSS overlay: only when color picked but render not yet loaded */}
              {shingle && !hasRender && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '52%', background: shingle.hex, mixBlendMode: 'multiply', opacity: 0.38, pointerEvents: 'none', transition: 'background 0.22s' }} />
              )}
              {/* Label pill */}
              <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(10,15,26,0.88)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 10, padding: '8px 14px', border: `1px solid ${C.border}` }}>
                {shingle ? (
                  <>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: shingle.hex, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }} />
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>{shingle.name}</p>
                      <p style={{ margin: 0, fontSize: 10, color: hasRender ? C.success : '#f59e0b' }}>{hasRender ? '✓ AI render' : 'Loading…'}</p>
                    </div>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 12, color: C.muted }}>← Select a color below</p>
                )}
              </div>
            </div>
          )
        }
        // Non-demo: CSS overlay on job photos
        if (!activeUrl) return (
          <div style={{ margin: '12px 20px 0', padding: '32px 20px', background: C.surface, borderRadius: 16, textAlign: 'center', border: `1px solid ${C.border}` }}>
            <p style={{ margin: '0 0 4px', fontSize: 22 }}>🏠</p>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Photos will appear here after the inspection</p>
          </div>
        )
        return (
          <div style={{ position: 'relative', margin: '12px 0 0', overflow: 'hidden' }}>
            <img key={activeUrl} src={activeUrl} alt="Your home"
              style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
            {shingle && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '52%', background: shingle.hex, mixBlendMode: 'multiply', opacity: 0.38, pointerEvents: 'none', transition: 'background 0.22s' }} />
            )}
            {shingle && (
              <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(10,15,26,0.88)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderRadius: 10, padding: '8px 14px', border: `1px solid ${C.border}` }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: shingle.hex, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }} />
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.1 }}>{shingle.name}</p>
                  <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{shingle.brand}</p>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Context tip */}
      {tip && activeUrl && (
        <div style={{ margin: '10px 20px 0', padding: '10px 14px', background: 'rgba(59,130,246,0.06)', borderRadius: 10, border: '1px solid rgba(59,130,246,0.12)' }}>
          <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>💡 {tip}</p>
        </div>
      )}

      {/* Shingles */}
      <div style={{ padding: '20px 20px 0' }}>
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Shingles</p>
        <SwatchRow items={SHINGLE_COLORS} value={shingle} onChange={(s) => { setShingle(s); setLoveSaved(false) }} size={44} />
      </div>

      {/* Gutters */}
      <div style={{ padding: '16px 20px 0' }}>
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Gutters & Metals</p>
        <SwatchRow items={METALS} value={gutter} onChange={(m) => { setGutter(m); setLoveSaved(false) }} size={36} />
      </div>

      {/* Drip edge */}
      <div style={{ padding: '16px 20px 0' }}>
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Drip Edge</p>
        <SwatchRow items={METALS} value={drip} onChange={(m) => { setDrip(m); setLoveSaved(false) }} size={36} />
      </div>

      {/* Selection summary */}
      <div style={{ margin: '20px 20px 0', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px' }}>
        <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your Selection</p>
        {[['Shingles', shingle, shingle ? `${shingle.brand} — ${shingle.name}` : '—'],
          ['Gutters', gutter, gutter?.name || '—'],
          ['Drip Edge', drip, drip?.name || '—']].map(([label, item, display]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: label !== 'Drip Edge' ? `1px solid ${C.border}` : 'none' }}>
            <span style={{ fontSize: 13, color: C.muted }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              {item && <div style={{ width: 14, height: 14, borderRadius: '50%', background: item.hex, border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0 }} />}
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{display}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Love CTA */}
      <div style={{ padding: '16px 20px 0' }}>
        <button onClick={loveIt} disabled={loveSaving || loveSaved}
          style={{ width: '100%', padding: '15px', border: `1px solid ${loveSaved ? C.success : 'rgba(59,130,246,0.35)'}`, borderRadius: 14, cursor: loveSaved ? 'default' : 'pointer', background: loveSaved ? 'rgba(16,185,129,0.1)' : 'linear-gradient(135deg,rgba(59,130,246,0.16),rgba(139,92,246,0.16))', color: loveSaved ? C.success : C.text, fontSize: 15, fontWeight: 700, transition: 'all 0.2s', minHeight: 52 }}>
          {loveSaved ? '✓ Your contractor has been notified!' : loveSaving ? 'Saving…' : '❤️ I Love This Combination!'}
        </button>
        {!loveSaved && (
          <p style={{ margin: '8px 0 0', fontSize: 11, color: C.muted, textAlign: 'center' }}>Your contractor will see your selection and confirm materials</p>
        )}
      </div>

      {/* Demo roofer CTA */}
      {isDemo && (
        <div style={{ margin: '24px 20px 0', background: 'linear-gradient(135deg,rgba(59,130,246,0.1),rgba(59,130,246,0.04))', border: '1px solid rgba(59,130,246,0.22)', borderRadius: 18, padding: '24px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🏠</div>
          <h3 style={{ color: C.text, fontSize: 18, fontWeight: 800, margin: '0 0 8px', lineHeight: 1.3 }}>Your homeowners could have this.</h3>
          <p style={{ color: C.muted, fontSize: 13, margin: '0 0 6px', lineHeight: 1.6 }}>Set up your free Roofing OS account in 4 minutes. Your next homeowner gets a real-time portal like this one — photos, progress updates, color visualization, and more.</p>
          <p style={{ color: C.primary, fontSize: 13, fontWeight: 600, margin: '0 0 20px' }}>Free forever. No credit card. No time limit.</p>
          <a href="https://roofingos.dev/signup" style={{ display: 'block', background: C.primary, color: '#fff', padding: '14px', borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: 'none', marginBottom: 10 }}>Create Free Account →</a>
          <a href="https://roofingos.dev" style={{ display: 'block', color: C.muted, fontSize: 12, textDecoration: 'none' }}>Learn more about Roofing OS</a>
        </div>
      )}
    </div>
  )
}

function DarkTabBar({ tab, setTab, plan }) {
  const isAI = plan === 'pro' || plan === 'custom'
  return (
    <div style={{ flexShrink: 0, background: 'rgba(10,15,26,0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: `1px solid ${C.border}`, height: 72, paddingBottom: 'env(safe-area-inset-bottom,0px)', display: 'flex' }}>
      {TABS.map(t => {
        const active = tab === t.id
        const aiColors = isAI && t.id === 'colors'
        return (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', padding: '10px 0 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, position: 'relative' }}>
            {active && <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 28, height: 3, background: C.primary, borderRadius: '0 0 3px 3px' }} />}
            <t.Icon c={active ? C.primary : '#6b7280'} />
            <span style={{ fontSize: 10, fontWeight: 600, color: active ? C.primary : '#6b7280', letterSpacing: '0.01em' }}>
              {t.label}{aiColors ? ' ✨' : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Pro portal V2 ────────────────────────────────────────────────────────
function ProPortalV2({ data, token, isDemo }) {
  const [tab, setTab]                   = useState('status')
  const [lightboxPhotos, setLightboxPhotos] = useState(null)
  const [lightboxStart, setLightboxStart]   = useState(0)
  const { contractor }                  = data

  const openLightbox = (arr, i = 0) => { setLightboxPhotos(arr); setLightboxStart(i) }

  return (
    <div style={{ background: C.bg, display: 'flex', flexDirection: 'column', height: '100dvh', color: C.text, fontFamily: "-apple-system,'Inter',system-ui,sans-serif", maxWidth: 480, margin: '0 auto', position: 'relative' }}>
      {lightboxPhotos && <Lightbox photos={lightboxPhotos} startIndex={lightboxStart} onClose={() => setLightboxPhotos(null)} />}

      {/* Demo banner — conversion bar */}
      {isDemo && (
        <div style={{ background: '#0d1520', borderBottom: '1px solid rgba(59,130,246,0.2)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
          <div>
            <p style={{ color: '#60a5fa', fontSize: 13, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>🏠 Homeowner Portal Demo</p>
            <p style={{ color: '#6b7280', fontSize: 11, margin: 0 }}>This is what your homeowners see</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="https://roofingos.dev/demo/contractor" style={{ color: '#9ca3af', fontSize: 12, textDecoration: 'none', padding: '6px 12px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, whiteSpace: 'nowrap' }}>← Contractor view</a>
            <a href="https://app.nexuszc.com/roofing/signup" style={{ background: C.primary, color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>Start free →</a>
          </div>
        </div>
      )}

      <PortalHeader contractor={contractor} />

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Status + Photos + Colors + Docs: scrollable */}
        {tab !== 'messages' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            {tab === 'status'  && <StatusTab   data={data} onViewPhotos={() => setTab('photos')} onLightbox={(i) => openLightbox(data.photos || [], i)} token={token} />}
            {tab === 'photos'  && <PhotosTab   data={data} />}
            {/* Design tab hidden — SAM tuning needed */}
            {/* {tab === 'colors'  && <ColorsTab   data={data} token={token} isDemo={isDemo} />} */}
            {tab === 'docs'    && <DocsTab     data={data} token={token} />}
          </div>
        )}
        {/* Messages: flex column with sticky input */}
        {tab === 'messages' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <MessagesTab data={data} token={token} />
          </div>
        )}
      </div>

      <DarkTabBar tab={tab} setTab={setTab} plan={data.plan} />
    </div>
  )
}

// ─── Free portal (dark themed, simplified) ────────────────────────────────
function FreePortal({ data }) {
  const { job, photos, timeline, documents } = data
  const [lightbox, setLightbox] = useState(null)
  const recentPhotos = (photos || []).slice(0, 6)

  const status = job?.status || 'in_progress'
  const statusLabel = STAGE_LABELS[status] || status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  const isComplete = ['complete', 'completed', 'paid'].includes(status)

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: "-apple-system,'Inter',system-ui,sans-serif", maxWidth: 480, margin: '0 auto' }}>
      {lightbox !== null && <Lightbox photos={recentPhotos} startIndex={lightbox} onClose={() => setLightbox(null)} />}

      <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: C.primary }}>ROOFING OS</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.muted, textAlign: 'right', maxWidth: 180, lineHeight: 1.3 }}>{job?.property_address}</span>
      </div>

      <div style={{ padding: '28px 20px 24px', textAlign: 'center', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: isComplete ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)', color: isComplete ? C.success : C.primary, fontWeight: 700, fontSize: 15, padding: '10px 20px', borderRadius: 100, marginBottom: 14 }}>
          {isComplete ? '✅' : '🏗️'} {statusLabel}
        </div>
        <p style={{ fontSize: 18, fontWeight: 600, color: C.text, margin: 0 }}>
          {isComplete ? 'Your new roof is complete!' : 'Your roof replacement is underway.'}
        </p>
      </div>

      {recentPhotos.length > 0 && (
        <div style={{ padding: '20px 0 0' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 20px', marginBottom: 10 }}>Photos</p>
          <div style={{ overflowX: 'auto', display: 'flex', gap: 8, padding: '0 20px 20px', scrollbarWidth: 'none' }}>
            {recentPhotos.map((p, i) => (
              <div key={p.id || i} onClick={() => setLightbox(i)} style={{ flexShrink: 0, width: 110, height: 84, borderRadius: 10, overflow: 'hidden', background: C.surface2, cursor: 'pointer' }}>
                <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(timeline || []).length > 0 && (
        <div style={{ padding: '0 20px 20px' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Timeline</p>
          {timeline.slice(0, 5).map((item, i) => (
            <div key={item.id || i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < 4 ? `1px solid ${C.border}` : 'none' }}>
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{item.raw_update === 'upcoming' ? '○' : '✅'}</span>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: item.raw_update === 'upcoming' ? C.muted : C.text }}>{item.title}</p>
                {item.created_at && item.raw_update !== 'upcoming' && <p style={{ margin: '2px 0 0', fontSize: 12, color: C.success }}>✓ {fmtDate(item.created_at)}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ margin: '0 20px 20px' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>More with Portal Pro</p>
        {['💬 Message your contractor', '📄 Download documents', '⭐ Leave a review'].map(label => (
          <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px', textAlign: 'center', marginBottom: 10 }}>
            <p style={{ fontWeight: 600, fontSize: 14, color: C.text, margin: '0 0 4px' }}>{label}</p>
            <a href="https://roofingos.dev/upgrade" target="_blank" rel="noreferrer" style={{ color: C.primary, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Learn more →</a>
          </div>
        ))}
      </div>

      <div style={{ padding: '20px', textAlign: 'center', borderTop: `1px solid ${C.border}` }}>
        <p style={{ fontSize: 12, color: C.muted, margin: '0 0 2px' }}>Powered by <strong style={{ color: C.text }}>Roofing OS</strong></p>
        <a href="https://roofingos.dev" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.primary, textDecoration: 'none' }}>roofingos.dev</a>
      </div>
    </div>
  )
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────
export default function RoofingPortal() {
  const { token }         = useParams()
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(reg => reg.unregister()))
        .catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!token) { setError('No portal link provided.'); setLoading(false); return }
    load()
  }, [token])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const res = await callPortalApi(`portal-api?token=${encodeURIComponent(token)}&action=overview`)
      const d   = await res.json()
      if (!d.ok || d.error) { setError(d.error || 'Invalid portal link. Please contact your contractor.'); setLoading(false); return }

      const photos    = [...(d.photos   || [])].sort((a, b) => new Date(b.taken_at || b.created_at) - new Date(a.taken_at || a.created_at))
      const messages  = [...(d.messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      const documents = (d.documents || []).map(doc => ({ ...doc, doc_type: doc.document_type || doc.doc_type }))

      setData({ ...d, photos, messages, documents })
      callPortalApi('roofing-notify', { method: 'POST', body: JSON.stringify({ event: 'portal_viewed', job_id: d.job?.id }) }).catch(() => {})
    } catch (e) {
      console.error(e)
      setError("We couldn't load your portal. Pull down to refresh.")
    }
    setLoading(false)
  }

  if (loading) return <DarkLoadingScreen />

  if (error) return (
    <div style={{ background: C.bg, minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "-apple-system,'Inter',system-ui,sans-serif", maxWidth: 480, margin: '0 auto', color: C.text }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>😕</div>
      <p style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px', textAlign: 'center' }}>{error}</p>
      <p style={{ fontSize: 14, color: C.muted, margin: '0 0 28px', textAlign: 'center' }}>If this keeps happening, contact your contractor directly.</p>
      <button onClick={load} style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '14px 28px', fontWeight: 700, fontSize: 16, cursor: 'pointer', minHeight: 52 }}>Try again</button>
    </div>
  )

  const isDemo = token === 'DEMO2026ROOFINGOS'

  return data.plan === 'free'
    ? <FreePortal data={data} />
    : <ProPortalV2 data={data} token={token} isDemo={isDemo} />
}

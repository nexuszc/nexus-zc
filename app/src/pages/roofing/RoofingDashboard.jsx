import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'
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

const ACTIVE_KEYS = new Set(['lead','estimate_sent','contract_signed','materials_ordered','scheduled','in_progress','inspection'])

const KANBAN_COLS = [
  { key: 'new',              label: 'New',             color: '#8896a8', bg: 'rgba(136,150,168,0.15)' },
  { key: 'in_progress',      label: 'In Progress',     color: '#4a9eff', bg: 'rgba(74,158,255,0.15)' },
  { key: 'complete',         label: 'Complete',        color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  { key: 'review_requested', label: 'Review Requested', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
]

function getKanbanCol(job) {
  if (job.review_requested) return 'review_requested'
  if (['complete', 'invoiced', 'paid'].includes(job.status)) return 'complete'
  if (job.status === 'lead') return 'new'
  return 'in_progress'
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function stageMeta(s) {
  return STAGE_META[s] || { label: s, bg: 'rgba(136,150,168,0.15)', fg: '#8896a8' }
}

function daysAgo(dateStr) {
  if (!dateStr) return null
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  return d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`
}

function StatCard({ label, value, sub, accent, icon }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>{label}</p>
        {icon && <span style={{ fontSize: '18px', opacity: 0.6 }}>{icon}</span>}
      </div>
      <p style={{ fontSize: '28px', fontWeight: '700', color: accent || C.text, margin: '0', lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: '11px', color: C.muted, margin: '6px 0 0' }}>{sub}</p>}
    </div>
  )
}

function leadScoreBadge(score) {
  if (!score && score !== 0) return null
  if (score >= 70) return { icon: '🔥', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
  if (score >= 40) return { icon: '🟡', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
  return { icon: '⚪', color: '#6b7280', bg: 'rgba(107,114,128,0.1)' }
}

function JobCard({ job }) {
  const navigate = useNavigate()
  const s = stageMeta(job.status)
  const contract = job.contract_amount || 0
  const days = daysAgo(job.actual_start_date || job.created_at)
  const accentColor = s.fg
  const scoreBadge = leadScoreBadge(job.lead_score)
  const suppFlag = job.supplement_status_flag && job.supplement_status_flag !== 'none' && job.supplement_status_flag !== null
  const payDot = job.payment_dot
  const weatherWarn = job.weather_warning

  return (
    <div
      onClick={() => navigate(`/roofing/jobs/${job.id}`)}
      style={{
        background: C.surface,
        border: `1px solid ${weatherWarn ? 'rgba(239,68,68,0.3)' : C.border}`,
        borderRadius: '16px',
        padding: '0',
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.1s',
        display: 'flex',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(74,158,255,0.4)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(74,158,255,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = weatherWarn ? 'rgba(239,68,68,0.3)' : C.border; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
    >
      {/* Left accent bar */}
      <div style={{ width: '4px', background: accentColor, flexShrink: 0 }} />

      <div style={{ flex: 1, padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <p style={{ fontWeight: '700', color: C.text, margin: 0, fontSize: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.homeowner_name}</p>
              {weatherWarn && <span title="Weather warning today" style={{ fontSize: '14px', flexShrink: 0 }}>⛈️</span>}
            </div>
            <p style={{ fontSize: '13px', color: C.muted, margin: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.property_address}</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', fontWeight: '600', padding: '3px 10px', borderRadius: '20px', background: s.bg, color: s.fg }}>{s.label}</span>
            {contract > 0 && <p style={{ fontSize: '14px', fontWeight: '700', color: C.success, margin: 0 }}>${contract.toLocaleString()}</p>}
          </div>
        </div>

        {/* Badge row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '8px 0 10px', flexWrap: 'wrap' }}>
          {days && <span style={{ fontSize: '11px', color: C.muted }}>{days} active</span>}
          {scoreBadge && job.lead_score >= 40 && (
            <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '20px', background: scoreBadge.bg, color: scoreBadge.color }}>
              {scoreBadge.icon} {job.lead_score}
            </span>
          )}
          {suppFlag && (
            <span style={{ fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '20px', background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>
              Supp {job.supplement_status_flag.replace(/_/g, ' ')}
            </span>
          )}
          {payDot === 'complete' && (
            <span title="Fully paid" style={{ fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '20px', background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>
              ● Paid
            </span>
          )}
          {payDot === 'partial' && (
            <span title="Partial payment received" style={{ fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '20px', background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
              ◐ Partial
            </span>
          )}
          {job.portal_sent && (
            <span title="Portal sent to homeowner" style={{ fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '20px', background: 'rgba(74,158,255,0.1)', color: '#4a9eff' }}>
              ● Portal sent
            </span>
          )}
          {job.measurements_ordered && (
            <span title="Aerial measurements ordered" style={{ fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '20px', background: 'rgba(20,184,166,0.1)', color: '#2dd4bf' }}>
              📐 Measured
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
          {[
            { icon: '📸', label: 'Photos', tab: 'photos' },
            { icon: '💬', label: 'Messages', tab: 'messages' },
            { icon: '🔗', label: 'Portal', tab: 'portal' },
          ].map(({ icon, label, tab }) => (
            <button
              key={tab}
              onClick={() => navigate(`/roofing/jobs/${job.id}?tab=${tab}`)}
              style={{
                background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
                borderRadius: '8px', padding: '6px 11px', fontSize: '12px', color: C.muted,
                cursor: 'pointer', fontWeight: '500', transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(74,158,255,0.12)'; e.currentTarget.style.color = C.primary }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = C.muted }}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' && window.innerWidth >= 768)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = e => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isDesktop
}

const JOB_TYPE_LABELS = {
  insurance_claim: 'Insurance',
  retail: 'Retail',
  repair: 'Repair',
  storm_damage: 'Storm',
}

function KanbanView({ jobs }) {
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()

  const colMap = {}
  for (const col of KANBAN_COLS) colMap[col.key] = []
  for (const job of jobs) {
    const key = getKanbanCol(job)
    if (colMap[key]) colMap[key].push(job)
  }

  const KanbanCard = ({ job, col }) => {
    const days = daysAgo(job.created_at)
    const typeLabel = JOB_TYPE_LABELS[job.job_type] || job.job_type || ''
    return (
      <div
        onClick={() => navigate(`/roofing/jobs/${job.id}`)}
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderLeft: `4px solid ${col.color}`,
          borderRadius: '10px',
          padding: '12px 12px 10px',
          cursor: 'pointer',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(74,158,255,0.4)'; e.currentTarget.style.borderLeftColor = col.color; e.currentTarget.style.boxShadow = '0 2px 12px rgba(74,158,255,0.1)' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.borderLeftColor = col.color; e.currentTarget.style.boxShadow = 'none' }}
      >
        <p style={{ fontSize: '14px', fontWeight: '700', color: C.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.homeowner_name}</p>
        <p style={{ fontSize: '12px', color: C.muted, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.property_address?.split(',')[0]}</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
            {typeLabel && (
              <span style={{ fontSize: '10px', fontWeight: '600', padding: '2px 7px', borderRadius: '20px', background: col.bg, color: col.color }}>{typeLabel}</span>
            )}
            {days && <span style={{ fontSize: '10px', color: C.muted }}>{days}</span>}
          </div>
          <button
            onClick={e => { e.stopPropagation(); navigate(`/roofing/jobs/${job.id}`) }}
            style={{ fontSize: '11px', color: C.primary, background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600', padding: '2px 0', flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            Open →
          </button>
        </div>
      </div>
    )
  }

  if (isDesktop) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
        {KANBAN_COLS.map(col => {
          const colJobs = colMap[col.key] || []
          return (
            <div key={col.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                <p style={{ fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                  {col.label}
                </p>
                <span style={{ fontSize: '10px', color: 'rgba(136,150,168,0.5)', fontWeight: '400' }}>({colJobs.length})</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '80px' }}>
                {colJobs.map(job => <KanbanCard key={job.id} job={job} col={col} />)}
                {colJobs.length === 0 && (
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px dashed ${C.border}`, borderRadius: '10px', padding: '20px', textAlign: 'center' }}>
                    <p style={{ fontSize: '11px', color: 'rgba(136,150,168,0.4)', margin: 0 }}>—</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {KANBAN_COLS.map(col => {
        const colJobs = colMap[col.key] || []
        if (colJobs.length === 0) return null
        return (
          <div key={col.key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col.color, flexShrink: 0 }} />
              <p style={{ fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                {col.label} <span style={{ color: 'rgba(136,150,168,0.5)', fontWeight: '400' }}>({colJobs.length})</span>
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {colJobs.map(job => <KanbanCard key={job.id} job={job} col={col} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BottomNav() {
  const navigate = useNavigate()
  const path = window.location.pathname
  const tabs = [
    { icon: '🏠', label: 'Jobs', path: '/roofing/jobs' },
    { icon: '＋', label: 'New Job', path: '/roofing/jobs/new' },
    { icon: '🚪', label: 'Canvass', path: '/roofing/canvass' },
    { icon: '⚙️', label: 'Settings', path: '/roofing/settings' },
  ]
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: C.surface,
      borderTop: `1px solid ${C.border}`,
      display: 'grid', gridTemplateColumns: `repeat(4, 1fr)`,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      height: '64px',
    }}>
      {tabs.map(t => {
        const active = path === t.path || (t.path === '/roofing/jobs' && path.startsWith('/roofing/jobs/'))
        return (
          <button
            key={t.path}
            onClick={() => navigate(t.path)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '8px 0', border: 'none',
              background: 'none', cursor: 'pointer',
              color: active ? C.primary : C.muted,
              position: 'relative',
            }}
          >
            {active && (
              <div style={{
                position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                width: '32px', height: '3px', borderRadius: '0 0 3px 3px',
                background: C.primary,
              }} />
            )}
            <span style={{ fontSize: '22px', lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: '10px', marginTop: '3px', fontWeight: active ? '700' : '500' }}>{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function FirstJobExperience({ contractorId, contractorClientId, contractorName }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', address: '', email: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.address.trim()) { setError('Name and address are required.'); return }
    setSaving(true)
    setError('')
    try {
      const { data: acct } = await supabase.from('contractor_accounts').select('plan, job_limit, jobs_used').eq('id', contractorId).single()
      if (acct?.plan === 'free') {
        const used = acct.jobs_used || 0
        const limit = acct.job_limit || 5
        if (used >= limit) {
          setError(`You've used all ${limit} free jobs. Upgrade to Starter ($149/mo) for unlimited jobs.`)
          setSaving(false)
          window.open(`https://roofingos.dev/upgrade?contractor_id=${contractorId}`, '_blank')
          return
        }
      }
      const { data: job, error: err } = await supabase.from('roofing_jobs').insert({
        homeowner_name: form.name.trim(), property_address: form.address.trim(),
        homeowner_email: form.email.trim() || null, homeowner_phone: form.phone.trim() || null,
        contractor_id: contractorId, client_id: contractorClientId || null, status: 'lead',
      }).select().single()
      if (err) throw err
      if (acct) await supabase.from('contractor_accounts').update({ jobs_used: (acct.jobs_used || 0) + 1 }).eq('id', contractorId)
      if (form.email || form.phone) {
        await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({ event: 'portal_link', job_id: job.id }),
        }).catch(() => {})
      }
      setCreated(job)
      setTimeout(() => navigate(`/roofing/jobs/${job.id}`), 2000)
    } catch {
      setError('Could not create job. Try again.')
      setSaving(false)
    }
  }

  const firstName = contractorName ? contractorName.split(' ')[0] : null

  if (created) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: '32px 24px', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <style>{`
          @keyframes confetti-fall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(80px) rotate(360deg);opacity:0} }
          .confetti-dot { position:absolute; width:8px; height:8px; border-radius:50%; animation:confetti-fall 1.2s ease-in forwards; }
        `}</style>
        <div style={{ position: 'relative', fontSize: '48px', marginBottom: '16px' }}>
          🎉
          {['#4a9eff','#22c55e','#f59e0b','#a78bfa','#2dd4bf'].map((c, i) => (
            <div key={i} className="confetti-dot" style={{ background: c, left: `${10 + i * 18}px`, top: '-10px', animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
        <p style={{ color: C.success, fontSize: '20px', fontWeight: '700', margin: '0 0 8px' }}>Job created!</p>
        {(form.email || form.phone) && (
          <p style={{ color: C.muted, fontSize: '14px', margin: 0 }}>Portal link sent to {form.email || form.phone}</p>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: '32px 24px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '420px' }}>
        <h2 style={{ color: C.text, fontSize: '22px', fontWeight: '700', margin: '0 0 6px' }}>
          {firstName ? `Welcome, ${firstName}! 🏠` : 'Add your first job 🏠'}
        </h2>
        <p style={{ color: C.muted, fontSize: '14px', margin: '0 0 24px', lineHeight: 1.5 }}>
          Enter a homeowner and address. They get a portal link instantly — track their job in real time.
        </p>
        <form onSubmit={handleCreate}>
          {[
            { key: 'name', label: 'Homeowner Name *', placeholder: 'Jane Smith', type: 'text' },
            { key: 'address', label: 'Property Address *', placeholder: '4821 Timberline Dr, Aurora CO', type: 'text' },
            { key: 'email', label: 'Email (portal link sent here)', placeholder: 'jane@gmail.com', type: 'email' },
            { key: 'phone', label: 'Phone (optional)', placeholder: '(720) 555-0100', type: 'tel' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>{f.label}</label>
              <input
                type={f.type} value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', fontSize: '14px', color: C.text, outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                onFocus={e => { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
                onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }}
              />
            </div>
          ))}
          {error && <p style={{ color: C.danger, fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
          <button
            type="submit" disabled={saving}
            style={{ width: '100%', background: saving ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '15px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', marginTop: '4px', transition: 'background 0.15s' }}
          >
            {saving ? 'Creating…' : 'Create Job & Open Portal →'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function RoofingDashboard() {
  const { contractorClientId, contractor } = useContractor()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState('active')
  const [viewMode, setViewMode] = useState('list')
  const [pendingMessages, setPendingMessages] = useState(0)
  const [todayJobs, setTodayJobs] = useState([])
  const [todayOpen, setTodayOpen] = useState(true)

  const load = useCallback(async () => {
    if (contractor === undefined) return
    const cid = contractor?.id
    const ccid = contractorClientId

    let query = supabase.from('roofing_jobs').select('id, homeowner_name, property_address, status, contract_amount, amount_paid, actual_start_date, created_at, insurance_claim, portal_token, portal_sent, contractor_id, client_id, lead_score, supplement_status_flag, payment_dot, weather_warning, review_requested, job_type, measurements_ordered').order('created_at', { ascending: false })
    if (cid) query = query.eq('contractor_id', cid)
    else if (ccid) query = query.eq('client_id', ccid)

    const { data } = await query
    const list = data || []
    setJobs(list)

    const active = list.filter(j => ACTIVE_KEYS.has(j.status)).length
    const revenue = list.reduce((a, j) => a + (j.contract_amount || 0), 0)
    const collected = list.reduce((a, j) => a + (j.amount_paid || 0), 0)
    const hotLeads = list.filter(j => (j.lead_score || 0) >= 70 && ACTIVE_KEYS.has(j.status)).length
    setStats({ total: list.length, active, revenue, collected, hotLeads })
    setLoading(false)

    if (list.length > 0) {
      const ids = list.map(j => j.id)
      const [{ count }, { data: schedules }] = await Promise.all([
        supabase.from('portal_messages').select('*', { count: 'exact', head: true }).in('job_id', ids).eq('requires_response', true).neq('sender_type', 'contractor'),
        supabase.from('job_schedule').select('job_id, arrival_window_start, work_description').eq('scheduled_date', new Date().toISOString().split('T')[0]).in('job_id', ids),
      ])
      setPendingMessages(count || 0)
      if (schedules?.length) {
        const schedMap = {}
        for (const s of schedules) schedMap[s.job_id] = s
        setTodayJobs(list.filter(j => schedMap[j.id]).map(j => ({ ...j, _sched: schedMap[j.id] })))
      }
    }
  }, [contractor, contractorClientId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!loading && jobs.length === 0 && contractor && contractor.onboarding_complete === false) {
      navigate('/roofing/onboarding-setup')
    }
  }, [loading, jobs.length, contractor, navigate])

  const stageCounts = jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc }, {})
  const displayJobs = stageFilter === 'active' ? jobs.filter(j => ACTIVE_KEYS.has(j.status)) : stageFilter === 'all' ? jobs : jobs.filter(j => j.status === stageFilter)

  const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font }}>
        <div style={{ padding: '20px 20px 0', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '20px', height: '80px', animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    )
  }

  if (!loading && jobs.length === 0) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '70px' }}>
        <FirstJobExperience contractorId={contractor?.id} contractorClientId={contractorClientId} contractorName={contractor?.company_name} />
        <BottomNav />
      </div>
    )
  }

  const planStr = (contractor?.plan || '').toLowerCase()
  const isFree = !planStr || planStr === 'free'
  const hasAria = planStr.includes('aria') || planStr.includes('all') || planStr.includes('pro')
  const insuranceJobs = jobs.filter(j => j.insurance_claim).length

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '70px' }}>
      {/* Header */}
      <div style={{
        background: 'rgba(15,25,35,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: '600', color: C.primary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Roofing OS</p>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: C.text }}>{contractor?.company_name || 'Job Pipeline'}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: '20px', background: 'rgba(74,158,255,0.15)', color: C.primary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {(contractor?.plan || 'free').toUpperCase()}
          </span>
          <Link to="/roofing/jobs/new" style={{ background: C.primary, color: '#fff', textDecoration: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '14px', fontWeight: '700', flexShrink: 0 }}>
            + New Job
          </Link>
        </div>
      </div>

      {/* Pending messages banner */}
      {pendingMessages > 0 && (
        <div style={{ margin: '12px 20px', background: 'rgba(74,158,255,0.08)', border: '1px solid rgba(74,158,255,0.2)', borderRadius: '12px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: C.primary }}>💬 {pendingMessages} homeowner message{pendingMessages > 1 ? 's' : ''} need{pendingMessages === 1 ? 's' : ''} a reply</p>
          <button onClick={() => setStageFilter('active')} style={{ fontSize: '12px', color: C.primary, background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>View Active →</button>
        </div>
      )}

      {/* Upgrade nudge */}
      {isFree && jobs.length >= 4 && !hasAria && (
        <div style={{ margin: '12px 20px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '12px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: '600', color: C.success }}>You have {jobs.length} jobs — Starter ($149/mo) unlocks unlimited jobs + homeowner portal</p>
            <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>Starter: unlimited jobs, branded portal, payment tracking, insurance status for homeowners.</p>
          </div>
          <a href={`https://roofingos.dev/upgrade?contractor_id=${contractor?.id}`} target="_blank" rel="noopener" style={{ flexShrink: 0, background: C.success, color: '#fff', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: '700', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Upgrade →
          </a>
        </div>
      )}

      {!hasAria && insuranceJobs >= 2 && (
        <div style={{ margin: '12px 20px', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '12px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: '600', color: '#a78bfa' }}>You have {insuranceJobs} insurance jobs — Supplement AI finds missed line items</p>
            <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>Average recovery $4,200/job. Only $99/job.</p>
          </div>
          <a href={`https://roofingos.dev/upgrade?plan=supplement&contractor_id=${contractor?.id}`} target="_blank" rel="noopener" style={{ flexShrink: 0, background: '#7c3aed', color: '#fff', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: '700', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Add Supplement AI →
          </a>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', padding: '14px 20px 0' }}>
        <StatCard label="Active Jobs" value={stats.active} icon="🏗️" />
        <StatCard label="Hot Leads" value={stats.hotLeads || 0} accent={stats.hotLeads > 0 ? '#ef4444' : C.muted} icon="🔥" sub="score ≥ 70" />
        <StatCard label="Total Revenue" value={`$${((stats.revenue || 0) / 1000).toFixed(0)}k`} accent={C.success} icon="💰" />
        <StatCard label="Collected" value={`$${((stats.collected || 0) / 1000).toFixed(0)}k`} sub={stats.revenue > 0 ? `${Math.round((stats.collected / stats.revenue) * 100)}% of contract` : null} icon="✅" />
      </div>

      {/* Today's scheduled jobs */}
      {todayJobs.length > 0 && (
        <div style={{ margin: '14px 20px 0', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '14px', overflow: 'hidden' }}>
          <button
            onClick={() => setTodayOpen(o => !o)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <span style={{ fontSize: '12px', fontWeight: '700', color: C.success, textTransform: 'uppercase', letterSpacing: '0.06em' }}>📅 Today — {todayJobs.length} job{todayJobs.length > 1 ? 's' : ''} scheduled</span>
            <span style={{ color: C.success, fontSize: '14px' }}>{todayOpen ? '▲' : '▼'}</span>
          </button>
          {todayOpen && (
            <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {todayJobs.map(job => {
                const s = stageMeta(job.status)
                return (
                  <div
                    key={job.id}
                    onClick={() => window.location.href = `/roofing/jobs/${job.id}`}
                    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px', fontWeight: '600', fontSize: '13px', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.homeowner_name}</p>
                      <p style={{ margin: 0, fontSize: '11px', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job._sched?.arrival_window_start ? `📍 ${job._sched.arrival_window_start}` : ''} {job.property_address?.split(',')[0]}</p>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: '600', padding: '2px 8px', borderRadius: '20px', background: s.bg, color: s.fg, flexShrink: 0 }}>{s.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Filter + view toggle */}
      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <p style={{ margin: 0, fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pipeline</p>
            <div style={{ display: 'flex', gap: '4px' }}>
              {['list', 'kanban'].map(v => (
                <button key={v} onClick={() => setViewMode(v)}
                  style={{ padding: '3px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600', background: viewMode === v ? C.primary : 'rgba(255,255,255,0.06)', color: viewMode === v ? '#fff' : C.muted, transition: 'all 0.15s' }}>
                  {v === 'list' ? '☰ List' : '⊞ Board'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={() => setStageFilter('active')}
              style={{ padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: stageFilter === 'active' ? C.primary : 'rgba(255,255,255,0.06)', color: stageFilter === 'active' ? '#fff' : C.muted, transition: 'all 0.15s' }}>
              Active ({stats.active || 0})
            </button>
            {Object.entries(STAGE_META).map(([key, meta]) => {
              const count = stageCounts[key] || 0
              if (!count) return null
              return (
                <button key={key} onClick={() => setStageFilter(key)}
                  style={{ padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: stageFilter === key ? meta.bg : 'rgba(255,255,255,0.06)', color: stageFilter === key ? meta.fg : C.muted, transition: 'all 0.15s' }}>
                  {meta.label} · {count}
                </button>
              )
            })}
            <button onClick={() => setStageFilter('all')}
              style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '500', background: stageFilter === 'all' ? 'rgba(255,255,255,0.06)' : 'none', color: C.muted, transition: 'all 0.15s' }}>
              All {jobs.length}
            </button>
          </div>
        </div>
      </div>

      {/* Job list / kanban */}
      <div style={{ padding: '12px 20px 0' }}>
        {viewMode === 'kanban' ? (
          <KanbanView jobs={displayJobs} />
        ) : displayJobs.length === 0 ? (
          <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: '12px', padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ color: C.muted, margin: '0 0 4px', fontWeight: '600' }}>No jobs here</p>
            <p style={{ color: 'rgba(136,150,168,0.6)', fontSize: '13px', margin: 0 }}>
              {stageFilter === 'active' ? 'No active jobs right now.' : `No "${stageFilter.replace(/_/g,' ')}" jobs.`}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {displayJobs.map(job => <JobCard key={job.id} job={job} />)}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}

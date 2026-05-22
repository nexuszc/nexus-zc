import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'
import { useContractor } from '../../context/ContractorContext'

const C = {
  bg: '#f9fafb', card: '#ffffff', text: '#0f1923', muted: '#6b7280',
  subtle: '#f3f4f6', border: '#e5e7eb', primary: '#4a9eff',
  primaryLight: '#eff6ff', success: '#22c55e', successLight: '#f0fdf4',
  warn: '#f59e0b', warnLight: '#fffbeb', error: '#ef4444',
}

const STAGE_META = {
  lead:              { label: 'Lead',        bg: '#f3f4f6', fg: '#6b7280' },
  estimate_sent:     { label: 'Estimate',    bg: '#eff6ff', fg: '#2563eb' },
  contract_signed:   { label: 'Signed',      bg: '#f5f3ff', fg: '#7c3aed' },
  materials_ordered: { label: 'Materials',   bg: '#fffbeb', fg: '#d97706' },
  scheduled:         { label: 'Scheduled',   bg: '#fff7ed', fg: '#ea580c' },
  in_progress:       { label: 'Active',      bg: '#f0fdf4', fg: '#16a34a' },
  inspection:        { label: 'Inspection',  bg: '#f0fdfa', fg: '#0d9488' },
  invoiced:          { label: 'Invoiced',    bg: '#fdf4ff', fg: '#a21caf' },
  complete:          { label: 'Complete',    bg: '#ecfdf5', fg: '#059669' },
  paid:              { label: 'Paid',        bg: '#f3f4f6', fg: '#374151' },
}

const ACTIVE_KEYS = new Set(['lead','estimate_sent','contract_signed','materials_ordered','scheduled','in_progress','inspection'])

const KANBAN_COLS = [
  { label: 'Estimating', keys: ['lead','estimate_sent'] },
  { label: 'Pre-Install', keys: ['contract_signed','materials_ordered','scheduled'] },
  { label: 'Active', keys: ['in_progress','inspection'] },
  { label: 'Done', keys: ['complete','invoiced','paid'] },
]

function stageMeta(s) {
  return STAGE_META[s] || { label: s, bg: '#f3f4f6', fg: '#6b7280' }
}

function daysAgo(dateStr) {
  if (!dateStr) return null
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  return d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px 18px' }}>
      <p style={{ fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{label}</p>
      <p style={{ fontSize: '28px', fontWeight: '800', color: accent || C.text, margin: '0', letterSpacing: '-1px', lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: '11px', color: C.muted, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  )
}

function JobCard({ job, onPortalClick }) {
  const navigate = useNavigate()
  const s = stageMeta(job.status)
  const contract = job.contract_amount || 0
  const days = daysAgo(job.actual_start_date || job.created_at)

  return (
    <div
      onClick={() => navigate(`/roofing/jobs/${job.id}`)}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px',
        padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.primary; e.currentTarget.style.boxShadow = '0 2px 12px rgba(74,158,255,0.08)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: '700', color: C.text, margin: '0 0 2px', fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.homeowner_name}</p>
          <p style={{ fontSize: '13px', color: C.muted, margin: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.property_address}</p>
          {days && <p style={{ fontSize: '11px', color: '#9ca3af', margin: '4px 0 0' }}>{days} active</p>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px', background: s.bg, color: s.fg }}>{s.label}</span>
          {contract > 0 && <p style={{ fontSize: '13px', fontWeight: '700', color: C.success, margin: 0 }}>${contract.toLocaleString()}</p>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }} onClick={e => e.stopPropagation()}>
        {[
          { icon: '📸', label: 'Photos', tab: 'photos' },
          { icon: '💬', label: 'Message', tab: 'messages' },
          { icon: '🔗', label: 'Portal', tab: 'portal' },
        ].map(({ icon, label, tab }) => (
          <button
            key={tab}
            onClick={() => navigate(`/roofing/jobs/${job.id}?tab=${tab}`)}
            style={{
              background: C.subtle, border: 'none', borderRadius: '8px',
              padding: '5px 10px', fontSize: '12px', color: C.muted,
              cursor: 'pointer', fontWeight: '500', transition: 'background 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#e5e7eb'}
            onMouseLeave={e => e.currentTarget.style.background = C.subtle}
          >
            {icon} {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function KanbanView({ jobs }) {
  const navigate = useNavigate()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
      {KANBAN_COLS.map(col => {
        const colJobs = jobs.filter(j => col.keys.includes(j.status))
        return (
          <div key={col.label}>
            <p style={{ fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              {col.label} <span style={{ color: '#9ca3af', fontWeight: '400' }}>({colJobs.length})</span>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '80px' }}>
              {colJobs.map(job => {
                const s = stageMeta(job.status)
                return (
                  <div
                    key={job.id}
                    onClick={() => navigate(`/roofing/jobs/${job.id}`)}
                    style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px',
                      padding: '10px 12px', cursor: 'pointer',
                    }}
                  >
                    <p style={{ fontSize: '13px', fontWeight: '600', color: C.text, margin: '0 0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.homeowner_name}</p>
                    <p style={{ fontSize: '11px', color: C.muted, margin: '0 0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.property_address?.split(',')[0]}</p>
                    <span style={{ fontSize: '10px', fontWeight: '600', padding: '2px 6px', borderRadius: '20px', background: s.bg, color: s.fg }}>{s.label}</span>
                    {job.contract_amount > 0 && (
                      <p style={{ fontSize: '11px', color: C.success, fontWeight: '600', margin: '4px 0 0' }}>${job.contract_amount.toLocaleString()}</p>
                    )}
                  </div>
                )
              })}
              {colJobs.length === 0 && (
                <div style={{ background: C.subtle, border: `1px dashed ${C.border}`, borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                  <p style={{ fontSize: '11px', color: '#9ca3af', margin: 0 }}>—</p>
                </div>
              )}
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
    { icon: '👥', label: 'Crew', path: '/roofing/crew' },
    { icon: '⚙️', label: 'Settings', path: '/roofing/onboarding' },
  ]
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: C.card, borderTop: `1px solid ${C.border}`,
      display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      {tabs.map(t => {
        const active = path === t.path || (t.path === '/roofing/jobs' && path.startsWith('/roofing/jobs/'))
        return (
          <button
            key={t.path}
            onClick={() => navigate(t.path)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '9px 0', border: 'none',
              background: 'none', cursor: 'pointer',
              color: active ? C.primary : '#9ca3af',
            }}
          >
            <span style={{ fontSize: '20px', lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: '10px', marginTop: '3px', fontWeight: active ? '700' : '500' }}>{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function FirstJobExperience({ contractorId, contractorClientId }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', address: '', email: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
          setError(`You've used all ${limit} free jobs. Upgrade to Pro for unlimited jobs.`)
          setSaving(false)
          window.open('https://roofingos.dev/upgrade', '_blank')
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
      navigate(`/roofing/jobs/${job.id}`)
    } catch {
      setError('Could not create job. Try again.')
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: '32px 24px', textAlign: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ fontSize: '40px', marginBottom: '16px' }}>🏠</div>
      <h2 style={{ fontSize: '22px', fontWeight: '800', color: C.text, margin: '0 0 8px', letterSpacing: '-0.5px' }}>Add your first job</h2>
      <p style={{ color: C.muted, fontSize: '14px', margin: '0 0 28px', maxWidth: '340px', lineHeight: 1.5 }}>
        Enter a homeowner and address. Their portal link generates instantly — share it and they track their job in real time.
      </p>
      <form onSubmit={handleCreate} style={{ width: '100%', maxWidth: '380px', textAlign: 'left' }}>
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
              style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '11px 13px', fontSize: '14px', color: C.text, outline: 'none' }}
            />
          </div>
        ))}
        {error && <p style={{ color: C.error, fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
        <button
          type="submit" disabled={saving}
          style={{ width: '100%', background: saving ? '#93c5fd' : C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '15px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', marginTop: '4px' }}
        >
          {saving ? 'Creating…' : 'Create Job & Open Portal →'}
        </button>
      </form>
    </div>
  )
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export default function RoofingDashboard() {
  const { contractorClientId, contractor } = useContractor()
  const [jobs, setJobs] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState('active')
  const [viewMode, setViewMode] = useState('list')
  const [pendingMessages, setPendingMessages] = useState(0)

  const load = useCallback(async () => {
    if (contractor === undefined) return
    const cid = contractor?.id
    const ccid = contractorClientId

    let query = supabase.from('roofing_jobs').select('id, homeowner_name, property_address, status, contract_amount, amount_paid, actual_start_date, created_at, insurance_claim, portal_token, contractor_id, client_id').order('created_at', { ascending: false })
    if (cid) query = query.eq('contractor_id', cid)
    else if (ccid) query = query.eq('client_id', ccid)

    const { data } = await query
    const list = data || []
    setJobs(list)

    const active = list.filter(j => ACTIVE_KEYS.has(j.status)).length
    const revenue = list.reduce((a, j) => a + (j.contract_amount || 0), 0)
    const collected = list.reduce((a, j) => a + (j.amount_paid || 0), 0)
    setStats({ total: list.length, active, revenue, collected })
    setLoading(false)

    if (list.length > 0) {
      const ids = list.map(j => j.id)
      const { count } = await supabase.from('portal_messages').select('*', { count: 'exact', head: true }).in('job_id', ids).eq('requires_response', true).neq('sender_type', 'contractor')
      setPendingMessages(count || 0)
    }
  }, [contractor, contractorClientId])

  useEffect(() => { load() }, [load])

  const stageCounts = jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc }, {})
  const displayJobs = stageFilter === 'active' ? jobs.filter(j => ACTIVE_KEYS.has(j.status)) : stageFilter === 'all' ? jobs : jobs.filter(j => j.status === stageFilter)

  const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font }}>
        <div style={{ padding: '20px 20px 0', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px 18px', height: '72px', animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      </div>
    )
  }

  if (!loading && jobs.length === 0) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '70px' }}>
        <FirstJobExperience contractorId={contractor?.id} contractorClientId={contractorClientId} />
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
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <div>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Roofing OS</p>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '800', color: C.text, letterSpacing: '-0.3px' }}>{contractor?.company_name || 'Job Pipeline'}</h1>
        </div>
        <Link to="/roofing/jobs/new" style={{ background: C.primary, color: '#fff', textDecoration: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '14px', fontWeight: '700', flexShrink: 0 }}>
          + New Job
        </Link>
      </div>

      {/* Pending messages banner */}
      {pendingMessages > 0 && (
        <div style={{ margin: '12px 20px', background: C.primaryLight, border: `1px solid ${C.primary}33`, borderRadius: '12px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#1d4ed8' }}>💬 {pendingMessages} homeowner message{pendingMessages > 1 ? 's' : ''} need{pendingMessages === 1 ? 's' : ''} a reply</p>
          <button onClick={() => setStageFilter('active')} style={{ fontSize: '12px', color: C.primary, background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>View Active →</button>
        </div>
      )}

      {/* Upgrade nudge */}
      {isFree && jobs.length >= 4 && !hasAria && (
        <div style={{ margin: '12px 20px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: '600', color: '#166534' }}>You have {jobs.length} jobs — unlock Pro for unlimited + homeowner portal</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#4ade80' }}>Portal Pro: branded portal, payment tracking, insurance status for homeowners.</p>
          </div>
          <a href="https://roofingos.dev/upgrade" target="_blank" rel="noopener" style={{ flexShrink: 0, background: C.success, color: '#fff', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: '700', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Upgrade →
          </a>
        </div>
      )}

      {!hasAria && insuranceJobs >= 2 && (
        <div style={{ margin: '12px 20px', background: '#faf5ff', border: '1px solid #d8b4fe', borderRadius: '12px', padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: '600', color: '#6b21a8' }}>You have {insuranceJobs} insurance jobs — Supplement AI finds missed line items</p>
            <p style={{ margin: 0, fontSize: '12px', color: '#a855f7' }}>Average recovery $4,200/job. Only $99/job.</p>
          </div>
          <a href="https://roofingos.dev/upgrade?plan=supplement" target="_blank" rel="noopener" style={{ flexShrink: 0, background: '#9333ea', color: '#fff', borderRadius: '8px', padding: '7px 14px', fontSize: '12px', fontWeight: '700', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Add Supplement AI →
          </a>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', padding: '14px 20px 0' }}>
        <StatCard label="Active Jobs" value={stats.active} />
        <StatCard label="Total Revenue" value={`$${((stats.revenue || 0) / 1000).toFixed(0)}k`} accent={C.success} />
        <StatCard label="Collected" value={`$${((stats.collected || 0) / 1000).toFixed(0)}k`} sub={stats.revenue > 0 ? `${Math.round((stats.collected / stats.revenue) * 100)}% of contract` : null} />
        <StatCard label="Pending Msgs" value={pendingMessages} accent={pendingMessages > 0 ? C.warn : C.muted} />
      </div>

      {/* Filter + view toggle */}
      <div style={{ padding: '14px 20px 0' }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <p style={{ margin: 0, fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pipeline</p>
            <div style={{ display: 'flex', gap: '4px' }}>
              {['list', 'kanban'].map(v => (
                <button key={v} onClick={() => setViewMode(v)}
                  style={{ padding: '3px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: '600', background: viewMode === v ? C.primary : C.subtle, color: viewMode === v ? '#fff' : C.muted }}>
                  {v === 'list' ? '☰ List' : '⊞ Board'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={() => setStageFilter('active')}
              style={{ padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: stageFilter === 'active' ? C.primary : C.subtle, color: stageFilter === 'active' ? '#fff' : C.muted }}>
              Active ({stats.active || 0})
            </button>
            {Object.entries(STAGE_META).map(([key, meta]) => {
              const count = stageCounts[key] || 0
              if (!count) return null
              return (
                <button key={key} onClick={() => setStageFilter(key)}
                  style={{ padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: stageFilter === key ? meta.bg : C.subtle, color: stageFilter === key ? meta.fg : C.muted }}>
                  {meta.label} · {count}
                </button>
              )
            })}
            <button onClick={() => setStageFilter('all')}
              style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '500', background: stageFilter === 'all' ? C.subtle : 'none', color: C.muted }}>
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
          <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: '12px', padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ color: C.muted, margin: '0 0 4px', fontWeight: '600' }}>No jobs here</p>
            <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>
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

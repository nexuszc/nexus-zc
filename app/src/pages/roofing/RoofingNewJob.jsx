import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useContractor } from '../../context/ContractorContext'

const C = {
  bg: '#0f1923', surface: '#1a2535', surface2: '#243044',
  text: '#ffffff', muted: '#8896a8',
  border: 'rgba(255,255,255,0.08)',
  primary: '#4a9eff', success: '#22c55e', danger: '#ef4444',
}
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

const JOB_TYPES = [
  { value: 'insurance_claim', icon: '🏠', label: 'Insurance' },
  { value: 'retail',          icon: '💰', label: 'Retail' },
  { value: 'repair',          icon: '🔧', label: 'Repair' },
]

function FInput({ type = 'text', value, onChange, placeholder }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        width: '100%', boxSizing: 'border-box',
        background: C.surface2,
        border: `1px solid ${focused ? C.primary : C.border}`,
        borderRadius: '12px',
        padding: '14px', fontSize: '15px', color: C.text, outline: 'none',
        boxShadow: focused ? '0 0 0 3px rgba(74,158,255,0.15)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    />
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{label}</label>
      {children}
    </div>
  )
}

function SuccessModal({ job, phone, onClose, onOpen }) {
  const portalUrl = `https://roofingos.dev/portal/${job.portal_token}`
  const firstName = (job.homeowner_name || '').split(' ')[0]
  const smsBody = `Hi ${firstName}! Track your roof job progress here: ${portalUrl}`

  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(portalUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div style={{ background: C.surface, border: `1px solid rgba(34,197,94,0.25)`, borderRadius: '24px', padding: '32px 24px', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <div style={{ fontSize: '52px', marginBottom: '12px' }}>🎉</div>
        <p style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: '800', color: C.text }}>Job Created!</p>
        <p style={{ margin: '0 0 24px', fontSize: '14px', color: C.muted }}>Share the portal link with your homeowner</p>

        {/* Portal URL */}
        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '13px', color: C.text, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            roofingos.dev/portal/{job.portal_token?.slice(0, 12)}…
          </span>
          <button onClick={copy} style={{ flexShrink: 0, background: copied ? C.success : C.primary, color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', transition: 'background 0.2s' }}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {phone && (
            <a
              href={`sms:${phone}?body=${encodeURIComponent(smsBody)}`}
              style={{ display: 'block', background: C.success, color: '#fff', textDecoration: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '700' }}
            >
              📱 Text Portal Link
            </a>
          )}
          <a
            href={portalUrl} target="_blank" rel="noopener"
            style={{ display: 'block', background: 'rgba(255,255,255,0.06)', color: C.text, textDecoration: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', border: `1px solid ${C.border}` }}
          >
            Open Portal →
          </a>
        </div>

        <button onClick={onOpen} style={{ width: '100%', background: 'none', border: 'none', color: C.muted, fontSize: '14px', cursor: 'pointer', fontWeight: '500' }}>
          Go to job detail →
        </button>
      </div>
    </div>
  )
}

export default function RoofingNewJob() {
  const navigate = useNavigate()
  const { contractorClientId, contractor } = useContractor()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdJob, setCreatedJob] = useState(null)

  const [form, setForm] = useState({
    homeowner_name: '',
    homeowner_phone: '',
    property_address: '',
    job_type: 'insurance_claim',
  })

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }))

  const createJob = async () => {
    if (!form.homeowner_name.trim()) { setError('Homeowner name is required.'); return }
    if (!form.property_address.trim()) { setError('Property address is required.'); return }

    setSaving(true)
    setError('')
    try {
      const { data: job, error: err } = await supabase.from('roofing_jobs').insert({
        homeowner_name: form.homeowner_name.trim(),
        homeowner_phone: form.homeowner_phone.trim() || null,
        property_address: form.property_address.trim(),
        job_type: form.job_type,
        insurance_claim: form.job_type === 'insurance_claim',
        contractor_id: contractor?.id || null,
        client_id: contractorClientId || null,
        status: 'lead',
      }).select().single()

      if (err) throw err

      if (form.homeowner_phone.trim()) {
        fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({ event: 'portal_link', job_id: job.id }),
        }).catch(() => {})
      }

      setCreatedJob(job)
    } catch {
      setError('Could not create job. Try again.')
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font }}>
      {/* Header */}
      <div style={{
        background: 'rgba(15,25,35,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: '12px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <button
          onClick={() => navigate('/roofing/jobs')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: C.muted, padding: 0 }}
        >←</button>
        <h1 style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: C.text }}>New Job</h1>
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '24px 20px 100px' }}>

        <Field label="Homeowner Name *">
          <FInput value={form.homeowner_name} onChange={e => set('homeowner_name', e.target.value)} placeholder="Jane Smith" />
        </Field>

        <Field label="Phone">
          <FInput type="tel" value={form.homeowner_phone} onChange={e => set('homeowner_phone', e.target.value)} placeholder="(720) 555-0100" />
        </Field>

        <Field label="Property Address *">
          <FInput value={form.property_address} onChange={e => set('property_address', e.target.value)} placeholder="4821 Timberline Dr, Aurora CO 80016" />
        </Field>

        <Field label="Job Type">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {JOB_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => set('job_type', t.value)}
                style={{
                  flex: '1 1 auto', minWidth: '80px',
                  padding: '10px 8px',
                  borderRadius: '12px',
                  border: `2px solid ${form.job_type === t.value ? C.primary : C.border}`,
                  background: form.job_type === t.value ? 'rgba(74,158,255,0.12)' : C.surface2,
                  color: form.job_type === t.value ? C.primary : C.muted,
                  fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                  transition: 'all 0.15s',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                }}
              >
                <span style={{ fontSize: '20px' }}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </Field>

        {error && <p style={{ color: C.danger, fontSize: '13px', margin: '0 0 16px' }}>{error}</p>}

        <button
          onClick={createJob} disabled={saving}
          style={{
            width: '100%', background: saving ? 'rgba(74,158,255,0.4)' : C.primary,
            color: '#fff', border: 'none', borderRadius: '14px',
            padding: '16px', fontSize: '17px', fontWeight: '700',
            cursor: saving ? 'default' : 'pointer',
            marginTop: '8px', transition: 'filter 0.15s',
          }}
          onMouseEnter={e => !saving && (e.currentTarget.style.filter = 'brightness(1.1)')}
          onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
        >
          {saving ? 'Creating…' : 'Create Job →'}
        </button>
      </div>

      {createdJob && (
        <SuccessModal
          job={createdJob}
          phone={form.homeowner_phone.trim()}
          onClose={() => navigate('/roofing/jobs')}
          onOpen={() => navigate(`/roofing/jobs/${createdJob.id}`)}
        />
      )}
    </div>
  )
}

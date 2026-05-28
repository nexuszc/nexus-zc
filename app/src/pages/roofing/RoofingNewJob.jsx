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

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: hint ? '2px' : '6px' }}>{label}</label>
      {hint && <p style={{ margin: '0 0 6px', fontSize: '11px', color: C.muted }}>{hint}</p>}
      {children}
    </div>
  )
}

function Input({ type = 'text', value, onChange, placeholder, required }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder} required={required}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={{
        width: '100%', boxSizing: 'border-box',
        background: C.surface2,
        border: `1px solid ${focused ? C.primary : C.border}`,
        borderRadius: '10px',
        padding: '12px 14px', fontSize: '15px', color: C.text, outline: 'none',
        boxShadow: focused ? '0 0 0 3px rgba(74,158,255,0.15)' : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    />
  )
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={onChange} style={{
      width: '100%', background: C.surface2, border: `1px solid ${C.border}`,
      borderRadius: '10px', padding: '12px 14px', fontSize: '15px', color: C.text,
      outline: 'none', appearance: 'none',
    }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export default function RoofingNewJob() {
  const navigate = useNavigate()
  const { contractorClientId, contractor } = useContractor()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    homeowner_name: '', homeowner_email: '', homeowner_phone: '',
    property_address: '', job_type: 'full_replacement',
    material_type: 'asphalt_shingle', shingle_brand: '', shingle_color: '',
    insurance_claim: false, claim_number: '',
    estimated_start_date: '', notes: '',
  })

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }))

  const goNext = () => {
    if (step === 1) {
      if (!form.homeowner_name.trim()) { setError('Name is required.'); return }
      setError('')
      setStep(2)
    } else if (step === 2) {
      if (!form.property_address.trim()) { setError('Address is required.'); return }
      setError('')
      setStep(3)
    }
  }

  const createJob = async (sendPortal = true) => {
    setSaving(true)
    setError('')
    try {
      const { data: job, error: err } = await supabase.from('roofing_jobs').insert({
        homeowner_name: form.homeowner_name.trim(),
        homeowner_email: form.homeowner_email.trim() || null,
        homeowner_phone: form.homeowner_phone.trim() || null,
        property_address: form.property_address.trim(),
        job_type: form.job_type,
        material_type: form.material_type,
        shingle_brand: form.shingle_brand || null,
        shingle_color: form.shingle_color || null,
        insurance_claim: form.insurance_claim,
        claim_number: form.claim_number || null,
        estimated_start_date: form.estimated_start_date || null,
        notes: form.notes || null,
        contractor_id: contractor?.id || null,
        client_id: contractorClientId || null,
        status: 'lead',
      }).select().single()

      if (err) throw err

      if (sendPortal && (form.homeowner_email || form.homeowner_phone)) {
        await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({ event: 'portal_link', job_id: job.id }),
        }).catch(() => {})
      }

      navigate(`/roofing/jobs/${job.id}`)
    } catch {
      setError('Could not create job. Try again.')
      setSaving(false)
    }
  }

  const steps = [
    { num: 1, label: 'Homeowner' },
    { num: 2, label: 'Job Info' },
    { num: 3, label: 'Send Portal' },
  ]

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
          onClick={() => step > 1 ? setStep(s => s - 1) : navigate('/roofing/jobs')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: C.muted, padding: 0 }}
        >←</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: C.text }}>New Job</h1>
          <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>Step {step} of 3 — {steps[step - 1].label}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ height: '100%', background: C.primary, width: `${(step / 3) * 100}%`, transition: 'width 0.3s' }} />
      </div>

      {/* Step indicators */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', padding: '18px 0 8px' }}>
        {steps.map(s => (
          <div key={s.num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
            <div style={{
              width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: s.num < step ? C.success : s.num === step ? C.primary : 'rgba(255,255,255,0.12)',
              color: s.num <= step ? '#fff' : C.muted, fontSize: '12px', fontWeight: '700', transition: 'background 0.2s',
            }}>
              {s.num < step ? '✓' : s.num}
            </div>
            <span style={{ fontSize: '10px', fontWeight: '600', color: s.num === step ? C.text : C.muted }}>{s.label}</span>
          </div>
        ))}
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '16px 20px 100px' }}>

        {/* STEP 1 — Homeowner */}
        {step === 1 && (
          <div>
            <Field label="Full Name *">
              <Input value={form.homeowner_name} onChange={e => set('homeowner_name', e.target.value)} placeholder="Jane Smith" required />
            </Field>
            <Field label="Email" hint="Portal link will be sent here">
              <Input type="email" value={form.homeowner_email} onChange={e => set('homeowner_email', e.target.value)} placeholder="jane@gmail.com" />
            </Field>
            <Field label="Phone" hint="SMS updates sent here">
              <Input type="tel" value={form.homeowner_phone} onChange={e => set('homeowner_phone', e.target.value)} placeholder="(720) 555-0100" />
            </Field>
          </div>
        )}

        {/* STEP 2 — Job Info */}
        {step === 2 && (
          <div>
            <Field label="Property Address *">
              <Input value={form.property_address} onChange={e => set('property_address', e.target.value)} placeholder="4821 Timberline Dr, Aurora CO 80016" required />
            </Field>
            <Field label="Job Type">
              <Select value={form.job_type} onChange={e => set('job_type', e.target.value)} options={[
                { value: 'full_replacement', label: 'Full Replacement' },
                { value: 'repair', label: 'Repair' },
                { value: 'inspection', label: 'Inspection' },
                { value: 'insurance_claim', label: 'Insurance Claim' },
              ]} />
            </Field>
            <Field label="Material">
              <Select value={form.material_type} onChange={e => set('material_type', e.target.value)} options={[
                { value: 'asphalt_shingle', label: 'Asphalt Shingle' },
                { value: 'metal', label: 'Metal' },
                { value: 'tile', label: 'Tile' },
                { value: 'flat', label: 'Flat / TPO' },
                { value: 'other', label: 'Other' },
              ]} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <Field label="Brand (e.g. GAF)">
                <Input value={form.shingle_brand} onChange={e => set('shingle_brand', e.target.value)} placeholder="GAF" />
              </Field>
              <Field label="Color">
                <Input value={form.shingle_color} onChange={e => set('shingle_color', e.target.value)} placeholder="Charcoal" />
              </Field>
            </div>
            <Field label="Estimated Start Date">
              <Input type="date" value={form.estimated_start_date} onChange={e => set('estimated_start_date', e.target.value)} />
            </Field>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.insurance_claim} onChange={e => set('insurance_claim', e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: C.primary }} />
                <div>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: C.text }}>Insurance claim job</p>
                  <p style={{ margin: 0, fontSize: '11px', color: C.muted }}>Enables supplement AI and claim tracking</p>
                </div>
              </label>
            </div>
            {form.insurance_claim && (
              <Field label="Claim Number">
                <Input value={form.claim_number} onChange={e => set('claim_number', e.target.value)} placeholder="HC-2026-12345" />
              </Field>
            )}
          </div>
        )}

        {/* STEP 3 — Send Portal */}
        {step === 3 && (
          <div>
            {/* Summary card */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '18px', marginBottom: '16px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job Summary</p>
              <p style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: '700', color: C.text }}>{form.homeowner_name}</p>
              <p style={{ margin: '0 0 8px', fontSize: '13px', color: C.muted }}>{form.property_address}</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: '600', background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: '6px', color: C.muted }}>{form.job_type.replace(/_/g,' ')}</span>
                <span style={{ fontSize: '11px', fontWeight: '600', background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: '6px', color: C.muted }}>{form.material_type.replace(/_/g,' ')}</span>
                {form.insurance_claim && <span style={{ fontSize: '11px', fontWeight: '600', background: 'rgba(124,58,237,0.15)', padding: '3px 8px', borderRadius: '6px', color: '#a78bfa' }}>Insurance Claim</span>}
              </div>
            </div>

            {/* Portal message preview */}
            {(form.homeowner_email || form.homeowner_phone) ? (
              <div style={{ background: 'rgba(74,158,255,0.08)', border: '1px solid rgba(74,158,255,0.2)', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
                <p style={{ margin: '0 0 8px', fontSize: '11px', fontWeight: '700', color: C.primary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Portal Message Preview</p>
                <div style={{ background: C.surface2, borderRadius: '10px', padding: '12px', fontSize: '13px', color: C.text, lineHeight: 1.5, border: `1px solid ${C.border}` }}>
                  Hi {form.homeowner_name.split(' ')[0]}! Your roof job is set up and you can track progress here: roofingos.dev/portal/... — Your contractor
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '11px', color: C.muted }}>
                  Sent to: {[form.homeowner_email, form.homeowner_phone].filter(Boolean).join(', ')}
                </p>
              </div>
            ) : (
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '12px', padding: '12px 14px', marginBottom: '16px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#f59e0b' }}>⚠️ No email or phone — portal link won't be auto-sent. You can copy and share it from the job detail.</p>
              </div>
            )}
          </div>
        )}

        {error && <p style={{ color: C.danger, fontSize: '13px', margin: '0 0 12px', textAlign: 'center' }}>{error}</p>}

        {/* Action buttons */}
        {step < 3 ? (
          <button onClick={goNext}
            style={{ width: '100%', background: C.primary, color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '16px', fontWeight: '700', cursor: 'pointer', marginTop: '8px', transition: 'filter 0.15s, transform 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
            onMouseLeave={e => e.currentTarget.style.filter = 'none'}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
            onMouseUp={e => e.currentTarget.style.transform = 'none'}
          >
            Continue →
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button onClick={() => createJob(true)} disabled={saving}
              style={{ width: '100%', background: saving ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '16px', fontWeight: '700', cursor: saving ? 'default' : 'pointer', transition: 'filter 0.15s' }}
              onMouseEnter={e => !saving && (e.currentTarget.style.filter = 'brightness(1.1)')}
              onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
            >
              {saving ? 'Creating…' : '🚀 Create Job & Send Portal'}
            </button>
            <button onClick={() => createJob(false)} disabled={saving}
              style={{ width: '100%', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: saving ? 'default' : 'pointer' }}>
              Create Job Only (send portal later)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

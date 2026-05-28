import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY    = import.meta.env.VITE_SUPABASE_ANON_KEY

const C = {
  bg: '#0f1923', surface: '#1a2535', surface2: '#243044',
  text: '#fff', muted: '#8896a8', border: 'rgba(255,255,255,0.08)',
  primary: '#4a9eff', success: '#22c55e', danger: '#ef4444',
}
const F = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

const JOB_TYPES = [
  { value: 'storm_damage',    icon: '⛈', label: 'Storm' },
  { value: 'insurance_claim', icon: '🏠', label: 'Insurance' },
  { value: 'retail',          icon: '💰', label: 'Retail' },
]

function inp(focused) {
  return {
    width: '100%', boxSizing: 'border-box', background: C.surface2,
    border: `1px solid ${focused ? C.primary : C.border}`, borderRadius: '12px',
    padding: '14px', fontSize: '15px', color: C.text, outline: 'none',
    boxShadow: focused ? '0 0 0 3px rgba(74,158,255,0.15)' : 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  }
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{label}</label>
      {children}
    </div>
  )
}

function FInput({ value, onChange, placeholder, type = 'text' }) {
  const [f, setF] = useState(false)
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={inp(f)}
      onFocus={() => setF(true)} onBlur={() => setF(false)} />
  )
}

function Btn({ onClick, disabled, children, variant = 'primary' }) {
  const bg = variant === 'primary'
    ? (disabled ? 'rgba(74,158,255,0.35)' : C.primary)
    : (disabled ? 'rgba(255,255,255,0.04)' : C.surface)
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: '100%', background: bg, color: variant === 'primary' ? '#fff' : C.muted, border: variant === 'primary' ? 'none' : `1px solid ${C.border}`, borderRadius: '14px', padding: '16px', fontSize: '17px', fontWeight: '700', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none' }}>
      {children}
    </button>
  )
}

export default function RoofingOnboarding() {
  const navigate   = useNavigate()
  const { contractor } = useContractor()
  const [step, setStep]   = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [portalToken, setPortalToken] = useState(null)
  const [copied, setCopied] = useState(false)

  const [profile, setProfile] = useState({ company_name: '', owner_name: '', owner_phone: '', market_city: '' })
  const [job, setJob]         = useState({ homeowner_name: '', homeowner_phone: '', property_address: '', job_type: 'insurance_claim' })

  useEffect(() => {
    if (contractor) setProfile(p => ({ ...p, company_name: contractor.company_name || '', owner_name: contractor.owner_name || '' }))
  }, [contractor])

  const setP = (k, v) => setProfile(p => ({ ...p, [k]: v }))
  const setJ = (k, v) => setJob(p => ({ ...p, [k]: v }))

  // ─── Step 1 ──────────────────────────────────────────────────────────────
  const handleStep1 = async () => {
    if (!profile.company_name.trim()) { setError('Company name is required'); return }
    setSaving(true)
    if (contractor?.id) {
      await supabase.from('contractor_accounts').update({
        company_name: profile.company_name.trim(),
        owner_name:   profile.owner_name.trim() || null,
        owner_phone:  profile.owner_phone.trim() || null,
        market_city:  profile.market_city.trim() || null,
      }).eq('id', contractor.id)
    }
    setSaving(false); setError(''); setStep(2)
  }

  // ─── Step 2 ──────────────────────────────────────────────────────────────
  const handleStep2 = async () => {
    if (!job.homeowner_name.trim() || !job.property_address.trim()) { setError('Name and address are required'); return }
    setSaving(true); setError('')
    try {
      const { data: newJob, error: err } = await supabase.from('roofing_jobs').insert({
        homeowner_name:   job.homeowner_name.trim(),
        homeowner_phone:  job.homeowner_phone.trim() || null,
        property_address: job.property_address.trim(),
        job_type:         job.job_type,
        insurance_claim:  job.job_type === 'insurance_claim',
        contractor_id:    contractor?.id || null,
        status: 'lead',
      }).select().single()
      if (err) throw err

      if (job.homeowner_phone) {
        await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({ event: 'portal_link', job_id: newJob.id }),
        }).catch(() => {})
        await new Promise(r => setTimeout(r, 1800))
      }

      const { data: session } = await supabase
        .from('homeowner_sessions').select('magic_link_token')
        .eq('job_id', newJob.id).maybeSingle()
      setPortalToken(session?.magic_link_token || null)
      setStep(3)
    } catch { setError('Could not create job. Try again.') }
    setSaving(false)
  }

  // ─── Step 3 ──────────────────────────────────────────────────────────────
  const finish = async () => {
    if (contractor?.id) await supabase.from('contractor_accounts').update({ onboarding_complete: true }).eq('id', contractor.id)
    navigate('/roofing/jobs')
  }

  const portalUrl   = portalToken ? `https://roofingos.dev/portal/${portalToken}` : null
  const firstName   = job.homeowner_name.split(' ')[0] || 'your homeowner'
  const companyName = profile.company_name || contractor?.company_name || 'Roofing OS'
  const smsBody     = portalUrl
    ? `Hi ${firstName}! ${companyName} is keeping you updated on your roof project in real time. View your portal:\n${portalUrl}`
    : ''

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...F, paddingBottom: '40px' }}>
      <style>{`@keyframes pop{0%{transform:scale(0.6);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}`}</style>

      {/* Progress bar */}
      <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ height: '100%', background: C.primary, width: `${(step / 3) * 100}%`, transition: 'width 0.4s ease' }} />
      </div>

      {/* Top nav */}
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {step === 2 && (
          <button onClick={() => { setStep(1); setError('') }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: '22px', padding: '4px 8px 4px 0', lineHeight: 1 }}>←</button>
        )}
        <div>
          <p style={{ margin: 0, fontSize: '12px', fontWeight: '700', color: C.primary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Step {step} of 3</p>
          <p style={{ margin: 0, fontSize: '11px', color: C.muted }}>
            {step === 1 ? 'Profile setup' : step === 2 ? 'First homeowner' : 'Share portal'}
          </p>
        </div>
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '24px 20px 0' }}>

        {/* ── STEP 1 ──────────────────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: '26px', fontWeight: '800', color: C.text }}>Set up your profile</h2>
            <p style={{ margin: '0 0 24px', fontSize: '15px', color: C.muted, lineHeight: 1.6 }}>This is what homeowners see in their portal.</p>

            <Field label="Company Name *"><FInput value={profile.company_name} onChange={e => setP('company_name', e.target.value)} placeholder="Smith Roofing LLC" /></Field>
            <Field label="Your Name"><FInput value={profile.owner_name} onChange={e => setP('owner_name', e.target.value)} placeholder="John Smith" /></Field>
            <Field label="Your Phone"><FInput type="tel" value={profile.owner_phone} onChange={e => setP('owner_phone', e.target.value)} placeholder="(720) 555-1234" /></Field>
            <Field label="Service Area"><FInput value={profile.market_city} onChange={e => setP('market_city', e.target.value)} placeholder="Denver, CO" /></Field>

            {/* Live portal preview */}
            <div style={{ margin: '0 0 24px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', overflow: 'hidden' }}>
              <div style={{ background: '#0a0f1a', padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg,#4a9eff,#22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🏠</div>
                <div>
                  <p style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: C.text }}>{profile.company_name || 'Your Company Name'}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>{profile.owner_phone || '(720) 555-XXXX'}</p>
                </div>
              </div>
              <p style={{ margin: 0, padding: '10px 16px', fontSize: '11px', color: C.muted, textAlign: 'center' }}>This is what your homeowners see ↑</p>
            </div>

            {error && <p style={{ color: C.danger, fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
            <Btn onClick={handleStep1} disabled={saving}>{saving ? 'Saving…' : 'Continue →'}</Btn>
          </>
        )}

        {/* ── STEP 2 ──────────────────────────────────────────────────────── */}
        {step === 2 && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: '26px', fontWeight: '800', color: C.text }}>Add your first homeowner</h2>
            <p style={{ margin: '0 0 24px', fontSize: '15px', color: C.muted, lineHeight: 1.6 }}>We'll create their portal instantly.</p>

            <Field label="Homeowner Name *"><FInput value={job.homeowner_name} onChange={e => setJ('homeowner_name', e.target.value)} placeholder="Sarah Johnson" /></Field>
            <Field label="Their Phone (for SMS portal link)"><FInput type="tel" value={job.homeowner_phone} onChange={e => setJ('homeowner_phone', e.target.value)} placeholder="(303) 555-0142" /></Field>
            <Field label="Property Address *"><FInput value={job.property_address} onChange={e => setJ('property_address', e.target.value)} placeholder="123 Main St, Denver CO 80203" /></Field>

            <Field label="Job Type *">
              <div style={{ display: 'flex', gap: '10px' }}>
                {JOB_TYPES.map(t => {
                  const active = job.job_type === t.value
                  return (
                    <button key={t.value} onClick={() => setJ('job_type', t.value)}
                      style={{ flex: 1, padding: '14px 8px', borderRadius: '12px', border: `2px solid ${active ? C.primary : C.border}`, background: active ? 'rgba(74,158,255,0.12)' : C.surface2, cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s' }}>
                      <div style={{ fontSize: '22px', marginBottom: '4px' }}>{t.icon}</div>
                      <div style={{ fontSize: '12px', fontWeight: '700', color: active ? C.primary : C.muted }}>{t.label}</div>
                    </button>
                  )
                })}
              </div>
            </Field>

            {error && <p style={{ color: C.danger, fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}
            <Btn onClick={handleStep2} disabled={saving}>{saving ? 'Creating portal…' : 'Create portal →'}</Btn>
          </>
        )}

        {/* ── STEP 3 ──────────────────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <div style={{ fontSize: '64px', marginBottom: '12px', animation: 'pop 0.4s ease' }}>✅</div>
              <h2 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: '800', color: C.text }}>Your portal is live!</h2>
              <p style={{ margin: 0, fontSize: '15px', color: C.muted }}>Send this link to {firstName} right now.</p>
            </div>

            {portalUrl ? (
              <div style={{ background: C.surface, border: '1px solid rgba(74,158,255,0.25)', borderRadius: '16px', padding: '16px', marginBottom: '20px' }}>
                <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: '700', color: C.primary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Portal URL</p>
                <p style={{ margin: 0, fontSize: '14px', color: C.text, fontWeight: '600', wordBreak: 'break-all', lineHeight: 1.5 }}>{portalUrl}</p>
              </div>
            ) : (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px', marginBottom: '20px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: C.muted }}>Portal created. Open the job from your dashboard to get the share link.</p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
              {portalUrl && (
                <button onClick={() => { navigator.clipboard.writeText(portalUrl).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  style={{ padding: '15px', borderRadius: '12px', border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  {copied ? '✓ Copied!' : '📋 Copy link'}
                </button>
              )}
              {smsBody && (
                <a href={`sms:${job.homeowner_phone}?body=${encodeURIComponent(smsBody)}`}
                  style={{ padding: '15px', borderRadius: '12px', border: `1px solid ${C.border}`, background: C.primary, color: '#fff', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none' }}>
                  💬 Text to {firstName}
                </a>
              )}
              {portalUrl && (
                <a href={portalUrl} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '15px', borderRadius: '12px', border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none' }}>
                  👁 Open portal
                </a>
              )}
            </div>

            <p style={{ margin: '0 0 24px', fontSize: '13px', color: C.muted, lineHeight: 1.6, textAlign: 'center' }}>
              Your homeowner will see real-time photos, progress updates, and messages the moment you send this.
            </p>

            <Btn onClick={finish}>Go to my dashboard →</Btn>
          </>
        )}
      </div>
    </div>
  )
}

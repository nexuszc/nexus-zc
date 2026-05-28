import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const C = {
  bg: '#0f1923', surface: '#1a2535', surface2: '#243044',
  text: '#ffffff', muted: '#8896a8',
  border: 'rgba(255,255,255,0.08)',
  primary: '#4a9eff', success: '#22c55e',
}
const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

const STEPS = [
  { num: 1, label: 'Your Market', icon: '📍' },
  { num: 2, label: 'Reviews',     icon: '⭐' },
  { num: 3, label: 'All Set!',    icon: '🚀' },
]

export default function RoofingOnboardingSetup() {
  const navigate = useNavigate()
  const { contractor } = useContractor()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    owner_phone: '',
    market_city: '',
    market_state: 'CO',
    google_review_link: '',
  })

  const save = async (fields) => {
    if (!contractor?.id) return
    setSaving(true)
    await supabase
      .from('contractor_accounts')
      .update({ ...fields, onboarding_complete: step >= 2 })
      .eq('id', contractor.id)
    setSaving(false)
  }

  const handleStep1 = async () => {
    if (!form.market_city.trim()) return
    await save({ market_city: form.market_city.trim(), market_state: form.market_state, owner_phone: form.owner_phone.trim() || null })
    setStep(2)
  }

  const handleStep2 = async () => {
    await save({ google_review_link: form.google_review_link.trim() || null, onboarding_complete: true })
    setStep(3)
  }

  const finish = () => navigate('/roofing/jobs')

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '440px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <span style={{ fontSize: '32px' }}>🏠</span>
          <p style={{ margin: '8px 0 0', fontSize: '22px', fontWeight: '800', color: C.text }}>Set Up Roofing OS</p>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: C.muted }}>2 minutes to get your account ready</p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '28px' }}>
          {STEPS.map((s, i) => (
            <div key={s.num} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? '1' : '0' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                background: step > s.num ? C.success : step === s.num ? C.primary : 'rgba(255,255,255,0.06)',
                border: `2px solid ${step > s.num ? C.success : step === s.num ? C.primary : C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', transition: 'all 0.2s',
              }}>
                {step > s.num ? '✓' : s.icon}
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: '2px', background: step > s.num ? C.success : C.border, margin: '0 4px' }} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1 — Market */}
        {step === 1 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '24px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: '700', color: C.text }}>📍 Quick Setup</p>
            <p style={{ margin: '0 0 20px', fontSize: '14px', color: C.muted }}>Tell us where you work and how to reach you.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '600' }}>Your Phone <span style={{ color: 'rgba(136,150,168,0.5)' }}>(for SMS alerts)</span></p>
                <input
                  value={form.owner_phone}
                  onChange={e => setForm(f => ({ ...f, owner_phone: e.target.value }))}
                  placeholder="(720) 555-1234"
                  type="tel"
                  style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', fontSize: '15px', color: C.text, outline: 'none' }}
                />
              </div>
              <div>
                <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '600' }}>Primary City</p>
                <input
                  value={form.market_city}
                  onChange={e => setForm(f => ({ ...f, market_city: e.target.value }))}
                  placeholder="e.g. Denver"
                  style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', fontSize: '15px', color: C.text, outline: 'none' }}
                  onKeyDown={e => e.key === 'Enter' && handleStep1()}
                />
              </div>
              <div>
                <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '600' }}>State</p>
                <select
                  value={form.market_state}
                  onChange={e => setForm(f => ({ ...f, market_state: e.target.value }))}
                  style={{ width: '100%', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', fontSize: '15px', color: C.text, outline: 'none', cursor: 'pointer' }}
                >
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <button onClick={handleStep1} disabled={saving || !form.market_city.trim()}
              style={{ marginTop: '20px', width: '100%', background: (!form.market_city.trim() || saving) ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '16px', fontWeight: '700', cursor: 'pointer', transition: 'background 0.15s' }}>
              {saving ? 'Saving…' : 'Next →'}
            </button>
          </div>
        )}

        {/* Step 2 — Google Review Link */}
        {step === 2 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '20px', padding: '24px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '18px', fontWeight: '700', color: C.text }}>⭐ Google Review Link</p>
            <p style={{ margin: '0 0 20px', fontSize: '14px', color: C.muted }}>
              After jobs complete, Roofing OS auto-texts homeowners to leave a review. Paste your Google Business review link below.
            </p>
            <div>
              <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '600' }}>Google Review URL <span style={{ color: 'rgba(136,150,168,0.5)' }}>(optional)</span></p>
              <input
                value={form.google_review_link}
                onChange={e => setForm(f => ({ ...f, google_review_link: e.target.value }))}
                placeholder="https://g.page/r/your-business/review"
                style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px 14px', fontSize: '13px', color: C.text, outline: 'none' }}
              />
              <p style={{ margin: '6px 0 0', fontSize: '11px', color: C.muted }}>
                Find this in Google Business Profile → Get more reviews → Share review form
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '20px' }}>
              <button onClick={handleStep2} disabled={saving}
                style={{ background: saving ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '16px', fontWeight: '700', cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Next →'}
              </button>
              <button onClick={() => { setStep(3); save({ onboarding_complete: true }) }}
                style={{ background: 'none', border: 'none', color: C.muted, fontSize: '13px', cursor: 'pointer', padding: '4px' }}>
                Skip for now
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Done */}
        {step === 3 && (
          <div style={{ background: C.surface, border: `1px solid rgba(34,197,94,0.25)`, borderRadius: '20px', padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🚀</div>
            <p style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: '800', color: C.text }}>You're all set!</p>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: C.muted, lineHeight: 1.6 }}>
              Roofing OS is ready. Create your first job to see the full dashboard — photos, payments, portal links, and more.
            </p>
            <button onClick={finish}
              style={{ width: '100%', background: C.success, color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '16px', fontWeight: '700', cursor: 'pointer' }}>
              Create My First Job →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

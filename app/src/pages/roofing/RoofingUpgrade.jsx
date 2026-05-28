import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useContractor } from '../../context/ContractorContext'

const C = {
  bg: '#0f1923', surface: '#1a2535', surface2: '#243044',
  text: '#ffffff', muted: '#8896a8',
  border: 'rgba(255,255,255,0.08)',
  primary: '#4a9eff', success: '#22c55e',
}
const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$149',
    period: '/mo',
    color: C.primary,
    popular: false,
    features: [
      'Unlimited jobs',
      'Homeowner portal for every job',
      'Photo uploads (before/after)',
      'Payment tracking',
      'Google review automation',
      'SMS + email updates',
    ],
    venmo: '$149',
    note: 'Billed monthly. Cancel anytime.',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$499',
    period: '/mo',
    color: '#a78bfa',
    popular: true,
    features: [
      'Everything in Starter',
      'AI color visualization',
      'Supplement AI (find missed items)',
      'Storm lead alerts',
      'Aria AI voice follow-up',
      'Priority support',
    ],
    venmo: '$499',
    note: 'Most popular. Pays for itself with 1 supplement.',
  },
]

function VenmoModal({ plan, onClose, contractor }) {
  const [step, setStep] = useState(1)
  const firstName = contractor?.owner_name?.split(' ')[0] || 'there'
  const venmoHandle = '@roofingos'
  const amount = plan.venmo
  const note = `${plan.name} plan - ${contractor?.company_name || contractor?.owner_email || 'new contractor'}`

  const venmoUrl = `venmo://paycharge?txn=pay&recipients=${venmoHandle}&amount=${amount.replace('$', '')}&note=${encodeURIComponent(note)}`
  const venmoWebUrl = `https://venmo.com/u/roofingos`

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: C.surface, borderRadius: '24px 24px 0 0',
        padding: '32px 24px 40px', width: '100%', maxWidth: '480px',
      }}>
        {step === 1 && (
          <>
            <p style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '800', color: C.text }}>
              Upgrade to {plan.name}
            </p>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: C.muted }}>
              Hey {firstName} — pay via Venmo and we'll activate your plan within minutes.
            </p>

            <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '14px', color: C.muted }}>Plan</span>
                <span style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>Roofing OS {plan.name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '14px', color: C.muted }}>Amount</span>
                <span style={{ fontSize: '20px', fontWeight: '800', color: plan.color }}>{plan.price}/mo</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: C.muted }}>Pay to</span>
                <span style={{ fontSize: '14px', fontWeight: '700', color: C.text }}>@roofingos on Venmo</span>
              </div>
            </div>

            <div style={{ background: 'rgba(74,158,255,0.06)', border: '1px solid rgba(74,158,255,0.2)', borderRadius: '12px', padding: '12px 14px', marginBottom: '20px' }}>
              <p style={{ margin: 0, fontSize: '13px', color: C.text, lineHeight: 1.5 }}>
                Include note: <strong style={{ color: C.primary }}>{note}</strong>
              </p>
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: C.muted }}>
                We'll verify payment and activate your plan via text/email within 30 min during business hours.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a
                href={venmoUrl}
                style={{ display: 'block', background: '#3d95ce', color: '#fff', textDecoration: 'none', borderRadius: '14px', padding: '15px', fontSize: '16px', fontWeight: '700', textAlign: 'center' }}
                onClick={() => setStep(2)}
              >
                Open Venmo App →
              </a>
              <a
                href={venmoWebUrl} target="_blank" rel="noopener"
                style={{ display: 'block', background: C.surface2, color: C.text, textDecoration: 'none', borderRadius: '14px', padding: '15px', fontSize: '15px', fontWeight: '600', textAlign: 'center', border: `1px solid ${C.border}` }}
                onClick={() => setStep(2)}
              >
                Pay on Venmo.com
              </a>
              <p style={{ margin: '4px 0 0', textAlign: 'center', fontSize: '12px', color: C.muted }}>
                Questions? Text <a href="tel:7205006668" style={{ color: C.primary, textDecoration: 'none' }}>(720) 500-6668</a>
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>✅</div>
            <p style={{ margin: '0 0 8px', fontSize: '22px', fontWeight: '800', color: C.text }}>Payment Sent?</p>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: C.muted, lineHeight: 1.6 }}>
              Once we see your Venmo payment we'll activate {plan.name} and text you. Usually within 30 minutes.
            </p>
            <p style={{ margin: '0 0 24px', fontSize: '13px', color: C.muted }}>
              Need help? Text Zach directly at{' '}
              <a href="sms:7205006668" style={{ color: C.primary, textDecoration: 'none', fontWeight: '700' }}>(720) 500-6668</a>
            </p>
            <button onClick={onClose} style={{ width: '100%', background: C.primary, color: '#fff', border: 'none', borderRadius: '14px', padding: '15px', fontSize: '16px', fontWeight: '700', cursor: 'pointer' }}>
              Got it — back to dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function RoofingUpgrade() {
  const navigate = useNavigate()
  const { contractor } = useContractor()
  const [selectedPlan, setSelectedPlan] = useState(null)

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
        <button onClick={() => navigate('/roofing/jobs')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: C.muted, padding: 0 }}>←</button>
        <div>
          <h1 style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: C.text }}>Upgrade Roofing OS</h1>
          <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>Pick a plan that fits your business</p>
        </div>
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* Headline */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '26px', fontWeight: '800', color: C.text }}>
            More jobs. Less chaos.
          </p>
          <p style={{ margin: 0, fontSize: '14px', color: C.muted, lineHeight: 1.6 }}>
            Unlock the full Roofing OS platform. Pay via Venmo — activated within 30 minutes.
          </p>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '28px' }}>
          {PLANS.map(plan => (
            <div key={plan.id} style={{
              background: C.surface,
              border: `2px solid ${plan.popular ? plan.color : C.border}`,
              borderRadius: '20px', overflow: 'hidden',
              position: 'relative',
            }}>
              {plan.popular && (
                <div style={{ background: plan.color, padding: '6px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#fff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Most Popular
                </div>
              )}
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <p style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: '800', color: C.text }}>{plan.name}</p>
                    <p style={{ margin: 0, fontSize: '11px', color: C.muted }}>{plan.note}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '30px', fontWeight: '800', color: plan.color }}>{plan.price}</span>
                    <span style={{ fontSize: '13px', color: C.muted }}>{plan.period}</span>
                  </div>
                </div>

                <ul style={{ margin: '0 0 20px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: C.text }}>
                      <span style={{ color: C.success, fontWeight: '700', flexShrink: 0 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => setSelectedPlan(plan)}
                  style={{
                    width: '100%', background: plan.popular ? plan.color : C.primary,
                    color: '#fff', border: 'none', borderRadius: '12px',
                    padding: '14px', fontSize: '16px', fontWeight: '700', cursor: 'pointer',
                    transition: 'filter 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.filter = 'none'}
                >
                  Upgrade to {plan.name} →
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Trust signals */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '20px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '12px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Why contractors upgrade</p>
          {[
            { icon: '💰', text: 'Supplement AI finds avg $4,200 in missed line items per job' },
            { icon: '⭐', text: 'Auto review requests on job complete — 3x more reviews' },
            { icon: '⛈', text: 'Storm alerts sent to your phone when hail hits your market' },
            { icon: '📱', text: 'Homeowners love the portal — fewer calls, happier clients' },
          ].map(({ icon, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: '13px', color: C.text, lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: C.muted }}>
          Questions? Text Zach at{' '}
          <a href="tel:7205006668" style={{ color: C.primary, textDecoration: 'none' }}>(720) 500-6668</a>
        </p>
      </div>

      {selectedPlan && (
        <VenmoModal
          plan={selectedPlan}
          contractor={contractor}
          onClose={() => { setSelectedPlan(null); navigate('/roofing/jobs') }}
        />
      )}
    </div>
  )
}

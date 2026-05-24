import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function RoofingLogin() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'https://app.nexuszc.com/roofing/jobs' },
    })
    if (err) {
      const isRateLimit = err.message.toLowerCase().includes('rate') || err.message.toLowerCase().includes('security') || err.status === 429
      setError(isRateLimit ? 'Already sent — check your email (including spam). Valid for 24 hours.' : err.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  const floatingCards = [
    { name: 'Johnson Residence', addr: '4821 Timberline Dr', stage: 'Active', amount: '$18,500' },
    { name: 'Martinez Property', addr: '2301 Oak Street', stage: 'Signed', amount: '$12,200' },
    { name: 'Williams Home', addr: '891 Pine Ave', stage: 'Estimate', amount: '$9,800' },
  ]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#0f1923' }}>
      <style>{`
        @keyframes float1 { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-12px)} }
        @keyframes float2 { 0%,100%{transform:translateY(-8px)} 50%{transform:translateY(4px)} }
        @keyframes float3 { 0%,100%{transform:translateY(-4px)} 50%{transform:translateY(8px)} }
        .ros-left { display: none; }
        @media (min-width: 768px) { .ros-left { display: flex; } }
        .ros-right { width: 100%; }
        @media (min-width: 768px) { .ros-right { width: 50%; max-width: 480px; } }
      `}</style>

      {/* Left panel — desktop only */}
      <div className="ros-left" style={{
        flex: 1, background: 'linear-gradient(135deg, #0f1923 0%, #1a2535 100%)',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '48px', position: 'relative', overflow: 'hidden',
        borderRight: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 30% 50%, rgba(74,158,255,0.06) 0%, transparent 60%)' }} />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: '380px', textAlign: 'center' }}>
          <div style={{ marginBottom: '32px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: '700', color: '#4a9eff', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Roofing OS</p>
            <h2 style={{ margin: '0 0 12px', fontSize: '32px', fontWeight: '700', color: '#fff', lineHeight: 1.2 }}>
              The professional dashboard your homeowners will love
            </h2>
            <p style={{ margin: 0, color: '#8896a8', fontSize: '15px', lineHeight: 1.6 }}>
              Real-time job tracking, homeowner portals, supplement AI, and team management — all in one place.
            </p>
          </div>

          {/* Floating job cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '32px' }}>
            {floatingCards.map((card, i) => (
              <div key={i} style={{
                background: '#1a2535', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px',
                padding: '14px 16px', textAlign: 'left',
                animation: `float${i + 1} ${3 + i * 0.5}s ease-in-out infinite`,
                transform: i === 1 ? 'translateX(20px)' : i === 2 ? 'translateX(-10px)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ margin: '0 0 2px', fontSize: '14px', fontWeight: '600', color: '#fff' }}>{card.name}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#8896a8' }}>{card.addr}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '20px', background: 'rgba(74,158,255,0.15)', color: '#4a9eff' }}>{card.stage}</span>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', fontWeight: '700', color: '#22c55e' }}>{card.amount}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="ros-right" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', flex: 1,
      }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ width: '52px', height: '52px', background: '#4a9eff', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', margin: '0 auto 16px' }}>🏠</div>
            <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#ffffff', margin: '0 0 6px' }}>Welcome back</h1>
            <p style={{ color: '#8896a8', fontSize: '14px', margin: 0 }}>Roofing OS Contractor Dashboard</p>
          </div>

          {sent ? (
            <div style={{ background: '#1a2535', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '32px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '42px', marginBottom: '16px' }}>📬</div>
              <p style={{ color: '#22c55e', fontSize: '18px', fontWeight: '700', margin: '0 0 8px' }}>Check your email</p>
              <p style={{ color: '#8896a8', fontSize: '14px', margin: '0 0 4px' }}>We sent a magic link to</p>
              <p style={{ color: '#fff', fontSize: '14px', fontWeight: '600', margin: 0 }}>{email}</p>
              <p style={{ color: '#8896a8', fontSize: '14px', marginTop: '16px', lineHeight: 1.5 }}>Tap the link in the email, then come back to this app.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ background: '#1a2535', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '28px' }}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#8896a8', marginBottom: '8px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  Email address
                </label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required autoFocus placeholder="you@yourbusiness.com"
                  style={{ width: '100%', boxSizing: 'border-box', background: '#243044', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '14px', fontSize: '15px', color: '#fff', outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                  onFocus={e => { e.target.style.borderColor = '#4a9eff'; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.boxShadow = 'none' }}
                />
              </div>
              {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
              <button
                type="submit" disabled={loading || !email}
                style={{
                  width: '100%', background: loading || !email ? 'rgba(74,158,255,0.4)' : '#4a9eff',
                  color: '#fff', border: 'none', borderRadius: '10px', padding: '14px',
                  fontSize: '15px', fontWeight: '700', cursor: loading || !email ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s, transform 0.1s',
                }}
                onMouseEnter={e => !loading && email && (e.currentTarget.style.filter = 'brightness(1.1)')}
                onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
                onMouseDown={e => !loading && email && (e.currentTarget.style.transform = 'scale(0.98)')}
                onMouseUp={e => (e.currentTarget.style.transform = 'none')}
              >
                {loading ? 'Sending…' : 'Send Magic Link →'}
              </button>
              <p style={{ textAlign: 'center', fontSize: '13px', color: '#8896a8', marginTop: '20px', marginBottom: 0 }}>
                New here?{' '}
                <a href="https://roofingos.dev/signup" style={{ color: '#4a9eff', textDecoration: 'none', fontWeight: '600' }}>
                  Create free account →
                </a>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

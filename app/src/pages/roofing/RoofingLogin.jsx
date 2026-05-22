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
      const isRateLimit = err.message.toLowerCase().includes('rate') ||
        err.message.toLowerCase().includes('security') ||
        err.status === 429
      setError(isRateLimit
        ? 'Already sent a link — check your email (including spam). It\'s valid for 24 hours.'
        : err.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '360px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ width: '52px', height: '52px', background: '#4a9eff', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', margin: '0 auto 16px' }}>🏠</div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f1923', margin: 0, letterSpacing: '-0.5px' }}>Roofing OS</h1>
          <p style={{ color: '#6b7280', fontSize: '14px', marginTop: '4px' }}>Contractor Dashboard</p>
        </div>

        {sent ? (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '28px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '36px', marginBottom: '14px' }}>📬</div>
            <p style={{ color: '#22c55e', fontSize: '17px', fontWeight: '700', margin: '0 0 8px' }}>Check your email</p>
            <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>We sent a magic link to <strong style={{ color: '#0f1923' }}>{email}</strong></p>
            <p style={{ color: '#9ca3af', fontSize: '12px', marginTop: '12px' }}>Click the link to sign in. No password needed.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '24px' }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px', letterSpacing: '0.03em' }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@yourbusiness.com"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#f9fafb', border: '1px solid #e5e7eb',
                  borderRadius: '10px', padding: '12px 14px',
                  fontSize: '15px', color: '#0f1923', outline: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = '#4a9eff'; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.12)' }}
                onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.boxShadow = 'none' }}
              />
            </div>
            {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', margin: '0 0 12px' }}>{error}</p>}
            <button
              type="submit"
              disabled={loading || !email}
              style={{
                width: '100%', background: loading || !email ? '#93c5fd' : '#4a9eff',
                color: '#fff', border: 'none', borderRadius: '10px',
                padding: '13px', fontSize: '15px', fontWeight: '700',
                cursor: loading || !email ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {loading ? 'Sending…' : 'Send Magic Link'}
            </button>
            <p style={{ textAlign: 'center', fontSize: '12px', color: '#9ca3af', marginTop: '16px', marginBottom: 0 }}>
              New here?{' '}
              <a href="https://roofingos.dev/signup" style={{ color: '#4a9eff', textDecoration: 'none' }} target="_blank" rel="noopener">
                New here? Create your free account →
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

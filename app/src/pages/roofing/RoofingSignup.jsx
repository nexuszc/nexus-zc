import { useState } from 'react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export default function RoofingSignup() {
  const [form, setForm] = useState({ owner_name: '', company_name: '', owner_email: '' })
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.owner_name.trim() || !form.company_name.trim() || !form.owner_email.trim()) {
      setError('Please fill in all fields')
      return
    }
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/contractor-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://roofingos.dev',
        },
        body: JSON.stringify({
          owner_name: form.owner_name.trim(),
          company_name: form.company_name.trim(),
          owner_email: form.owner_email.trim().toLowerCase(),
          plan: 'free',
          ref_source: 'app_signup',
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (data.ok && data.action_link) {
        window.location.href = data.action_link
      } else if (data.ok) {
        setSent(true)
      } else {
        setError(data.error || 'Something went wrong. Text us: (720) 500-6668')
      }
    } catch {
      setError('Connection error. Please try again.')
    }
    setLoading(false)
  }

  const focusStyle = { borderColor: '#4a9eff', boxShadow: '0 0 0 3px rgba(74,158,255,0.15)' }
  const blurStyle  = { borderColor: 'rgba(255,255,255,0.08)', boxShadow: 'none' }
  const inputBase  = {
    width: '100%', boxSizing: 'border-box',
    background: '#243044', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px', padding: '14px', fontSize: '15px', color: '#fff',
    outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1923', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ width: '52px', height: '52px', background: '#4a9eff', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', margin: '0 auto 16px' }}>🏠</div>
          <h1 style={{ fontSize: '26px', fontWeight: '800', color: '#fff', margin: '0 0 6px' }}>Start for free</h1>
          <p style={{ color: '#8896a8', fontSize: '14px', margin: 0 }}>Roofing OS — No credit card, no time limit</p>
        </div>

        {sent ? (
          <div style={{ background: '#1a2535', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '36px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📧</div>
            <p style={{ color: '#22c55e', fontSize: '20px', fontWeight: '800', margin: '0 0 10px' }}>Check your email!</p>
            <p style={{ color: '#8896a8', fontSize: '14px', margin: '0 0 20px', lineHeight: 1.6 }}>We sent you a login link.</p>
            <a href="/roofing/login" style={{ display: 'inline-block', color: '#4a9eff', fontSize: '15px', fontWeight: '600', textDecoration: 'none' }}>
              Go to login →
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ background: '#1a2535', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '28px' }}>
            {[
              { key: 'owner_name',    label: 'Your Name',     placeholder: 'John Smith', type: 'text' },
              { key: 'company_name',  label: 'Company Name',  placeholder: 'Smith Roofing LLC', type: 'text' },
              { key: 'owner_email',   label: 'Work Email',    placeholder: 'john@smithroofing.com', type: 'email' },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key} style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#8896a8', marginBottom: '8px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {label}
                </label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={e => set(key, e.target.value)}
                  required
                  autoFocus={key === 'owner_name'}
                  placeholder={placeholder}
                  style={inputBase}
                  onFocus={e => Object.assign(e.target.style, focusStyle)}
                  onBlur={e => Object.assign(e.target.style, blurStyle)}
                />
              </div>
            ))}

            {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

            <button
              type="submit"
              disabled={loading || !form.owner_name || !form.company_name || !form.owner_email}
              style={{
                width: '100%', border: 'none', borderRadius: '12px', padding: '15px',
                fontSize: '16px', fontWeight: '700', cursor: 'pointer',
                background: (loading || !form.owner_name || !form.company_name || !form.owner_email) ? 'rgba(74,158,255,0.4)' : '#4a9eff',
                color: '#fff', transition: 'background 0.15s, transform 0.1s',
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.filter = 'brightness(1.1)' }}
              onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
              onMouseDown={e => { if (!loading) e.currentTarget.style.transform = 'scale(0.98)' }}
              onMouseUp={e => { e.currentTarget.style.transform = 'none' }}
            >
              {loading ? 'Creating your account…' : 'Create Free Account →'}
            </button>

            <p style={{ textAlign: 'center', fontSize: '13px', color: '#8896a8', margin: '20px 0 0' }}>
              Already have an account?{' '}
              <a href="/roofing/login" style={{ color: '#4a9eff', textDecoration: 'none', fontWeight: '600' }}>Sign in →</a>
            </p>
          </form>
        )}

        <p style={{ textAlign: 'center', fontSize: '12px', color: 'rgba(136,150,168,0.5)', marginTop: '20px' }}>
          Need help?{' '}
          <a href="tel:7205006668" style={{ color: '#4a9eff', textDecoration: 'none' }}>(720) 500-6668</a>
        </p>
      </div>
    </div>
  )
}

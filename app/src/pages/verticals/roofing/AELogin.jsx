import { useState } from 'react'

const SB_URL = import.meta.env.VITE_SUPABASE_URL

export default function AELogin() {
  const [email, setEmail]       = useState('')
  const [sent, setSent]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${SB_URL}/functions/v1/ae-login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()

      if (res.ok && data.ok) {
        setSent(true)
      } else {
        setError(data.error === 'not_found'
          ? 'That email is not registered.'
          : 'Something went wrong. Try again.')
      }
    } catch {
      setError('Network error. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-3xl mb-3">🏠</div>
          <h1 className="text-xl font-bold text-white">Roofing OS</h1>
          <p className="text-gray-500 text-sm mt-1">Account Executive Portal</p>
        </div>

        {sent ? (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-2xl p-8 text-center">
            <div className="text-3xl mb-4">✉️</div>
            <p className="text-white font-semibold text-lg mb-2">Check your email</p>
            <p className="text-gray-400 text-sm">
              Link expires in 12 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-[#12121a] border border-[#1e1e2e] rounded-2xl p-8">
            <label className="block text-xs text-gray-400 uppercase tracking-widest mb-2">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ae@roofingos.dev"
              required
              autoFocus
              className="w-full bg-[#0c0c14] border border-[#2a2a3e] rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-indigo-500 mb-4"
            />
            {error && (
              <p className="text-red-400 text-sm mb-4">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
            >
              {loading ? 'Sending…' : 'Send my link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

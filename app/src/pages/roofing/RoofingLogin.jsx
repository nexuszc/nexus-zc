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
      options: { emailRedirectTo: `${window.location.origin}/roofing` },
    })

    if (err) {
      setError(err.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Roofing OS</h1>
          <p className="text-gray-400 text-sm mt-2">Contractor Portal</p>
        </div>

        {sent ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
            <p className="text-green-400 text-lg font-semibold mb-2">Check your email</p>
            <p className="text-gray-400 text-sm">We sent a magic link to <strong className="text-white">{email}</strong></p>
            <p className="text-gray-500 text-xs mt-3">Click the link to sign in. No password needed.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@yourbusiness.com"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-2.5 font-medium text-sm transition-colors"
            >
              {loading ? 'Sending...' : 'Send Magic Link'}
            </button>
            <p className="text-center text-xs text-gray-500">
              Don't have an account? Contact your account administrator.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

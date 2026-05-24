import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]   = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]     = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'https://app.nexuszc.com' },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950 px-4 overflow-x-hidden w-full box-border">
      {/* Subtle background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '48px 48px' }}
      />

      <div className="relative w-full max-w-sm animate-fade-in">
        {/* Wordmark */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-900/50">
              <span className="text-white font-black text-base">N</span>
            </div>
            <div className="text-left leading-none">
              <div className="text-white font-bold text-xl tracking-tight">Nexus</div>
              <div className="text-violet-400 text-xs font-bold tracking-widest uppercase">ZC</div>
            </div>
          </div>
          <p className="text-gray-500 text-sm">AI-powered operations platform</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900/80 backdrop-blur border border-gray-800 rounded-2xl p-7 shadow-2xl shadow-black/50">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-violet-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg mb-2">Check your email</h2>
              <p className="text-gray-400 text-sm">Magic link sent to <span className="text-violet-400">{email}</span>. Click it to sign in.</p>
              <button
                onClick={() => { setSent(false); setEmail('') }}
                className="mt-5 text-gray-500 text-xs hover:text-gray-400 transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-white font-semibold text-lg mb-1">Sign in to continue</h2>
              <p className="text-gray-500 text-sm mb-5">We'll send a magic link to your email.</p>

              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Email</label>
                  <input
                    type="email"
                    placeholder="you@nexuszc.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all placeholder-gray-600"
                    required
                    autoFocus
                  />
                </div>

                {error && (
                  <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
                    <p className="text-red-400 text-xs">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-1 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:text-violet-400 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-all duration-150 shadow-lg shadow-violet-900/30"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Sending…
                    </span>
                  ) : 'Send magic link'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-gray-700 text-xs mt-6">Nexus ZC · Internal Platform</p>
      </div>
    </div>
  )
}

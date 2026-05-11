import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950 px-4">
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
          <h2 className="text-white font-semibold text-lg mb-5">Sign in to continue</h2>

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
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3.5 py-2.5 text-white text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-all placeholder-gray-600"
                required
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
                  Signing in…
                </span>
              ) : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-700 text-xs mt-6">Nexus ZC · Internal Platform</p>
      </div>
    </div>
  )
}

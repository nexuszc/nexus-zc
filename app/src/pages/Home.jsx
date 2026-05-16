import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function todayStr() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function ago(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function Stat({ label, value, color = 'text-white', loading }) {
  return (
    <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{label}</div>
      {loading
        ? <div className="skeleton h-9 w-14" />
        : <div className={`text-3xl font-black ${color}`}>{value ?? '—'}</div>
      }
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [stats, setStats]           = useState(null)
  const [directives, setDirectives] = useState([])
  const [systemErrors, setSystemErrors] = useState([])
  const [roofingStats, setRoofingStats] = useState(null)
  const [loading, setLoading]       = useState(true)

  const load = useCallback(async () => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const weekAgo = new Date(Date.now() - 7 * 86400000)
    const dayAgo  = new Date(Date.now() - 86400000)

    const [
      { count: cyclesToday },
      { count: activeDirectives },
      { count: decisionsWeek },
      { data: dirs },
      { data: errors },
      { count: rContractors },
      { count: rWhales },
      { count: rCalls },
    ] = await Promise.all([
      supabase.from('nexus_agent_cycles').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('nexus_directives').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('nexus_decisions').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
      supabase.from('nexus_directives').select('id, title, description, priority').eq('status', 'active').order('priority').limit(5),
      supabase.from('system_heartbeats').select('function_name, error_message, recorded_at').eq('status', 'error').gte('recorded_at', dayAgo.toISOString()).order('recorded_at', { ascending: false }).limit(5),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true }).eq('subscription_status', 'active'),
      supabase.from('roofing_prospects').select('id', { count: 'exact', head: true }).eq('clicked', true).is('outcome', null),
      supabase.from('aria_call_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    ])

    setStats({
      cyclesToday:      cyclesToday ?? 0,
      activeDirectives: activeDirectives ?? 0,
      decisionsWeek:    decisionsWeek ?? 0,
    })
    setDirectives(dirs || [])
    setSystemErrors(errors || [])
    setRoofingStats({
      contractors: rContractors ?? 0,
      whales:      rWhales ?? 0,
      calls:       rCalls ?? 0,
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">{greeting()}, Zach</h1>
        <p className="text-gray-500 text-sm mt-0.5">{todayStr()}</p>
      </div>

      {/* Brain stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Cycles Today"      value={stats?.cyclesToday}      loading={loading} />
        <Stat label="Active Directives" value={stats?.activeDirectives} color="text-indigo-400" loading={loading} />
        <Stat label="Decisions (7d)"    value={stats?.decisionsWeek}    color="text-green-400"  loading={loading} />
      </div>

      {/* Active priorities */}
      <div className="mb-6">
        <h2 className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Active Priorities</h2>
        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="skeleton h-14 w-full rounded-xl" />)}
          </div>
        ) : directives.length === 0 ? (
          <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] p-6 text-center">
            <p className="text-gray-600 text-sm">No active directives. Run Nexus Core to generate priorities.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {directives.map((d, i) => (
              <div key={d.id} className="bg-[#12121a] rounded-xl border border-[#1e1e2e] p-4 flex items-start gap-3">
                <div className="w-7 h-7 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-indigo-400 font-black text-xs">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{d.title}</div>
                  {d.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.description}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System health alerts */}
      {!loading && systemErrors.length > 0 && (
        <div className="mb-6">
          <h2 className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">System Alerts</h2>
          <div className="bg-[#12121a] rounded-xl border border-red-900/40 overflow-hidden">
            {systemErrors.map((e, i) => (
              <div key={`${e.function_name}-${i}`} className="flex items-start gap-3 px-4 py-3 border-b border-[#1e1e2e] last:border-0">
                <span className="text-base shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{e.function_name}</div>
                  {e.error_message && <div className="text-xs text-red-400 mt-0.5 truncate">{e.error_message}</div>}
                </div>
                <div className="text-[10px] text-gray-600 shrink-0 whitespace-nowrap">{ago(e.recorded_at)}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/roofing/system')}
            className="mt-2 text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            View all in System →
          </button>
        </div>
      )}

      {/* Verticals */}
      <div>
        <h2 className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Verticals</h2>
        <div className="space-y-3">
          {/* Roofing OS card */}
          <div
            onClick={() => navigate('/roofing')}
            className="bg-[#12121a] rounded-xl border border-[#1e1e2e] hover:border-indigo-500/40 p-4 cursor-pointer transition-all group"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-lg">🏠</span>
              <h3 className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">Roofing OS</h3>
              <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide">Active</span>
              <span className="ml-auto text-[10px] text-gray-600 group-hover:text-indigo-400 transition-colors">Open →</span>
            </div>
            {!loading && roofingStats ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xl font-black text-white">{roofingStats.contractors}</div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest">Contractors</div>
                </div>
                <div>
                  <div className="text-xl font-black text-cyan-400">{roofingStats.whales}</div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest">Whales Hot</div>
                </div>
                <div>
                  <div className="text-xl font-black text-amber-400">{roofingStats.calls}</div>
                  <div className="text-[10px] text-gray-600 uppercase tracking-widest">Calls Queued</div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[1,2,3].map(i => <div key={i} className="skeleton h-8 w-full rounded-lg" />)}
              </div>
            )}
          </div>

          {/* Coming soon verticals */}
          <div className="opacity-35 pointer-events-none select-none bg-[#12121a] rounded-xl border border-[#1e1e2e] p-4">
            <div className="flex items-center gap-3">
              <span className="text-lg">💰</span>
              <h3 className="text-sm font-semibold text-gray-500">Cash Out Refi OS</h3>
              <span className="ml-auto text-[9px] bg-gray-800 text-gray-600 px-1.5 py-0.5 rounded font-medium uppercase">Coming Soon</span>
            </div>
          </div>

          <div className="opacity-35 pointer-events-none select-none bg-[#12121a] rounded-xl border border-[#1e1e2e] p-4">
            <div className="flex items-center gap-3">
              <span className="text-lg">🌡️</span>
              <h3 className="text-sm font-semibold text-gray-500">HVAC OS</h3>
              <span className="ml-auto text-[9px] bg-gray-800 text-gray-600 px-1.5 py-0.5 rounded font-medium uppercase">Coming Soon</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

function ago(ts) {
  if (!ts) return null
  const d = Math.floor((Date.now() - new Date(ts)) / 86400000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

function initials(name = '') {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = [
  'from-violet-600 to-violet-800',
  'from-blue-600 to-blue-800',
  'from-emerald-600 to-emerald-800',
  'from-amber-600 to-amber-800',
  'from-pink-600 to-pink-800',
  'from-cyan-600 to-cyan-800',
]

function avatarColor(name = '') {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

function dealLabel(dealType = '') {
  const dt = dealType.toLowerCase()
  if (dt.includes('roof'))    return { label: 'Roofing',   cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' }
  if (dt.includes('refi') || dt.includes('mortgage')) return { label: 'Mortgage', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' }
  if (dt.includes('va') || dt.includes('virtual'))    return { label: 'VA',       cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20' }
  if (dt.includes('nexus') || dt.includes('platform'))return { label: 'Platform', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' }
  if (dealType) return { label: dealType.replace(/_/g,' '), cls: 'bg-gray-500/10 text-gray-400 border-gray-500/20' }
  return null
}

function healthBar(score) {
  if (score == null) return null
  const w   = Math.min(score, 100)
  const col = score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'
  const txt = score >= 75 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400'
  return { w, col, txt }
}

function Skeleton() {
  return <div className="skeleton h-28 rounded-2xl" />
}

export default function Clients() {
  const [clients,     setClients]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [filter,      setFilter]      = useState('all')
  const [provisioning,setProvisioning]= useState(null)

  useEffect(() => {
    supabase.from('clients')
      .select('id,name,deal_type,status,monthly_fee,rev_share_pct,slug,provision_status,created_at,health_score,last_activity_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setClients(data || []); setLoading(false) })
  }, [])

  const provisionClient = async (clientId, clientName) => {
    setProvisioning(clientId)
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ client_id: clientId }),
    })
    alert(`Provisioning ${clientName}… Check Telegram for updates.`)
    setProvisioning(null)
  }

  const filtered = filter === 'all'
    ? clients
    : clients.filter(c => c.status === filter)

  const activeCount = clients.filter(c => c.status === 'active').length

  return (
    <div className="animate-fade-in">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="px-6 lg:px-10 pt-8 pb-6 border-b border-gray-800/40">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-[0.15em] mb-1.5">CRM</p>
            <h1 className="text-[28px] font-black text-white tracking-tight leading-none">Client Pipeline</h1>
            <p className="text-gray-600 text-sm mt-2">{activeCount} active · {clients.length} total</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
              {['all', 'active', 'inactive'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                    filter === f ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-300'
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Client grid ──────────────────────────────────────────────────────── */}
      <div className="px-6 lg:px-10 py-6">
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="max-w-md mx-auto text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">👥</span>
            </div>
            <h3 className="text-white font-bold mb-2">No clients yet</h3>
            <p className="text-gray-600 text-sm mb-4">
              {filter === 'all' ? 'Add your first client via Telegram.' : `No ${filter} clients.`}
            </p>
            <p className="text-gray-700 text-xs font-mono bg-white/[0.03] border border-white/[0.06] rounded-lg px-4 py-2.5 inline-block">
              "new client: [name]"
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(c => {
              const hb     = healthBar(c.health_score)
              const badge  = dealLabel(c.deal_type)
              const stale  = !c.last_activity_at || (Date.now() - new Date(c.last_activity_at)) / 86400000 > 5
              const lastAct = ago(c.last_activity_at)
              const grad   = avatarColor(c.name)

              return (
                <div key={c.id}
                  className="bg-[#0c0c10] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl overflow-hidden transition-all group">

                  {/* Card top: avatar + name + status */}
                  <div className="p-5 pb-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center shrink-0 shadow-lg`}>
                        <span className="text-white font-black text-sm">{initials(c.name)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <Link to={`/clients/${c.id}`}
                            className="text-white font-bold text-[15px] leading-tight hover:text-violet-300 transition-colors truncate">
                            {c.name}
                          </Link>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'active' ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                            <span className={`text-[10px] font-semibold capitalize ${c.status === 'active' ? 'text-emerald-500' : 'text-gray-600'}`}>
                              {c.status}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {badge && (
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${badge.cls}`}>
                              {badge.label}
                            </span>
                          )}
                          {c.monthly_fee > 0 && (
                            <span className="text-[11px] text-emerald-500 font-semibold">
                              ${c.monthly_fee.toLocaleString()}/mo
                            </span>
                          )}
                          {c.rev_share_pct > 0 && (
                            <span className="text-[11px] text-gray-600">{c.rev_share_pct}% rev</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Health score */}
                    {hb && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider">Health Score</span>
                          <span className={`text-sm font-black tabular-nums ${hb.txt}`}>{c.health_score}</span>
                        </div>
                        <div className="w-full bg-white/[0.04] rounded-full h-1">
                          <div className={`${hb.col} h-1 rounded-full transition-all`} style={{ width: `${hb.w}%` }} />
                        </div>
                      </div>
                    )}

                    {/* Activity */}
                    <div className="flex items-center justify-between mt-3">
                      <span className={`text-[11px] ${stale ? 'text-amber-600' : 'text-gray-600'}`}>
                        {stale && lastAct ? `⚠ Last active ${lastAct}` : lastAct ? `Active ${lastAct}` : 'No activity logged'}
                      </span>
                    </div>
                  </div>

                  {/* Card actions bar */}
                  <div className="flex items-center gap-0 border-t border-white/[0.04] divide-x divide-white/[0.04]">
                    <Link to={`/clients/${c.id}`}
                      className="flex-1 flex items-center justify-center py-2.5 text-xs font-semibold text-gray-600 hover:text-white hover:bg-white/[0.03] transition-all">
                      View Details
                    </Link>
                    {c.provision_status !== 'live' ? (
                      <button
                        onClick={() => provisionClient(c.id, c.name)}
                        disabled={provisioning === c.id || c.provision_status === 'provisioning'}
                        className="flex-1 flex items-center justify-center py-2.5 text-xs font-semibold text-violet-500 hover:text-violet-300 hover:bg-violet-500/5 transition-all disabled:opacity-50">
                        {provisioning === c.id || c.provision_status === 'provisioning' ? 'Provisioning…' : '⚡ Provision'}
                      </button>
                    ) : (
                      <a href={`https://${c.slug}.nexuszc.com`} target="_blank" rel="noreferrer"
                        className="flex-1 flex items-center justify-center py-2.5 text-xs font-semibold text-blue-500 hover:text-blue-300 hover:bg-blue-500/5 transition-all">
                        View Site ↗
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />
}

function dealBadge(dealType) {
  const dt = (dealType || '').toLowerCase()
  if (dt.includes('roof')) return { label: 'Roofing', cls: 'bg-orange-900/30 text-orange-400' }
  if (dt.includes('refi') || dt.includes('mortgage')) return { label: 'Mortgage', cls: 'bg-blue-900/30 text-blue-400' }
  if (dt.includes('va') || dt.includes('virtual')) return { label: 'VA Services', cls: 'bg-violet-900/30 text-violet-400' }
  if (dt.includes('nexus') || dt.includes('platform')) return { label: 'Platform', cls: 'bg-emerald-900/30 text-emerald-400' }
  if (dealType) return { label: dealType.replace(/_/g, ' '), cls: 'bg-gray-700 text-gray-400' }
  return null
}

function healthColor(score) {
  if (score == null) return 'text-gray-600'
  if (score >= 75) return 'text-green-400'
  if (score >= 50) return 'text-amber-400'
  return 'text-red-400'
}

export default function Clients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [provisioning, setProvisioning] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    supabase
      .from('clients')
      .select('id, name, deal_type, status, monthly_fee, rev_share_pct, slug, provision_status, created_at, health_score, last_activity_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setClients(data || [])
        setLoading(false)
      })
  }, [])

  const provisionClient = async (clientId, clientName) => {
    setProvisioning(clientId)
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ client_id: clientId }),
    })
    alert(`Provisioning ${clientName}… Check Telegram for updates.`)
    setProvisioning(null)
  }

  const filtered = filter === 'all' ? clients : clients.filter(c => c.status === filter)
  const activeCount = clients.filter(c => c.status === 'active').length

  return (
    <div className="max-w-3xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Clients</h1>
          <p className="text-gray-600 text-xs mt-0.5">{activeCount} active</p>
        </div>
        <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {['all', 'active', 'inactive'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all capitalize ${
                filter === f ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl py-12 text-center">
          <p className="text-gray-400 text-sm font-medium mb-1">No clients yet</p>
          <p className="text-gray-600 text-xs">Add one via Telegram: "new client: [name]"</p>
        </div>
      )}

      {/* Client list */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(c => {
            const badge = dealBadge(c.deal_type)
            const lastActive = c.last_activity_at
              ? new Date(c.last_activity_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : null
            const stale = !c.last_activity_at || (Date.now() - new Date(c.last_activity_at).getTime()) / 86400000 > 5

            return (
              <div key={c.id} className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition-colors group">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: name + meta */}
                  <Link to={`/clients/${c.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.status === 'active' ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <p className="text-white font-medium group-hover:text-violet-300 transition-colors">{c.name}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pl-3.5">
                      {badge && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                      )}
                      {c.monthly_fee > 0 && (
                        <span className="text-xs text-green-400">${c.monthly_fee.toLocaleString()}/mo</span>
                      )}
                      {c.rev_share_pct > 0 && (
                        <span className="text-xs text-gray-500">{c.rev_share_pct}% rev share</span>
                      )}
                      {lastActive && (
                        <span className={`text-xs ${stale ? 'text-amber-500' : 'text-gray-600'}`}>
                          {stale ? 'stale · ' : ''}active {lastActive}
                        </span>
                      )}
                    </div>
                  </Link>

                  {/* Right: health + actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {c.health_score != null && (
                      <div className="text-right mr-1">
                        <p className={`text-sm font-bold ${healthColor(c.health_score)}`}>{c.health_score}</p>
                        <p className="text-xs text-gray-600">health</p>
                      </div>
                    )}
                    {c.provision_status !== 'live' ? (
                      <button
                        onClick={() => provisionClient(c.id, c.name)}
                        disabled={provisioning === c.id || c.provision_status === 'provisioning'}
                        className="text-xs bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                      >
                        {provisioning === c.id || c.provision_status === 'provisioning' ? 'Provisioning…' : 'Provision'}
                      </button>
                    ) : (
                      <a
                        href={`https://${c.slug}.nexuszc.com`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-violet-400 hover:text-violet-300 transition-colors font-medium"
                      >
                        View site →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

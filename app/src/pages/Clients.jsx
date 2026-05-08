import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

export default function Clients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [provisioning, setProvisioning] = useState(null)

  useEffect(() => {
    supabase
      .from('clients')
      .select('id, name, deal_type, status, monthly_fee, rev_share_pct, slug, provision_status, created_at')
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
    alert(`Provisioning ${clientName}... Check Telegram for updates.`)
    setProvisioning(null)
  }

  if (loading) return <p className="text-gray-400">Loading...</p>

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-bold text-white mb-6">Client Brains</h2>
      {clients.length === 0 && (
        <p className="text-gray-400">No clients yet. Add one via Telegram: "new client: [name]"</p>
      )}
      <div className="flex flex-col gap-3">
        {clients.map(c => (
          <div key={c.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <Link to={`/clients/${c.id}`} className="flex-1 min-w-0">
                <p className="text-white font-medium">{c.name}</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  {c.deal_type || 'no deal type'}
                  {c.monthly_fee ? ` · $${c.monthly_fee}/mo` : ''}
                  {c.rev_share_pct ? ` · ${c.rev_share_pct}% rev share` : ''}
                </p>
              </Link>
              <div className="flex items-center gap-2 ml-3 shrink-0">
                {c.provision_status !== 'live'
                  ? (
                    <button
                      onClick={() => provisionClient(c.id, c.name)}
                      disabled={provisioning === c.id || c.provision_status === 'provisioning'}
                      className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-2 py-1 rounded transition-colors"
                    >
                      {provisioning === c.id || c.provision_status === 'provisioning' ? 'Provisioning...' : '⚡ Provision'}
                    </button>
                  )
                  : (
                    <a
                      href={`https://${c.slug}.nexuszc.com`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      🌐 View site
                    </a>
                  )
                }
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    c.status === 'active'
                      ? 'bg-green-900/40 text-green-400'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {c.status}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

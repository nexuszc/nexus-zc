import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

export default function Clients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('clients')
      .select('id, name, deal_type, status, monthly_fee, rev_share_pct, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setClients(data || [])
        setLoading(false)
      })
  }, [])

  if (loading) return <p className="text-gray-400">Loading...</p>

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-bold text-white mb-6">Client Brains</h2>
      {clients.length === 0 && (
        <p className="text-gray-400">No clients yet. Add one via Telegram: "new client: [name]"</p>
      )}
      <div className="flex flex-col gap-3">
        {clients.map(c => (
          <Link
            key={c.id}
            to={`/clients/${c.id}`}
            className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-4 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white font-medium">{c.name}</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  {c.deal_type || 'no deal type'}
                  {c.monthly_fee ? ` · $${c.monthly_fee}/mo` : ''}
                  {c.rev_share_pct ? ` · ${c.rev_share_pct}% rev share` : ''}
                </p>
              </div>
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
          </Link>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ClientDetail() {
  const { id } = useParams()
  const [client, setClient] = useState(null)
  const [context, setContext] = useState(null)
  const [vas, setVas] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('client_context').select('*').eq('client_id', id).maybeSingle(),
      supabase.from('va_assignments').select('*').eq('client_id', id).eq('status', 'active'),
      supabase.from('entries').select('content, entry_type, created_at, role').eq('client_id', id).order('created_at', { ascending: false }).limit(20),
    ]).then(([c, ctx, v, e]) => {
      setClient(c.data)
      setContext(ctx.data)
      setVas(v.data || [])
      setEntries(e.data || [])
      setLoading(false)
    })
  }, [id])

  if (loading) return <p className="text-gray-400">Loading...</p>
  if (!client) return <p className="text-gray-400">Client not found</p>

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-2xl font-bold text-white">{client.name}</h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400">
          {client.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs text-gray-400 font-semibold uppercase mb-3">Deal</h3>
          <p className="text-sm text-white">{client.deal_type || '—'}</p>
          {client.monthly_fee && <p className="text-sm text-gray-300">${client.monthly_fee}/mo</p>}
          {client.rev_share_pct && <p className="text-sm text-gray-300">{client.rev_share_pct}% rev share</p>}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs text-gray-400 font-semibold uppercase mb-3">Assigned VAs</h3>
          {vas.length === 0 && <p className="text-sm text-gray-500">No VA assigned</p>}
          {vas.map(v => (
            <p key={v.id} className="text-sm text-white">{v.va_name}</p>
          ))}
        </div>
      </div>

      {context && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
          <h3 className="text-xs text-gray-400 font-semibold uppercase mb-3">Client Context</h3>
          {context.core_offer && (
            <p className="text-sm text-gray-300 mb-1">
              <span className="text-gray-500">Offer:</span> {context.core_offer}
            </p>
          )}
          {context.goals && (
            <p className="text-sm text-gray-300 mb-1">
              <span className="text-gray-500">Goals:</span> {context.goals}
            </p>
          )}
          {context.target_audience && (
            <p className="text-sm text-gray-300 mb-1">
              <span className="text-gray-500">Audience:</span> {context.target_audience}
            </p>
          )}
          {context.script && (
            <p className="text-sm text-gray-300 mb-1">
              <span className="text-gray-500">Script:</span> {context.script}
            </p>
          )}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-xs text-gray-400 font-semibold uppercase mb-3">Recent Activity</h3>
        {entries.length === 0 && <p className="text-sm text-gray-500">No activity yet</p>}
        {entries.map((e, i) => (
          <div key={i} className="py-2 border-b border-gray-800 last:border-0">
            <p className="text-sm text-white">{e.content?.slice(0, 150)}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {e.role} · {new Date(e.created_at).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

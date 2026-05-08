import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [insights, setInsights] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('clients').select('id, name, deal_type, status').eq('status', 'active'),
      supabase.from('platform_insights').select('*').eq('status', 'new').order('created_at', { ascending: false }).limit(5),
      supabase.from('entries').select('content, created_at, project_names').eq('task_status', 'open').order('created_at', { ascending: true }),
    ]).then(([c, i, t]) => {
      setClients(c.data || [])
      setInsights(i.data || [])
      setTasks(t.data || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <p className="text-gray-400">Loading...</p>

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold text-white mb-6">Dashboard</h2>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Active Clients</p>
          <p className="text-3xl font-bold text-white">{clients.length}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Open Tasks</p>
          <p className="text-3xl font-bold text-white">{tasks.length}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">New Insights</p>
          <p className="text-3xl font-bold text-white">{insights.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Active Clients</h3>
          {clients.length === 0 && <p className="text-gray-500 text-sm">No clients yet</p>}
          {clients.map(c => (
            <Link
              key={c.id}
              to={`/clients/${c.id}`}
              className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0 hover:text-blue-400 transition-colors"
            >
              <span className="text-sm text-white">{c.name}</span>
              <span className="text-xs text-gray-500">{c.deal_type || 'no deal type'}</span>
            </Link>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Open Tasks</h3>
          {tasks.length === 0 && <p className="text-gray-500 text-sm">No open tasks</p>}
          {tasks.map((t, i) => (
            <div key={i} className="py-2 border-b border-gray-800 last:border-0">
              <p className="text-sm text-white">{t.content?.slice(0, 80)}</p>
              <p className="text-xs text-gray-500 mt-0.5">{new Date(t.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      </div>

      {insights.length > 0 && (
        <div className="mt-6 bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-yellow-400 mb-3">⚡ Platform Insights</h3>
          {insights.map(ins => (
            <p key={ins.id} className="text-sm text-yellow-200 py-1">{ins.insight}</p>
          ))}
        </div>
      )}
    </div>
  )
}

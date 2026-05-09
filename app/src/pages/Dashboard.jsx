import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [insights, setInsights] = useState([])
  const [tasks, setTasks] = useState([])
  const [callActivity, setCallActivity] = useState([])
  const [leadStats, setLeadStats] = useState({})
  const [vaStats, setVaStats] = useState([])
  const [nexusHealth, setNexusHealth] = useState([])
  const [loading, setLoading] = useState(true)
  const [focusResponse, setFocusResponse] = useState(null)
  const [focusLoading, setFocusLoading] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [])

  const loadDashboard = async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [clientsRes, insightsRes, tasksRes, callRes, leadsRes, healthRes] = await Promise.all([
      supabase.from('clients').select('id, name, deal_type, status, monthly_fee, rev_share_pct, health_score, last_activity_at').eq('status', 'active'),
      supabase.from('platform_insights').select('*').eq('status', 'new').order('created_at', { ascending: false }).limit(5),
      supabase.from('entries').select('content, created_at').eq('task_status', 'open').order('created_at', { ascending: true }),
      supabase.from('call_logs').select('outcome, lead_name, logged_at, client_id').gt('logged_at', sevenDaysAgo).order('logged_at', { ascending: false }).limit(20),
      supabase.from('leads').select('client_id, status'),
      supabase.from('nexus_health').select('function_name, status, error_count, success_count').order('checked_at', { ascending: false }).limit(4),
    ])

    setClients(clientsRes.data || [])
    setInsights(insightsRes.data || [])
    setTasks(tasksRes.data || [])
    setCallActivity(callRes.data || [])
    setNexusHealth(healthRes.data || [])

    const stats = {}
    for (const lead of (leadsRes.data || [])) {
      if (!stats[lead.client_id]) stats[lead.client_id] = { total: 0, interested: 0, callback: 0 }
      stats[lead.client_id].total++
      if (lead.status === 'interested') stats[lead.client_id].interested++
      if (lead.status === 'callback') stats[lead.client_id].callback++
    }
    setLeadStats(stats)

    const today = new Date().toISOString().split('T')[0]
    const { data: queues } = await supabase
      .from('va_task_queues')
      .select('va_assignment_id, total_count, completed_count, va_assignments(va_name)')
      .eq('date', today)

    setVaStats(queues || [])
    setLoading(false)
  }

  const handleFocus = async () => {
    setFocusLoading(true)
    setFocusResponse(null)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/nexus-coo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ action: 'focus' }),
      })
      const data = await res.json()
      setFocusResponse(data.response || 'No focus generated.')
    } catch {
      setFocusResponse('Error generating focus. Try again.')
    }
    setFocusLoading(false)
  }

  const isStale = (lastActivity) => {
    if (!lastActivity) return true
    const daysSince = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
    return daysSince > 5
  }

  const healthScoreColor = (score) => {
    if (!score && score !== 0) return 'text-gray-500'
    if (score >= 75) return 'text-green-400'
    if (score >= 50) return 'text-yellow-400'
    return 'text-red-400'
  }

  const callSummary = {
    total: callActivity.length,
    interested: callActivity.filter(c => c.outcome === 'interested').length,
    callback: callActivity.filter(c => c.outcome === 'callback').length,
  }

  const monthlyRevenue = clients.reduce((sum, c) => sum + (c.monthly_fee || 0), 0)

  if (loading) return <p className="text-gray-400">Loading...</p>

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <button
          onClick={handleFocus}
          disabled={focusLoading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-blue-400 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {focusLoading ? '⏳ Thinking...' : '🎯 Get Focus'}
        </button>
      </div>

      {/* Focus response panel */}
      {focusResponse && (
        <div className="bg-blue-950/40 border border-blue-700/40 rounded-xl p-4 mb-6 whitespace-pre-wrap text-sm text-blue-100">
          {focusResponse}
        </div>
      )}

      {/* Top stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Active Clients</p>
          <p className="text-3xl font-bold text-white">{clients.length}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Monthly Revenue</p>
          <p className="text-3xl font-bold text-green-400">${monthlyRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Calls This Week</p>
          <p className="text-3xl font-bold text-white">{callSummary.total}</p>
          <p className="text-xs text-green-400 mt-1">{callSummary.interested} interested</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Open Tasks</p>
          <p className="text-3xl font-bold text-white">{tasks.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Client pipeline */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300">Client Pipeline</h3>
            <Link to="/clients" className="text-xs text-blue-400 hover:text-blue-300">View all</Link>
          </div>
          {clients.length === 0 && <p className="text-gray-500 text-sm">No active clients</p>}
          {clients.map(c => {
            const ls = leadStats[c.id] || { total: 0, interested: 0 }
            const stale = isStale(c.last_activity_at)
            return (
              <Link key={c.id} to={`/clients/${c.id}`}
                className="flex items-center justify-between py-2.5 border-b border-gray-800 last:border-0 hover:text-blue-400 transition-colors group">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-white group-hover:text-blue-400 truncate">{c.name}</span>
                  {stale && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-400 shrink-0">stale</span>
                  )}
                </div>
                <div className="text-right shrink-0 ml-2">
                  {(c.health_score !== null && c.health_score !== undefined) && (
                    <p className={`text-xs font-medium ${healthScoreColor(c.health_score)}`}>
                      ❤ {c.health_score}
                    </p>
                  )}
                  {ls.total > 0 && (
                    <p className="text-xs text-gray-400">{ls.total} leads · {ls.interested} hot</p>
                  )}
                  {c.monthly_fee > 0 && (
                    <p className="text-xs text-green-400">${c.monthly_fee}/mo</p>
                  )}
                </div>
              </Link>
            )
          })}
        </div>

        {/* Call activity feed */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300">Recent Calls</h3>
            <Link to="/leads" className="text-xs text-blue-400 hover:text-blue-300">Lead pipeline</Link>
          </div>
          {callActivity.length === 0 && <p className="text-gray-500 text-sm">No calls logged yet</p>}
          {callActivity.slice(0, 8).map((call, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
              <div>
                <p className="text-sm text-white">{call.lead_name || 'Unknown'}</p>
                <p className="text-xs text-gray-500">{new Date(call.logged_at).toLocaleDateString()}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                call.outcome === 'interested' ? 'bg-green-900/40 text-green-400' :
                call.outcome === 'callback' ? 'bg-yellow-900/40 text-yellow-400' :
                call.outcome === 'not_interested' ? 'bg-red-900/40 text-red-400' :
                'bg-gray-700 text-gray-400'
              }`}>{call.outcome?.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* VA performance */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300">VA Tasks Today</h3>
            <Link to="/va" className="text-xs text-blue-400 hover:text-blue-300">VA interface</Link>
          </div>
          {vaStats.length === 0 && <p className="text-gray-500 text-sm">No task queues generated today</p>}
          {vaStats.map((q, i) => {
            const pct = q.total_count > 0 ? Math.round((q.completed_count / q.total_count) * 100) : 0
            return (
              <div key={i} className="py-2 border-b border-gray-800 last:border-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-white">{q.va_assignments?.va_name || 'VA'}</p>
                  <p className="text-xs text-gray-400">{q.completed_count}/{q.total_count} tasks</p>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Nexus health */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Nexus Health</h3>
          {nexusHealth.length === 0 && <p className="text-gray-500 text-sm">No health data yet</p>}
          {nexusHealth.map(h => (
            <div key={h.function_name} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
              <p className="text-sm text-white">{h.function_name}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{h.success_count} ok · {h.error_count} err</span>
                <span className={`w-2 h-2 rounded-full ${h.status === 'healthy' ? 'bg-green-400' : 'bg-red-400'}`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Open tasks */}
      {tasks.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Open Tasks</h3>
          {tasks.map((t, i) => {
            const ageMs = Date.now() - new Date(t.created_at).getTime()
            const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
            const overdue = ageMs > 48 * 60 * 60 * 1000
            return (
              <div key={i} className="flex items-start justify-between py-2 border-b border-gray-800 last:border-0">
                <p className="text-sm text-white">{t.content?.slice(0, 100)}</p>
                <span className={`text-xs ml-3 shrink-0 ${overdue ? 'text-red-400' : 'text-gray-500'}`}>
                  {ageDays === 0 ? 'today' : `${ageDays}d`}{overdue ? ' overdue' : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Platform insights */}
      {insights.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-yellow-400 mb-3">Platform Insights</h3>
          {insights.map(ins => (
            <p key={ins.id} className="text-sm text-yellow-200 py-1">{ins.insight}</p>
          ))}
        </div>
      )}
    </div>
  )
}

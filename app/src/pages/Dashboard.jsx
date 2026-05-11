import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />
}

function KpiCard({ label, value, sub, accent = 'card-accent-violet', valueColor = 'text-white' }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${accent}`}>
      <p className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold ${valueColor} tabular-nums`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

function ago(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function auditDot(outcome) {
  if (outcome === 'success') return 'bg-green-400'
  if (outcome === 'failed' || outcome === 'error') return 'bg-red-400'
  return 'bg-violet-400'
}

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [tasks, setTasks] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [leadStats, setLeadStats] = useState({})
  const [vaStats, setVaStats] = useState([])
  const [nexusHealth, setNexusHealth] = useState([])
  const [insights, setInsights] = useState([])
  const [loading, setLoading] = useState(true)
  const [focusResponse, setFocusResponse] = useState(null)
  const [focusLoading, setFocusLoading] = useState(false)

  useEffect(() => { loadDashboard() }, [])

  const loadDashboard = async () => {
    const [clientsRes, tasksRes, auditRes, leadsRes, healthRes, insightsRes] = await Promise.all([
      supabase.from('clients').select('id, name, deal_type, status, monthly_fee, rev_share_pct, health_score, last_activity_at').eq('status', 'active'),
      supabase.from('entries').select('content, created_at').eq('task_status', 'open').order('created_at', { ascending: true }),
      supabase.from('nexus_audit_log').select('id, engine, action_type, action_detail, outcome, created_at').order('created_at', { ascending: false }).limit(12),
      supabase.from('leads').select('client_id, status'),
      supabase.from('nexus_health').select('function_name, status, error_count, success_count').order('checked_at', { ascending: false }).limit(4),
      supabase.from('platform_insights').select('id, insight').eq('status', 'new').order('created_at', { ascending: false }).limit(3),
    ])

    setClients(clientsRes.data || [])
    setTasks(tasksRes.data || [])
    setAuditLog(auditRes.data || [])
    setNexusHealth(healthRes.data || [])
    setInsights(insightsRes.data || [])

    const stats = {}
    for (const lead of (leadsRes.data || [])) {
      if (!stats[lead.client_id]) stats[lead.client_id] = { total: 0, interested: 0 }
      stats[lead.client_id].total++
      if (lead.status === 'interested') stats[lead.client_id].interested++
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
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
    return (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24) > 5
  }

  const healthScoreColor = (score) => {
    if (score == null) return 'text-gray-500'
    if (score >= 75) return 'text-green-400'
    if (score >= 50) return 'text-amber-400'
    return 'text-red-400'
  }

  const monthlyRevenue = clients.reduce((sum, c) => sum + (c.monthly_fee || 0), 0)

  return (
    <div className="max-w-5xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Dashboard</h1>
          <p className="text-gray-600 text-xs mt-0.5">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <button
          onClick={handleFocus}
          disabled={focusLoading}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:text-violet-400 text-white text-sm font-semibold rounded-lg transition-all shadow-lg shadow-violet-900/20"
        >
          {focusLoading ? 'Thinking…' : 'Get Focus'}
        </button>
      </div>

      {/* Focus panel */}
      {focusResponse && (
        <div className="bg-violet-950/30 border border-violet-700/30 rounded-xl p-4 mb-6 whitespace-pre-wrap text-sm text-violet-100 leading-relaxed">
          {focusResponse}
        </div>
      )}

      {/* KPI row */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Active Clients" value={clients.length} accent="card-accent-violet" />
          <KpiCard label="Monthly Revenue" value={`$${monthlyRevenue.toLocaleString()}`} accent="card-accent-green" valueColor="text-green-400" />
          <KpiCard label="Open Tasks" value={tasks.length} accent="card-accent-blue" sub={tasks.length > 0 ? 'oldest first' : 'all clear'} />
          <KpiCard label="Engine Events" value={auditLog.length} accent="card-accent-amber" sub="last 12 actions" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Client pipeline */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Client Pipeline</h3>
            <Link to="/clients" className="text-xs text-violet-400 hover:text-violet-300 transition-colors">View all →</Link>
          </div>
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : clients.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-gray-500 text-sm">No active clients</p>
              <p className="text-gray-600 text-xs mt-1">Add via Telegram: "new client: [name]"</p>
            </div>
          ) : (
            <div>
              {clients.map(c => {
                const ls = leadStats[c.id] || { total: 0, interested: 0 }
                const stale = isStale(c.last_activity_at)
                return (
                  <Link key={c.id} to={`/clients/${c.id}`}
                    className="flex items-center justify-between py-2.5 border-b border-gray-800/60 last:border-0 group">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                      <span className="text-sm text-gray-200 group-hover:text-violet-300 truncate transition-colors">{c.name}</span>
                      {stale && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-500 shrink-0">stale</span>}
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      {c.health_score != null && (
                        <p className={`text-xs font-semibold ${healthScoreColor(c.health_score)}`}>{c.health_score}</p>
                      )}
                      {ls.total > 0 && <p className="text-xs text-gray-600">{ls.total} leads</p>}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Engine activity feed */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Engine Activity</h3>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 pulse-dot" />
              <span className="text-xs text-gray-600">live</span>
            </div>
          </div>
          {loading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : auditLog.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-gray-500 text-sm">No engine activity yet</p>
              <p className="text-gray-600 text-xs mt-1">Nexus logs all autonomous actions here</p>
            </div>
          ) : (
            <div className="space-y-0">
              {auditLog.map((e, i) => (
                <div key={e.id || i} className="flex items-start gap-2.5 py-2 border-b border-gray-800/50 last:border-0">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${auditDot(e.outcome)}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate">{e.action_detail || e.action_type || 'action'}</p>
                    <p className="text-xs text-gray-600">{e.engine} · {ago(e.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* VA tasks */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">VA Tasks Today</h3>
            <Link to="/va" className="text-xs text-violet-400 hover:text-violet-300 transition-colors">VA interface →</Link>
          </div>
          {loading ? (
            <Skeleton className="h-12" />
          ) : vaStats.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-gray-500 text-sm">No queues generated today</p>
              <p className="text-gray-600 text-xs mt-1">Trigger via Telegram: "generate va tasks"</p>
            </div>
          ) : (
            <div>
              {vaStats.map((q, i) => {
                const pct = q.total_count > 0 ? Math.round((q.completed_count / q.total_count) * 100) : 0
                return (
                  <div key={i} className="py-2.5 border-b border-gray-800/60 last:border-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm text-gray-200">{q.va_assignments?.va_name || 'VA'}</p>
                      <p className="text-xs text-gray-500">{q.completed_count}/{q.total_count}</p>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1">
                      <div className="bg-violet-500 h-1 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Nexus health */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Nexus Health</h3>
          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : nexusHealth.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-gray-500 text-sm">No health data yet</p>
            </div>
          ) : (
            <div>
              {nexusHealth.map(h => (
                <div key={h.function_name} className="flex items-center justify-between py-2.5 border-b border-gray-800/60 last:border-0">
                  <p className="text-sm text-gray-300">{h.function_name}</p>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs text-gray-600">{h.success_count} ok · {h.error_count} err</span>
                    <span className={`w-2 h-2 rounded-full ${h.status === 'healthy' ? 'bg-green-400' : 'bg-red-400'}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Open tasks */}
      {!loading && tasks.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Open Tasks</h3>
          <div>
            {tasks.map((t, i) => {
              const ageMs = Date.now() - new Date(t.created_at).getTime()
              const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
              const overdue = ageMs > 48 * 60 * 60 * 1000
              return (
                <div key={i} className="flex items-start justify-between py-2.5 border-b border-gray-800/60 last:border-0 gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <div className={`w-1 h-1 rounded-full mt-2 shrink-0 ${overdue ? 'bg-red-400' : 'bg-gray-600'}`} />
                    <p className="text-sm text-gray-300 leading-snug">{t.content?.slice(0, 120)}</p>
                  </div>
                  <span className={`text-xs shrink-0 tabular-nums ${overdue ? 'text-red-400' : 'text-gray-600'}`}>
                    {ageDays === 0 ? 'today' : `${ageDays}d`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Platform insights */}
      {!loading && insights.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl p-4">
          <h3 className="text-xs font-bold text-amber-500/80 uppercase tracking-wider mb-3">Platform Insights</h3>
          <div className="space-y-2">
            {insights.map(ins => (
              <p key={ins.id} className="text-sm text-amber-200/80 leading-relaxed">{ins.insight}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

// ── Utilities ─────────────────────────────────────────────────────────────────
function ago(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function Skeleton({ cls = '' }) {
  return <div className={`skeleton ${cls}`} />
}

const OUTCOME_COLOR = { success: 'bg-emerald-400', failure: 'bg-red-400', failed: 'bg-red-400', error: 'bg-red-400' }
function outcomeDot(outcome) {
  return OUTCOME_COLOR[outcome] || 'bg-violet-500'
}

// ── Quick action card ─────────────────────────────────────────────────────────
function QuickAction({ icon, label, sub, onClick, color = 'violet', disabled = false }) {
  const colors = {
    violet:  'border-violet-500/20 hover:border-violet-500/50 hover:bg-violet-500/5 text-violet-300',
    emerald: 'border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-emerald-300',
    blue:    'border-blue-500/20 hover:border-blue-500/50 hover:bg-blue-500/5 text-blue-300',
    orange:  'border-orange-500/20 hover:border-orange-500/50 hover:bg-orange-500/5 text-orange-300',
  }
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-white/[0.02] transition-all text-left group disabled:opacity-50 disabled:cursor-default ${colors[color]}`}>
      <span className="text-xl leading-none">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-white leading-none mb-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-600">{sub}</p>}
      </div>
    </button>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [clients,    setClients]    = useState([])
  const [tasks,      setTasks]      = useState([])
  const [auditLog,   setAuditLog]   = useState([])
  const [vaStats,    setVaStats]    = useState([])
  const [health,     setHealth]     = useState([])
  const [leadStats,  setLeadStats]  = useState({})
  const [entryCount, setEntryCount] = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [focusResp,  setFocusResp]  = useState(null)
  const [focusLoading, setFocusLoading] = useState(false)
  const [agentState, setAgentState] = useState('idle')
  const feedRef = useRef(null)

  useEffect(() => { load() }, [])

  // Realtime: new audit entries float in
  useEffect(() => {
    const ch = supabase.channel('dashboard-audit')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'nexus_audit_log' }, payload => {
        setAuditLog(prev => [payload.new, ...prev].slice(0, 30))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  const load = async () => {
    const today = new Date().toISOString().split('T')[0]
    const [clRes, tkRes, auRes, leRes, hlRes, ecRes, vaRes] = await Promise.all([
      supabase.from('clients').select('id,name,deal_type,status,monthly_fee,health_score,last_activity_at').eq('status','active'),
      supabase.from('entries').select('id,content,created_at').eq('task_status','open').order('created_at',{ascending:true}).limit(20),
      supabase.from('nexus_audit_log').select('id,engine,action_type,action_detail,outcome,created_at').order('created_at',{ascending:false}).limit(30),
      supabase.from('leads').select('client_id,status'),
      supabase.from('nexus_health').select('function_name,status,error_count,success_count').order('checked_at',{ascending:false}).limit(4),
      supabase.from('entries').select('*',{count:'exact',head:true}),
      supabase.from('va_task_queues').select('va_assignment_id,total_count,completed_count,va_assignments(va_name)').eq('date',today),
    ])
    setClients(clRes.data || [])
    setTasks(tkRes.data || [])
    setAuditLog(auRes.data || [])
    setHealth(hlRes.data || [])
    setEntryCount(ecRes.count || 0)
    setVaStats(vaRes.data || [])
    const stats = {}
    for (const l of (leRes.data || [])) {
      if (!stats[l.client_id]) stats[l.client_id] = { total: 0, interested: 0 }
      stats[l.client_id].total++
      if (l.status === 'interested') stats[l.client_id].interested++
    }
    setLeadStats(stats)
    setLoading(false)
  }

  const handleFocus = async () => {
    setFocusLoading(true)
    setFocusResp(null)
    try {
      const res = await fetch(`${SB_URL}/functions/v1/nexus-coo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SB_KEY}` },
        body: JSON.stringify({ action: 'focus' }),
      })
      const data = await res.json()
      setFocusResp(data.response || 'No focus generated.')
    } catch { setFocusResp('Error. Try again.') }
    setFocusLoading(false)
  }

  const runAgent = async () => {
    if (agentState === 'loading') return
    setAgentState('loading')
    try {
      await fetch(`${SB_URL}/functions/v1/nexus-core`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SB_KEY}` },
        body: JSON.stringify({ trigger: 'manual' }),
      })
      setAgentState('done')
    } catch { setAgentState('error') }
    setTimeout(() => setAgentState('idle'), 3000)
  }

  const monthlyRevenue = clients.reduce((s, c) => s + (c.monthly_fee || 0), 0)
  const activeClients  = clients.length
  const openTasks      = tasks.length
  const auditCount     = auditLog.length

  const isStale = (ts) => !ts || (Date.now() - new Date(ts)) / 86400000 > 5

  const healthColor = (score) => {
    if (score == null) return 'text-gray-600'
    if (score >= 75) return 'text-emerald-400'
    if (score >= 50) return 'text-amber-400'
    return 'text-red-400'
  }

  return (
    <div className="animate-fade-in">

      {/* ── Hero section ───────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-b border-gray-800/40">
        {/* Background glows */}
        <div className="absolute inset-0 bg-gradient-to-br from-violet-600/[0.07] via-transparent to-transparent pointer-events-none" />
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-violet-700/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative px-6 lg:px-10 pt-8 pb-0">
          {/* Header row */}
          <div className="flex items-start justify-between mb-8 gap-4">
            <div>
              <p className="text-gray-600 text-xs font-semibold uppercase tracking-[0.15em] mb-1.5">
                {greeting()} · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <h1 className="text-[28px] font-black text-white tracking-tight leading-none">
                Operations Overview
              </h1>
            </div>
            <button
              onClick={handleFocus}
              disabled={focusLoading}
              className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-900/30"
            >
              {focusLoading ? 'Thinking…' : '↗ Get Focus'}
            </button>
          </div>

          {/* Focus response */}
          {focusResp && (
            <div className="bg-violet-950/40 border border-violet-700/30 rounded-xl p-4 mb-6 text-sm text-violet-100 whitespace-pre-wrap leading-relaxed">
              {focusResp}
            </div>
          )}

          {/* Hero KPI grid */}
          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pb-8">
              {[...Array(4)].map((_, i) => <Skeleton key={i} cls="h-20 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pb-8">
              {[
                { value: `$${monthlyRevenue.toLocaleString()}`, label: 'Monthly Revenue', sub: `${activeClients} active clients`, gradient: 'from-white to-violet-300' },
                { value: activeClients, label: 'Active Clients', sub: 'in pipeline', gradient: 'from-white to-blue-300' },
                { value: openTasks,    label: 'Open Tasks',     sub: openTasks > 0 ? 'need attention' : 'all clear', gradient: openTasks > 5 ? 'from-white to-red-300' : 'from-white to-emerald-300' },
                { value: entryCount,   label: 'Brain Entries',  sub: 'total memories', gradient: 'from-white to-amber-300' },
              ].map((kpi, i) => (
                <div key={i} className="group">
                  <div className={`text-[42px] font-black leading-none tracking-tight tabular-nums bg-gradient-to-br ${kpi.gradient} bg-clip-text text-transparent`}>
                    {kpi.value}
                  </div>
                  <div className="text-[13px] font-semibold text-white/80 mt-2 leading-none">{kpi.label}</div>
                  <div className="text-xs text-gray-600 mt-1">{kpi.sub}</div>
                  <div className="mt-3 h-px bg-gradient-to-r from-white/10 to-transparent" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-6 lg:px-10 py-6">

        {/* ── Quick actions bar ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <QuickAction icon="⚡" label="Run Agent" sub={agentState === 'loading' ? 'Triggering…' : agentState === 'done' ? 'Triggered!' : 'Nexus-core cycle'} onClick={runAgent} color="violet" disabled={agentState === 'loading'} />
          <QuickAction icon="✓" label="Approve All" sub="Pending abilities & actions" onClick={async () => {
            const { data: ab } = await supabase.from('nexus_ability_proposals').select('id').in('status',['proposed','pending']).limit(5)
            const { data: ac } = await supabase.from('nexus_action_queue').select('id').eq('status','pending').limit(5)
            const ops = []
            if (ab?.length) ops.push(supabase.from('nexus_ability_proposals').update({status:'approved'}).in('id',ab.map(a=>a.id)))
            if (ac?.length) ops.push(supabase.from('nexus_action_queue').update({status:'approved'}).in('id',ac.map(a=>a.id)))
            if (ops.length) await Promise.all(ops)
          }} color="emerald" />
          <QuickAction icon="+" label="New Client" sub="Add to pipeline" onClick={() => navigate('/clients')} color="blue" />
          <QuickAction icon="🏠" label="New Job" sub="Roofing OS" onClick={() => navigate('/roofing/jobs/new')} color="orange" />
        </div>

        {/* ── Main content ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Live activity feed — 2 cols */}
          <div className="lg:col-span-2">
            <div className="bg-[#0c0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
                <div>
                  <h2 className="text-sm font-bold text-white">Live Engine Activity</h2>
                  <p className="text-xs text-gray-600 mt-0.5">Real-time from nexus_audit_log</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                  <span className="text-xs text-gray-600">live</span>
                </div>
              </div>

              <div ref={feedRef} className="divide-y divide-white/[0.03] max-h-[480px] overflow-y-auto">
                {loading ? (
                  <div className="p-5 space-y-3">
                    {[...Array(6)].map((_, i) => <Skeleton key={i} cls="h-10 rounded-lg" />)}
                  </div>
                ) : auditLog.length === 0 ? (
                  <div className="px-5 py-12 text-center">
                    <p className="text-gray-600 text-sm">No engine activity yet</p>
                    <p className="text-gray-700 text-xs mt-1">Trigger a nexus-core cycle to see events here</p>
                  </div>
                ) : auditLog.map((e, i) => (
                  <div key={e.id || i} className="flex items-start gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors group">
                    <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${outcomeDot(e.outcome)}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-300 leading-snug truncate">
                        {e.action_detail || e.action_type || 'action'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">{e.engine}</span>
                        <span className="text-[10px] text-gray-700">·</span>
                        <span className="text-[10px] text-gray-700">{e.action_type}</span>
                      </div>
                    </div>
                    <span className="text-[11px] text-gray-700 shrink-0 tabular-nums">{ago(e.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column — clients + tasks */}
          <div className="space-y-5">

            {/* Client pipeline */}
            <div className="bg-[#0c0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
                <h2 className="text-sm font-bold text-white">Clients</h2>
                <Link to="/clients" className="text-xs text-violet-400 hover:text-violet-300 transition-colors">View all →</Link>
              </div>
              <div className="divide-y divide-white/[0.03]">
                {loading ? (
                  <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} cls="h-12 rounded-lg" />)}</div>
                ) : clients.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <p className="text-gray-600 text-sm">No active clients</p>
                    <Link to="/clients" className="text-xs text-violet-500 hover:text-violet-400 mt-1 block">Add one →</Link>
                  </div>
                ) : clients.map(c => {
                  const ls = leadStats[c.id] || { total: 0, interested: 0 }
                  const initials = c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                  return (
                    <Link key={c.id} to={`/clients/${c.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                      <div className="w-7 h-7 rounded-lg bg-violet-600/30 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-violet-300">{initials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 font-medium group-hover:text-violet-300 transition-colors truncate">{c.name}</p>
                        {ls.total > 0 && <p className="text-[11px] text-gray-700">{ls.total} leads · {ls.interested} hot</p>}
                      </div>
                      {c.health_score != null && (
                        <span className={`text-sm font-bold tabular-nums ${healthColor(c.health_score)}`}>{c.health_score}</span>
                      )}
                      {isStale(c.last_activity_at) && (
                        <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider">stale</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Open tasks */}
            {!loading && tasks.length > 0 && (
              <div className="bg-[#0c0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/[0.04]">
                  <h2 className="text-sm font-bold text-white">Open Tasks <span className="text-blue-400 ml-1">{tasks.length}</span></h2>
                </div>
                <div className="divide-y divide-white/[0.03] max-h-64 overflow-y-auto">
                  {tasks.map((t, i) => {
                    const overdue = (Date.now() - new Date(t.created_at)) > 172800000
                    return (
                      <div key={i} className="flex items-start gap-3 px-4 py-3">
                        <div className={`w-1 h-1 rounded-full mt-2 shrink-0 ${overdue ? 'bg-red-400' : 'bg-blue-400'}`} />
                        <p className="text-sm text-gray-400 leading-snug flex-1">{t.content?.slice(0, 100)}</p>
                        <span className={`text-[11px] tabular-nums shrink-0 ${overdue ? 'text-red-500' : 'text-gray-700'}`}>
                          {ago(t.created_at)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* VA tasks today */}
            {!loading && vaStats.length > 0 && (
              <div className="bg-[#0c0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
                  <h2 className="text-sm font-bold text-white">VA Today</h2>
                  <Link to="/va" className="text-xs text-violet-400 hover:text-violet-300 transition-colors">VA →</Link>
                </div>
                <div className="divide-y divide-white/[0.03]">
                  {vaStats.map((q, i) => {
                    const pct = q.total_count > 0 ? Math.round((q.completed_count / q.total_count) * 100) : 0
                    return (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm text-gray-300">{q.va_assignments?.va_name || 'VA'}</p>
                          <p className="text-xs text-gray-600 tabular-nums">{q.completed_count}/{q.total_count}</p>
                        </div>
                        <div className="w-full bg-gray-800/60 rounded-full h-0.5">
                          <div className="bg-violet-500 h-0.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Nexus health strip */}
        {!loading && health.length > 0 && (
          <div className="mt-6 bg-[#0c0c10] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="flex items-center divide-x divide-white/[0.04]">
              <div className="px-5 py-3 shrink-0">
                <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">System Health</p>
              </div>
              {health.map(h => (
                <div key={h.function_name} className="flex items-center gap-2.5 px-5 py-3">
                  <span className={`w-1.5 h-1.5 rounded-full ${h.status === 'healthy' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="text-xs text-gray-500">{h.function_name}</span>
                  <span className="text-[11px] text-gray-700">{h.success_count}↑ {h.error_count}↓</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

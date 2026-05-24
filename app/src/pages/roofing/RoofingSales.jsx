import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function relativeTime(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatFireAt(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>{label}</p>
      <p className="text-3xl font-bold" style={{ color: color || '#ffffff' }}>{value ?? '—'}</p>
    </div>
  )
}

function ScoreBadge({ score }) {
  if (score == null) return <span style={{ color: '#6b7a9d' }}>—</span>
  if (score >= 80) return (
    <span className="px-2 py-1 rounded-lg text-xs font-bold" style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>🔥 {score}</span>
  )
  if (score >= 60) return (
    <span className="px-2 py-1 rounded-lg text-xs font-bold" style={{ background: 'rgba(249,115,22,0.2)', color: '#fb923c' }}>⚡ {score}</span>
  )
  return (
    <span className="px-2 py-1 rounded-lg text-xs font-bold" style={{ background: 'rgba(107,114,128,0.2)', color: '#9ca3af' }}>{score}</span>
  )
}

function Toast({ msg }) {
  if (!msg) return null
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#7c3aed' }}>
      {msg}
    </div>
  )
}

const FUNNEL_STAGES = [
  { key: 'new_lead', label: 'New Lead', color: '#4a9eff' },
  { key: 'contacted', label: 'Contacted', color: '#f59e0b' },
  { key: 'interested', label: 'Interested', color: '#fb923c' },
  { key: 'hot', label: 'Hot', color: '#ef4444' },
  { key: 'signed_up', label: 'Signed Up', color: '#22c55e' },
]

export default function RoofingSales() {
  const navigate = useNavigate()
  const [toast, setToast] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  const [stats, setStats] = useState({ hot: 0, pipeline: 0, callsToday: 0, activeSeq: 0 })
  const [hotLeads, setHotLeads] = useState([])
  const [funnelData, setFunnelData] = useState({})

  const [ariaStats, setAriaStats] = useState({ queued: 0, completedToday: 0, failed: 0 })
  const [ariaQueue, setAriaQueue] = useState([])
  const [ariaLoading, setAriaLoading] = useState(false)

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  const fetchStats = useCallback(async () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [
      { count: hot },
      { count: pipeline },
      { count: callsToday },
      { count: activeSeq },
    ] = await Promise.all([
      supabase.from('roofing_prospects').select('*', { count: 'exact', head: true }).eq('clicked', true).is('outcome', null),
      supabase.from('roofing_prospects').select('*', { count: 'exact', head: true }).is('outcome', null).neq('funnel_stage', 'dead'),
      supabase.from('aria_call_queue').select('*', { count: 'exact', head: true }).eq('status', 'completed').gt('updated_at', todayStart.toISOString()),
      supabase.from('email_sequences').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    ])

    setStats({ hot: hot || 0, pipeline: pipeline || 0, callsToday: callsToday || 0, activeSeq: activeSeq || 0 })
  }, [])

  const fetchHotLeads = useCallback(async () => {
    const { data } = await supabase
      .from('roofing_prospects')
      .select('id, company_name, owner_name, phone, lead_score, last_activity_at, funnel_stage, total_opens, clicked, outcome')
      .or('clicked.eq.true,total_opens.gte.3')
      .is('outcome', null)
      .order('lead_score', { ascending: false })
      .limit(25)
    setHotLeads(data || [])
  }, [])

  const fetchFunnel = useCallback(async () => {
    const { data } = await supabase
      .from('roofing_prospects')
      .select('funnel_stage')
    if (data) {
      const counts = {}
      data.forEach(p => { counts[p.funnel_stage] = (counts[p.funnel_stage] || 0) + 1 })
      setFunnelData(counts)
    }
  }, [])

  const fetchAria = useCallback(async () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [
      { count: queued },
      { count: completedToday },
      { count: failed },
    ] = await Promise.all([
      supabase.from('aria_call_queue').select('*', { count: 'exact', head: true }).eq('status', 'queued'),
      supabase.from('aria_call_queue').select('*', { count: 'exact', head: true }).eq('status', 'completed').gt('updated_at', todayStart.toISOString()),
      supabase.from('aria_call_queue').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    ])
    setAriaStats({ queued: queued || 0, completedToday: completedToday || 0, failed: failed || 0 })

    const { data: queue } = await supabase
      .from('aria_call_queue')
      .select('id, contact_name, contact_type, fire_at, attempt_count')
      .eq('status', 'queued')
      .order('fire_at', { ascending: true })
      .limit(5)
    setAriaQueue(queue || [])
  }, [])

  useEffect(() => {
    fetchStats()
    fetchHotLeads()
    fetchFunnel()
    fetchAria()
  }, [fetchStats, fetchHotLeads, fetchFunnel, fetchAria])

  const copyPhone = (id, phone) => {
    if (!phone) return
    navigator.clipboard.writeText(phone).then(() => {
      setCopiedId(id)
      showToast('Copied!')
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const markContacted = async (id) => {
    await supabase
      .from('roofing_prospects')
      .update({ funnel_stage: 'contacted', last_activity_at: new Date().toISOString() })
      .eq('id', id)
    setHotLeads(prev => prev.filter(l => l.id !== id))
    showToast('Marked contacted')
  }

  const forceBatch = async () => {
    setAriaLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || ANON_KEY
      const res = await fetch(`${SUPABASE_URL}/functions/v1/aria-call-gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'force_batch', limit: 20 }),
      })
      if (res.ok) {
        showToast('20 calls queued!')
        fetchAria()
      } else {
        showToast('Failed to queue calls')
      }
    } catch {
      showToast('Error')
    } finally {
      setAriaLoading(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#0a0d1a', color: '#ffffff' }}>
      <Toast msg={toast} />

      <header className="sticky top-0 z-10 flex items-center justify-between px-4" style={{ height: '56px', background: 'rgba(10,13,26,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(74,158,255,0.2)' }}>
        <button onClick={() => navigate('/roofing/dashboard')} className="flex items-center gap-1 text-sm font-medium transition-opacity hover:opacity-70" style={{ color: '#4a9eff' }}>
          ← Roofing OS
        </button>
        <span className="text-sm font-bold tracking-widest uppercase">Sales</span>
        <div className="w-24" />
      </header>

      <div className="p-4 max-w-7xl mx-auto flex flex-col gap-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Hot Leads" value={stats.hot} color={stats.hot > 0 ? '#ef4444' : '#ffffff'} />
          <StatCard label="In Pipeline" value={stats.pipeline} />
          <StatCard label="Calls Today" value={stats.callsToday} color="#22c55e" />
          <StatCard label="Active Sequences" value={stats.activeSeq} color="#4a9eff" />
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>Hot Leads — Call Now</p>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(74,158,255,0.15)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'rgba(74,158,255,0.05)' }}>
                  {['Company', 'Owner', 'Phone', 'Score', 'Last Touch', 'Actions'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7a9d' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hotLeads.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm" style={{ color: '#6b7a9d' }}>No hot leads right now</td></tr>
                )}
                {hotLeads.map(lead => (
                  <tr key={lead.id} className="border-b" style={{ background: '#12172b', borderColor: 'rgba(255,255,255,0.05)' }}>
                    <td className="px-3 py-2.5 font-medium">{lead.company_name || '—'}</td>
                    <td className="px-3 py-2.5" style={{ color: '#6b7a9d' }}>{lead.owner_name || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{lead.phone || '—'}</td>
                    <td className="px-3 py-2.5"><ScoreBadge score={lead.lead_score} /></td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{relativeTime(lead.last_activity_at)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => copyPhone(lead.id, lead.phone)}
                          title="Copy phone"
                          className="w-7 h-7 flex items-center justify-center rounded transition-opacity hover:opacity-70 text-sm"
                          style={{ background: copiedId === lead.id ? 'rgba(34,197,94,0.2)' : 'rgba(74,158,255,0.15)' }}
                        >
                          {copiedId === lead.id ? '✓' : '📞'}
                        </button>
                        <a
                          href={`mailto:${lead.owner_name ? encodeURIComponent(lead.owner_name) : ''}?subject=${encodeURIComponent('Following up on your interest in Roofing OS')}`}
                          title="Send email"
                          className="w-7 h-7 flex items-center justify-center rounded transition-opacity hover:opacity-70 text-sm"
                          style={{ background: 'rgba(124,58,237,0.15)' }}
                        >
                          ✉
                        </a>
                        <button
                          onClick={() => markContacted(lead.id)}
                          title="Mark as contacted"
                          className="w-7 h-7 flex items-center justify-center rounded transition-opacity hover:opacity-70 text-sm"
                          style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                        >
                          ✓
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#6b7a9d' }}>Funnel</p>
          <div className="rounded-xl p-4" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
            <div className="flex items-center gap-2 overflow-x-auto">
              {FUNNEL_STAGES.map((stage, i) => {
                const count = funnelData[stage.key] || 0
                return (
                  <div key={stage.key} className="flex items-center gap-2 shrink-0">
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: `${stage.color}20`, border: `2px solid ${stage.color}40` }}>
                        <span style={{ color: stage.color }}>{count}</span>
                      </div>
                      <span className="text-[10px] font-medium text-center w-16" style={{ color: '#6b7a9d' }}>{stage.label}</span>
                    </div>
                    {i < FUNNEL_STAGES.length - 1 && (
                      <span className="text-lg shrink-0" style={{ color: 'rgba(74,158,255,0.3)' }}>→</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#6b7a9d' }}>Aria Call Queue</p>
          <div className="rounded-xl p-4 flex flex-col gap-4" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <span className="text-2xl font-bold" style={{ color: '#4a9eff' }}>{ariaStats.queued}</span>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#6b7a9d' }}>Queued</span>
              </div>
              <div className="w-px h-8" style={{ background: 'rgba(74,158,255,0.15)' }} />
              <div className="flex flex-col">
                <span className="text-2xl font-bold" style={{ color: '#22c55e' }}>{ariaStats.completedToday}</span>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#6b7a9d' }}>Done Today</span>
              </div>
              <div className="w-px h-8" style={{ background: 'rgba(74,158,255,0.15)' }} />
              <div className="flex flex-col">
                <span className="text-2xl font-bold" style={{ color: ariaStats.failed > 0 ? '#ef4444' : '#ffffff' }}>{ariaStats.failed}</span>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: '#6b7a9d' }}>Failed</span>
              </div>
              <div className="ml-auto">
                <button
                  onClick={forceBatch}
                  disabled={ariaLoading}
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ background: 'rgba(124,58,237,0.25)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.3)' }}
                >
                  {ariaLoading ? 'Queuing…' : 'Force 20 Calls'}
                </button>
              </div>
            </div>

            {ariaQueue.length > 0 && (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(74,158,255,0.1)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(74,158,255,0.05)' }}>
                      {['Contact', 'Type', 'Fires At', 'Attempts'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7a9d' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ariaQueue.map(item => (
                      <tr key={item.id} className="border-b" style={{ background: 'rgba(10,13,26,0.5)', borderColor: 'rgba(255,255,255,0.04)' }}>
                        <td className="px-3 py-2.5 font-medium">{item.contact_name || '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(74,158,255,0.15)', color: '#4a9eff' }}>
                            {item.contact_type || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{formatFireAt(item.fire_at)}</td>
                        <td className="px-3 py-2.5 text-center text-xs" style={{ color: '#6b7a9d' }}>{item.attempt_count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ariaQueue.length === 0 && (
              <p className="text-sm text-center py-2" style={{ color: '#6b7a9d' }}>No calls queued</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

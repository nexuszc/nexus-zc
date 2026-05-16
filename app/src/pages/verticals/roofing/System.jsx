import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function StatusDot({ status }) {
  const cls = status === 'ok' ? 'bg-green-400' : status === 'error' ? 'bg-red-400 animate-pulse' : 'bg-amber-400'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />
}

function SectionTitle({ children }) {
  return <h2 className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">{children}</h2>
}

export default function System() {
  const [heartbeats, setHeartbeats]   = useState([])
  const [proposals, setProposals]     = useState([])
  const [improvements, setImprovements] = useState([])
  const [tab, setTab]   = useState('health')
  const [loading, setLoading] = useState(true)
  const [acting, setActing]   = useState(null)

  const load = useCallback(async () => {
    const hourAgo = new Date(Date.now() - 3600000).toISOString()
    const [{ data: hb }, { data: props }, { data: impr }] = await Promise.all([
      supabase.from('system_heartbeats')
        .select('function_name, status, response_ms, error_message, recorded_at')
        .gte('recorded_at', hourAgo)
        .order('recorded_at', { ascending: false })
        .limit(100),
      supabase.from('nexus_roofing_proposals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('nexus_improvements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    setHeartbeats(hb || [])
    setProposals(props || [])
    setImprovements(impr || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Deduplicate heartbeats — most recent per function
  const latestByFn = Object.values(
    (heartbeats || []).reduce((acc, h) => {
      if (!acc[h.function_name] || new Date(h.recorded_at) > new Date(acc[h.function_name].recorded_at)) {
        acc[h.function_name] = h
      }
      return acc
    }, {})
  ).sort((a, b) => {
    if (a.status === 'error' && b.status !== 'error') return -1
    if (b.status === 'error' && a.status !== 'error') return 1
    return a.function_name.localeCompare(b.function_name)
  })

  const errors = latestByFn.filter(h => h.status === 'error')
  const ok     = latestByFn.filter(h => h.status !== 'error')

  const actOnProposal = async (id, action) => {
    setActing(id)
    try {
      await supabase.from('nexus_roofing_proposals').update({ status: action }).eq('id', id)
      await load()
    } finally { setActing(null) }
  }

  const actOnImprovement = async (item, action) => {
    setActing(item.id)
    try {
      if (action === 'approve') {
        await fetch(`${SB_URL}/functions/v1/auto-fix`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
          body: JSON.stringify({ improvement_id: item.id }),
        }).catch(() => {})
        await supabase.from('nexus_improvements').update({ status: 'approved' }).eq('id', item.id)
      } else {
        await supabase.from('nexus_improvements').update({ status: 'rejected' }).eq('id', item.id)
      }
      await load()
    } finally { setActing(null) }
  }

  const TABS = [
    { key: 'health',       label: `Health (${latestByFn.length})` },
    { key: 'errors',       label: `Errors (${errors.length})` },
    { key: 'proposals',    label: `Proposals (${proposals.filter(p => p.status === 'pending').length})` },
    { key: 'improvements', label: `Fixes (${improvements.filter(i => i.status === 'pending').length})` },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">System</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {errors.length > 0
              ? <span className="text-red-400">{errors.length} function{errors.length !== 1 ? 's' : ''} in error</span>
              : <span className="text-green-400">All systems nominal</span>
            }
          </p>
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
          Refresh
        </button>
      </div>

      {/* Quick stat row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Healthy</div>
          <div className="text-2xl font-black text-green-400">{ok.length}</div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Errors</div>
          <div className={`text-2xl font-black ${errors.length > 0 ? 'text-red-400' : 'text-white'}`}>{errors.length}</div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Pending Fixes</div>
          <div className="text-2xl font-black text-amber-400">{improvements.filter(i => i.status === 'pending').length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              tab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-[#12121a] text-gray-500 hover:text-gray-300 border border-[#1e1e2e]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-10 w-full rounded-xl" />)}
        </div>
      ) : tab === 'health' || tab === 'errors' ? (
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl overflow-hidden">
          {(tab === 'errors' ? errors : latestByFn).length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-gray-600 text-sm">No errors in the last hour.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest">Function</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest">Status</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden sm:table-cell">Response</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden md:table-cell">Last Check</th>
                </tr>
              </thead>
              <tbody>
                {(tab === 'errors' ? errors : latestByFn).map(h => (
                  <tr key={h.function_name} className="border-b border-[#1e1e2e] last:border-0 hover:bg-white/[0.01]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <StatusDot status={h.status} />
                        <span className="text-sm text-white font-mono">{h.function_name}</span>
                      </div>
                      {h.status === 'error' && h.error_message && (
                        <div className="text-xs text-red-400 mt-0.5 ml-4">{h.error_message?.slice(0, 100)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${h.status === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                        {h.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 hidden sm:table-cell">
                      {h.response_ms != null ? `${h.response_ms}ms` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">
                      {ago(h.recorded_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : tab === 'proposals' ? (
        proposals.length === 0 ? (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
            <p className="text-gray-600 text-sm">No improvement proposals yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map(p => (
              <div key={p.id} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-white">{p.title}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        p.status === 'pending' ? 'text-amber-400 bg-amber-500/10' :
                        p.status === 'approved' ? 'text-green-400 bg-green-500/10' :
                        'text-red-400 bg-red-500/10'
                      }`}>{p.status}</span>
                    </div>
                    <p className="text-xs text-gray-500">{p.description?.slice(0, 200)}</p>
                    <div className="text-[10px] text-gray-700 mt-1">{ago(p.created_at)}</div>
                  </div>
                  {p.status === 'pending' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => actOnProposal(p.id, 'approved')}
                        disabled={acting === p.id}
                        className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
                      >
                        {acting === p.id ? '…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => actOnProposal(p.id, 'rejected')}
                        disabled={acting === p.id}
                        className="text-xs text-gray-500 hover:text-red-400 px-3 py-1 rounded-lg transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        improvements.length === 0 ? (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
            <p className="text-gray-600 text-sm">No auto-fixes queued.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {improvements.map(item => (
              <div key={item.id} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-white">{item.title}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        item.status === 'pending'  ? 'text-amber-400 bg-amber-500/10' :
                        item.status === 'approved' ? 'text-green-400 bg-green-500/10' :
                        item.status === 'deployed' ? 'text-indigo-400 bg-indigo-500/10' :
                        'text-red-400 bg-red-500/10'
                      }`}>{item.status}</span>
                      {item.priority && (
                        <span className="text-[10px] text-gray-600">P{item.priority}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{item.problem?.slice(0, 200)}</p>
                    {item.fix_confidence != null && (
                      <div className="text-[10px] text-gray-700 mt-1">Confidence: {Math.round(item.fix_confidence * 100)}%</div>
                    )}
                    <div className="text-[10px] text-gray-700 mt-0.5">{ago(item.created_at)}</div>
                  </div>
                  {item.status === 'pending' && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => actOnImprovement(item, 'approve')}
                        disabled={acting === item.id}
                        className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
                      >
                        {acting === item.id ? '…' : 'Apply Fix'}
                      </button>
                      <button
                        onClick={() => actOnImprovement(item, 'rejected')}
                        disabled={acting === item.id}
                        className="text-xs text-gray-500 hover:text-red-400 px-3 py-1 rounded-lg transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

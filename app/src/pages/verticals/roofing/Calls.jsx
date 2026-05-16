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

const OUTCOME_COLORS = {
  appointment_booked: 'text-green-400 bg-green-500/10',
  interested:         'text-indigo-400 bg-indigo-500/10',
  callback_requested: 'text-cyan-400 bg-cyan-500/10',
  not_interested:     'text-red-400 bg-red-500/10',
  voicemail:          'text-amber-400 bg-amber-500/10',
  no_answer:          'text-gray-500 bg-gray-700/30',
  portal_sent:        'text-blue-400 bg-blue-500/10',
}

const QUEUE_STATUS_COLORS = {
  pending:    'text-amber-400 bg-amber-500/10',
  fired:      'text-green-400 bg-green-500/10',
  cancelled:  'text-red-400 bg-red-500/10',
}

function OutcomeBadge({ outcome }) {
  const cls = OUTCOME_COLORS[outcome] || 'text-gray-500 bg-gray-800'
  const label = outcome?.replace(/_/g, ' ') || 'unknown'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  )
}

export default function Calls() {
  const [queue, setQueue]   = useState([])
  const [calls, setCalls]   = useState([])
  const [tab, setTab]       = useState('queue')
  const [loading, setLoading] = useState(true)
  const [calling, setCalling] = useState(null)
  const [adding, setAdding]   = useState(false)
  const [addForm, setAddForm] = useState({ phone: '', name: '', prospect_id: '' })
  const [prospectSearch, setProspectSearch] = useState('')
  const [prospectResults, setProspectResults] = useState([])

  const load = useCallback(async () => {
    const [{ data: q }, { data: c }] = await Promise.all([
      supabase.from('aria_call_queue')
        .select('id, call_type, contact_phone, contact_name, contact_type, status, attempt_count, fire_at, queue_reason, created_at')
        .eq('status', 'queued')
        .order('fire_at', { ascending: true })
        .limit(100),
      supabase.from('roofing_aria_calls')
        .select('id, call_type, to_number, outcome, duration_seconds, created_at, buy_signals, transcript')
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    setQueue(q || [])
    setCalls(c || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const searchProspects = async (q) => {
    setProspectSearch(q)
    if (q.length < 2) { setProspectResults([]); return }
    const { data } = await supabase
      .from('roofing_prospects')
      .select('id, owner_name, phone')
      .ilike('owner_name', `%${q}%`)
      .limit(5)
    setProspectResults(data || [])
  }

  const triggerCall = async (item) => {
    setCalling(item.id)
    try {
      await fetch(`${SB_URL}/functions/v1/roofing-aria-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ contact_phone: item.contact_phone, contact_name: item.contact_name, call_type: item.call_type }),
      }).catch(() => {})
      await supabase.from('aria_call_queue').update({ status: 'fired', fired_at: new Date().toISOString() }).eq('id', item.id)
      await load()
    } finally {
      setCalling(null)
    }
  }

  const cancelQueue = async (id) => {
    await supabase.from('aria_call_queue').update({ status: 'cancelled' }).eq('id', id)
    await load()
  }

  const addToQueue = async () => {
    if (!addForm.phone) return
    await supabase.from('aria_call_queue').insert([{
      contact_phone: addForm.phone,
      contact_name: addForm.name || null,
      contact_type: 'new_lead',
      call_type: 'lead_followup',
      fire_at: new Date().toISOString(),
      status: 'queued',
      attempt_count: 0,
    }])
    setAdding(false)
    setAddForm({ phone: '', name: '', prospect_id: '' })
    await load()
  }

  const pendingQueue = queue

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Aria Calls</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {pendingQueue.length} queued · {calls.length} total calls
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
            Refresh
          </button>
          <button
            onClick={() => setAdding(a => !a)}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + Queue Call
          </button>
        </div>
      </div>

      {adding && (
        <div className="mb-4 bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-3">Search for a prospect to queue a call</div>
          <div className="relative mb-3">
            <input
              type="text"
              placeholder="Search prospect name..."
              value={prospectSearch}
              onChange={e => searchProspects(e.target.value)}
              className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
            {prospectResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#12121a] border border-[#1e1e2e] rounded-lg overflow-hidden z-10">
                {prospectResults.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setAddForm({ phone: p.phone, name: p.owner_name, prospect_id: p.id })
                      setProspectSearch(p.owner_name)
                      setProspectResults([])
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-300 hover:bg-white/[0.04] text-left transition-colors"
                  >
                    <span>{p.owner_name}</span>
                    <span className="text-gray-600 font-mono text-xs">{p.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {addForm.prospect_id && (
            <div className="text-xs text-indigo-400 mb-3">Selected: {addForm.name} · {addForm.phone}</div>
          )}
          <div className="flex gap-2">
            <button onClick={addToQueue} disabled={!addForm.prospect_id} className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">
              Add to Queue
            </button>
            <button onClick={() => { setAdding(false); setAddForm({ phone: '', name: '', prospect_id: '' }); setProspectSearch('') }} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4">
        {[
          { key: 'queue', label: `Queue (${pendingQueue.length})` },
          { key: 'recent', label: 'Recent Calls' },
        ].map(t => (
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
          {[1,2,3,4].map(i => <div key={i} className="skeleton h-14 w-full rounded-xl" />)}
        </div>
      ) : tab === 'queue' ? (
        pendingQueue.length === 0 ? (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
            <p className="text-2xl mb-2">📞</p>
            <p className="text-gray-600 text-sm">No calls queued.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingQueue.map(item => {
              return (
                <div key={item.id} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {item.contact_name || 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span className="capitalize">{item.call_type?.replace(/_/g, ' ') || ''}</span>
                      {item.contact_phone && <span className="font-mono text-cyan-400"> · {item.contact_phone}</span>}
                    </div>
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      Attempt {item.attempt_count + 1} · Scheduled {ago(item.fire_at)}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => triggerCall(item)}
                      disabled={calling === item.id}
                      className="text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {calling === item.id ? '…' : 'Call Now'}
                    </button>
                    <button
                      onClick={() => cancelQueue(item.id)}
                      className="text-xs text-gray-600 hover:text-red-400 px-2 py-1.5 rounded-lg transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        calls.length === 0 ? (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
            <p className="text-gray-600 text-sm">No calls recorded yet.</p>
          </div>
        ) : (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest">Prospect</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden sm:table-cell">Outcome</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden md:table-cell">Duration</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest">When</th>
                </tr>
              </thead>
              <tbody>
                {calls.map(call => (
                  <tr key={call.id} className="border-b border-[#1e1e2e] last:border-0 hover:bg-white/[0.01] transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-sm text-white">{call.to_number || '—'}</div>
                      {call.call_type && <div className="text-xs text-gray-600">{call.call_type}</div>}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <OutcomeBadge outcome={call.outcome} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">
                      {call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {ago(call.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

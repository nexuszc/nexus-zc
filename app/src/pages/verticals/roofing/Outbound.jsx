import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const STATES = ['CO', 'TX', 'FL', 'GA', 'OH', 'IL']
const STATE_TARGETS = { CO: 20, TX: 25, FL: 20, GA: 15, OH: 10, IL: 10 }

function ago(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const OUTCOME_COLOR = {
  interested:    'text-green-400',
  voicemail:     'text-amber-400',
  not_interested:'text-gray-500',
  completed:     'text-indigo-400',
  dialing:       'text-cyan-400',
}

let _setToast = null
function toast(msg, type = 'success') {
  if (_setToast) _setToast({ msg, type, id: Date.now() })
}

function Toast({ toast: t }) {
  if (!t) return null
  return (
    <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg ${
      t.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
    }`}>
      {t.msg}
    </div>
  )
}

function ProgressBar({ value, max, color = 'bg-indigo-500' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex-1 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function Outbound() {
  const [todayCalls, setTodayCalls]   = useState(null)
  const [byState, setByState]         = useState({})
  const [recent, setRecent]           = useState([])
  const [paused, setPaused]           = useState(false)
  const [loading, setLoading]         = useState(true)
  const [queueing, setQueueing]       = useState(false)
  const [toastState, setToastState]   = useState(null)

  useEffect(() => { _setToast = setToastState; return () => { _setToast = null } }, [])
  useEffect(() => {
    if (!toastState) return
    const t = setTimeout(() => setToastState(null), 2500)
    return () => clearTimeout(t)
  }, [toastState])

  const load = useCallback(async () => {
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)

    const [{ data: queueData }, { data: pausePref }, { data: recentData }] = await Promise.all([
      supabase.from('aria_call_queue')
        .select('status, metadata, contact_name, contact_phone, created_at, fire_at')
        .gte('fire_at', todayStart.toISOString())
        .order('fire_at', { ascending: false })
        .limit(200),
      supabase.from('nexus_preferences').select('value').eq('key', 'aria_outbound_paused').maybeSingle(),
      supabase.from('aria_call_queue')
        .select('contact_name, status, metadata, fire_at')
        .in('status', ['completed', 'voicemail', 'interested', 'not_interested'])
        .order('fire_at', { ascending: false })
        .limit(20),
    ])

    const queue = queueData || []

    const summary = {
      queued:       queue.filter(c => c.status === 'queued').length,
      dialing:      queue.filter(c => c.status === 'dialing').length,
      completed:    queue.filter(c => c.status === 'completed').length,
      voicemail:    queue.filter(c => c.status === 'voicemail').length,
      interested:   queue.filter(c => c.status === 'interested').length,
      total:        queue.length,
    }
    setTodayCalls(summary)
    setPaused(pausePref?.value === 'true')

    // By state breakdown
    const stateBreakdown: Record<string, { done: number; total: number }> = {}
    for (const s of STATES) stateBreakdown[s] = { done: 0, total: 0 }
    for (const c of queue) {
      const state = (c.metadata as any)?.state
      if (state && stateBreakdown[state]) {
        stateBreakdown[state].total++
        if (['completed', 'voicemail', 'interested', 'not_interested'].includes(c.status)) {
          stateBreakdown[state].done++
        }
      }
    }
    setByState(stateBreakdown)
    setRecent(recentData || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [load])

  const queueToday = async () => {
    setQueueing(true)
    try {
      const res = await fetch(`${SB_URL}/functions/v1/aria-queue-daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.paused) { toast('Outbound is paused', 'error'); return }
      if (data.ok) {
        toast(`Queued ${data.queued} calls ✓`)
        await load()
      } else {
        toast(data.message || data.error || 'Queue failed', 'error')
      }
    } finally {
      setQueueing(false)
    }
  }

  const togglePause = async () => {
    const newVal = !paused
    await supabase.from('nexus_preferences').upsert({ key: 'aria_outbound_paused', value: String(newVal) }, { onConflict: 'key' })
    setPaused(newVal)
    toast(newVal ? 'Outbound paused' : 'Outbound resumed')
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Toast toast={toastState} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Outbound Calls</h1>
          <p className="text-gray-500 text-sm mt-0.5">Aria cold calls — 100/day across 6 states</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">Refresh</button>
        </div>
      </div>

      {/* Today's summary */}
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5 mb-5">
        <div className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-4">Today's Calls</div>
        {loading ? (
          <div className="h-16 animate-pulse bg-[#1e1e2e] rounded-lg" />
        ) : (
          <>
            <div className="flex gap-4 flex-wrap mb-5">
              {[
                { label: 'Queued',      value: todayCalls?.queued,      color: 'text-gray-400' },
                { label: 'Dialing',     value: todayCalls?.dialing,     color: 'text-cyan-400' },
                { label: 'Completed',   value: todayCalls?.completed,   color: 'text-indigo-400' },
                { label: 'Voicemail',   value: todayCalls?.voicemail,   color: 'text-amber-400' },
                { label: 'Interested',  value: todayCalls?.interested,  color: 'text-green-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center min-w-[60px]">
                  <div className={`text-xl font-black ${color}`}>{value ?? '—'}</div>
                  <div className="text-[10px] text-gray-600 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={queueToday}
                disabled={queueing || paused}
                className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {queueing ? 'Queuing…' : '▶ Queue Today\'s Calls'}
              </button>
              <button
                onClick={togglePause}
                className={`text-xs font-semibold px-4 py-2 rounded-lg transition-colors ${
                  paused
                    ? 'bg-green-700 hover:bg-green-600 text-white'
                    : 'bg-[#1e1e2e] hover:bg-red-700 text-gray-400 hover:text-white border border-[#2a2a3e]'
                }`}
              >
                {paused ? '▶ Resume Outbound' : '⏸ Pause Outbound'}
              </button>
            </div>
            {paused && (
              <p className="text-xs text-amber-400 mt-3">⚠️ Outbound is paused — new calls won't be queued until resumed</p>
            )}
          </>
        )}
      </div>

      {/* By state */}
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5 mb-5">
        <div className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-4">By State</div>
        {loading ? (
          <div className="space-y-3">{[1,2,3,4,5,6].map(i => <div key={i} className="h-6 animate-pulse bg-[#1e1e2e] rounded" />)}</div>
        ) : (
          <div className="space-y-3">
            {STATES.map(state => {
              const s = byState[state] || { done: 0, total: 0 }
              const target = STATE_TARGETS[state]
              return (
                <div key={state} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-6">{state}</span>
                  <ProgressBar
                    value={s.done}
                    max={target}
                    color={s.done >= target ? 'bg-green-500' : 'bg-indigo-500'}
                  />
                  <span className="text-xs text-gray-500 w-12 text-right">{s.done}/{target}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent outcomes */}
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5">
        <div className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Recent Outcomes</div>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 animate-pulse bg-[#1e1e2e] rounded" />)}</div>
        ) : recent.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-4">No completed calls yet today.</p>
        ) : (
          <div className="space-y-0">
            {recent.map((call, i) => {
              const state = (call.metadata as any)?.state || '—'
              const company = (call.metadata as any)?.company_name || ''
              return (
                <div key={i} className="flex items-center gap-3 py-2.5 border-b border-[#1e1e2e] last:border-0">
                  <span className="text-xs font-bold text-gray-500 w-6">{state}</span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white">{call.contact_name}</span>
                    {company && <span className="text-xs text-gray-600 ml-2">{company}</span>}
                  </div>
                  <span className={`text-xs font-semibold capitalize ${OUTCOME_COLOR[call.status] || 'text-gray-500'}`}>
                    {call.status.replace('_', ' ')}
                  </span>
                  <span className="text-[10px] text-gray-700">{ago(call.fire_at)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function pct(num, den) {
  if (!den) return '—'
  return `${Math.round(num / den * 100)}%`
}

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 flex flex-col gap-1">
      <div className="text-gray-400 text-xs uppercase tracking-wider">{label}</div>
      <div className={`text-3xl font-bold ${color}`}>{value ?? '—'}</div>
      {sub && <div className="text-gray-500 text-xs">{sub}</div>}
    </div>
  )
}

function Badge({ children, color = 'bg-gray-700 text-gray-300' }) {
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{children}</span>
}

export default function OutreachDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [nudging, setNudging] = useState(null)
  const [outcomes, setOutcomes] = useState({})

  const load = useCallback(async () => {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const [
      { data: prospects },
      { data: logs },
      { data: hotOpens },
      { data: whales },
      { data: recent },
    ] = await Promise.all([
      supabase.from('roofing_prospects').select('id, owner_name, company_name, in_sequence, clicked, whale_alerted, outcome, sequence_day, last_touch_at, email, phone'),
      supabase.from('roofing_outreach_log')
        .select('id, prospect_id, touch_number, delivered, opened, open_count, bounced, spam, first_opened_at, last_opened_at, created_at, subject, direction')
        .eq('direction', 'outbound')
        .gte('created_at', since30d)
        .order('created_at', { ascending: false }),
      supabase.from('roofing_outreach_log')
        .select('id, prospect_id, touch_number, open_count, last_opened_at')
        .gte('open_count', 2)
        .order('open_count', { ascending: false })
        .limit(10),
      supabase.from('roofing_prospects')
        .select('id, owner_name, company_name, phone, whale_alerted_at, sequence_day')
        .eq('whale_alerted', true)
        .is('outcome', null)
        .order('whale_alerted_at', { ascending: false })
        .limit(10),
      supabase.from('roofing_outreach_log')
        .select('id, prospect_id, touch_number, subject, created_at, opened, delivered, bounced')
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const all = prospects || []
    const emailLogs = (logs || []).filter(l => l.touch_number !== 2)

    const pipeline = {
      total: all.length,
      inSeq: all.filter(p => p.in_sequence).length,
      clicked: all.filter(p => p.clicked).length,
      whales: (whales || []).length,
      booked: all.filter(p => p.outcome === 'booked').length,
      dead: all.filter(p => p.outcome === 'dead').length,
      unsubscribed: all.filter(p => p.outcome === 'unsubscribed').length,
    }

    const email = {
      sent: emailLogs.length,
      t1: emailLogs.filter(l => l.touch_number === 1).length,
      t3: emailLogs.filter(l => l.touch_number === 3).length,
      delivered: emailLogs.filter(l => l.delivered).length,
      opened: emailLogs.filter(l => l.opened).length,
      bounced: emailLogs.filter(l => l.bounced).length,
      spam: emailLogs.filter(l => l.spam).length,
    }

    // Build prospect map for hot opens and whales
    const prospectMap = {}
    for (const p of all) prospectMap[p.id] = p

    setData({ pipeline, email, hotOpens: hotOpens || [], whales: whales || [], recent: recent || [], prospectMap, prospects: all })
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60 * 1000)
    return () => clearInterval(interval)
  }, [load])

  async function setOutcome(prospectId, outcome) {
    setOutcomes(prev => ({ ...prev, [prospectId]: 'saving' }))
    await supabase.from('roofing_prospects').update({
      outcome,
      in_sequence: false,
    }).eq('id', prospectId)
    setOutcomes(prev => ({ ...prev, [prospectId]: 'done' }))
    load()
  }

  async function nudge(prospect) {
    setNudging(prospect.id)
    await supabase.from('roofing_prospects').update({
      in_sequence: true,
      sequence_started_at: new Date().toISOString(),
      sequence_day: prospect.sequence_day ?? 0,
    }).eq('id', prospect.id)
    // Fire sequencer
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-outreach-sequencer`
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }).catch(() => {})
    setNudging(null)
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-400">
      Loading outreach data...
    </div>
  )

  const { pipeline, email, hotOpens, whales, recent, prospectMap, prospects } = data
  const deliverRate = pct(email.delivered, email.sent)
  const openRate = pct(email.opened, email.delivered)
  const clickRate = pct(pipeline.clicked, email.sent)

  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 py-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Lead Gen Machine</h1>
          <div className="text-gray-500 text-xs mt-0.5">Refreshes every 60s · Last: {lastRefresh ? ago(lastRefresh) : '—'}</div>
        </div>
        <Link to="/" className="text-gray-500 text-sm hover:text-gray-300">← Dashboard</Link>
      </div>

      {/* Section 1: Pipeline */}
      <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-3">Pipeline</h2>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="In Sequence" value={pipeline.inSeq} />
        <StatCard label="Whales" value={pipeline.whales} color="text-yellow-400" sub="clicked, uncalled" />
        <StatCard label="Booked" value={pipeline.booked} color="text-green-400" />
        <StatCard label="Total Prospects" value={pipeline.total} />
        <StatCard label="Clicked Portal" value={pipeline.clicked} color="text-blue-400" />
        <StatCard label="Dead / Unsub" value={pipeline.dead + pipeline.unsubscribed} color="text-gray-500" />
      </div>

      {/* Section 2: Email Performance */}
      <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-3">Email Performance (30d)</h2>
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Sent" value={email.sent} sub={`T1: ${email.t1} · T3: ${email.t3}`} />
        <StatCard label="Delivered" value={`${deliverRate}`} sub={`${email.delivered} emails`} color="text-blue-400" />
        <StatCard label="Open Rate" value={openRate} sub={`${email.opened} opened`} color="text-green-400" />
        <StatCard label="Click Rate" value={clickRate} sub={`${pipeline.clicked} clicked`} color="text-yellow-400" />
        <StatCard label="Bounced" value={email.bounced} color={email.bounced > 3 ? 'text-red-400' : 'text-gray-400'} />
        <StatCard label="Spam" value={email.spam} color={email.spam > 0 ? 'text-red-400' : 'text-gray-400'} />
      </div>

      {/* Section 3: Whale Queue */}
      {whales.length > 0 && (
        <>
          <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-3">
            🐋 Whale Queue — Call These
          </h2>
          <div className="space-y-2 mb-6">
            {whales.map(w => {
              const saving = outcomes[w.id]
              return (
                <div key={w.id} className="bg-gray-900 rounded-xl p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{w.owner_name}</div>
                    <div className="text-gray-400 text-sm truncate">{w.company_name}</div>
                    <div className="text-blue-400 text-sm mt-0.5">{w.phone || 'no phone'}</div>
                    <div className="text-gray-500 text-xs mt-0.5">Clicked {ago(w.whale_alerted_at)}</div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {saving === 'done' ? (
                      <span className="text-green-400 text-xs">✓ Saved</span>
                    ) : (
                      <>
                        <button
                          onClick={() => setOutcome(w.id, 'booked')}
                          disabled={saving === 'saving'}
                          className="bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
                        >
                          Booked
                        </button>
                        <button
                          onClick={() => setOutcome(w.id, 'dead')}
                          disabled={saving === 'saving'}
                          className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
                        >
                          Dead
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Section 4: Hot Opens */}
      {hotOpens.length > 0 && (
        <>
          <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-3">
            🔥 Hot Opens — Re-read Emails
          </h2>
          <div className="space-y-2 mb-6">
            {hotOpens.map(log => {
              const p = prospectMap[log.prospect_id]
              if (!p) return null
              return (
                <div key={log.id} className="bg-gray-900 rounded-xl p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.owner_name}</div>
                    <div className="text-gray-400 text-sm truncate">{p.company_name}</div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      Touch {log.touch_number} · opened {log.open_count}x · last {ago(log.last_opened_at)}
                    </div>
                  </div>
                  <div className="text-orange-400 text-lg font-bold shrink-0">{log.open_count}×</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Section 5: Recent Sends */}
      <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-3">Recent Sends</h2>
      <div className="space-y-1.5 mb-6">
        {recent.map(log => {
          const p = prospectMap[log.prospect_id]
          const statusDot = log.bounced ? '🔴' : log.opened ? '🟢' : log.delivered ? '🔵' : '⚪'
          return (
            <div key={log.id} className="bg-gray-900 rounded-lg px-4 py-3 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{p?.owner_name || log.prospect_id?.slice(0, 8)}</div>
                <div className="text-gray-500 text-xs truncate">{log.subject || `Touch ${log.touch_number}`}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span title={log.bounced ? 'bounced' : log.opened ? 'opened' : log.delivered ? 'delivered' : 'sent'}>{statusDot}</span>
                <span className="text-gray-500 text-xs">{ago(log.created_at)}</span>
              </div>
            </div>
          )
        })}
        {!recent.length && (
          <div className="text-gray-600 text-sm py-4 text-center">No emails sent yet in the last 30 days</div>
        )}
      </div>

      {/* Nudge any prospect */}
      <h2 className="text-gray-400 text-xs uppercase tracking-widest mb-3">Active Sequence</h2>
      <div className="space-y-1.5">
        {prospects.filter(p => p.in_sequence).slice(0, 20).map(p => (
          <div key={p.id} className="bg-gray-900 rounded-lg px-4 py-3 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{p.owner_name}</div>
              <div className="text-gray-500 text-xs truncate">{p.company_name} · Day {p.sequence_day ?? 0} · last touch {ago(p.last_touch_at)}</div>
            </div>
            <button
              onClick={() => nudge(p)}
              disabled={nudging === p.id}
              className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg disabled:opacity-50 shrink-0"
            >
              {nudging === p.id ? '...' : 'Nudge'}
            </button>
          </div>
        ))}
        {!prospects.filter(p => p.in_sequence).length && (
          <div className="text-gray-600 text-sm py-4 text-center">No prospects currently in sequence</div>
        )}
      </div>
    </div>
  )
}

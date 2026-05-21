import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

function ago(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function StatTile({ label, value, color = 'text-white', loading }) {
  return (
    <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{label}</div>
      {loading
        ? <div className="skeleton h-8 w-14" />
        : <div className={`text-2xl font-black ${color}`}>{value ?? '—'}</div>
      }
    </div>
  )
}

function ActionCard({ icon, title, sub, phone, actionLabel = 'Act', onAction, onDismiss, color = 'indigo' }) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const borderCls = { indigo: 'border-indigo-500/30 hover:border-indigo-500/60', cyan: 'border-cyan-500/30 hover:border-cyan-500/60', amber: 'border-amber-500/30 hover:border-amber-500/60', red: 'border-red-500/30 hover:border-red-500/60', green: 'border-green-500/30 hover:border-green-500/60' }
  const btnCls    = { indigo: 'bg-indigo-600 hover:bg-indigo-500', cyan: 'bg-cyan-700 hover:bg-cyan-600', amber: 'bg-amber-700 hover:bg-amber-600', red: 'bg-red-700 hover:bg-red-600', green: 'bg-green-700 hover:bg-green-600' }

  if (done) return null

  const handle = async () => {
    setLoading(true)
    try { await onAction?.(); setDone(true) } finally { setLoading(false) }
  }

  return (
    <div className={`bg-[#12121a] rounded-xl border p-4 transition-all ${borderCls[color]}`}>
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white leading-tight">{title}</div>
          {sub   && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
          {phone && <div className="text-sm text-cyan-400 font-mono mt-1">{phone}</div>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={handle} disabled={loading} className={`text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${btnCls[color]}`}>
            {loading ? '…' : actionLabel}
          </button>
          {onDismiss && (
            <button onClick={() => { onDismiss?.(); setDone(true) }} className="text-xs text-gray-600 hover:text-gray-400 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">✕</button>
          )}
        </div>
      </div>
    </div>
  )
}

function FeedItem({ icon, text, ts }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-[#1e1e2e] last:border-0">
      <span className="text-base shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-300 leading-snug truncate">{text}</div>
      </div>
      <div className="text-[10px] text-gray-600 shrink-0 mt-0.5 whitespace-nowrap">{ago(ts)}</div>
    </div>
  )
}

function GrowthPanel({ growth }) {
  if (!growth) return null
  const { signupsToday, visitsToday, signupsWeek, totalSignups, bySource, contentQueue, communityPending } = growth
  const goal = 1000
  const remaining = Math.max(0, goal - totalSignups)
  const daysLeft = 60 - Math.floor((Date.now() - new Date('2026-05-21').getTime()) / 86400000)
  const paceNeeded = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0
  const convPct = visitsToday > 0 ? ((signupsToday / visitsToday) * 100).toFixed(1) : '—'
  const onPace = signupsToday >= paceNeeded

  const sources = [
    { label: 'Reddit',   value: bySource?.reddit   || 0 },
    { label: 'Facebook', value: bySource?.facebook  || 0 },
    { label: 'YouTube',  value: bySource?.youtube   || 0 },
    { label: 'Email',    value: bySource?.email     || 0 },
    { label: 'Aria',     value: bySource?.aria      || 0 },
    { label: 'Referral', value: bySource?.referral  || 0 },
    { label: 'Direct',   value: bySource?.direct    || 0 },
  ]
  const maxSource = Math.max(1, ...sources.map(s => s.value))

  return (
    <div className="bg-[#0e0e18] border border-[#1e1e2e] rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] text-gray-600 uppercase tracking-widest font-bold">🚀 Growth — 1,000 Signups in 60 Days</div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${onPace ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
          {onPace ? '✅ On pace' : '⚠️ Behind pace'}
        </span>
      </div>

      {/* Today stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[#12121a] rounded-lg p-3 text-center">
          <div className="text-xl font-black text-white">{signupsToday}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">Signups today</div>
        </div>
        <div className="bg-[#12121a] rounded-lg p-3 text-center">
          <div className="text-xl font-black text-white">{visitsToday}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">Visits today</div>
        </div>
        <div className="bg-[#12121a] rounded-lg p-3 text-center">
          <div className="text-xl font-black text-indigo-400">{convPct}%</div>
          <div className="text-[10px] text-gray-600 mt-0.5">Conversion</div>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-gray-500">{totalSignups} / {goal}</span>
          <span className="text-gray-600">Need {paceNeeded}/day · {daysLeft}d left</span>
        </div>
        <div className="h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${Math.min(100, (totalSignups / goal) * 100)}%` }} />
        </div>
      </div>

      {/* By source */}
      <div className="mb-4">
        <div className="text-[10px] text-gray-700 uppercase tracking-widest mb-2">By Source (7d)</div>
        <div className="space-y-1.5">
          {sources.map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 w-14">{label}</span>
              <div className="flex-1 h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500/70 rounded-full" style={{ width: `${(value / maxSource) * 100}%` }} />
              </div>
              <span className="text-[10px] text-gray-600 w-4 text-right">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Content queue */}
      <div className="flex gap-3 flex-wrap text-[10px] text-gray-600 border-t border-[#1e1e2e] pt-3">
        <span>YT ready: <span className="text-white font-semibold">{contentQueue?.ytReady || 0}</span></span>
        <span>Scripts queued: <span className="text-white font-semibold">{contentQueue?.queued || 0}</span></span>
        <span>Reddit pending: <span className="text-amber-400 font-semibold">{communityPending || 0}</span></span>
        <span>This week: <span className="text-indigo-400 font-semibold">{signupsWeek} signups</span></span>
      </div>
    </div>
  )
}

export default function RoofingOverview() {
  const navigate = useNavigate()
  const [stats, setStats]     = useState(null)
  const [growth, setGrowth]   = useState(null)
  const [actions, setActions] = useState([])
  const [feed, setFeed]       = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const weekAgo = new Date(Date.now() - 7 * 86400000)
    const dayAgo = new Date(Date.now() - 86400000)

    const [
      { count: activeContractors },
      { count: whalesNow },
      { count: emailsToday },
      { count: callsQueued },
      { count: contentPending },
      { data: activeContractorRevenue },
      { data: whaleList },
      { data: hotOpens },
      { data: pendingContent },
      { data: recentErrors },
      { data: recentStorms },
      { data: heartbeats },
      { data: pendingFixes },
      { count: signupsToday },
      { count: signupsWeek },
      { count: totalSignups },
      { count: communityPending },
      { count: ytReady },
      { count: scriptsQueued },
    ] = await Promise.all([
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true }).eq('subscription_status', 'active'),
      supabase.from('roofing_prospects').select('id', { count: 'exact', head: true }).eq('clicked', true).is('outcome', null),
      supabase.from('roofing_outreach_log').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('aria_call_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
      supabase.from('roofing_content').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('contractor_accounts').select('plan_price_cents').eq('subscription_status', 'active'),
      supabase.from('roofing_prospects').select('id, owner_name, company_name, phone, last_activity_at').eq('clicked', true).is('outcome', null).order('last_activity_at', { ascending: false }).limit(5),
      supabase.from('roofing_outreach_log').select('id, prospect_id, open_count, last_opened_at').gte('open_count', 2).order('open_count', { ascending: false }).limit(5),
      supabase.from('roofing_content').select('id, title, type').eq('status', 'pending').limit(5),
      supabase.from('system_heartbeats').select('id, function_name, error_message, recorded_at').eq('status', 'error').gte('recorded_at', dayAgo.toISOString()).limit(3),
      supabase.from('hail_events').select('id, city, state, hail_size_inches, event_date').gte('event_date', new Date(Date.now() - 86400000 * 2).toISOString()).order('hail_size_inches', { ascending: false }).limit(3),
      supabase.from('system_heartbeats').select('function_name, status, response_ms, error_message, recorded_at').order('recorded_at', { ascending: false }).limit(20),
      supabase.from('nexus_improvements').select('id, title, priority').eq('status', 'pending').order('priority', { ascending: true }).limit(5),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString()),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true }),
      supabase.from('roofing_community_posts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('roofing_content').select('id', { count: 'exact', head: true }).eq('youtube_upload_ready', true).is('youtube_video_id', null),
      supabase.from('roofing_content').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    ])

    const mrrCents = (activeContractorRevenue || []).reduce((s, c) => s + (c.plan_price_cents || 0), 0)
    setStats({
      mrr:           mrrCents > 0 ? `$${(mrrCents / 100).toLocaleString()}` : '$0',
      contractors:   activeContractors ?? 0,
      whales:        whalesNow ?? 0,
      emailsToday:   emailsToday ?? 0,
      callsQueued:   callsQueued ?? 0,
      contentPending: contentPending ?? 0,
    })

    setGrowth({
      signupsToday:     signupsToday ?? 0,
      visitsToday:      0, // roofing_page_visits not yet populated
      signupsWeek:      signupsWeek ?? 0,
      totalSignups:     totalSignups ?? 0,
      bySource:         {}, // will populate once signup_source is tracked
      contentQueue:     { ytReady: ytReady ?? 0, queued: scriptsQueued ?? 0 },
      communityPending: communityPending ?? 0,
    })

    const cards = []

    if (whaleList?.length) {
      const w = whaleList[0]
      cards.push({
        id: `whale-${w.id}`,
        icon: '🐋',
        title: `${whaleList.length} prospect${whaleList.length > 1 ? 's' : ''} clicked your portal`,
        sub: `${w.owner_name} · ${w.company_name}`,
        phone: w.phone,
        actionLabel: 'Call Now',
        color: 'cyan',
        onAction: () => navigate('/roofing/pipeline'),
      })
    }

    if (hotOpens?.length) {
      cards.push({
        id: 'hot-opens',
        icon: '👀',
        title: `${hotOpens.length} prospect${hotOpens.length > 1 ? 's' : ''} re-read your email`,
        sub: "They're thinking about it — good time to nudge",
        actionLabel: 'Send Nudge',
        color: 'amber',
        onAction: async () => {
          await fetch(`${SB_URL}/functions/v1/roofing-outreach-sequencer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
            body: JSON.stringify({}),
          }).catch(() => {})
          navigate('/roofing/pipeline')
        },
      })
    }

    if (pendingContent?.length) {
      cards.push({
        id: 'content',
        icon: '📹',
        title: `${pendingContent.length} content piece${pendingContent.length > 1 ? 's' : ''} waiting for approval`,
        sub: pendingContent.map(c => c.title).slice(0, 2).join(' · '),
        actionLabel: 'Review',
        color: 'indigo',
        onAction: () => navigate('/roofing/content'),
      })
    }

    if (recentErrors?.length) {
      const e = recentErrors[0]
      cards.push({
        id: `error-${e.id}`,
        icon: '⚠️',
        title: `${e.function_name} returned an error`,
        sub: e.error_message?.slice(0, 80) || 'Check system logs',
        actionLabel: 'View Errors',
        color: 'red',
        onAction: () => navigate('/roofing/system'),
      })
    }

    if (recentStorms?.length) {
      const s = recentStorms[0]
      cards.push({
        id: `storm-${s.id}`,
        icon: '🌩️',
        title: `Hail storm — ${[s.city, s.state].filter(Boolean).join(', ')}`,
        sub: `${s.hail_size_inches}" hail reported`,
        actionLabel: 'Deploy Marketing',
        color: 'amber',
        onAction: async () => {
          await fetch(`${SB_URL}/functions/v1/roofing-storm-marketing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
            body: JSON.stringify({ hail_event_id: s.id }),
          }).catch(() => {})
        },
      })
    }

    if (pendingFixes?.length) {
      cards.push({
        id: 'pending-fixes',
        icon: '🔧',
        title: `${pendingFixes.length} auto-fix${pendingFixes.length > 1 ? 'es' : ''} ready to review`,
        sub: pendingFixes[0]?.title || 'Review in System → Fixes tab',
        actionLabel: 'Review Fixes',
        color: 'indigo',
        onAction: () => navigate('/roofing/system'),
      })
    }

    setActions(cards)

    // Activity feed: heartbeats + portal activities + email opens
    const feedItems = (heartbeats || []).map(h => ({
      id: `hb-${h.recorded_at}-${h.function_name}`,
      icon: h.status === 'error' ? '⚠️' : '✅',
      text: h.status === 'error'
        ? `${h.function_name} — ${h.error_message?.slice(0, 60) || 'error'}`
        : `${h.function_name} — ${h.response_ms}ms`,
      ts: h.recorded_at,
    }))

    const [{ data: portalActivity }, { data: recentOpens }] = await Promise.all([
      supabase.from('portal_activities').select('title, created_at').order('created_at', { ascending: false }).limit(5),
      supabase.from('roofing_outreach_log').select('prospect_id, open_count, last_opened_at').gte('open_count', 1).gte('last_opened_at', new Date(Date.now() - 3600000 * 4).toISOString()).order('last_opened_at', { ascending: false }).limit(5),
    ])

    for (const a of portalActivity || []) {
      feedItems.push({ id: `portal-${a.created_at}`, icon: '🏠', text: a.title || 'Portal activity', ts: a.created_at })
    }

    const prospectIds = (recentOpens || []).map(r => r.prospect_id).filter(Boolean)
    let prospectNames = {}
    if (prospectIds.length) {
      const { data: names } = await supabase.from('roofing_prospects').select('id, owner_name').in('id', prospectIds)
      prospectNames = Object.fromEntries((names || []).map(p => [p.id, p.owner_name]))
    }
    for (const o of recentOpens || []) {
      feedItems.push({
        id: `open-${o.last_opened_at}-${o.prospect_id}`,
        icon: o.open_count >= 2 ? '🔥' : '📧',
        text: o.open_count >= 2
          ? `Hot open — ${prospectNames[o.prospect_id] || 'Prospect'} (${o.open_count}×)`
          : `Email opened — ${prospectNames[o.prospect_id] || 'Prospect'}`,
        ts: o.last_opened_at,
      })
    }

    feedItems.sort((a, b) => new Date(b.ts) - new Date(a.ts))
    setFeed(feedItems.slice(0, 20))
    setLoading(false)
  }, [navigate])

  useEffect(() => {
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [load])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Growth scoreboard */}
      <GrowthPanel growth={growth} />

      {/* 6-tile stats bar */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Monthly Revenue"     value={stats?.mrr}            loading={loading} />
        <StatTile label="Active Contractors"  value={stats?.contractors}    loading={loading} />
        <StatTile label="Whales Hot"          value={stats?.whales}         color="text-cyan-400"   loading={loading} />
        <StatTile label="Emails Today"        value={stats?.emailsToday}    color="text-indigo-400" loading={loading} />
        <StatTile label="Calls Queued"        value={stats?.callsQueued}    color="text-amber-400"  loading={loading} />
        <StatTile label="Content Pending"     value={stats?.contentPending} loading={loading} />
      </div>

      {/* Action queue */}
      <div className="mb-6">
        <h2 className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">Action Queue</h2>
        {loading ? (
          <div className="space-y-3">
            {[1,2].map(i => <div key={i} className="skeleton h-16 w-full rounded-xl" />)}
          </div>
        ) : actions.length === 0 ? (
          <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] p-8 text-center">
            <p className="text-2xl mb-2">✨</p>
            <p className="text-gray-500 text-sm">Nothing needs you right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {actions.map(card => (
              <ActionCard
                key={card.id}
                {...card}
                onDismiss={() => setActions(prev => prev.filter(a => a.id !== card.id))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Live activity feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] text-gray-600 uppercase tracking-widest font-bold">Live Activity</h2>
          <button onClick={load} className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">Refresh</button>
        </div>
        <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] px-4 py-2">
          {loading ? (
            <div className="space-y-3 py-2">
              {[1,2,3].map(i => <div key={i} className="skeleton h-8 w-full" />)}
            </div>
          ) : feed.length === 0 ? (
            <p className="text-gray-600 text-sm py-4 text-center">No recent activity.</p>
          ) : (
            feed.map(item => <FeedItem key={item.id} {...item} />)
          )}
        </div>
      </div>
    </div>
  )
}

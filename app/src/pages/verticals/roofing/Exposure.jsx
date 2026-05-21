import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const START_DATE = new Date('2026-05-21T00:00:00Z')
const TOTAL_DAYS = 90

function todayStart() {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function weekAgoISO() {
  return new Date(Date.now() - 7 * 86400000).toISOString()
}

function daysElapsed() {
  return Math.max(1, Math.floor((Date.now() - START_DATE.getTime()) / 86400000))
}

function pct(ok, total) {
  return total > 0 ? Math.round((ok / total) * 100) + '%' : '—'
}

function StatusDot({ active }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${active ? 'bg-green-400' : 'bg-red-400'}`} />
  )
}

function SectionLabel({ children }) {
  return <h2 className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">{children}</h2>
}

export default function Exposure() {
  const [kpis, setKpis]           = useState(null)
  const [channels, setChannels]   = useState([])
  const [misc, setMisc]           = useState({})
  const [killSwitches, setKillSwitches] = useState({})
  const [toggling, setToggling]   = useState(null)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const ts  = todayStart()
    const w7  = weekAgoISO()

    const [
      { count: signupsToday },
      { count: totalContractors },
      { count: ytToday },
      { count: ytWeek },
      { count: emailToday },
      { count: emailWeek },
      { count: callsToday },
      { count: callsWeek },
      { count: redditToday },
      { count: redditWeek },
      { count: fbPageToday },
      { count: fbPageWeek },
      { count: fbGroupToday },
      { count: fbGroupWeek },
      { count: nexusNew },
      { count: nexusActive },
      { count: nexusConverted },
      { count: contentPending },
      { count: contentReady },
      { count: contentPub7d },
      { data: partnerships },
      { data: killRows },
      { count: sysOk },
      { count: sysErr },
    ] = await Promise.all([
      // KPIs
      supabase.from('contractor_accounts').select('*', { count: 'exact', head: true }).gte('created_at', ts),
      supabase.from('contractor_accounts').select('*', { count: 'exact', head: true }),
      // YouTube
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).in('type', ['youtube_short', 'youtube_long']).gte('created_at', ts),
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).in('type', ['youtube_short', 'youtube_long']).gte('created_at', w7),
      // Email
      supabase.from('email_log').select('*', { count: 'exact', head: true }).gte('created_at', ts),
      supabase.from('email_log').select('*', { count: 'exact', head: true }).gte('created_at', w7),
      // Calls
      supabase.from('roofing_aria_calls').select('*', { count: 'exact', head: true }).gte('created_at', ts),
      supabase.from('roofing_aria_calls').select('*', { count: 'exact', head: true }).gte('created_at', w7),
      // Reddit
      supabase.from('roofing_community_posts').select('*', { count: 'exact', head: true }).eq('platform', 'reddit').gte('created_at', ts),
      supabase.from('roofing_community_posts').select('*', { count: 'exact', head: true }).eq('platform', 'reddit').gte('created_at', w7),
      // FB Page (published posts)
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).eq('type', 'facebook_post').eq('channel', 'facebook_page').eq('status', 'published').gte('updated_at', ts),
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).eq('type', 'facebook_post').eq('channel', 'facebook_page').eq('status', 'published').gte('updated_at', w7),
      // FB Group (published posts)
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).eq('type', 'facebook_post').eq('channel', 'facebook_group').eq('status', 'published').gte('updated_at', ts),
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).eq('type', 'facebook_post').eq('channel', 'facebook_group').eq('status', 'published').gte('updated_at', w7),
      // Nexus pipeline
      supabase.from('nexus_outbound_prospects').select('*', { count: 'exact', head: true }).eq('status', 'new'),
      supabase.from('nexus_outbound_prospects').select('*', { count: 'exact', head: true }).in('status', ['contacted', 'replied']),
      supabase.from('nexus_outbound_prospects').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
      // Content queue
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).eq('status', 'pending_approval'),
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).eq('status', 'ready_to_copy'),
      supabase.from('roofing_content').select('*', { count: 'exact', head: true }).eq('status', 'published').gte('created_at', w7),
      // Partnerships
      supabase.from('roofing_partnership_targets').select('status, replied_at'),
      // Kill switches
      supabase.from('channel_kill_switches').select('channel, paused'),
      // System health (last 7d)
      supabase.from('system_heartbeats').select('*', { count: 'exact', head: true }).eq('status', 'ok').gte('checked_at', w7),
      supabase.from('system_heartbeats').select('*', { count: 'exact', head: true }).neq('status', 'ok').gte('checked_at', w7),
    ])

    const elapsed = daysElapsed()
    const total   = totalContractors || 0
    const pace    = Math.round((total / elapsed) * TOTAL_DAYS)

    setKpis({
      signupsToday:     signupsToday     || 0,
      totalContractors: total,
      pace,
      daysRemaining: Math.max(0, TOTAL_DAYS - elapsed),
    })

    setChannels([
      { key: 'youtube',        label: 'YouTube',   today: ytToday      || 0, week: ytWeek      || 0, unit: 'shorts' },
      { key: 'email',          label: 'Email',     today: emailToday   || 0, week: emailWeek   || 0, unit: 'sent' },
      { key: 'aria_calls',     label: 'Calls',     today: callsToday   || 0, week: callsWeek   || 0, unit: 'calls' },
      { key: 'reddit',         label: 'Reddit',    today: redditToday  || 0, week: redditWeek  || 0, unit: 'posts' },
      { key: 'facebook_page',  label: 'FB Page',   today: fbPageToday  || 0, week: fbPageWeek  || 0, unit: 'posts' },
      { key: 'facebook_group', label: 'FB Group',  today: fbGroupToday || 0, week: fbGroupWeek || 0, unit: 'posts' },
    ])

    const ks = {}
    for (const row of (killRows || [])) ks[row.channel] = row.paused
    setKillSwitches(ks)

    const ok  = sysOk  || 0
    const err = sysErr || 0
    setMisc({
      nexusNew:       nexusNew       || 0,
      nexusActive:    nexusActive    || 0,
      nexusConverted: nexusConverted || 0,
      contentPending: contentPending || 0,
      contentReady:   contentReady   || 0,
      contentPub7d:   contentPub7d   || 0,
      partnershipsSent:    (partnerships || []).filter(p => p.status === 'sent').length,
      partnershipsPending: (partnerships || []).filter(p => p.status === 'pending').length,
      partnershipsReplied: (partnerships || []).filter(p => p.replied_at).length,
      sysOk:  ok,
      sysErr: err,
      sysUptime: pct(ok, ok + err),
    })

    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { load() }, [load])

  const refresh = () => { setRefreshing(true); load() }

  const toggleKillSwitch = async (channelKey) => {
    const paused = killSwitches[channelKey] || false
    setToggling(channelKey)
    try {
      await supabase
        .from('channel_kill_switches')
        .update({
          paused:    !paused,
          paused_at: !paused ? new Date().toISOString() : null,
        })
        .eq('channel', channelKey)
      setKillSwitches(prev => ({ ...prev, [channelKey]: !paused }))
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div className="h-6 w-48 bg-[#1e1e2e] rounded animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="bg-[#12121a] rounded-xl h-20 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="bg-[#12121a] rounded-xl h-28 animate-pulse" />)}
        </div>
      </div>
    )
  }

  const elapsed = daysElapsed()

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Exposure Machine</h1>
          <p className="text-gray-500 text-sm mt-0.5">Day {elapsed} of {TOTAL_DAYS} — automated reach across 6 channels</p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors disabled:opacity-40"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Row 1 — KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Signups Today</div>
          <div className={`text-2xl font-black ${kpis.signupsToday > 0 ? 'text-green-400' : 'text-white'}`}>
            {kpis.signupsToday}
          </div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Total Contractors</div>
          <div className="text-2xl font-black text-white">{kpis.totalContractors}</div>
          <div className="text-[11px] text-gray-600 mt-1">goal: 100</div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Pace to 100</div>
          <div className={`text-2xl font-black ${
            kpis.pace >= 100 ? 'text-green-400' :
            kpis.pace >= 50  ? 'text-amber-400' :
            'text-red-400'
          }`}>
            {kpis.pace}
            <span className="text-sm font-normal text-gray-600 ml-1">/ 90d</span>
          </div>
        </div>
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Days Remaining</div>
          <div className={`text-2xl font-black ${
            kpis.daysRemaining > 30 ? 'text-white' :
            kpis.daysRemaining > 10 ? 'text-amber-400' :
            'text-red-400'
          }`}>
            {kpis.daysRemaining}
          </div>
        </div>
      </div>

      {/* Row 2 — Channels */}
      <SectionLabel>Channels</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        {channels.map(ch => {
          const paused = killSwitches[ch.key] || false
          return (
            <div
              key={ch.key}
              className={`bg-[#12121a] border rounded-xl p-4 transition-colors ${
                paused ? 'border-red-500/30' : 'border-[#1e1e2e]'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusDot active={!paused} />
                  <span className="text-sm font-semibold text-white">{ch.label}</span>
                </div>
                <button
                  onClick={() => toggleKillSwitch(ch.key)}
                  disabled={toggling === ch.key}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded transition-colors disabled:opacity-40 ${
                    paused
                      ? 'text-green-400 bg-green-500/10 hover:bg-green-500/20'
                      : 'text-red-400 bg-red-500/10 hover:bg-red-500/20'
                  }`}
                >
                  {toggling === ch.key ? '…' : paused ? 'Resume' : 'Pause'}
                </button>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-baseline">
                  <span className="text-[11px] text-gray-600">Today</span>
                  <span className={`text-lg font-black leading-none ${ch.today > 0 ? 'text-white' : 'text-gray-700'}`}>
                    {ch.today}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[11px] text-gray-600">This week</span>
                  <span className={`text-sm font-semibold ${ch.week > 0 ? 'text-gray-300' : 'text-gray-700'}`}>
                    {ch.week}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Row 3 — Pipeline summary */}
      <SectionLabel>Pipeline</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

        {/* Nexus Pipeline */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Nexus Pipeline</div>
          {[
            { label: 'New',       value: misc.nexusNew,       color: 'text-gray-400' },
            { label: 'Active',    value: misc.nexusActive,    color: 'text-amber-400' },
            { label: 'Converted', value: misc.nexusConverted, color: 'text-green-400' },
          ].map(r => (
            <div key={r.label} className="flex justify-between items-center py-0.5">
              <span className="text-xs text-gray-600">{r.label}</span>
              <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* Partnerships */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Partnerships</div>
          {[
            { label: 'Pending', value: misc.partnershipsPending, color: 'text-gray-400' },
            { label: 'Sent',    value: misc.partnershipsSent,    color: 'text-amber-400' },
            { label: 'Replied', value: misc.partnershipsReplied, color: 'text-green-400' },
          ].map(r => (
            <div key={r.label} className="flex justify-between items-center py-0.5">
              <span className="text-xs text-gray-600">{r.label}</span>
              <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* Content Queue */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">Content Queue</div>
          {[
            { label: 'Pending',     value: misc.contentPending, color: misc.contentPending > 0 ? 'text-amber-400' : 'text-gray-400' },
            { label: 'Ready copy',  value: misc.contentReady,   color: misc.contentReady > 0 ? 'text-indigo-400' : 'text-gray-400' },
            { label: 'Pub (7d)',    value: misc.contentPub7d,   color: 'text-green-400' },
          ].map(r => (
            <div key={r.label} className="flex justify-between items-center py-0.5">
              <span className="text-xs text-gray-600">{r.label}</span>
              <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* System Health */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">System (7d)</div>
          {[
            { label: 'OK calls',  value: misc.sysOk,     color: 'text-green-400' },
            { label: 'Errors',    value: misc.sysErr,     color: misc.sysErr > 0 ? 'text-red-400' : 'text-gray-400' },
            { label: 'Uptime',    value: misc.sysUptime,  color: 'text-white' },
          ].map(r => (
            <div key={r.label} className="flex justify-between items-center py-0.5">
              <span className="text-xs text-gray-600">{r.label}</span>
              <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}

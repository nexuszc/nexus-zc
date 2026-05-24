import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function todayStr() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtDollars(cents) {
  if (!cents) return '$0'
  const dollars = cents / 100
  if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(1)}M`
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}K`
  return `$${dollars.toLocaleString()}`
}

function Skeleton({ h = 'h-8', w = 'w-full', className = '' }) {
  return (
    <div className={`bg-[#1a2140] rounded-xl ${h} ${w} animate-pulse ${className}`} />
  )
}

function MiniStat({ label, value, loading }) {
  return (
    <div className="flex flex-col items-center px-4 first:pl-0 last:pr-0">
      <div className="text-[10px] uppercase tracking-widest text-[#6b7a9d] mb-1 whitespace-nowrap">{label}</div>
      {loading
        ? <Skeleton h="h-6" w="w-12" />
        : <div className="text-xl font-black text-white">{value ?? '—'}</div>
      }
    </div>
  )
}

function BrainCard({ label, value, danger, loading }) {
  return (
    <div className="bg-[#12172b] border border-[rgba(124,58,237,0.1)] p-3 rounded-xl flex-1">
      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">{label}</div>
      {loading
        ? <Skeleton h="h-8" w="w-16" />
        : <div className={`text-2xl font-black ${danger && value > 0 ? 'text-[#ef4444]' : 'text-white'}`}>
            {value ?? '—'}
          </div>
      }
    </div>
  )
}

function VerticalCardSkeleton() {
  return (
    <div className="bg-[#12172b] border border-[rgba(124,58,237,0.2)] rounded-2xl p-6 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#1a2140] rounded-l-2xl" />
      <div className="pl-4 space-y-3">
        <div className="flex justify-between items-center">
          <Skeleton h="h-4" w="w-24" />
          <Skeleton h="h-5" w="w-12" />
        </div>
        <Skeleton h="h-10" w="w-20" />
        <div className="flex gap-3">
          <Skeleton h="h-8" w="w-16" />
          <Skeleton h="h-8" w="w-16" />
          <Skeleton h="h-8" w="w-16" />
          <Skeleton h="h-8" w="w-16" />
        </div>
      </div>
    </div>
  )
}

function VerticalCard({ vertical, roofingStats, navigate }) {
  const isRoofing = vertical.slug === 'roofing'
  const color = vertical.color || '#7c3aed'

  const stats = [
    { label: 'Contractors', value: isRoofing ? (roofingStats?.contractors ?? '—') : '—' },
    { label: 'Hot Leads', value: isRoofing ? (roofingStats?.hotLeads ?? '—') : '—' },
    { label: 'Calls Queued', value: isRoofing ? (roofingStats?.calls ?? '—') : '—' },
    { label: 'Emails Today', value: isRoofing ? (roofingStats?.emailsSent ?? '—') : '—' },
  ]

  return (
    <div
      onClick={() => navigate(vertical.route)}
      className="bg-[#12172b] border border-[rgba(124,58,237,0.2)] rounded-2xl p-6 relative overflow-hidden cursor-pointer
        hover:border-[rgba(124,58,237,0.5)] hover:-translate-y-0.5 transition-all duration-150"
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{ backgroundColor: color }}
      />
      <div className="pl-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-white font-bold text-sm">{vertical.name}</span>
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border"
              style={{
                color,
                backgroundColor: `${color}20`,
                borderColor: `${color}40`,
              }}
            >
              LIVE
            </span>
            <span className="font-bold" style={{ color }}>→</span>
          </div>
        </div>

        <div className="mb-3">
          <div className="text-4xl font-black text-white">$0</div>
          <div className="text-[10px] text-[#6b7a9d] mt-0.5">this month</div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="bg-[#1a2140] rounded-lg px-2 py-2">
              <div className="text-[9px] text-[#6b7a9d] uppercase tracking-widest mb-0.5 leading-tight">{s.label}</div>
              <div className="text-base font-black text-white">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function NexusDashboard() {
  const navigate = useNavigate()
  const [verticals, setVerticals] = useState([])
  const [roofingStats, setRoofingStats] = useState(null)
  const [brainStats, setBrainStats] = useState(null)
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const dayAgo = new Date(Date.now() - 86400000)

      const [
        { data: vertsData },
        contractorsRes,
        hotLeadsRes,
        callsRes,
        emailsSentRes,
        cyclesRes,
        directivesRes,
        errorsRes,
      ] = await Promise.all([
        supabase
          .from('nexus_verticals')
          .select('slug, name, route, color, enabled, total_revenue_cents')
          .eq('enabled', true)
          .order('slug'),
        supabase
          .from('contractor_accounts')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('roofing_prospects')
          .select('id', { count: 'exact', head: true })
          .eq('clicked', true)
          .is('outcome', null),
        supabase
          .from('aria_call_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'queued'),
        supabase
          .from('roofing_outreach_log')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayStart.toISOString()),
        supabase
          .from('nexus_agent_cycles')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayStart.toISOString()),
        supabase
          .from('nexus_directives')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
        supabase
          .from('system_heartbeats')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'error')
          .gte('recorded_at', dayAgo.toISOString()),
      ])

      const verts = vertsData || []
      setVerticals(verts)

      const total = verts.reduce((sum, v) => sum + (v.total_revenue_cents || 0), 0)
      setTotalRevenue(total)

      setRoofingStats({
        contractors: contractorsRes.count ?? 0,
        hotLeads: hotLeadsRes.count ?? 0,
        calls: callsRes.count ?? 0,
        emailsSent: emailsSentRes.count ?? 0,
      })

      setBrainStats({
        cycles: cyclesRes.count ?? 0,
        directives: directivesRes.count ?? 0,
        errors: errorsRes.count ?? 0,
      })

      setLoading(false)
    }

    load()
  }, [])

  const totalStr = fmtDollars(totalRevenue)

  return (
    <div className="min-h-screen bg-[#0a0d1a]">
      <div className="sticky top-0 z-10 h-14 flex items-center justify-between px-4
        bg-[rgba(10,13,26,0.92)] backdrop-blur-md border-b border-[rgba(124,58,237,0.15)]">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-lg tracking-tight">NEXUS</span>
          <span className="text-[#7c3aed] text-xs">⬡</span>
          <span className="text-[#7c3aed] font-bold text-lg tracking-tight">ZC</span>
        </div>
        <div className="text-[#6b7a9d] text-sm">{todayStr()}</div>
      </div>

      <div className="mx-4 mt-4 mb-2 rounded-2xl p-6
        bg-gradient-to-br from-[rgba(124,58,237,0.1)] to-[rgba(168,85,247,0.07)]
        border border-[rgba(124,58,237,0.2)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#6b7a9d] mb-1">Total Revenue</div>
            {loading
              ? <Skeleton h="h-14" w="w-32" className="mb-2" />
              : <div className="text-5xl font-black text-white leading-none mb-1">{totalStr}</div>
            }
            <div className="text-sm text-[#6b7a9d]">
              {totalRevenue > 0 ? `↑ ${totalStr} total` : 'No revenue yet'}
            </div>
          </div>

          <div className="flex items-center divide-x divide-[rgba(124,58,237,0.2)]">
            <MiniStat
              label="Active Verticals"
              value={loading ? null : verticals.length || 1}
              loading={loading}
            />
            <MiniStat
              label="Contractors"
              value={loading ? null : (roofingStats?.contractors ?? 0)}
              loading={loading}
            />
            <MiniStat
              label="Hot Leads"
              value={loading ? null : (roofingStats?.hotLeads ?? 0)}
              loading={loading}
            />
          </div>
        </div>
      </div>

      <div className="px-4 mt-5 mb-2">
        <div className="text-[10px] uppercase tracking-widest text-[#6b7a9d]">Verticals</div>
      </div>

      <div className="px-4 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {loading
          ? [0, 1].map((i) => <VerticalCardSkeleton key={i} />)
          : verticals.length > 0
            ? verticals.map((v) => (
                <VerticalCard
                  key={v.slug}
                  vertical={v}
                  roofingStats={roofingStats}
                  navigate={navigate}
                />
              ))
            : (
                <VerticalCard
                  vertical={{ slug: 'roofing', name: 'Roofing OS', route: '/roofing/dashboard', color: '#4a9eff', enabled: true, total_revenue_cents: 0 }}
                  roofingStats={roofingStats}
                  navigate={navigate}
                />
              )
        }
      </div>

      <div className="px-4 mb-2">
        <div className="text-[10px] uppercase tracking-widest text-[#6b7a9d]">Nexus Brain</div>
      </div>

      <div className="px-4 pb-8 flex gap-3">
        <BrainCard
          label="Agent Cycles Today"
          value={brainStats?.cycles ?? 0}
          loading={loading}
        />
        <BrainCard
          label="Active Directives"
          value={brainStats?.directives ?? 0}
          loading={loading}
        />
        <BrainCard
          label="System Errors"
          value={brainStats?.errors ?? 0}
          danger
          loading={loading}
        />
      </div>
    </div>
  )
}

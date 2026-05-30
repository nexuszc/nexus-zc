import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function fmtDollars(cents) {
  if (!cents) return '$0'
  const d = cents / 100
  if (d >= 1000000) return `$${(d / 1000000).toFixed(1)}M`
  if (d >= 1000) return `$${Math.round(d / 1000)}K`
  return `$${d.toLocaleString()}`
}

function Skeleton({ h = 'h-4', w = 'w-full', className = '' }) {
  return <div className={`bg-[#1a2140] rounded ${h} ${w} animate-pulse ${className}`} />
}

function TopStatCard({ label, subLabel, value, trend, color, loading }) {
  return (
    <div className="bg-[#12172b] border border-[rgba(74,158,255,0.15)] rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">{label}</div>
      {loading
        ? <Skeleton h="h-9" w="w-20" className="my-1" />
        : (
          <div className="text-3xl font-black" style={{ color: color || '#ffffff' }}>
            {value ?? '—'}
          </div>
        )
      }
      {subLabel && <div className="text-[10px] text-gray-500 mt-1">{subLabel}</div>}
      {trend && !loading && <div className="text-xs text-gray-500 mt-1">{trend}</div>}
    </div>
  )
}

function SectionCard({ title, subtitle, accent, onClick, loading }) {
  return (
    <div
      onClick={onClick}
      className="bg-[#12172b] border border-[rgba(74,158,255,0.15)] rounded-xl relative overflow-hidden
        cursor-pointer hover:border-[rgba(74,158,255,0.4)] hover:-translate-y-px transition-all duration-150 p-5"
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: accent }}
      />
      <div className="pl-4 flex items-center justify-between">
        <div>
          <div className="text-white font-bold text-sm mb-1">{title}</div>
          {loading
            ? <Skeleton h="h-3" w="w-48" />
            : <div className="text-xs text-[#6b7a9d]">{subtitle}</div>
          }
        </div>
        <div className="text-[#6b7a9d] font-bold ml-4">→</div>
      </div>
    </div>
  )
}

export default function RoofingVertical() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [sections, setSections] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const now = new Date()
      const todayStart = new Date(now)
      todayStart.setHours(0, 0, 0, 0)
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const dayAgo = new Date(Date.now() - 86400000)
      const weekAgo = new Date(Date.now() - 7 * 86400000)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)

      const [
        jobPaymentsRes,
        contractorsRes,
        contractorsNewRes,
        hotLeadsRes,
        emailsOpenedRes,
        ariaCallsRes,
        supplementsRes,
        emailsSentTotalRes,
        emailsOpened30Res,
        youtubeLiveRes,
        hotLeadsSectRes,
        funnelTotalRes,
        callsTodayRes,
        activeJobsRes,
        totalContractorsRes,
        portalsSentRes,
      ] = await Promise.all([
        supabase
          .from('job_payments')
          .select('amount')
          .eq('status', 'paid')
          .gte('updated_at', monthStart.toISOString())
          .catch(() => ({ data: [] })),
        supabase
          .from('contractor_accounts')
          .select('id', { count: 'exact', head: true })
          .neq('plan', 'churned')
          .catch(() => ({ count: 0 })),
        supabase
          .from('contractor_accounts')
          .select('id', { count: 'exact', head: true })
          .neq('plan', 'churned')
          .gte('created_at', weekAgo.toISOString())
          .catch(() => ({ count: 0 })),
        supabase
          .from('roofing_prospects')
          .select('id', { count: 'exact', head: true })
          .or('clicked.eq.true,total_opens.gte.3')
          .is('outcome', null)
          .catch(() => ({ count: 0 })),
        supabase
          .from('roofing_outreach_log')
          .select('id', { count: 'exact', head: true })
          .eq('opened', true)
          .gte('last_opened_at', dayAgo.toISOString())
          .catch(() => ({ count: 0 })),
        supabase
          .from('aria_call_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('updated_at', todayStart.toISOString())
          .catch(() => ({ count: 0 })),
        supabase
          .from('supplement_status')
          .select('amount_approved_cents')
          .gte('updated_at', monthStart.toISOString())
          .catch(() => ({ data: [] })),
        supabase
          .from('roofing_outreach_log')
          .select('id', { count: 'exact', head: true })
          .eq('direction', 'outbound')
          .gte('created_at', thirtyDaysAgo.toISOString())
          .catch(() => ({ count: 0 })),
        supabase
          .from('roofing_outreach_log')
          .select('id', { count: 'exact', head: true })
          .eq('opened', true)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .catch(() => ({ count: 0 })),
        supabase
          .from('roofing_content')
          .select('id', { count: 'exact', head: true })
          .ilike('type', '%youtube%')
          .not('published_url', 'is', null)
          .catch(() => ({ count: 0 })),
        supabase
          .from('roofing_prospects')
          .select('id', { count: 'exact', head: true })
          .eq('clicked', true)
          .is('outcome', null)
          .catch(() => ({ count: 0 })),
        supabase
          .from('roofing_prospects')
          .select('id', { count: 'exact', head: true })
          .is('outcome', null)
          .catch(() => ({ count: 0 })),
        supabase
          .from('aria_call_queue')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed')
          .gte('updated_at', todayStart.toISOString())
          .catch(() => ({ count: 0 })),
        supabase
          .from('roofing_jobs')
          .select('id', { count: 'exact', head: true })
          .catch(() => ({ count: 0 })),
        supabase
          .from('contractor_accounts')
          .select('id', { count: 'exact', head: true })
          .catch(() => ({ count: 0 })),
        supabase
          .from('homeowner_sessions')
          .select('id', { count: 'exact', head: true })
          .catch(() => ({ count: 0 })),
      ])

      const revenueCents = (jobPaymentsRes.data || []).reduce(
        (sum, row) => sum + (row.amount || 0),
        0
      )

      const suppCents = (supplementsRes.data || []).reduce(
        (sum, row) => sum + (row.amount_approved_cents || 0),
        0
      )

      setStats({
        revenue: fmtDollars(revenueCents * 100),
        contractors: contractorsRes.count ?? 0,
        contractorsNew: contractorsNewRes.count ?? 0,
        hotLeads: hotLeadsRes.count ?? 0,
        emailsOpened: emailsOpenedRes.count ?? 0,
        ariaCalls: ariaCallsRes.count ?? 0,
        supplements: fmtDollars(suppCents),
      })

      setSections({
        emailsSentTotal: emailsSentTotalRes.count ?? 0,
        emailsOpened30: emailsOpened30Res.count ?? 0,
        youtubeLive: youtubeLiveRes.count ?? 0,
        hotLeads: hotLeadsSectRes.count ?? 0,
        funnelTotal: funnelTotalRes.count ?? 0,
        callsToday: callsTodayRes.count ?? 0,
        activeJobs: activeJobsRes.count ?? 0,
        totalContractors: totalContractorsRes.count ?? 0,
        portalsSent: portalsSentRes.count ?? 0,
      })

      setLoading(false)
    }

    load()
  }, [])

  return (
    <div className="min-h-screen bg-[#0a0d1a]">
      <div className="sticky top-0 z-10 h-14 flex items-center justify-between px-4
        bg-[rgba(10,13,26,0.92)] backdrop-blur-md border-b border-[rgba(74,158,255,0.2)]">
        <button
          onClick={() => navigate('/')}
          className="text-[#4a9eff] hover:text-blue-300 text-sm font-medium transition-colors"
        >
          ← Dashboard
        </button>
        <div className="text-white font-bold text-sm tracking-wide">ROOFING OS</div>
        <div className="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[10px] font-bold uppercase
          px-2 py-0.5 rounded-full">
          LIVE
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 px-4 py-4">
        <TopStatCard
          label="Revenue"
          subLabel="This Month"
          value={loading ? null : stats?.revenue}
          trend="from job payments"
          color="#22c55e"
          loading={loading}
        />
        <TopStatCard
          label="Contractors"
          subLabel="Active"
          value={loading ? null : stats?.contractors}
          trend={loading ? null : `+ ${stats?.contractorsNew ?? 0} this week`}
          color="#ffffff"
          loading={loading}
        />
        <TopStatCard
          label="Hot Leads"
          subLabel="To Call"
          value={loading ? null : stats?.hotLeads}
          color={!loading && stats?.hotLeads > 0 ? '#ef4444' : '#ffffff'}
          loading={loading}
        />
        <TopStatCard
          label="Emails Opened"
          subLabel="Last 24h"
          value={loading ? null : stats?.emailsOpened}
          color="#f59e0b"
          loading={loading}
        />
        <TopStatCard
          label="Aria Calls"
          subLabel="Done Today"
          value={loading ? null : stats?.ariaCalls}
          color="#a855f7"
          loading={loading}
        />
        <TopStatCard
          label="Supplements"
          subLabel="Recovered"
          value={loading ? null : stats?.supplements}
          color="#22c55e"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 pb-6">
        <SectionCard
          title="Marketing"
          subtitle={
            loading
              ? ''
              : `${sections?.emailsSentTotal ?? 0} emails sent · ${sections?.emailsOpened30 ?? 0} opened · ${sections?.youtubeLive ?? 0} YouTube`
          }
          accent="#4a9eff"
          onClick={() => navigate('/roofing/marketing')}
          loading={loading}
        />
        <SectionCard
          title="Social"
          subtitle="Reddit opportunities · LinkedIn · X post queue"
          accent="#ff4500"
          onClick={() => navigate('/roofing/social')}
          loading={loading}
        />
        <SectionCard
          title="Sales"
          subtitle={
            loading
              ? ''
              : `${sections?.hotLeads ?? 0} hot leads · ${sections?.funnelTotal ?? 0} in pipeline · ${sections?.callsToday ?? 0} calls today`
          }
          accent="#ef4444"
          onClick={() => navigate('/roofing/sales')}
          loading={loading}
        />
        <SectionCard
          title="Operations"
          subtitle={
            loading
              ? ''
              : `${sections?.activeJobs ?? 0} active jobs · track crew and jobs`
          }
          accent="#4a9eff"
          onClick={() => navigate('/roofing/admin/jobs')}
          loading={loading}
        />
        <SectionCard
          title="Finance"
          subtitle={
            loading
              ? ''
              : `${stats?.revenue ?? '$0'} collected · contractor billing`
          }
          accent="#22c55e"
          onClick={() => navigate('/roofing/finance')}
          loading={loading}
        />
        <SectionCard
          title="Customers"
          subtitle={
            loading
              ? ''
              : `${sections?.totalContractors ?? 0} contractors · ${sections?.portalsSent ?? 0} portals sent`
          }
          accent="#f59e0b"
          onClick={() => navigate('/roofing/customers')}
          loading={loading}
        />
        <SectionCard
          title="Product & System"
          subtitle="Functions · health · deploy log"
          accent="#6b7a9d"
          onClick={() => navigate('/roofing/product-status')}
          loading={loading}
        />
      </div>
    </div>
  )
}

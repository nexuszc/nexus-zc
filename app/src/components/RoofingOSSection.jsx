import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function ago(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const PLAN_COLORS = {
  door:    'bg-slate-700/50 text-slate-300',
  taste:   'bg-green-900/40 text-green-400',
  revenue: 'bg-blue-900/40 text-blue-400',
  command: 'bg-purple-900/40 text-purple-400',
}

export default function RoofingOSSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  const load = async () => {
    const today = new Date().toISOString().split('T')[0]
    const currentMonth = new Date().toISOString().slice(0, 7)

    const [
      { count: totalContractors },
      { count: activeContractors },
      { count: trialContractors },
      { count: jobsToday },
      { count: jobsMonth },
      { data: tiers },
      { data: churnRisk },
      { data: recentUpgrades },
      { data: recentJobs }
    ] = await Promise.all([
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true }),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true })
        .eq('status', 'active').eq('subscription_status', 'active'),
      supabase.from('contractor_accounts').select('id', { count: 'exact', head: true })
        .eq('status', 'active').eq('subscription_status', 'trialing'),
      supabase.from('roofing_jobs').select('id', { count: 'exact', head: true })
        .gte('created_at', today + 'T00:00:00'),
      supabase.from('roofing_jobs').select('id', { count: 'exact', head: true })
        .gte('created_at', currentMonth + '-01T00:00:00'),
      supabase.from('contractor_accounts').select('plan').eq('status', 'active'),
      supabase.from('contractor_accounts')
        .select('id, company_name, owner_name, churn_risk_score, plan, owner_phone')
        .eq('status', 'active').gte('churn_risk_score', 70)
        .order('churn_risk_score', { ascending: false }).limit(5),
      supabase.from('contractor_upgrade_events')
        .select('contractor_id, from_tier, to_tier, trigger_type, upgrade_initiated_at')
        .order('upgrade_initiated_at', { ascending: false }).limit(5),
      supabase.from('roofing_jobs')
        .select('id, property_address, status, contractor_id, created_at')
        .order('created_at', { ascending: false }).limit(5)
    ])

    // Tier breakdown
    const tierCounts = {}
    for (const c of (tiers || [])) {
      const p = c.plan || 'door'
      tierCounts[p] = (tierCounts[p] || 0) + 1
    }

    setData({
      totalContractors: totalContractors || 0,
      activeContractors: activeContractors || 0,
      trialContractors: trialContractors || 0,
      jobsToday: jobsToday || 0,
      jobsMonth: jobsMonth || 0,
      tierCounts,
      churnRisk: churnRisk || [],
      recentUpgrades: recentUpgrades || [],
      recentJobs: recentJobs || []
    })
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="mt-8 bg-[#0c0c10] border border-orange-500/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.04] flex items-center gap-2">
          <span className="text-orange-400/80 text-sm font-bold">🏠 Roofing OS</span>
        </div>
        <div className="p-5 space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  const { totalContractors, activeContractors, trialContractors, jobsToday, jobsMonth, tierCounts, churnRisk, recentUpgrades, recentJobs } = data

  return (
    <div className="mt-8">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-orange-400">🏠</span>
          <h2 className="text-sm font-bold text-white">Roofing OS</h2>
          <span className="text-[10px] font-bold text-orange-500/60 uppercase tracking-widest">GTM Channel</span>
        </div>
        <Link to="/roofing" className="text-xs text-orange-400 hover:text-orange-300 transition-colors">
          Open dashboard →
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* KPIs + Tier breakdown */}
        <div className="bg-[#0c0c10] border border-orange-500/10 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.04]">
            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Platform Stats</p>
          </div>
          <div className="p-5 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { val: totalContractors, label: 'Total' },
                { val: activeContractors, label: 'Active', color: 'text-emerald-400' },
                { val: trialContractors, label: 'Trial', color: 'text-amber-400' },
              ].map((kpi, i) => (
                <div key={i} className="text-center">
                  <div className={`text-2xl font-black tabular-nums ${kpi.color || 'text-white'}`}>{kpi.val}</div>
                  <div className="text-[10px] text-gray-600 mt-0.5 font-medium">{kpi.label}</div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-white/[0.04]">
              <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-2">By Tier</p>
              <div className="space-y-1.5">
                {['door', 'taste', 'revenue', 'command'].map(plan => (
                  <div key={plan} className="flex items-center justify-between">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${PLAN_COLORS[plan]}`}>
                      {plan.charAt(0).toUpperCase() + plan.slice(1)}
                    </span>
                    <span className="text-sm font-bold text-white tabular-nums">{tierCounts[plan] || 0}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-3 border-t border-white/[0.04] grid grid-cols-2 gap-3">
              <div>
                <div className="text-xl font-black text-blue-400 tabular-nums">{jobsToday}</div>
                <div className="text-[10px] text-gray-600 font-medium">Jobs Today</div>
              </div>
              <div>
                <div className="text-xl font-black text-white tabular-nums">{jobsMonth}</div>
                <div className="text-[10px] text-gray-600 font-medium">This Month</div>
              </div>
            </div>
          </div>
        </div>

        {/* Churn risk */}
        <div className="bg-[#0c0c10] border border-orange-500/10 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Churn Risk</p>
            {churnRisk.length > 0 && (
              <span className="text-[11px] font-bold text-red-400">{churnRisk.length} at risk</span>
            )}
          </div>
          <div className="divide-y divide-white/[0.03]">
            {churnRisk.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-emerald-400 text-sm font-semibold">All clear</p>
                <p className="text-xs text-gray-600 mt-1">No contractors at high churn risk</p>
              </div>
            ) : churnRisk.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 font-medium truncate">{c.company_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PLAN_COLORS[c.plan] || PLAN_COLORS.door}`}>
                      {c.plan}
                    </span>
                    {c.owner_phone && <span className="text-[10px] text-gray-700">{c.owner_phone}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-lg font-black tabular-nums ${
                    c.churn_risk_score >= 85 ? 'text-red-400' : 'text-amber-400'
                  }`}>{c.churn_risk_score}</div>
                  <div className="text-[10px] text-gray-700">risk</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent upgrades + recent jobs */}
        <div className="space-y-4">
          {/* Recent upgrades */}
          <div className="bg-[#0c0c10] border border-orange-500/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.04]">
              <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Recent Upgrades</p>
            </div>
            <div className="divide-y divide-white/[0.03]">
              {recentUpgrades.length === 0 ? (
                <div className="px-5 py-6 text-center">
                  <p className="text-xs text-gray-600">No upgrades yet</p>
                </div>
              ) : recentUpgrades.map((u, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 font-medium">
                      {u.from_tier} → <span className="text-emerald-400">{u.to_tier}</span>
                    </p>
                    <p className="text-[10px] text-gray-700 mt-0.5">{u.trigger_type?.replace(/_/g, ' ')}</p>
                  </div>
                  <span className="text-[11px] text-gray-700 tabular-nums shrink-0">{ago(u.upgrade_initiated_at)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent jobs */}
          <div className="bg-[#0c0c10] border border-orange-500/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.04]">
              <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Recent Jobs</p>
            </div>
            <div className="divide-y divide-white/[0.03]">
              {recentJobs.length === 0 ? (
                <div className="px-5 py-6 text-center">
                  <p className="text-xs text-gray-600">No jobs yet</p>
                </div>
              ) : recentJobs.map((j, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    j.status === 'completed' ? 'bg-emerald-400' :
                    j.status === 'in_progress' ? 'bg-amber-400' :
                    j.status === 'pending_upgrade' ? 'bg-orange-400' :
                    'bg-blue-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-300 truncate">{j.property_address || 'Address unknown'}</p>
                  </div>
                  <span className="text-[11px] text-gray-700 tabular-nums shrink-0">{ago(j.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

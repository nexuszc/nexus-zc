import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'whale',      label: '🐋 Whales' },
  { key: 'hot',        label: '🔥 Hot Opens' },
  { key: 'cold',       label: '🌡️ Going Cold' },
  { key: 'sequence',   label: 'In Sequence' },
  { key: 'clicked',    label: 'Clicked' },
  { key: 'booked',     label: 'Booked' },
  { key: 'dead',       label: 'Dead' },
]

const STATUS_COLORS = {
  new:        'text-gray-400 bg-gray-500/10',
  contacted:  'text-blue-400 bg-blue-500/10',
  interested: 'text-indigo-400 bg-indigo-500/10',
  booked:     'text-green-400 bg-green-500/10',
  dead:       'text-red-400 bg-red-500/10',
  converted:  'text-emerald-400 bg-emerald-500/10',
}

function Badge({ status }) {
  const cls = STATUS_COLORS[status] || 'text-gray-500 bg-gray-800'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>
      {status}
    </span>
  )
}

function ProspectRow({ p, log, onAction }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)

  const hotOpens = log?.filter(l => l.prospect_id === p.id && l.open_count >= 2)
  const lastOpen = log?.find(l => l.prospect_id === p.id && l.last_opened_at)
  const isAutoFound = AUTO_FOUND_SOURCES.includes(p.source) && p.created_at > new Date(Date.now() - 86400000).toISOString()

  const act = async (type) => {
    setActing(type)
    try { await onAction(p, type) } finally { setActing(null) }
  }

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        className="border-b border-[#1e1e2e] hover:bg-white/[0.02] cursor-pointer transition-colors"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {p.whale_alerted && <span className="text-base leading-none">🐋</span>}
            {hotOpens?.length > 0 && <span className="text-base leading-none">🔥</span>}
            {isAutoFound && <span className="text-base leading-none" title="Auto-found by prospector">🤖</span>}
            <div>
              <div className="text-sm font-semibold text-white">{p.owner_name || '—'}</div>
              <div className="text-xs text-gray-500">{p.company_name || ''}</div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
          <div className="text-sm text-gray-400 font-mono">{p.phone || '—'}</div>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <Badge status={p.status || 'new'} />
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <div className="text-xs text-gray-500">
            {lastOpen ? `opened ${ago(lastOpen.last_opened_at)} ago` : p.last_contacted_at ? `contacted ${ago(p.last_contacted_at)} ago` : '—'}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => act('nudge')}
              disabled={acting === 'nudge'}
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors disabled:opacity-40"
            >
              {acting === 'nudge' ? '…' : 'Nudge'}
            </button>
            <button
              onClick={() => act('call')}
              disabled={acting === 'call'}
              className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded hover:bg-cyan-500/10 transition-colors disabled:opacity-40"
            >
              {acting === 'call' ? '…' : 'Call'}
            </button>
            <button
              onClick={() => act('dead')}
              disabled={acting === 'dead'}
              className="text-[11px] font-semibold text-gray-600 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/5 transition-colors disabled:opacity-40"
            >
              ✕
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[#0e0e18] border-b border-[#1e1e2e]">
          <td colSpan={5} className="px-4 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Email</div>
                <div className="text-gray-300">{p.email || '—'}</div>
              </div>
              <div>
                <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">City / State</div>
                <div className="text-gray-300">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</div>
              </div>
              <div>
                <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Score</div>
                <div className="text-gray-300">{p.lead_score ?? '—'}</div>
              </div>
              <div>
                <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Touches</div>
                <div className="text-gray-300">{log?.filter(l => l.prospect_id === p.id).length ?? 0}</div>
              </div>
              <div className="col-span-2">
                <div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Notes</div>
                <div className="text-gray-300">{p.notes || '—'}</div>
              </div>
              <div className="col-span-2 flex gap-2 pt-1">
                <button
                  onClick={() => act('book')}
                  disabled={acting === 'book'}
                  className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  {acting === 'book' ? '…' : 'Mark Booked'}
                </button>
                <button
                  onClick={() => act('enroll')}
                  disabled={acting === 'enroll'}
                  className="text-xs font-semibold bg-indigo-700 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  {acting === 'enroll' ? '…' : 'Enroll Sequence'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

const AUTO_FOUND_SOURCES = ['serper', 'hail_zone']

export default function Pipeline() {
  const [prospects, setProspects] = useState([])
  const [log, setLog] = useState([])
  const [autoFoundToday, setAutoFoundToday] = useState(0)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState({ owner_name: '', company_name: '', phone: '', email: '' })

  const load = useCallback(async () => {
    const since24h = new Date(Date.now() - 86400000).toISOString()
    const [{ data: pros }, { data: logs }, { count: autoFound }] = await Promise.all([
      supabase.from('roofing_prospects').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('roofing_outreach_log').select('prospect_id, touch_number, open_count, last_opened_at, direction').order('last_opened_at', { ascending: false }).limit(500),
      supabase.from('roofing_prospects').select('id', { count: 'exact', head: true }).in('source', AUTO_FOUND_SOURCES).gte('created_at', since24h),
    ])
    setProspects(pros || [])
    setLog(logs || [])
    setAutoFoundToday(autoFound || 0)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = prospects.filter(p => {
    if (search) {
      const q = search.toLowerCase()
      if (!`${p.owner_name} ${p.company_name} ${p.phone} ${p.email}`.toLowerCase().includes(q)) return false
    }
    if (filter === 'whale') return p.whale_alerted && !p.outcome
    if (filter === 'hot') return log.some(l => l.prospect_id === p.id && l.open_count >= 2)
    if (filter === 'cold') {
      if (!p.in_sequence) return false
      const touches = log.filter(l => l.prospect_id === p.id)
      if (!touches.length) return false
      const allNoOpens = touches.every(l => !l.open_count || l.open_count === 0)
      const oldest = touches.reduce((a, b) => a.last_opened_at < b.last_opened_at ? a : b)
      const daysSince = (Date.now() - new Date(oldest.last_opened_at || p.created_at)) / 86400000
      return allNoOpens && daysSince >= 3
    }
    if (filter === 'sequence') return p.in_sequence
    if (filter === 'clicked') return p.clicked
    if (filter === 'booked') return p.status === 'booked'
    if (filter === 'dead') return p.status === 'dead'
    return true
  })

  const handleAction = async (prospect, type) => {
    if (type === 'nudge') {
      await fetch(`${SB_URL}/functions/v1/roofing-outreach-sequencer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ prospect_id: prospect.id }),
      }).catch(() => {})
    } else if (type === 'call') {
      await fetch(`${SB_URL}/functions/v1/roofing-aria-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ prospect_id: prospect.id }),
      }).catch(() => {})
    } else if (type === 'dead') {
      await supabase.from('roofing_prospects').update({ status: 'dead', outcome: 'dead' }).eq('id', prospect.id)
      await load()
    } else if (type === 'book') {
      await supabase.from('roofing_prospects').update({ status: 'booked' }).eq('id', prospect.id)
      await load()
    } else if (type === 'enroll') {
      await fetch(`${SB_URL}/functions/v1/roofing-outreach-sequencer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ prospect_id: prospect.id, enroll: true }),
      }).catch(() => {})
    }
  }

  const addProspect = async () => {
    if (!newForm.owner_name && !newForm.phone) return
    await supabase.from('roofing_prospects').insert([{ ...newForm, status: 'new' }])
    setNewForm({ owner_name: '', company_name: '', phone: '', email: '' })
    setAdding(false)
    await load()
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Pipeline</h1>
          <p className="text-gray-500 text-sm mt-0.5">{prospects.length} prospects</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={() => setAdding(a => !a)}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      {autoFoundToday > 0 && (
        <div className="mb-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <span className="text-base leading-none">🤖</span>
          <span className="text-sm text-indigo-300 font-medium">{autoFoundToday} new prospect{autoFoundToday !== 1 ? 's' : ''} found today by prospector</span>
        </div>
      )}

      {adding && (
        <div className="mb-4 bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {[
              { key: 'owner_name', placeholder: 'Name *' },
              { key: 'company_name', placeholder: 'Company' },
              { key: 'phone', placeholder: 'Phone *' },
              { key: 'email', placeholder: 'Email' },
            ].map(f => (
              <input
                key={f.key}
                type="text"
                placeholder={f.placeholder}
                value={newForm[f.key]}
                onChange={e => setNewForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={addProspect} className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg">Save</button>
            <button onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* Filters + search */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search name, company, phone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-[#12121a] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500 sm:w-64"
        />
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                filter === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#12121a] text-gray-500 hover:text-gray-300 border border-[#1e1e2e]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-10 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-600 text-sm">No prospects match this filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e1e2e]">
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest">Prospect</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden sm:table-cell">Phone</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden md:table-cell">Status</th>
                  <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden lg:table-cell">Last Activity</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <ProspectRow key={p.id} p={p} log={log} onAction={handleAction} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <JobsSection />
    </div>
  )
}

const JOB_STATUS_COLORS = {
  lead:              'text-gray-400',
  assessed:          'text-blue-400',
  contracted:        'text-violet-400',
  materials_ordered: 'text-amber-400',
  scheduled:         'text-orange-400',
  in_progress:       'text-green-400',
  complete:          'text-emerald-400',
  invoiced:          'text-pink-400',
  paid:              'text-gray-500',
}

function JobsSection() {
  const [jobs, setJobs] = useState([])
  const [activities, setActivities] = useState({})
  const [photoCounts, setPhotoCounts] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: jobRows } = await supabase
        .from('roofing_jobs')
        .select('id, homeowner_name, property_address, city, status, contract_amount, created_at, portal_sent_at')
        .not('status', 'in', '("paid","cancelled")')
        .order('created_at', { ascending: false })
        .limit(30)

      setJobs(jobRows || [])

      if (!jobRows?.length) { setLoading(false); return }

      const ids = jobRows.map(j => j.id)

      const [{ data: acts }, { data: photos }] = await Promise.all([
        supabase.from('portal_activities')
          .select('job_id, title, created_at')
          .in('job_id', ids)
          .order('created_at', { ascending: false }),
        supabase.from('portal_photos')
          .select('job_id')
          .in('job_id', ids),
      ])

      const actMap = {}
      for (const a of acts || []) {
        if (!actMap[a.job_id]) actMap[a.job_id] = a
      }

      const photoMap = {}
      for (const p of photos || []) {
        photoMap[p.job_id] = (photoMap[p.job_id] || 0) + 1
      }

      setActivities(actMap)
      setPhotoCounts(photoMap)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-white">Active Jobs</h2>
          <p className="text-gray-600 text-xs mt-0.5">Real-time from call/text intake</p>
        </div>
      </div>

      <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1,2,3].map(i => <div key={i} className="skeleton h-14 w-full rounded-lg" />)}
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-gray-600 text-sm">No active jobs yet.</p>
            <p className="text-gray-700 text-xs mt-1">Call +1 (720) 292-1930 to create one.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#1e1e2e]">
            {jobs.map(j => {
              const lastAct = activities[j.id]
              const photos = photoCounts[j.id] || 0
              const statusColor = JOB_STATUS_COLORS[j.status] || 'text-gray-400'
              return (
                <div key={j.id} className="px-4 py-3 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-xs font-semibold ${statusColor}`}>{j.status}</span>
                      <span className="text-white text-sm font-medium truncate">{j.homeowner_name}</span>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{j.property_address}{j.city ? `, ${j.city}` : ''}</p>
                    {lastAct && (
                      <p className="text-xs text-gray-600 mt-0.5 truncate">
                        <span className="text-gray-500">{lastAct.title}</span>
                        {' · '}{ago(lastAct.created_at)} ago
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-right">
                    {photos > 0 && (
                      <span className="text-xs text-gray-600">{photos} photo{photos !== 1 ? 's' : ''}</span>
                    )}
                    {j.contract_amount > 0 && (
                      <span className="text-sm font-semibold text-amber-400">${j.contract_amount.toLocaleString()}</span>
                    )}
                    {j.portal_sent_at && (
                      <span className="text-[10px] text-green-600 font-semibold">Portal ✓</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

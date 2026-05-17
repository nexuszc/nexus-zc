import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Returns next Mon/Wed/Fri dates starting from today
function getScheduleDates(count, startFrom = new Date()) {
  const dates = []
  const d = new Date(startFrom)
  d.setHours(14, 0, 0, 0)
  while (dates.length < count) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow === 1 || dow === 3 || dow === 5) {
      dates.push(new Date(d))
    }
  }
  return dates
}

function slotLabel(slot) {
  if (!slot) return ''
  if (slot === 'now') return 'Post Now'
  return slot.charAt(0).toUpperCase() + slot.slice(1)
}

const COMMUNITY_STATUS_COLORS = {
  pending:  'text-amber-400 bg-amber-500/10',
  approved: 'text-green-400 bg-green-500/10',
  skipped:  'text-gray-500 bg-gray-800',
}

// ── YouTube Queue Card ────────────────────────────────────────────────────────

function QueueCard({ item, onApprove, onReject, onSchedule }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)

  const act = async (fn, type) => {
    setActing(type)
    try { await fn() } finally { setActing(null) }
  }

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5 hover:border-[#2a2a3e] transition-all">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${item.format === 'long' ? 'bg-red-700' : 'bg-red-600'}`}>
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white leading-tight">{item.title || 'Untitled'}</span>
            <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full uppercase tracking-wide">
              {item.format === 'long' ? 'Long' : 'Short'}
            </span>
            {item.duration_estimate && (
              <span className="text-[10px] text-gray-600">~{item.duration_estimate}s</span>
            )}
          </div>

          {item.script && !expanded && (
            <p className="mt-1.5 text-xs text-gray-500 line-clamp-2 leading-relaxed">{item.script}</p>
          )}

          {expanded && (
            <div className="mt-3 border-t border-[#1e1e2e] pt-3 space-y-2">
              {item.hook_text && (
                <p className="text-xs text-amber-400 italic">"{item.hook_text}"</p>
              )}
              <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{item.script}</p>
              {item.thumbnail_text && (
                <p className="text-[10px] text-gray-500">
                  Thumbnail: <span className="text-white font-semibold">{item.thumbnail_text}</span>
                </p>
              )}
              {item.seo_description && (
                <p className="text-[10px] text-gray-500 mt-2 border-t border-[#1e1e2e] pt-2">
                  <span className="text-gray-600 block mb-1 uppercase tracking-widest text-[9px]">SEO Description</span>
                  {item.seo_description}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[#1e1e2e] flex items-center gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-1 flex-wrap">
          {['now', 'mon', 'wed', 'fri'].map(slot => (
            <button
              key={slot}
              onClick={() => act(() => onSchedule(slot), slot)}
              disabled={!!acting}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1e1e2e] text-gray-400 hover:bg-indigo-600 hover:text-white transition-colors disabled:opacity-40"
            >
              {acting === slot ? '…' : slot === 'now' ? 'Post Now' : slot.charAt(0).toUpperCase() + slot.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 items-center">
          <button
            onClick={() => act(onApprove, 'approve')}
            disabled={!!acting}
            className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {acting === 'approve' ? '…' : 'Approve'}
          </button>
          <button
            onClick={() => act(onReject, 'reject')}
            disabled={!!acting}
            className="text-xs text-gray-600 hover:text-red-400 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {acting === 'reject' ? '…' : 'Skip'}
          </button>
        </div>
      </div>

      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-2 text-xs text-gray-700 hover:text-gray-500 transition-colors"
      >
        {expanded ? 'Hide script ↑' : 'Full script ↓'}
      </button>
    </div>
  )
}

// ── Scheduled Card ────────────────────────────────────────────────────────────

function ScheduledCard({ item }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-[#0e0e18] border border-[#1e1e2e] rounded-xl p-4 hover:border-[#2a2a3e] transition-all">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-indigo-600/20 rounded-lg flex items-center justify-center shrink-0 border border-indigo-500/20">
          <span className="text-xs font-bold text-indigo-400">
            {item.schedule_slot === 'now' ? '▶' : (item.schedule_slot || '?').slice(0, 1).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white leading-tight">{item.title || 'Untitled'}</span>
            <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
              {item.format === 'long' ? 'Long' : 'Short'}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="text-indigo-400 font-medium">{slotLabel(item.schedule_slot)}</span>
            {item.schedule_date && <span>· {fmtDate(item.schedule_date)}</span>}
            {item.approved_at && <span>· approved {ago(item.approved_at)}</span>}
          </div>
          {expanded && item.script && (
            <p className="mt-2 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap border-t border-[#1e1e2e] pt-2">
              {item.script}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-2 text-xs text-gray-700 hover:text-gray-500 transition-colors"
      >
        {expanded ? 'Hide ↑' : 'Preview ↓'}
      </button>
    </div>
  )
}

// ── Posted Card ───────────────────────────────────────────────────────────────

function PostedCard({ item }) {
  return (
    <div className="bg-[#0e0e18] border border-[#1e1e2e] rounded-xl p-4 hover:border-[#2a2a3e] transition-all">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center shrink-0 border border-green-500/20">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-green-400"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white leading-tight">{item.title || 'Untitled'}</span>
            <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">Published</span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
            {item.posted_at && <span>{fmtDate(item.posted_at)}</span>}
            {item.views_count > 0 && <span className="text-white font-semibold">{item.views_count.toLocaleString()} views</span>}
            {item.likes_count > 0 && <span>{item.likes_count} likes</span>}
            {item.youtube_url && (
              <a href={item.youtube_url} target="_blank" rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300">View ↗</a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Community card ────────────────────────────────────────────────────────────

function CommunityCard({ post, onApprove, onSkip }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)
  const act = async (fn, type) => { setActing(type); try { await fn() } finally { setActing(null) } }
  const ICONS = { reddit: '🟠', facebook_groups: '🔵' }

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 hover:border-[#2a2a3e] transition-all">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5">{ICONS[post.platform] || '💬'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white line-clamp-1">{post.thread_title || 'Untitled'}</span>
            <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${COMMUNITY_STATUS_COLORS[post.status] || 'text-gray-500 bg-gray-800'}`}>
              {post.status}
            </span>
            {post.portal_mentioned && (
              <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">Portal</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 capitalize">{(post.platform || '').replace('_', ' ')} · {ago(post.created_at)}</div>
          {expanded && (
            <div className="mt-3 border-t border-[#1e1e2e] pt-3 space-y-3">
              {post.thread_content && (
                <p className="text-xs text-gray-500">{post.thread_content.slice(0, 400)}</p>
              )}
              {post.our_response && (
                <div>
                  <div className="text-[9px] text-gray-600 uppercase tracking-widest mb-1">Our Response</div>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{post.our_response}</p>
                </div>
              )}
              {post.thread_url && (
                <a href={post.thread_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300">View thread ↗</a>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {post.status === 'pending' && (
            <>
              <button onClick={() => act(onApprove, 'approve')} disabled={acting === 'approve'}
                className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">
                {acting === 'approve' ? '…' : 'Approve'}
              </button>
              <button onClick={() => act(onSkip, 'skip')} disabled={acting === 'skip'}
                className="text-xs text-gray-500 hover:text-red-400 px-3 py-1.5 rounded-lg disabled:opacity-40">
                {acting === 'skip' ? '…' : 'Skip'}
              </button>
            </>
          )}
          <button onClick={() => setExpanded(e => !e)} className="text-xs text-gray-600 hover:text-gray-400 px-3 py-1">
            {expanded ? 'Less' : 'More'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Content() {
  const [items, setItems]           = useState([])
  const [community, setCommunity]   = useState([])
  const [tab, setTab]               = useState('queue')
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)
  const [approvingAll, setApprovingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: contentRows }, { data: communityRows }] = await Promise.all([
      supabase.from('roofing_content')
        .select('*')
        .in('channel', ['youtube'])
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('roofing_community_posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    setItems(contentRows || [])
    setCommunity(communityRows || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const queueItems     = items.filter(i => i.status === 'pending_approval' || i.status === 'pending')
  const scheduledItems = items.filter(i => i.status === 'approved').sort((a, b) => {
    const order = { now: 0, mon: 1, wed: 2, fri: 3 }
    return (order[a.schedule_slot] ?? 9) - (order[b.schedule_slot] ?? 9)
  })
  const postedItems    = items.filter(i => i.status === 'published').sort((a, b) =>
    new Date(b.posted_at || b.created_at) - new Date(a.posted_at || a.created_at)
  )
  const communityPending = community.filter(p => p.status === 'pending').length

  // Handlers
  const approve = (item) => async () => {
    await supabase.from('roofing_content')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', item.id)
    await load()
  }

  const reject = (item) => async () => {
    await supabase.from('roofing_content').update({ status: 'rejected' }).eq('id', item.id)
    await load()
  }

  const schedule = (item) => async (slot) => {
    const scheduleDate = slot === 'now' ? new Date().toISOString().split('T')[0] : null
    await supabase.from('roofing_content')
      .update({ status: 'approved', approved_at: new Date().toISOString(), schedule_slot: slot, schedule_date: scheduleDate })
      .eq('id', item.id)
    await load()
  }

  // Approve All: space pending items across Mon/Wed/Fri starting next available
  const approveAll = async () => {
    if (queueItems.length === 0) return
    setApprovingAll(true)
    try {
      // "now" slot for the first one, then Mon/Wed/Fri sequence for the rest
      const nowItem = queueItems[0]
      const rest = queueItems.slice(1)
      const dates = getScheduleDates(rest.length)

      const dayToSlot = { 1: 'mon', 3: 'wed', 5: 'fri' }
      const updates = [
        { id: nowItem.id, slot: 'now', date: new Date().toISOString().split('T')[0] },
        ...rest.map((item, i) => ({
          id: item.id,
          slot: dayToSlot[dates[i].getDay()],
          date: dates[i].toISOString().split('T')[0],
        })),
      ]

      await Promise.all(updates.map(({ id, slot, date }) =>
        supabase.from('roofing_content').update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          schedule_slot: slot,
          schedule_date: date,
        }).eq('id', id)
      ))
      await load()
    } finally {
      setApprovingAll(false)
    }
  }

  const approvePost = (post) => async () => {
    await supabase.from('roofing_community_posts')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', post.id)
    await load()
  }

  const skipPost = (post) => async () => {
    await supabase.from('roofing_community_posts').update({ status: 'skipped' }).eq('id', post.id)
    await load()
  }

  const generate = async () => {
    setGenerating(true)
    try {
      await fetch(`${SB_URL}/functions/v1/roofing-content-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({}),
      })
      await new Promise(r => setTimeout(r, 4000))
      await load()
    } finally {
      setGenerating(false)
    }
  }

  const TABS = [
    { key: 'queue',     label: 'Approval Queue', count: queueItems.length },
    { key: 'scheduled', label: 'Scheduled',      count: scheduledItems.length },
    { key: 'posted',    label: 'Posted',          count: postedItems.length },
    { key: 'community', label: 'Community',       count: communityPending },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Content</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {queueItems.length > 0 ? `${queueItems.length} pending approval` : 'YouTube content pipeline'}
            {communityPending > 0 && ` · ${communityPending} community`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
            Refresh
          </button>
          <button onClick={generate} disabled={generating}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              tab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-[#12121a] text-gray-500 hover:text-gray-300 border border-[#1e1e2e]'
            }`}>
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                t.key === 'queue' ? 'bg-amber-500 text-black' : 'bg-gray-700 text-gray-300'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-[#12121a] rounded-xl animate-pulse" />)}
        </div>

      ) : tab === 'queue' ? (
        <div className="space-y-4">
          {queueItems.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{queueItems.length} script{queueItems.length !== 1 ? 's' : ''} need approval</span>
              <button onClick={approveAll} disabled={approvingAll}
                className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                {approvingAll ? 'Scheduling…' : `Approve All → Schedule Mon/Wed/Fri`}
              </button>
            </div>
          )}

          {queueItems.length === 0 ? (
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
              <p className="text-gray-600 text-sm">Queue is clear.</p>
              <button onClick={generate} disabled={generating}
                className="mt-3 text-xs text-indigo-400 hover:text-indigo-300">
                {generating ? 'Generating…' : 'Generate next batch →'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {queueItems.map(item => (
                <QueueCard
                  key={item.id}
                  item={item}
                  onApprove={approve(item)}
                  onReject={reject(item)}
                  onSchedule={schedule(item)}
                />
              ))}
            </div>
          )}
        </div>

      ) : tab === 'scheduled' ? (
        <div className="space-y-3">
          {scheduledItems.length === 0 ? (
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
              <p className="text-gray-600 text-sm">Nothing scheduled yet. Approve content from the queue.</p>
            </div>
          ) : (
            <>
              {/* Group by slot */}
              {['now', 'mon', 'wed', 'fri'].map(slot => {
                const group = scheduledItems.filter(i => i.schedule_slot === slot)
                if (group.length === 0) return null
                return (
                  <div key={slot}>
                    <div className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-2 px-1">
                      {slot === 'now' ? 'Post Now' : slot.charAt(0).toUpperCase() + slot.slice(1) + 'days'}
                      <span className="ml-2 text-gray-700 normal-case tracking-normal font-normal">
                        {group.length} script{group.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.map(item => <ScheduledCard key={item.id} item={item} />)}
                    </div>
                  </div>
                )
              })}
              {/* Any with no slot */}
              {scheduledItems.filter(i => !['now','mon','wed','fri'].includes(i.schedule_slot)).map(item => (
                <ScheduledCard key={item.id} item={item} />
              ))}
            </>
          )}
        </div>

      ) : tab === 'posted' ? (
        <div className="space-y-3">
          {postedItems.length === 0 ? (
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
              <p className="text-gray-600 text-sm">Nothing published yet.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Published', value: postedItems.length },
                  { label: 'Total Views', value: postedItems.reduce((s, i) => s + (i.views_count || 0), 0).toLocaleString() },
                  { label: 'Total Likes', value: postedItems.reduce((s, i) => s + (i.likes_count || 0), 0).toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 text-center">
                    <div className="text-lg font-bold text-white">{value}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {postedItems.map(item => <PostedCard key={item.id} item={item} />)}
              </div>
            </>
          )}
        </div>

      ) : tab === 'community' ? (
        <div className="space-y-3">
          {community.length === 0 ? (
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
              <p className="text-gray-600 text-sm">No community posts yet.</p>
            </div>
          ) : community.map(post => (
            <CommunityCard
              key={post.id}
              post={post}
              onApprove={approvePost(post)}
              onSkip={skipPost(post)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

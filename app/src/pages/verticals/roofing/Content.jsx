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

function isPendingStatus(status) {
  return status === 'pending' || status === 'pending_approval'
}

const STATUS_BADGE = (status) => {
  if (isPendingStatus(status)) return 'text-amber-400 bg-amber-500/10'
  if (status === 'approved')   return 'text-indigo-400 bg-indigo-500/10'
  if (status === 'published')  return 'text-green-400 bg-green-500/10'
  if (status === 'rejected')   return 'text-red-400 bg-red-500/10'
  return 'text-gray-500 bg-gray-800'
}

const COMMUNITY_STATUS_COLORS = {
  pending:  'text-amber-400 bg-amber-500/10',
  approved: 'text-green-400 bg-green-500/10',
  skipped:  'text-gray-500 bg-gray-800',
}

const PLATFORM_ICONS = {
  reddit:          '🟠',
  facebook_groups: '🔵',
}

// ── YouTube card ──────────────────────────────────────────────────────────────

function YouTubeCard({ item, onApprove, onReject, onSchedule }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)

  const act = async (fn, type) => {
    setActing(type)
    try { await fn() } finally { setActing(null) }
  }

  const pending = isPendingStatus(item.status)

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5 transition-all hover:border-[#2a2a3e]">
      <div className="flex items-start gap-3">
        {/* YouTube icon */}
        <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M8 5v14l11-7z"/></svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white leading-tight">{item.title || 'Untitled'}</span>
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_BADGE(item.status)}`}>
              {isPendingStatus(item.status) ? 'pending' : item.status}
            </span>
            {item.format && (
              <span className="text-[10px] text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full uppercase tracking-wide">
                {item.format}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            {item.duration_estimate && <span>~{item.duration_estimate}s</span>}
            {item.schedule_slot && <span className="text-indigo-400">· {item.schedule_slot}</span>}
            <span>· {ago(item.created_at)}</span>
          </div>

          {/* Script preview */}
          {item.script && !expanded && (
            <p className="mt-2 text-xs text-gray-400 line-clamp-2 leading-relaxed">{item.script}</p>
          )}

          {/* Expanded full script */}
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
            </div>
          )}
        </div>
      </div>

      {/* Schedule + approve row */}
      {pending && (
        <div className="mt-4 pt-4 border-t border-[#1e1e2e] flex items-center gap-2 flex-wrap">
          <div className="flex gap-1.5 flex-1 flex-wrap">
            {['Now', 'Mon', 'Wed', 'Fri'].map(slot => (
              <button
                key={slot}
                onClick={() => act(() => onSchedule(slot), slot)}
                disabled={!!acting}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1e1e2e] text-gray-300 hover:bg-indigo-600 hover:text-white transition-colors disabled:opacity-40"
              >
                {acting === slot ? '…' : slot}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
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
              className="text-xs text-gray-500 hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/5 transition-colors disabled:opacity-40"
            >
              {acting === 'reject' ? '…' : 'Skip'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          {expanded ? 'Hide script ↑' : 'Full script ↓'}
        </button>
        {item.published_url && (
          <a href={item.published_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300">
            View on YouTube ↗
          </a>
        )}
      </div>
    </div>
  )
}

// ── Simple card (Facebook / LinkedIn) ─────────────────────────────────────────

function SimpleCard({ item, icon, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)

  const act = async (fn, type) => {
    setActing(type)
    try { await fn() } finally { setActing(null) }
  }

  const pending = isPendingStatus(item.status)

  return (
    <div className="bg-[#0e0e18] border border-[#1e1e2e] rounded-lg p-4 transition-all hover:border-[#2a2a3e]">
      <div className="flex items-start gap-3">
        <span className="text-lg shrink-0 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white leading-tight">{item.title || 'Untitled'}</span>
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_BADGE(item.status)}`}>
              {isPendingStatus(item.status) ? 'pending' : item.status}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <span>{ago(item.created_at)}</span>
          </div>
          {expanded && item.body && (
            <p className="mt-2 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
              {item.body.slice(0, 600)}{item.body.length > 600 ? '…' : ''}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {pending && (
            <>
              <button onClick={() => act(onApprove, 'approve')} disabled={!!acting}
                className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">
                {acting === 'approve' ? '…' : 'Approve'}
              </button>
              <button onClick={() => act(onReject, 'reject')} disabled={!!acting}
                className="text-xs text-gray-500 hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/5 transition-colors disabled:opacity-40">
                {acting === 'reject' ? '…' : 'Skip'}
              </button>
            </>
          )}
          <button onClick={() => setExpanded(e => !e)}
            className="text-xs text-gray-600 hover:text-gray-400 px-3 py-1 transition-colors">
            {expanded ? 'Less' : 'More'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Collapsed secondary section ────────────────────────────────────────────────

function CollapsedSection({ title, pendingCount, items, icon, onApprove, onReject }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null

  return (
    <div className="border border-[#1e1e2e] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#0e0e18] hover:bg-[#12121a] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <span className="text-sm font-semibold text-gray-300">{title}</span>
          {pendingCount > 0 && (
            <span className="text-[9px] font-black bg-amber-500 text-black px-1.5 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
          <span className="text-xs text-gray-600">({items.length} total)</span>
        </div>
        <span className="text-gray-600 text-xs">{open ? '↑' : '↓'}</span>
      </button>
      {open && (
        <div className="p-3 space-y-2 border-t border-[#1e1e2e]">
          {items.map(item => (
            <SimpleCard
              key={item.id}
              item={item}
              icon={icon}
              onApprove={onApprove(item)}
              onReject={onReject(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Community card (unchanged) ─────────────────────────────────────────────────

function CommunityCard({ post, onApprove, onSkip }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)

  const act = async (fn, type) => {
    setActing(type)
    try { await fn() } finally { setActing(null) }
  }

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 transition-all hover:border-[#2a2a3e]">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5">{PLATFORM_ICONS[post.platform] || '💬'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white leading-tight line-clamp-1">
              {post.thread_title || 'Untitled thread'}
            </span>
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${COMMUNITY_STATUS_COLORS[post.status] || 'text-gray-500 bg-gray-800'}`}>
              {post.status}
            </span>
            {post.portal_mentioned && (
              <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">Portal</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="capitalize">{(post.platform || '').replace('_', ' ')}</span>
            <span>· {ago(post.created_at)}</span>
          </div>
          {expanded && (
            <div className="mt-3 border-t border-[#1e1e2e] pt-3 space-y-3">
              {post.thread_content && (
                <div>
                  <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-1">Thread</div>
                  <div className="text-xs text-gray-500 leading-relaxed">{post.thread_content.slice(0, 400)}</div>
                </div>
              )}
              {post.our_response && (
                <div>
                  <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-1">Our Response</div>
                  <div className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{post.our_response}</div>
                </div>
              )}
              {post.thread_url && (
                <a href={post.thread_url} target="_blank" rel="noopener noreferrer"
                  className="inline-block text-xs text-indigo-400 hover:text-indigo-300">
                  View thread ↗
                </a>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {post.status === 'pending' && (
            <>
              <button onClick={() => act(onApprove, 'approve')} disabled={acting === 'approve'}
                className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">
                {acting === 'approve' ? '…' : 'Approve'}
              </button>
              <button onClick={() => act(onSkip, 'skip')} disabled={acting === 'skip'}
                className="text-xs font-semibold text-gray-500 hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/5 transition-colors disabled:opacity-40">
                {acting === 'skip' ? '…' : 'Skip'}
              </button>
            </>
          )}
          <button onClick={() => setExpanded(e => !e)}
            className="text-xs text-gray-600 hover:text-gray-400 px-3 py-1 transition-colors">
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
  const [tab, setTab]               = useState('youtube')
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)
  const [approvingAll, setApprovingAll] = useState(false)

  const load = useCallback(async () => {
    const [{ data: contentRows }, { data: communityRows }] = await Promise.all([
      supabase.from('roofing_content').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('roofing_community_posts').select('*').order('created_at', { ascending: false }).limit(20),
    ])
    setItems(contentRows || [])
    setCommunity(communityRows || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Channel buckets
  const ytItems = items.filter(i => i.channel === 'youtube' || i.type === 'youtube_short' || i.type === 'youtube_long')
  const fbItems = items.filter(i => i.channel === 'facebook')
  const liItems = items.filter(i => i.channel === 'linkedin')

  const ytPending        = ytItems.filter(i => isPendingStatus(i.status)).length
  const fbPending        = fbItems.filter(i => isPendingStatus(i.status)).length
  const liPending        = liItems.filter(i => isPendingStatus(i.status)).length
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
    await supabase.from('roofing_content')
      .update({ status: 'approved', approved_at: new Date().toISOString(), schedule_slot: slot })
      .eq('id', item.id)
    await load()
  }

  const approveAllYouTube = async () => {
    setApprovingAll(true)
    try {
      const pending = ytItems.filter(i => isPendingStatus(i.status))
      if (pending.length === 0) return
      await supabase.from('roofing_content')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .in('id', pending.map(i => i.id))
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
        body: JSON.stringify({ manual: true }),
      }).catch(() => {})
      await new Promise(r => setTimeout(r, 3000))
      await load()
    } finally {
      setGenerating(false)
    }
  }

  const TABS = [
    { key: 'youtube',   label: 'YouTube',   count: ytPending },
    { key: 'facebook',  label: 'Facebook',  count: fbPending },
    { key: 'linkedin',  label: 'LinkedIn',  count: liPending },
    { key: 'community', label: 'Community', count: communityPending },
    { key: 'all',       label: 'All' },
  ]

  const tabItems = tab === 'all' ? items : tab === 'facebook' ? fbItems : tab === 'linkedin' ? liItems : []

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Content</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {ytPending > 0 ? `${ytPending} YouTube pending` : 'Content pipeline'}
            {communityPending > 0 && ` · ${communityPending} community`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
            Refresh
          </button>
          {tab !== 'community' && (
            <button onClick={generate} disabled={generating}
              className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
              {generating ? 'Generating…' : 'Generate'}
            </button>
          )}
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
              <span className="ml-1.5 bg-amber-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="skeleton h-24 w-full rounded-xl" />)}
        </div>

      ) : tab === 'youtube' ? (
        <div className="space-y-4">
          {/* Approve All button */}
          {ytPending > 0 && (
            <div className="flex justify-end">
              <button onClick={approveAllYouTube} disabled={approvingAll}
                className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                {approvingAll ? 'Approving…' : `Approve All YouTube (${ytPending}) →`}
              </button>
            </div>
          )}

          {/* YouTube cards */}
          {ytItems.length === 0 ? (
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
              <p className="text-gray-600 text-sm">No YouTube content yet.</p>
              <button onClick={generate} disabled={generating}
                className="mt-3 text-xs text-indigo-400 hover:text-indigo-300">
                {generating ? 'Generating…' : 'Generate first batch →'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {ytItems.map(item => (
                <YouTubeCard
                  key={item.id}
                  item={item}
                  onApprove={approve(item)}
                  onReject={reject(item)}
                  onSchedule={schedule(item)}
                />
              ))}
            </div>
          )}

          {/* Secondary: Facebook + LinkedIn collapsed */}
          <CollapsedSection
            title="Facebook Drafts"
            pendingCount={fbPending}
            items={fbItems}
            icon="🔵"
            onApprove={approve}
            onReject={reject}
          />
          <CollapsedSection
            title="LinkedIn Drafts"
            pendingCount={liPending}
            items={liItems}
            icon="🔷"
            onApprove={approve}
            onReject={reject}
          />
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

      ) : (
        /* Facebook, LinkedIn, All tabs — simple card list */
        <div className="space-y-3">
          {tabItems.length === 0 ? (
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
              <p className="text-gray-600 text-sm">
                No {tab === 'all' ? '' : tab} content yet.
              </p>
            </div>
          ) : tabItems.map(item => (
            <SimpleCard
              key={item.id}
              item={item}
              icon={tab === 'facebook' ? '🔵' : tab === 'linkedin' ? '🔷' : '📄'}
              onApprove={approve(item)}
              onReject={reject(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

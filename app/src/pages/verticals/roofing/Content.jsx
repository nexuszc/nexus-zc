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

const TYPE_ICONS = {
  email:     '📧',
  blog:      '📝',
  video:     '📹',
  youtube:   '▶️',
  social:    '📱',
  seo:       '🔍',
  voiceover: '🎙️',
}

const STATUS_COLORS = {
  pending:    'text-amber-400 bg-amber-500/10',
  approved:   'text-indigo-400 bg-indigo-500/10',
  published:  'text-green-400 bg-green-500/10',
  rejected:   'text-red-400 bg-red-500/10',
  generating: 'text-blue-400 bg-blue-500/10',
}

const TAB_FILTERS = [
  { key: 'pending',   label: 'Needs Approval' },
  { key: 'approved',  label: 'Approved' },
  { key: 'published', label: 'Published' },
  { key: 'all',       label: 'All' },
]

function ContentCard({ item, onApprove, onReject, onPublish }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing]   = useState(null)

  const act = async (fn, type) => {
    setActing(type)
    try { await fn() } finally { setActing(null) }
  }

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 transition-all hover:border-[#2a2a3e]">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5">{TYPE_ICONS[item.type] || '📄'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-semibold text-white leading-tight">{item.title || 'Untitled'}</div>
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_COLORS[item.status] || 'text-gray-500 bg-gray-800'}`}>
              {item.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{item.type}</span>
            {item.market && <span>· {item.market}</span>}
            {item.channel && <span>· {item.channel}</span>}
            <span>· {ago(item.created_at)}</span>
          </div>
          {item.hook && (
            <div className="mt-2 text-xs text-gray-400 italic line-clamp-2">"{item.hook}"</div>
          )}
          {expanded && item.body && (
            <div className="mt-3 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap border-t border-[#1e1e2e] pt-3">
              {item.body.slice(0, 800)}{item.body.length > 800 ? '…' : ''}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {item.status === 'pending' && (
            <>
              <button
                onClick={() => act(onApprove, 'approve')}
                disabled={acting === 'approve'}
                className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              >
                {acting === 'approve' ? '…' : 'Approve'}
              </button>
              <button
                onClick={() => act(onReject, 'reject')}
                disabled={acting === 'reject'}
                className="text-xs font-semibold text-gray-500 hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/5 transition-colors disabled:opacity-40"
              >
                {acting === 'reject' ? '…' : 'Reject'}
              </button>
            </>
          )}
          {item.status === 'approved' && (
            <button
              onClick={() => act(onPublish, 'publish')}
              disabled={acting === 'publish'}
              className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            >
              {acting === 'publish' ? '…' : 'Publish'}
            </button>
          )}
          {item.published_url && (
            <a
              href={item.published_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-400 hover:text-indigo-300 px-3 py-1.5 rounded-lg hover:bg-indigo-500/10 transition-colors text-center"
            >
              View ↗
            </a>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-gray-600 hover:text-gray-400 px-3 py-1 transition-colors"
          >
            {expanded ? 'Less' : 'More'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Content() {
  const [items, setItems]   = useState([])
  const [tab, setTab]       = useState('pending')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('roofing_content')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setItems(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = tab === 'all' ? items : items.filter(i => i.status === tab)

  const approve = (item) => async () => {
    await supabase.from('roofing_content').update({ status: 'approved' }).eq('id', item.id)
    await load()
  }

  const reject = (item) => async () => {
    await supabase.from('roofing_content').update({ status: 'rejected' }).eq('id', item.id)
    await load()
  }

  const publish = (item) => async () => {
    await fetch(`${SB_URL}/functions/v1/roofing-seo-publisher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify({ content_id: item.id }),
    }).catch(() => {})
    await supabase.from('roofing_content').update({ status: 'published' }).eq('id', item.id)
    await load()
  }

  const generate = async () => {
    setGenerating(true)
    try {
      await fetch(`${SB_URL}/functions/v1/roofing-content-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({}),
      }).catch(() => {})
      await new Promise(r => setTimeout(r, 3000))
      await load()
    } finally {
      setGenerating(false)
    }
  }

  const pendingCount = items.filter(i => i.status === 'pending').length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Content</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {pendingCount > 0 ? `${pendingCount} pending approval` : 'Content pipeline'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={generate}
            disabled={generating}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {TAB_FILTERS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              tab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-[#12121a] text-gray-500 hover:text-gray-300 border border-[#1e1e2e]'
            }`}
          >
            {t.label}
            {t.key === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-500 text-black text-[9px] font-black px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="skeleton h-24 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
          <p className="text-gray-600 text-sm">No {tab === 'all' ? '' : tab} content yet.</p>
          {tab === 'pending' && (
            <button onClick={generate} disabled={generating} className="mt-3 text-xs text-indigo-400 hover:text-indigo-300">
              {generating ? 'Generating…' : 'Generate content →'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <ContentCard
              key={item.id}
              item={item}
              onApprove={approve(item)}
              onReject={reject(item)}
              onPublish={publish(item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const API = `${SB_URL}/functions/v1/roofing-content-api`
function api(method, action, id) {
  const url = `${API}?action=${action}${id ? `&id=${id}` : ''}`
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
  }).then(r => r.json())
}

// Facebook post variants for rotating daily banner
const FB_VARIANTS = [
  {
    label: 'Variant A — CompanyCam angle',
    groups: 'Roofing Contractors Network, Roofers Coffee Shop, Contractor Talk',
    body: `We built a free replacement for CompanyCam. Here's why.

CompanyCam charges $79–199/month to store and share job photos. That's it.

We built something that does that — plus gives every homeowner a real-time portal for their job. Photos, updates, insurance claim status, Aria chat, the whole thing.

It's free. No credit card. First 5 jobs free to test. No subscription to share photos with homeowners ever.

Why free? We make money on Measurements ($25/report), Supplement AI ($99–329/job), and CRM ($299/mo). The portal is the hook. If you just want to cancel CompanyCam, it costs you nothing.

4 minutes to get your first homeowner portal live: roofingos.dev/dashboard

Curious what the homeowner sees? Portal demo: roofingos.dev/portal/demo

Happy to answer questions in comments.`,
  },
  {
    label: 'Variant B — Homeowner calls angle',
    groups: 'Roofing Business Owners, Roofing Sales & Marketing, Roofing Contractor Mastermind',
    body: `Quick question for contractors: how many calls/texts do you get from homeowners asking "what's the status of my roof?"

We track this. Average contractor gets 4–6 status check calls per active job per week. That's 20–30 interruptions a week during storm season.

We built a homeowner portal that shows them everything in real time — photos your crew uploads from the job site, updates from the office, insurance claim status, timeline. They stop calling because they don't need to.

Portal is free. Your crew uploads photos from any phone. Homeowner gets a link. Done.

Get set up in 4 minutes: roofingos.dev/dashboard

Demo of what the homeowner sees: roofingos.dev/portal/demo`,
  },
  {
    label: 'Variant C — Supplement AI angle',
    groups: 'Storm Restoration Professionals, Insurance Restoration Roofing, Roofing Contractor Pro Talk',
    body: `Storm season question: what's your supplement approval rate with State Farm right now?

Industry average is hovering around 58%. Best contractors I know are hitting 75–80% — and they're using AI to build the packets.

We built Supplement AI into our free portal. It:
- Analyzes your job photos for every damage code
- Generates carrier-specific Xactimate line items the adjuster missed
- Builds the full supplement packet as a PDF
- (Optional) Has Aria call the adjuster and follow up until approved

Package is $99/job. Full handling with Aria calling the adjuster is $329/job. Industry supplement companies charge 10–15% of recovery. At $329 you keep significantly more.

The portal your homeowners use is free: roofingos.dev/dashboard`,
  },
]

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

let _setToast = null
function toast(msg, type = 'success') {
  if (_setToast) _setToast({ msg, type, id: Date.now() })
}

function Toast({ toast: t }) {
  if (!t) return null
  return (
    <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg ${
      t.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
    }`}>
      {t.msg}
    </div>
  )
}

// Copy to clipboard with 2s feedback
function CopyButton({ text, label = '📋 Copy', className = '' }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast('Copy failed — check permissions', 'error')
    }
  }
  return (
    <button
      onClick={copy}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
        copied
          ? 'bg-green-700 text-white'
          : 'bg-[#1e1e2e] text-gray-400 hover:bg-indigo-600 hover:text-white'
      } ${className}`}
    >
      {copied ? '✓ Copied!' : label}
    </button>
  )
}

// ── Facebook Daily Banner ─────────────────────────────────────────────────────

function FacebookBanner() {
  const dayIndex = Math.floor(Date.now() / 86400000) % FB_VARIANTS.length
  const variant = FB_VARIANTS[dayIndex]
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-[#1a1a2e] border border-blue-500/30 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-blue-400 text-lg">🔵</span>
          <span className="text-xs font-bold text-blue-400 uppercase tracking-wide">Today's Facebook Post</span>
          <span className="text-[10px] text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">{variant.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={variant.body} label="📋 Copy post" />
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            {expanded ? 'Hide ↑' : 'Preview ↓'}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-gray-600">Best groups: {variant.groups}</p>
      {expanded && (
        <pre className="mt-3 text-xs text-gray-300 whitespace-pre-wrap bg-[#0e0e18] rounded-lg p-3 border border-[#1e1e2e] leading-relaxed">
          {variant.body}
        </pre>
      )}
    </div>
  )
}

// ── Stats Bar ─────────────────────────────────────────────────────────────────

function StatsBar({ stats }) {
  if (!stats) return null
  const items = [
    { label: 'Posts this week', value: stats.posts_this_week },
    { label: 'New signups (7d)', value: stats.signups_this_week },
    { label: 'Community pending', value: stats.community_pending },
  ]
  return (
    <div className="grid grid-cols-3 gap-3 mb-5">
      {items.map(({ label, value }) => (
        <div key={label} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-3 text-center">
          <div className="text-lg font-bold text-white">{value ?? '—'}</div>
          <div className="text-[10px] text-gray-600 mt-0.5">{label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Channel Status Row ────────────────────────────────────────────────────────

function ChannelRow({ icon, label, status, copyText, onCopy, onDone, generating }) {
  const isDone = status === 'done'
  const isPosted = status === 'posted'
  const isPending = !isDone && !isPosted

  return (
    <div className={`flex items-center gap-2 py-1.5 border-t border-[#1e1e2e] ${isDone || isPosted ? 'opacity-60' : ''}`}>
      <span className="text-sm w-5 text-center">{icon}</span>
      <span className="text-xs text-gray-500 w-16">{label}</span>
      <div className="flex-1" />
      {isPosted || isDone ? (
        <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full font-semibold">
          {isPosted ? '✓ Posted' : '✓ Done'}
        </span>
      ) : copyText ? (
        <>
          <CopyButton text={copyText} label="📋 Copy" />
          {onDone && (
            <button
              onClick={onDone}
              className="text-[10px] text-gray-600 hover:text-green-400 px-2 py-1 rounded transition-colors"
            >
              Mark done
            </button>
          )}
        </>
      ) : (
        <button
          onClick={onCopy}
          disabled={generating}
          className="text-xs font-semibold bg-[#1e1e2e] text-gray-500 hover:bg-indigo-600 hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
        >
          {generating ? 'Generating…' : '✨ Generate + Copy'}
        </button>
      )}
    </div>
  )
}

// ── Content Card ──────────────────────────────────────────────────────────────

function ContentCard({ item, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [generatingFb, setGeneratingFb] = useState(false)
  const [generatingTt, setGeneratingTt] = useState(false)

  const fbStatus = item.facebook_marked_done_at ? 'done' : item.facebook_status
  const ttStatus = item.tiktok_marked_done_at ? 'done' : item.tiktok_status
  const ytStatus = item.youtube_status
  const liStatus = item.linkedin_status

  const handleGenerateFb = async () => {
    setGeneratingFb(true)
    try {
      const res = await api('POST', 'generate-facebook', item.id)
      if (res.copy) {
        await navigator.clipboard.writeText(res.copy).catch(() => {})
        toast('Facebook copy generated + copied ✓')
        onUpdate()
      } else {
        toast('Generation failed', 'error')
      }
    } finally {
      setGeneratingFb(false)
    }
  }

  const handleGenerateTt = async () => {
    setGeneratingTt(true)
    try {
      const res = await api('POST', 'generate-tiktok', item.id)
      if (res.copy) {
        await navigator.clipboard.writeText(res.copy).catch(() => {})
        toast('TikTok copy generated + copied ✓')
        onUpdate()
      } else {
        toast('Generation failed', 'error')
      }
    } finally {
      setGeneratingTt(false)
    }
  }

  const handleFbDone = async () => {
    await api('POST', 'facebook-done', item.id)
    toast('Facebook marked done ✓')
    onUpdate()
  }

  const handleTtDone = async () => {
    await api('POST', 'tiktok-done', item.id)
    toast('TikTok marked done ✓')
    onUpdate()
  }

  const channelBadge = (status, label) => {
    if (status === 'posted' || status === 'done') return <span key={label} className="text-[9px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded-full">✓ {label}</span>
    return <span key={label} className="text-[9px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded-full">{label}</span>
  }

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 hover:border-[#2a2a3e] transition-all">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-red-600/20 rounded-lg flex items-center justify-center shrink-0 border border-red-500/20">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-red-400"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white leading-tight flex-1">{item.title || 'Untitled'}</span>
            <div className="flex gap-1 flex-wrap shrink-0">
              {channelBadge(ytStatus, 'YT')}
              {channelBadge(liStatus, 'LI')}
              {channelBadge(fbStatus, 'FB')}
              {channelBadge(ttStatus, 'TT')}
            </div>
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">{ago(item.created_at)}</div>
        </div>
      </div>

      {/* Channel rows */}
      <div className="mt-3">
        <ChannelRow
          icon="▶"
          label="YouTube"
          status={ytStatus}
        />
        <ChannelRow
          icon="💼"
          label="LinkedIn"
          status={liStatus}
        />
        <ChannelRow
          icon="🔵"
          label="Facebook"
          status={fbStatus}
          copyText={item.facebook_copy}
          onCopy={handleGenerateFb}
          onDone={handleFbDone}
          generating={generatingFb}
        />
        <ChannelRow
          icon="🎵"
          label="TikTok"
          status={ttStatus}
          copyText={item.tiktok_copy}
          onCopy={handleGenerateTt}
          onDone={handleTtDone}
          generating={generatingTt}
        />
      </div>

      {expanded && item.script && (
        <div className="mt-3 pt-3 border-t border-[#1e1e2e]">
          {item.hook_text && (
            <p className="text-xs text-amber-400 italic mb-2">"{item.hook_text}"</p>
          )}
          <p className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{item.script.slice(0, 600)}</p>
        </div>
      )}

      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-2 text-xs text-gray-700 hover:text-gray-500 transition-colors"
      >
        {expanded ? 'Hide ↑' : 'Script ↓'}
      </button>
    </div>
  )
}

// ── Community Card ────────────────────────────────────────────────────────────

function CommunityCard({ post, onApprove, onSkip }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)
  const act = async (fn, type) => { setActing(type); try { await fn() } finally { setActing(null) } }

  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 hover:border-[#2a2a3e] transition-all">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5">{post.platform === 'reddit' ? '🟠' : '🔵'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white line-clamp-1">{post.thread_title || 'Untitled'}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              post.status === 'approved' ? 'text-green-400 bg-green-500/10' :
              post.status === 'skipped'  ? 'text-gray-500 bg-gray-800' :
              'text-amber-400 bg-amber-500/10'
            }`}>
              {post.status}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5 capitalize">
            {(post.platform || '').replace('_', ' ')} · {ago(post.created_at)}
          </div>
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
          {post.our_response && (
            <CopyButton text={post.our_response} label="📋 Copy" />
          )}
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

// ── Partner Row ───────────────────────────────────────────────────────────────

function PartnerRow({ partner, onSent }) {
  const [acting, setActing] = useState(false)
  const isSent = !!partner.sent_at

  const handleSent = async () => {
    setActing(true)
    try {
      await api('POST', 'partner-sent', partner.id)
      toast('Marked as sent ✓')
      onSent()
    } finally {
      setActing(false)
    }
  }

  const emailText = `To: ${partner.email}\nSubject: ${partner.subject}\n\n${partner.body}`

  return (
    <div className={`flex items-center gap-3 py-3 border-b border-[#1e1e2e] last:border-0 ${isSent ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white">{partner.name}</div>
        <div className="text-xs text-gray-500 truncate">{partner.email} · {partner.subject}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isSent ? (
          <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">Sent</span>
        ) : (
          <>
            <CopyButton text={emailText} label="📋 Copy email" />
            <button
              onClick={handleSent}
              disabled={acting}
              className="text-xs font-semibold bg-[#1e1e2e] hover:bg-green-700 text-gray-400 hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            >
              {acting ? '…' : 'Mark sent'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Content() {
  const [items, setItems]         = useState([])
  const [community, setCommunity] = useState([])
  const [partners, setPartners]   = useState([])
  const [stats, setStats]         = useState(null)
  const [tab, setTab]             = useState('content')
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)
  const [toastState, setToastState] = useState(null)

  useEffect(() => {
    _setToast = setToastState
    return () => { _setToast = null }
  }, [])
  useEffect(() => {
    if (!toastState) return
    const t = setTimeout(() => setToastState(null), 2500)
    return () => clearTimeout(t)
  }, [toastState])

  const load = useCallback(async () => {
    setLoading(true)
    const [dashRes, communityRes, partnersRes, statsRes] = await Promise.all([
      api('GET', 'dashboard', null),
      api('GET', 'community', null),
      api('GET', 'partners', null),
      api('GET', 'stats', null),
    ])
    setItems(dashRes.data || [])
    setCommunity(communityRes.data || [])
    setPartners(partnersRes.data || [])
    setStats(statsRes)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const communityPending = community.filter(p => p.status === 'pending').length
  const partnerPending   = partners.filter(p => !p.sent_at).length

  const approvePost = (post) => async () => {
    const { error } = await supabase.from('roofing_community_posts')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', post.id)
    if (error) { toast(`Approve failed: ${error.message}`, 'error'); return }
    toast('Post approved ✓')
    await load()
  }

  const skipPost = (post) => async () => {
    const { error } = await supabase.from('roofing_community_posts')
      .update({ status: 'skipped' })
      .eq('id', post.id)
    if (error) { toast(`Skip failed: ${error.message}`, 'error'); return }
    toast('Post skipped')
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
    { key: 'content',   label: 'Content',   count: 0 },
    { key: 'community', label: 'Community', count: communityPending },
    { key: 'partners',  label: 'Partners',  count: partnerPending },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Toast toast={toastState} />

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Content</h1>
          <p className="text-gray-500 text-sm mt-0.5">Multi-channel posting hub</p>
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

      <StatsBar stats={stats} />
      <FacebookBanner />

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
              <span className="ml-1.5 text-[9px] font-black bg-amber-500 text-black px-1.5 py-0.5 rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-[#12121a] rounded-xl animate-pulse" />)}
        </div>

      ) : tab === 'content' ? (
        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
              <p className="text-gray-600 text-sm">No content yet.</p>
              <button onClick={generate} disabled={generating}
                className="mt-3 text-xs text-indigo-400 hover:text-indigo-300">
                {generating ? 'Generating…' : 'Generate first batch →'}
              </button>
            </div>
          ) : (
            items.map(item => (
              <ContentCard key={item.id} item={item} onUpdate={load} />
            ))
          )}
        </div>

      ) : tab === 'community' ? (
        <div className="space-y-3">
          {community.length === 0 ? (
            <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-10 text-center">
              <p className="text-gray-600 text-sm">No community posts yet.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">{communityPending} pending · {community.length} total</span>
              </div>
              {community.map(post => (
                <CommunityCard
                  key={post.id}
                  post={post}
                  onApprove={approvePost(post)}
                  onSkip={skipPost(post)}
                />
              ))}
            </>
          )}
        </div>

      ) : tab === 'partners' ? (
        <div>
          <p className="text-xs text-gray-500 mb-4">
            Distribution partners — their audience is our customer. Copy email, send manually, mark done.
          </p>
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
            {partners.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-6">No partnership targets yet.</p>
            ) : (
              partners.map(p => (
                <PartnerRow key={p.id} partner={p} onSent={load} />
              ))
            )}
          </div>
          <p className="text-[10px] text-gray-700 mt-3">Full email templates: docs/partnership-outreach-emails.md</p>
        </div>
      ) : null}
    </div>
  )
}

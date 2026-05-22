import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const FB_GROUP_URL   = 'https://facebook.com/groups/2266757270527259'
const REDDIT_URL     = 'https://reddit.com/r/RoofingOS/submit'
const LINKEDIN_URL   = 'https://linkedin.com/feed'

const EXTERNAL_GROUPS = [
  'Roofing Contractors Network',
  'Storm Restoration Contractors',
  'Roofers Coffee Shop',
  'Insurance Restoration Contractors',
  'Roofing Business Owners USA',
]

const TODAY_KEY = new Date().toISOString().slice(0, 10)
const TODAY_LABEL = new Date().toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
})

// ── localStorage helpers ───────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem('post_today') || '{}')
    if (raw.date !== TODAY_KEY) return { date: TODAY_KEY, posted: {} }
    return raw
  } catch { return { date: TODAY_KEY, posted: {} } }
}

function saveState(s) {
  try { localStorage.setItem('post_today', JSON.stringify(s)) } catch {}
}

// ── Copy button ────────────────────────────────────────────────────────────────

function CopyBtn({ text, className = '' }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }
  return (
    <button
      onClick={copy}
      className={`px-5 py-2.5 rounded-lg font-bold text-sm transition-all ${
        copied
          ? 'bg-green-600 text-white'
          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
      } ${className}`}
    >
      {copied ? '✓ Copied!' : '📋 Copy'}
    </button>
  )
}

// ── Post text box ──────────────────────────────────────────────────────────────

function PostText({ text }) {
  if (!text) return (
    <div className="text-sm text-gray-600 italic bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-4 mb-4">
      No content scheduled — generating…
    </div>
  )
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm text-gray-200 leading-relaxed bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg p-4 mb-4">
      {text}
    </pre>
  )
}

// ── Card wrapper ───────────────────────────────────────────────────────────────

function Card({ done, children }) {
  return (
    <div className={`rounded-xl border p-6 mb-5 transition-colors ${
      done ? 'bg-green-950/20 border-green-500/30' : 'bg-[#12121a] border-[#2a2a3e]'
    }`}>
      {children}
    </div>
  )
}

function PlatformHeader({ icon, name, sub, url, done }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{icon}</span>
        <div>
          <div className={`font-bold text-base ${done ? 'text-green-400' : 'text-white'}`}>{name}</div>
          {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-0.5 block">
              {url} ↗
            </a>
          )}
        </div>
      </div>
      {done && (
        <span className="text-xs text-green-400 font-bold bg-green-500/10 px-3 py-1 rounded-full shrink-0">
          ✓ Posted
        </span>
      )}
    </div>
  )
}

// ── Section 1: Facebook (owned group) ─────────────────────────────────────────

function FBOwnedCard({ text, posted, onToggle }) {
  const done = !!posted['fb_owned']
  return (
    <Card done={done}>
      <PlatformHeader
        icon="📘" name="FACEBOOK GROUP"
        sub='"Roofing Contractors — AI Tools & Tips"'
        url={FB_GROUP_URL} done={done}
      />
      <PostText text={text} />
      <div className="flex items-center gap-3">
        <CopyBtn text={text} />
        <label className="flex items-center gap-2 cursor-pointer ml-auto select-none">
          <input type="checkbox" checked={done} onChange={() => onToggle('fb_owned')}
            className="w-4 h-4 accent-green-500 cursor-pointer" />
          <span className={`text-sm font-medium ${done ? 'text-green-400' : 'text-gray-400'}`}>✓ Mark posted</span>
        </label>
      </div>
    </Card>
  )
}

// ── Section 2: Facebook (external groups) ─────────────────────────────────────

function FBExternalCard({ text, posted, onToggle }) {
  const checkedCount = EXTERNAL_GROUPS.filter(g => posted[`fb_ext_${g}`]).length
  const allDone = checkedCount === EXTERNAL_GROUPS.length

  const markAll = () => {
    EXTERNAL_GROUPS.forEach(g => {
      if (!posted[`fb_ext_${g}`]) onToggle(`fb_ext_${g}`)
    })
  }

  return (
    <Card done={allDone}>
      <PlatformHeader
        icon="📘" name="FACEBOOK GROUPS (external)"
        sub="Post in each — put link in first comment"
        done={allDone}
      />
      <PostText text={text} />
      <CopyBtn text={text} className="mb-4" />

      <div className="space-y-1 mt-2 mb-4">
        {EXTERNAL_GROUPS.map(g => {
          const key = `fb_ext_${g}`
          const checked = !!posted[key]
          return (
            <label key={g} className="flex items-center gap-3 cursor-pointer px-3 py-2 rounded-lg hover:bg-white/[0.03] select-none">
              <input type="checkbox" checked={checked} onChange={() => onToggle(key)}
                className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0" />
              <span className={`text-sm flex-1 ${checked ? 'text-green-400 line-through opacity-60' : 'text-gray-300'}`}>
                {g}
              </span>
              {checked && <span className="text-green-400 text-xs">✓</span>}
            </label>
          )
        })}
      </div>

      <button
        onClick={markAll}
        disabled={allDone}
        className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all ${
          allDone
            ? 'bg-green-600/20 text-green-400 cursor-default'
            : 'bg-[#1e1e2e] hover:bg-indigo-700 text-gray-300 hover:text-white'
        }`}
      >
        {allDone ? `✓ All ${EXTERNAL_GROUPS.length} groups posted` : `Mark all posted ✓`}
      </button>
    </Card>
  )
}

// ── Section 3: Reddit ──────────────────────────────────────────────────────────

function RedditCard({ text, posted, onToggle }) {
  const done = !!posted['reddit']
  return (
    <Card done={done}>
      <PlatformHeader
        icon="🔴" name="REDDIT — r/RoofingOS"
        url={REDDIT_URL} done={done}
      />
      <PostText text={text} />
      <div className="flex items-center gap-3">
        <CopyBtn text={text} />
        <label className="flex items-center gap-2 cursor-pointer ml-auto select-none">
          <input type="checkbox" checked={done} onChange={() => onToggle('reddit')}
            className="w-4 h-4 accent-green-500 cursor-pointer" />
          <span className={`text-sm font-medium ${done ? 'text-green-400' : 'text-gray-400'}`}>✓ Mark posted</span>
        </label>
      </div>
    </Card>
  )
}

// ── Section 4: LinkedIn ────────────────────────────────────────────────────────

function LinkedInCard({ text, posted, onToggle }) {
  const done = !!posted['linkedin']
  return (
    <Card done={done}>
      <PlatformHeader
        icon="💼" name="LINKEDIN (personal)"
        url={LINKEDIN_URL} done={done}
      />
      <PostText text={text} />
      <div className="flex items-center gap-3">
        <CopyBtn text={text} />
        <label className="flex items-center gap-2 cursor-pointer ml-auto select-none">
          <input type="checkbox" checked={done} onChange={() => onToggle('linkedin')}
            className="w-4 h-4 accent-green-500 cursor-pointer" />
          <span className={`text-sm font-medium ${done ? 'text-green-400' : 'text-gray-400'}`}>✓ Mark posted</span>
        </label>
      </div>
    </Card>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function Content() {
  const [posts, setPosts] = useState({ fb: null, reddit: null, linkedin: null })
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState(loadState)

  // Persist on every change
  useEffect(() => { saveState(state) }, [state])

  const toggle = useCallback((key) => {
    setState(prev => ({
      ...prev,
      posted: { ...prev.posted, [key]: !prev.posted[key] },
    }))
  }, [])

  // Fetch today's content, fallback to most recent per channel
  useEffect(() => {
    async function load() {
      const channels = ['facebook_group', 'facebook_page', 'reddit', 'linkedin']

      // Try today's schedule first
      const { data: todayData } = await supabase
        .from('roofing_content')
        .select('id, title, hook, body, channel')
        .in('channel', channels)
        .in('status', ['approved', 'pending_approval', 'published'])
        .eq('schedule_date', TODAY_KEY)
        .order('channel')

      // Fallback: most recent approved per channel
      const { data: recentData } = await supabase
        .from('roofing_content')
        .select('id, title, hook, body, channel')
        .in('channel', channels)
        .in('status', ['approved', 'pending_approval', 'published'])
        .order('created_at', { ascending: false })
        .limit(20)

      const pick = (ch) => {
        const fromToday = (todayData || []).find(r => r.channel === ch)
        if (fromToday) return fromToday
        return (recentData || []).find(r => r.channel === ch) || null
      }

      const fullText = (row) => {
        if (!row) return null
        return [row.hook, row.body].filter(Boolean).join('\n\n').trim() || row.title || null
      }

      const fbRow = pick('facebook_group') || pick('facebook_page')

      setPosts({
        fb:       fullText(fbRow),
        reddit:   fullText(pick('reddit')),
        linkedin: fullText(pick('linkedin')),
      })
      setLoading(false)
    }
    load()
  }, [])

  const { posted } = state

  // Count platforms done (FB owned = 1, FB external = 1 if all checked, Reddit = 1, LinkedIn = 1)
  const fbOwnedDone = !!posted['fb_owned']
  const fbExtDone = EXTERNAL_GROUPS.every(g => !!posted[`fb_ext_${g}`])
  const redditDone = !!posted['reddit']
  const linkedinDone = !!posted['linkedin']
  const doneCount = [fbOwnedDone, fbExtDone, redditDone, linkedinDone].filter(Boolean).length
  const allDone = doneCount === 4

  if (loading) return (
    <div className="flex items-center justify-center py-32 text-gray-600 text-sm">
      Loading today's posts…
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto pb-20 pt-2">

      {/* Header */}
      <div className="mb-8">
        <div className="text-[11px] text-gray-600 uppercase tracking-widest font-bold mb-1">
          TODAY'S POSTS
        </div>
        <div className="text-xl font-bold text-white">{TODAY_LABEL}</div>
        <div className="mt-1 h-px bg-[#2a2a3e]" />
      </div>

      {/* Cards */}
      <FBOwnedCard    text={posts.fb}       posted={posted} onToggle={toggle} />
      <FBExternalCard text={posts.fb}       posted={posted} onToggle={toggle} />
      <RedditCard     text={posts.reddit}   posted={posted} onToggle={toggle} />
      <LinkedInCard   text={posts.linkedin} posted={posted} onToggle={toggle} />

      {/* Footer */}
      <div className={`rounded-xl border p-5 text-center transition-all ${
        allDone
          ? 'bg-green-950/30 border-green-500/40'
          : 'bg-[#0a0a0f] border-[#1e1e2e]'
      }`}>
        <div className={`text-lg font-bold ${allDone ? 'text-green-400' : 'text-white'}`}>
          {allDone ? '🎉 ALL DONE TODAY' : `DONE TODAY: ${doneCount}/4 platforms posted ✓`}
        </div>
        {allDone && (
          <div className="text-sm text-green-500/70 mt-1">Resets automatically at midnight.</div>
        )}
      </div>
    </div>
  )
}

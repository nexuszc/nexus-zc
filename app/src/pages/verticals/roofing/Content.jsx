import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const fn = (name) => `${SB_URL}/functions/v1/${name}`

async function callFn(name, body = {}) {
  const r = await fetch(fn(name), {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.json()
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FB_GROUP_URL = 'https://facebook.com/groups/2266757270527259'
const REDDIT_URL = 'https://reddit.com/r/RoofingOS/submit'
const LINKEDIN_URL = 'https://linkedin.com/feed'

const FB_VARIANTS = [
  {
    label: 'Variant A — CompanyCam angle',
    body: `We built a free replacement for CompanyCam. Here's why.

CompanyCam charges $79–199/month to store and share job photos. That's it.

We built something that does that — plus gives every homeowner a real-time portal for their job. Photos, updates, insurance claim status, the whole thing.

It's free. No credit card. 4 minutes to get your first homeowner portal live: roofingos.dev/dashboard

Curious what the homeowner sees? Demo: roofingos.dev/portal/demo

Happy to answer questions in comments.`,
  },
  {
    label: 'Variant B — Homeowner calls angle',
    body: `Quick question for contractors: how many calls/texts do you get from homeowners asking "what's the status of my roof?"

Average contractor gets 4–6 status check calls per active job per week. That's 20–30 interruptions a week during storm season.

We built a homeowner portal that shows them everything in real time — photos your crew uploads from the job site, updates from the office, insurance claim status. They stop calling because they don't need to.

Portal is free. Get set up in 4 minutes: roofingos.dev/dashboard

Demo of what the homeowner sees: roofingos.dev/portal/demo`,
  },
  {
    label: 'Variant C — Supplement AI angle',
    body: `Storm season question: what's your supplement approval rate with State Farm right now?

Industry average is around 58%. Best contractors hitting 75–80% are using AI to build the packets.

We built Supplement AI into our free portal. It analyzes photos, generates carrier-specific Xactimate line items the adjuster missed, and builds the full supplement packet.

$99/job. Full Aria adjuster follow-up handling is $329/job. Industry supplement companies charge 10–15% of recovery — you keep significantly more here.

The homeowner portal is free: roofingos.dev/dashboard`,
  },
]

const FB_OWNED_VARIANTS = [
  {
    body: `📸 Contractors: what does your homeowner communication look like right now?

If your answer is "a lot of calls and texts" — you're in the right place.

We built Roofing OS to give every homeowner a live portal for their job. Photos, insurance status, crew schedule, Aria AI chat. They stop calling because they don't need to.

Free. No credit card. Drop a question in comments.

→ roofingos.dev/portal/demo`,
  },
  {
    body: `Storm season question for the group: how do you handle homeowner calls when you're running 10+ active jobs?

The top contractors I know have one system: send the portal link before you leave the driveway.

Homeowner gets real-time updates. They stop calling. Your crew stays on jobs.

Free: roofingos.dev/dashboard — what's your system?`,
  },
  {
    body: `Supplement question for the group: what's your approval rate with State Farm this season?

Industry average is around 58%. Best contractors hitting 75–80% are using AI to build the packets. Photo analysis, missed line items, carrier-specific Xactimate codes — all automated.

Built into our free portal. $99/job. Anyone working insurance restoration jobs?

→ roofingos.dev`,
  },
]

const REDDIT_VARIANTS = [
  {
    title: 'Free homeowner portal for roofing contractors — what we built and why',
    body: `We built roofingos.dev after watching contractors lose referrals because homeowners felt ignored during the job.

The portal gives every homeowner a magic link — no app, no password. They see job status, crew photos, insurance claim tracker, and can message your office directly.

It's free. No credit card. Curious what contractors think — what does your current homeowner communication look like?`,
  },
  {
    title: 'How we cut homeowner status calls by 70% with one link',
    body: `The average roofing job generates 4-8 "what's happening?" calls from the homeowner. Multiply by 20+ active jobs during storm season and you're fielding 80-160 interruptions a week.

We built a portal that answers those questions automatically. Homeowner gets a link at contract signing, sees live updates as work progresses.

Free at roofingos.dev — happy to answer questions here.`,
  },
  {
    title: 'Supplement AI that builds carrier-specific packages — how it works',
    body: `Most supplement software generates generic reports. We built something that adjusts the package based on the carrier.

State Farm gets documentation volume. Allstate gets third-party market data. USAA gets code citations. Same damage, different presentation — approval rates differ by 15-20%.

The AI is free to use at roofingos.dev/dashboard. What carrier are you fighting most this season?`,
  },
]

const LINKEDIN_VARIANTS = [
  {
    body: `The roofing industry is going through a technology inflection point.

Contractors who figured out homeowner communication — real-time portals, automated updates, digital claim tracking — are closing 20-30% more referrals than those still running on phone calls.

We built roofingos.dev to make this accessible to independent contractors, not just enterprise operations. The homeowner portal is free.

If you're in residential roofing or insurance restoration, curious what your current tech stack looks like.`,
  },
  {
    body: `Insurance restoration roofing is one of the most documentation-intensive businesses in construction.

Every supplement requires: photos, Xactimate codes, code compliance citations, carrier-specific language. Most contractors leave $3,000-5,000 per claim on the table because the documentation isn't optimized.

We built AI supplement generation into roofingos.dev. The tool is free. Average recovery improvement: $2,800-5,400 per claim.

For roofing contractors — what's your current supplement process look like?`,
  },
  {
    body: `The 5-star review problem in roofing: most contractors ask at the wrong moment.

They send a review request 3 weeks after the job when the relationship has gone cold. Response rate: 8-15%.

Contractors using a homeowner portal ask at completion — when the homeowner just watched their job progress in real time, saw before/after photos, and felt genuinely informed. Response rate: 40-60%.

The timing is everything. Our portal at roofingos.dev automates the review request at job completion. Free to use.`,
  },
]

const EXTERNAL_GROUPS = [
  'Roofing Contractors Network',
  'Storm Restoration Contractors',
  'Roofers Coffee Shop',
  'Insurance Restoration Contractors',
  'Roofing Business Owners USA',
]
const OWNED_GROUP = 'Roofing Contractors — AI Tools & Tips'

const BLOG_POSTS = [
  { title: 'The Best Free CompanyCam Alternative for Roofing Contractors in 2026', url: 'https://roofingos.dev/blog/companycam-alternative-free.html', slug: 'companycam-alternative-free' },
  { title: 'Roofing Supplement Software That Actually Gets Approvals in 2026', url: 'https://roofingos.dev/blog/roofing-supplement-software.html', slug: 'roofing-supplement-software' },
  { title: 'Why Every Roofing Contractor Needs a Homeowner Portal in 2026', url: 'https://roofingos.dev/blog/homeowner-portal-roofing.html', slug: 'homeowner-portal-roofing' },
  { title: 'AccuLynx Alternative: Full Comparison for 2026', url: 'https://roofingos.dev/blog/acculynx-alternative.html', slug: 'acculynx-alternative' },
  { title: 'How to Stop Homeowner Calls During Roofing Jobs', url: 'https://roofingos.dev/blog/stop-homeowner-calls.html', slug: 'stop-homeowner-calls' },
  { title: 'Roofing Storm Leads: How to Win After Hail', url: 'https://roofingos.dev/blog/roofing-storm-leads.html', slug: 'roofing-storm-leads' },
  { title: 'The 48-Hour Rule That Kills Your Close Rate', url: 'https://roofingos.dev/blog/the-48-hour-rule-that-kills-your-close-rate.html', slug: '48-hour-rule' },
  { title: 'Why Homeowners Don\'t Trust Roofers', url: 'https://roofingos.dev/blog/why-homeowners-dont-trust-roofers.html', slug: 'why-homeowners-dont-trust-roofers' },
  { title: 'Get 5-Star Reviews From Every Job: Automated System', url: 'https://roofingos.dev/blog/get-5-star-reviews-from-every-roofing-job-automated-system.html', slug: '5-star-reviews' },
  { title: 'Hail Storm Hit? Do This First', url: 'https://roofingos.dev/blog/hail-storm-hit-do-this-first.html', slug: 'hail-storm-hit' },
]

// ── Utilities ─────────────────────────────────────────────────────────────────

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

let _setToast = null
function toast(msg, type = 'success') {
  if (_setToast) _setToast({ msg, type, id: Date.now() })
}

// ── Small reusable components ─────────────────────────────────────────────────

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

function SectionHeader({ title, subtitle }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-bold text-white uppercase tracking-widest">{title}</h2>
      {subtitle && <p className="text-[11px] text-gray-600 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function StatCard({ value, label, color = 'text-white' }) {
  return (
    <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-3 text-center">
      <div className={`text-xl font-bold ${color}`}>{value ?? '—'}</div>
      <div className="text-[10px] text-gray-600 mt-0.5 leading-tight">{label}</div>
    </div>
  )
}

function ActionButton({ label, onClick, color = 'blue', small = false, loading = false }) {
  const colors = {
    blue: 'bg-blue-600 hover:bg-blue-500 text-white',
    orange: 'bg-orange-500 hover:bg-orange-400 text-white',
    green: 'bg-green-600 hover:bg-green-500 text-white',
    red: 'bg-red-600 hover:bg-red-500 text-white',
    gray: 'bg-[#1e1e2e] hover:bg-[#2e2e3e] text-gray-300',
  }
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`font-semibold rounded-lg transition-colors disabled:opacity-40 ${
        small ? 'text-[11px] px-2.5 py-1.5' : 'text-xs px-3 py-2'
      } ${colors[color]}`}
    >
      {loading ? 'Working…' : label}
    </button>
  )
}

// ── Section 0: Scoreboard ─────────────────────────────────────────────────────

function Scoreboard({ stats }) {
  return (
    <div className="grid grid-cols-4 gap-3 mb-6">
      <StatCard value={stats?.posts_today ?? '—'} label="Posts live today" color="text-blue-400" />
      <StatCard value={stats?.videos_this_week ?? '—'} label="Videos uploaded this week" color="text-purple-400" />
      <StatCard value={stats?.emails_today ?? '—'} label="Emails sent today" color="text-green-400" />
      <StatCard value={stats?.calls_today ?? '—'} label="Prospects called today" color="text-orange-400" />
    </div>
  )
}

// ── Section 1: Push Now ───────────────────────────────────────────────────────

const CHANNEL_ICONS = {
  youtube: '▶️',
  reddit: '🤖',
  facebook_page: '🔵',
  facebook_group: '🔵',
  linkedin: '💼',
}

function PushNowSection({ pending, onPushed }) {
  const [pushing, setPushing] = useState({})

  const pushItem = async (item) => {
    setPushing(p => ({ ...p, [item.id]: true }))
    try {
      const r = await callFn('roofing-content-publisher', { content_id: item.id })
      if (r.ok || r.published_url) {
        toast(`✓ ${item.title?.slice(0, 40)} pushed`)
        onPushed?.(item.id)
      } else {
        toast(r.error || 'Push failed', 'error')
      }
    } catch {
      toast('Push failed', 'error')
    }
    setPushing(p => ({ ...p, [item.id]: false }))
  }

  if (!pending || pending.length === 0) {
    return (
      <div className="mb-6">
        <SectionHeader title="Push Now" subtitle="Content approved but not yet posted" />
        <div className="bg-green-950/30 border border-green-500/20 rounded-xl p-4 text-center">
          <div className="text-green-400 text-sm font-bold">✓ All caught up</div>
          <div className="text-gray-600 text-[11px] mt-1">No content is waiting to be pushed</div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <SectionHeader title="⚠ Push Now" subtitle={`${pending.length} item${pending.length > 1 ? 's' : ''} approved and waiting`} />
      <div className="space-y-2">
        {pending.map(item => {
          const icon = CHANNEL_ICONS[item.channel] || '📄'
          const isManual = ['facebook_group', 'reddit', 'linkedin'].includes(item.channel)
          return (
            <div key={item.id} className="bg-red-950/20 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
              <span className="text-xl shrink-0">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{item.title}</div>
                <div className="text-[10px] text-gray-500 capitalize">{item.channel?.replace('_', ' ')} · approved {ago(item.updated_at)}</div>
              </div>
              {isManual ? (
                <CopyButton
                  text={`${item.hook || ''}\n\n${item.body || ''}`.trim()}
                  label="📋 Copy & post"
                  className="!text-xs !px-3 !py-2"
                />
              ) : (
                <ActionButton
                  label="Push now"
                  color="red"
                  small
                  loading={pushing[item.id]}
                  onClick={() => pushItem(item)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Section 2: Today's Manual Posts ──────────────────────────────────────────

function FacebookDailyTask() {
  const today = new Date().toISOString().slice(0, 10)
  const dayIndex = Math.floor(Date.now() / 86400000) % FB_VARIANTS.length
  const variant = FB_VARIANTS[dayIndex]
  const ownedVariant = FB_OWNED_VARIANTS[dayIndex]

  const [checked, setChecked] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('fb_task') || '{}')
      if (stored.date === today) return stored.checked || {}
    } catch {}
    return {}
  })
  const [copiedMain, setCopiedMain] = useState(false)
  const [copiedOwned, setCopiedOwned] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem('fb_task', JSON.stringify({ date: today, checked }))
    } catch {}
  }, [checked, today])

  const externalDone = EXTERNAL_GROUPS.filter(g => checked[g]).length
  const ownedDone = !!checked[OWNED_GROUP]
  const allDone = externalDone === EXTERNAL_GROUPS.length && ownedDone

  const toggle = (group) => setChecked(prev => ({ ...prev, [group]: !prev[group] }))

  const copyMain = async () => {
    try { await navigator.clipboard.writeText(variant.body); setCopiedMain(true); setTimeout(() => setCopiedMain(false), 2000) }
    catch { toast('Copy failed', 'error') }
  }
  const copyOwned = async () => {
    try { await navigator.clipboard.writeText(ownedVariant.body); setCopiedOwned(true); setTimeout(() => setCopiedOwned(false), 2000) }
    catch { toast('Copy failed', 'error') }
  }

  return (
    <div className={`border rounded-xl p-5 mb-4 transition-colors ${
      allDone ? 'bg-green-950/30 border-green-500/30' : 'bg-[#1a1a2e] border-blue-500/30'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🔵</span>
        <div className="flex-1">
          <div className={`text-sm font-bold ${allDone ? 'text-green-400' : 'text-blue-400'}`}>Facebook Groups</div>
          <div className="text-[10px] text-gray-600">{variant.label} · AE daily task</div>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full font-bold ${
          allDone ? 'text-green-400 bg-green-500/15' : 'text-blue-400 bg-blue-500/10'
        }`}>
          {externalDone + (ownedDone ? 1 : 0)}/{EXTERNAL_GROUPS.length + 1} done
        </span>
      </div>

      <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-[#0e0e18] rounded-lg p-4 border border-[#1e1e2e] leading-relaxed max-h-36 overflow-y-auto mb-3">
        {variant.body}
      </pre>

      <button
        onClick={copyMain}
        className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all mb-4 ${
          copiedMain ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
        }`}
      >
        {copiedMain ? '✓ Copied to clipboard!' : '📋 Copy post'}
      </button>

      <div className="space-y-1 mb-5">
        {EXTERNAL_GROUPS.map(group => (
          <label key={group} className="flex items-center gap-3 cursor-pointer py-1.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors">
            <input type="checkbox" checked={!!checked[group]} onChange={() => toggle(group)}
              className="w-4 h-4 rounded accent-blue-500 cursor-pointer shrink-0" />
            <span className={`text-sm flex-1 transition-colors ${checked[group] ? 'text-green-400 line-through opacity-60' : 'text-gray-200'}`}>
              {group}
            </span>
            {checked[group] && <span className="text-green-400 text-xs">✓</span>}
          </label>
        ))}
      </div>

      <div className="border-t border-[#1e1e2e] pt-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest font-bold flex-1">Our owned group</div>
          <a href={FB_GROUP_URL} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300">Open group ↗</a>
        </div>
        <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-[#0e0e18] rounded-lg p-4 border border-[#1e1e2e] leading-relaxed max-h-28 overflow-y-auto mb-3">
          {ownedVariant.body}
        </pre>
        <div className="flex items-center gap-3">
          <button
            onClick={copyOwned}
            className={`flex-1 py-2 rounded-xl font-bold text-sm transition-all ${
              copiedOwned ? 'bg-green-600 text-white' : 'bg-[#1e1e2e] hover:bg-blue-700 text-gray-300 hover:text-white'
            }`}
          >
            {copiedOwned ? '✓ Copied!' : '📋 Copy group post'}
          </button>
          <label className="flex items-center gap-2 cursor-pointer py-2 px-3 rounded-lg hover:bg-white/[0.03] shrink-0">
            <input type="checkbox" checked={ownedDone} onChange={() => toggle(OWNED_GROUP)}
              className="w-4 h-4 rounded accent-blue-500 cursor-pointer" />
            <span className={`text-sm transition-colors ${ownedDone ? 'text-green-400' : 'text-gray-400'}`}>{OWNED_GROUP}</span>
          </label>
        </div>
      </div>

      {allDone && (
        <div className="mt-4 pt-4 border-t border-green-500/20 text-center text-xs text-green-400 font-semibold">
          ✓ Facebook done for today. Resets at midnight.
        </div>
      )}
    </div>
  )
}

function RedditSection() {
  const today = new Date().toISOString().slice(0, 10)
  const dayIndex = Math.floor(Date.now() / 86400000) % REDDIT_VARIANTS.length
  const variant = REDDIT_VARIANTS[dayIndex]

  const [checked, setChecked] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('reddit_task') || '{}')
      return s.date === today ? s.done : false
    } catch { return false }
  })

  const save = (val) => {
    setChecked(val)
    try { localStorage.setItem('reddit_task', JSON.stringify({ date: today, done: val })) } catch {}
  }

  return (
    <div className={`border rounded-xl p-5 mb-4 transition-colors ${checked ? 'bg-green-950/30 border-green-500/30' : 'bg-[#1a1a2e] border-orange-500/20'}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🤖</span>
        <div className="flex-1">
          <div className={`text-sm font-bold ${checked ? 'text-green-400' : 'text-orange-400'}`}>Reddit r/RoofingOS</div>
          <div className="text-[10px] text-gray-600">Post to our community</div>
        </div>
        {checked
          ? <span className="text-xs text-green-400 bg-green-500/15 px-3 py-1 rounded-full font-bold">✓ Posted</span>
          : <a href={REDDIT_URL} target="_blank" rel="noopener noreferrer" className="text-[10px] text-orange-400 hover:text-orange-300">Open r/RoofingOS ↗</a>
        }
      </div>
      <div className="text-xs text-gray-400 font-semibold mb-1">{variant.title}</div>
      <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-[#0e0e18] rounded-lg p-4 border border-[#1e1e2e] leading-relaxed max-h-32 overflow-y-auto mb-3">
        {variant.body}
      </pre>
      <div className="flex items-center gap-3">
        <CopyButton text={`${variant.title}\n\n${variant.body}`} label="📋 Copy post" className="flex-1 !py-2 !text-sm !justify-center" />
        <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg hover:bg-white/[0.03]">
          <input type="checkbox" checked={checked} onChange={(e) => save(e.target.checked)} className="w-4 h-4 rounded accent-orange-500" />
          <span className={`text-sm ${checked ? 'text-green-400' : 'text-gray-400'}`}>Mark posted</span>
        </label>
      </div>
    </div>
  )
}

function LinkedInSection() {
  const today = new Date().toISOString().slice(0, 10)
  const dayIndex = Math.floor(Date.now() / 86400000) % LINKEDIN_VARIANTS.length
  const variant = LINKEDIN_VARIANTS[dayIndex]

  const [checked, setChecked] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('linkedin_task') || '{}')
      return s.date === today ? s.done : false
    } catch { return false }
  })

  const save = (val) => {
    setChecked(val)
    try { localStorage.setItem('linkedin_task', JSON.stringify({ date: today, done: val })) } catch {}
  }

  return (
    <div className={`border rounded-xl p-5 mb-4 transition-colors ${checked ? 'bg-green-950/30 border-green-500/30' : 'bg-[#1a1a2e] border-blue-500/20'}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">💼</span>
        <div className="flex-1">
          <div className={`text-sm font-bold ${checked ? 'text-green-400' : 'text-blue-400'}`}>LinkedIn</div>
          <div className="text-[10px] text-gray-600">Post from personal profile</div>
        </div>
        {checked
          ? <span className="text-xs text-green-400 bg-green-500/15 px-3 py-1 rounded-full font-bold">✓ Posted</span>
          : <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300">Open LinkedIn ↗</a>
        }
      </div>
      <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-[#0e0e18] rounded-lg p-4 border border-[#1e1e2e] leading-relaxed max-h-32 overflow-y-auto mb-3">
        {variant.body}
      </pre>
      <div className="flex items-center gap-3">
        <CopyButton text={variant.body} label="📋 Copy post" className="flex-1 !py-2 !text-sm !justify-center" />
        <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg hover:bg-white/[0.03]">
          <input type="checkbox" checked={checked} onChange={(e) => save(e.target.checked)} className="w-4 h-4 rounded accent-blue-500" />
          <span className={`text-sm ${checked ? 'text-green-400' : 'text-gray-400'}`}>Mark posted</span>
        </label>
      </div>
    </div>
  )
}

// ── Section 3: Automated Channels ────────────────────────────────────────────

function AutomatedChannels({ ch, onAction }) {
  const [loading, setLoading] = useState({})

  const act = async (key, fnName, body) => {
    setLoading(l => ({ ...l, [key]: true }))
    try {
      const r = await callFn(fnName, body)
      toast(r.ok ? `✓ ${key} triggered` : (r.error || 'Error'), r.ok ? 'success' : 'error')
      onAction?.()
    } catch { toast('Error', 'error') }
    setLoading(l => ({ ...l, [key]: false }))
  }

  const rows = [
    {
      icon: '▶️',
      label: 'YouTube',
      key: 'youtube',
      stats: [
        `${ch?.youtube_queue ?? '—'} in queue`,
        `Last: ${ch?.youtube_last_title ? ch.youtube_last_title.slice(0, 30) + '…' : '—'}`,
        `${ch?.youtube_this_week ?? '—'} this week`,
      ],
      action: { label: 'Upload now', fn: 'roofing-youtube-uploader', body: {} },
    },
    {
      icon: '📧',
      label: 'Email sequences',
      key: 'email',
      stats: [
        `${ch?.email_active ?? '—'} active`,
        `${ch?.email_due_today ?? '—'} due today`,
        `${ch?.email_open_rate ?? '—'}% open rate (7d)`,
      ],
      action: { label: 'Send due now', fn: 'roofing-outreach-sequencer', body: {} },
    },
    {
      icon: '📞',
      label: 'Aria calls',
      key: 'aria',
      stats: [
        `${ch?.aria_queued ?? '—'} queued`,
        `${ch?.aria_today ?? '—'} made today`,
        `${ch?.aria_answer_rate ?? '—'}% answer rate`,
      ],
      action: { label: 'Queue more', fn: 'aria-queue-daily', body: {} },
    },
    {
      icon: '❄️',
      label: 'Cold email',
      key: 'cold',
      stats: [
        `${ch?.cold_enrolled ?? '—'} enrolled`,
        `${ch?.cold_sent_today ?? '—'} sent today`,
      ],
      action: { label: 'Enroll more', fn: 'aria-queue-daily', body: {} },
    },
  ]

  return (
    <div className="mb-6">
      <SectionHeader title="Automated Channels" subtitle="Live system status" />
      <div className="grid grid-cols-2 gap-3">
        {rows.map(row => (
          <div key={row.key} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">{row.icon}</span>
              <span className="text-sm font-bold text-white">{row.label}</span>
            </div>
            <div className="space-y-1 mb-3">
              {row.stats.map(s => (
                <div key={s} className="text-xs text-gray-400">{s}</div>
              ))}
            </div>
            <ActionButton
              label={row.action.label}
              color="gray"
              small
              loading={loading[row.key]}
              onClick={() => act(row.key, row.action.fn, row.action.body)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section 4: Content Calendar ───────────────────────────────────────────────

function ContentCalendar({ calendar }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return d
  })

  return (
    <div className="mb-6">
      <SectionHeader title="Content Calendar" subtitle="Next 7 days" />
      <div className="space-y-2">
        {days.map(d => {
          const key = d.toISOString().slice(0, 10)
          const label = i => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
          const isToday = key === new Date().toISOString().slice(0, 10)
          const dayData = calendar?.[key] || {}
          return (
            <div key={key} className={`border rounded-xl p-3 ${isToday ? 'border-blue-500/40 bg-blue-950/20' : 'border-[#1e1e2e] bg-[#12121a]'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`text-xs font-bold w-12 ${isToday ? 'text-blue-400' : 'text-gray-400'}`}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]}
                </div>
                <div className="text-[10px] text-gray-600">{key}</div>
                {isToday && <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full font-bold">Today</span>}
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[
                  { ch: 'YouTube', icon: '▶️', val: dayData.youtube },
                  { ch: 'FB Page', icon: '🔵', val: dayData.facebook_page },
                  { ch: 'FB Group', icon: '🟦', val: dayData.facebook_group },
                  { ch: 'Reddit', icon: '🤖', val: dayData.reddit },
                  { ch: 'LinkedIn', icon: '💼', val: dayData.linkedin },
                ].map(({ ch, icon, val }) => (
                  <div key={ch} className="text-center">
                    <div className="text-[10px] text-gray-600 mb-1">{icon} {ch}</div>
                    <div className="text-[10px] text-gray-400 leading-tight truncate" title={val}>
                      {val ? val.slice(0, 18) : <span className="text-gray-700">none</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Section 5: Blog Posts ─────────────────────────────────────────────────────

function BlogPostsSection({ indexedOverrides = {} }) {
  const [indexed, setIndexed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('blog_indexed') || '{}') } catch { return {} }
  })

  const toggleIndexed = (slug) => {
    const next = { ...indexed, [slug]: !indexed[slug] }
    setIndexed(next)
    try { localStorage.setItem('blog_indexed', JSON.stringify(next)) } catch {}
  }

  return (
    <div className="mb-6">
      <SectionHeader title="Blog Posts" subtitle={`${BLOG_POSTS.length} published`} />
      <div className="space-y-2">
        {BLOG_POSTS.map(post => (
          <div key={post.slug} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-200 font-medium truncate">{post.title}</div>
              <div className="text-[10px] text-gray-600 mt-0.5 truncate">{post.url}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={!!indexed[post.slug]} onChange={() => toggleIndexed(post.slug)}
                  className="w-3.5 h-3.5 rounded accent-green-500" />
                <span className={`text-[10px] ${indexed[post.slug] ? 'text-green-400' : 'text-gray-600'}`}>Indexed</span>
              </label>
              <a href={post.url} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-1 rounded font-semibold">
                View ↗
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section 6: Partnership Status ─────────────────────────────────────────────

function PartnershipSection({ targets, onUpdate }) {
  const [sending, setSending] = useState({})
  const [marking, setMarking] = useState({})

  const sendFollowUp = async (target) => {
    setSending(s => ({ ...s, [target.id]: true }))
    try {
      const r = await callFn('send-email', {
        to: target.email,
        subject: 'Following up — Roofing OS',
        text: `Hi,\n\nFollowing up on my earlier message about Roofing OS. Happy to set up a quick call this week.\n\n— Zach\nzach@nexuszc.com`,
        from: 'Zach Curtis <zach@nexuszc.com>',
      })
      if (r.ok || r.id) {
        await supabase.from('roofing_partnership_targets').update({ sent_at: new Date().toISOString(), status: 'sent' }).eq('id', target.id)
        toast(`✓ Follow-up sent to ${target.name}`)
        onUpdate?.()
      } else {
        toast('Send failed: ' + (r.error || 'unknown'), 'error')
      }
    } catch { toast('Send failed', 'error') }
    setSending(s => ({ ...s, [target.id]: false }))
  }

  const markReplied = async (target) => {
    setMarking(m => ({ ...m, [target.id]: true }))
    await supabase.from('roofing_partnership_targets').update({ replied_at: new Date().toISOString(), status: 'replied' }).eq('id', target.id)
    toast(`✓ ${target.name} marked replied`)
    onUpdate?.()
    setMarking(m => ({ ...m, [target.id]: false }))
  }

  const statusColor = {
    sent: 'text-blue-400',
    replied: 'text-green-400',
    converted: 'text-purple-400',
    default: 'text-gray-500',
  }

  if (!targets?.length) {
    return (
      <div className="mb-6">
        <SectionHeader title="Partnership Status" />
        <div className="text-sm text-gray-600 text-center py-8">No partnership targets found</div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <SectionHeader title="Partnership Status" subtitle={`${targets.length} targets`} />
      <div className="space-y-2">
        {targets.map(t => (
          <div key={t.id} className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-white">{t.name}</span>
                  <span className={`text-[10px] font-semibold capitalize px-2 py-0.5 rounded-full ${
                    statusColor[t.status] || statusColor.default
                  } bg-white/5`}>
                    {t.status || 'pending'}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">{t.email}</div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-gray-600">Last contacted: {fmt(t.sent_at) || '—'}</span>
                  {t.replied_at && <span className="text-[10px] text-green-400">Replied: {fmt(t.replied_at)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!t.replied_at && (
                  <ActionButton
                    label={sending[t.id] ? 'Sending…' : 'Send follow-up'}
                    color="blue"
                    small
                    loading={sending[t.id]}
                    onClick={() => sendFollowUp(t)}
                  />
                )}
                {!t.replied_at && (
                  <ActionButton
                    label="Mark replied"
                    color="gray"
                    small
                    loading={marking[t.id]}
                    onClick={() => markReplied(t)}
                  />
                )}
                {t.replied_at && (
                  <span className="text-xs text-green-400 font-bold">✓ Replied</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Content Component ────────────────────────────────────────────────────

export default function Content() {
  const [toastState, setToastState] = useState(null)
  _setToast = setToastState

  const [scoreboard, setScoreboard] = useState(null)
  const [pendingContent, setPendingContent] = useState([])
  const [channels, setChannels] = useState(null)
  const [calendar, setCalendar] = useState(null)
  const [partnerships, setPartnerships] = useState([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10)

      const [
        { data: pendingData },
        { data: ytQueue },
        { data: emailStats },
        { data: ariaStats },
        { data: callsToday },
        { data: partnerData },
        { data: calendarData },
        { data: ytRecent },
        { data: emailToday },
        { data: enrolledCount },
      ] = await Promise.all([
        supabase.from('roofing_content').select('id,title,channel,hook,body,updated_at')
          .eq('status', 'approved').in('type', ['facebook_post','youtube_short','reddit_post','linkedin_post']).limit(10),
        supabase.from('roofing_content').select('id,title,created_at').eq('youtube_upload_ready', true).is('youtube_posted_at', null).limit(100),
        supabase.from('email_sequences').select('id,status,next_touch_at').eq('status', 'active').neq('unsubscribed', true),
        supabase.from('aria_call_queue').select('id,status,created_at').eq('status', 'queued'),
        supabase.from('aria_call_queue').select('id').eq('status', 'fired').gte('created_at', today),
        supabase.from('roofing_partnership_targets').select('*').order('sent_at', { ascending: true, nullsFirst: true }),
        supabase.from('roofing_content').select('title,channel,schedule_date').eq('status', 'pending_approval')
          .gte('schedule_date', today).lte('schedule_date', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).limit(50),
        supabase.from('roofing_content').select('id,title').eq('channel', 'youtube').not('youtube_posted_at', 'is', null).order('youtube_posted_at', { ascending: false }).limit(3),
        supabase.from('roofing_outreach_log').select('id').gte('created_at', today),
        supabase.from('email_sequences').select('id', { count: 'exact' }).neq('status', 'dead').neq('unsubscribed', true),
      ])

      const nowIso = new Date().toISOString()
      const emailDueToday = (emailStats || []).filter(s => s.next_touch_at && s.next_touch_at <= nowIso).length

      const calMap = {}
      for (const item of calendarData || []) {
        if (!calMap[item.schedule_date]) calMap[item.schedule_date] = {}
        calMap[item.schedule_date][item.channel] = item.title
      }

      setScoreboard({
        posts_today: (pendingData || []).filter(p => ['facebook_page','facebook_group'].includes(p.channel)).length,
        videos_this_week: (ytRecent || []).length,
        emails_today: (emailToday || []).length,
        calls_today: (callsToday || []).length,
      })

      setPendingContent(pendingData || [])

      setChannels({
        youtube_queue: (ytQueue || []).length,
        youtube_last_title: ytRecent?.[0]?.title || null,
        youtube_this_week: (ytRecent || []).length,
        email_active: (emailStats || []).length,
        email_due_today: emailDueToday,
        email_open_rate: '—',
        aria_queued: (ariaStats || []).length,
        aria_today: (callsToday || []).length,
        aria_answer_rate: '—',
        cold_enrolled: enrolledCount?.length ?? '—',
        cold_sent_today: (emailToday || []).length,
      })

      setCalendar(calMap)
      setPartnerships(partnerData || [])
    } catch (e) {
      console.error('Content load error:', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-600 text-sm">
        Loading content dashboard…
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-2 pb-16">
      <Toast toast={toastState} />

      {/* Scoreboard */}
      <Scoreboard stats={scoreboard} />

      {/* Push Now */}
      <PushNowSection pending={pendingContent} onPushed={() => loadData()} />

      {/* Manual Posts */}
      <div className="mb-6">
        <SectionHeader title="Today's Manual Posts" subtitle="AE daily task — copy, post, check off" />
        <FacebookDailyTask />
        <RedditSection />
        <LinkedInSection />
      </div>

      {/* Automated Channels */}
      <AutomatedChannels ch={channels} onAction={loadData} />

      {/* Content Calendar */}
      <ContentCalendar calendar={calendar} />

      {/* Blog Posts */}
      <BlogPostsSection />

      {/* Partnership Status */}
      <PartnershipSection targets={partnerships} onUpdate={loadData} />
    </div>
  )
}

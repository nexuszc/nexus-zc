// Funnel.jsx — Outreach Command Center
// Full campaign tracking: kanban + timeline + manual touch logging

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

// ── Constants ──────────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: 'new',            label: 'NEW',        count_color: 'text-gray-400',  bg: 'bg-gray-500/5',   border: 'border-gray-500/20',  dot: 'bg-gray-500'  },
  { key: 'contacted',      label: 'CONTACTED',  count_color: 'text-blue-400',  bg: 'bg-blue-500/5',   border: 'border-blue-500/20',  dot: 'bg-blue-500'  },
  { key: 'interested',     label: 'INTERESTED', count_color: 'text-amber-400', bg: 'bg-amber-500/5',  border: 'border-amber-500/20', dot: 'bg-amber-400' },
  { key: 'signed_up',      label: 'SIGNED UP',  count_color: 'text-green-400', bg: 'bg-green-500/5',  border: 'border-green-500/20', dot: 'bg-green-500' },
  { key: 'not_interested', label: 'DEAD',       count_color: 'text-red-400',   bg: 'bg-red-500/5',    border: 'border-red-500/20',   dot: 'bg-red-500'   },
]

const COL_KEYS = new Set(COLUMNS.map(c => c.key))
const statusToCol = s => COL_KEYS.has(s) ? s : 'new'

const TOUCH_ICONS = {
  aria_call: '📞', email: '📧', sms: '💬',
  manual_call: '📞', manual_text: '💬', manual_email: '📧',
  inbound_call: '📲', meeting: '🤝',
}

const TOUCH_STATUS_LABEL = {
  sent: 'Sent', delivered: 'Delivered', opened: 'Opened', clicked: 'Clicked',
  answered: 'Answered', voicemail: 'Voicemail', no_answer: 'No answer',
  interested: 'Interested', not_interested: 'Not interested', signed_up: 'Signed up',
  replied: 'Replied', bounced: 'Bounced', left_message: 'Left message', sent_info: 'Sent info',
}

const TOUCH_STATUS_COLOR = {
  opened: 'text-green-400', clicked: 'text-green-400', interested: 'text-amber-400',
  signed_up: 'text-emerald-400', answered: 'text-blue-400', replied: 'text-green-400',
  voicemail: 'text-gray-400', no_answer: 'text-gray-500',
  sent: 'text-gray-500', delivered: 'text-gray-500', bounced: 'text-red-500',
  not_interested: 'text-red-400',
}

const FILTERS = [
  { key: 'all',   label: 'All'      },
  { key: 'hot',   label: '🔥 Hot'   },
  { key: 'zach',  label: 'My Calls' },
  { key: 'aria',  label: 'Aria'     },
  { key: 'email', label: 'Email'    },
]

const STATUS_OPTIONS = [
  { key: 'new',            label: 'New',        cls: 'text-gray-400 bg-gray-500/10 border-gray-500/20'    },
  { key: 'contacted',      label: 'Contacted',  cls: 'text-blue-400 bg-blue-500/10 border-blue-500/20'    },
  { key: 'interested',     label: 'Interested', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { key: 'signed_up',      label: 'Signed Up',  cls: 'text-green-400 bg-green-500/10 border-green-500/20' },
  { key: 'not_interested', label: 'Dead',       cls: 'text-red-400 bg-red-500/10 border-red-500/20'       },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function ago(ts) {
  if (!ts) return null
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Denver',
  }) + ' MT'
}

function firstName(name) {
  return (name || '').split(' ')[0] || 'there'
}

function getHeat(c) {
  const touches = c.touches || []
  const ms4h    = 4 * 3600 * 1000
  const ms24h   = 24 * 3600 * 1000
  const recentHot = touches.find(t =>
    Date.now() - new Date(t.created_at) < ms4h &&
    (t.status === 'opened' || t.status === 'clicked' ||
      (t.status === 'answered' && t.outcome === 'interested'))
  )
  if (recentHot) return 'hot'
  const anyEngaged = touches.find(t =>
    t.status === 'opened' || t.status === 'clicked' ||
    (t.status === 'answered' && Date.now() - new Date(t.created_at) < ms24h)
  )
  if (anyEngaged) return 'warm'
  if ((c.touch_count || 0) >= 7) return 'dead'
  return 'cold'
}

function getNextAction(c) {
  const tc   = c.touch_count || 0
  const heat = getHeat(c)
  if (heat === 'hot')                return { label: '🔥 HOT — call now',  cls: 'text-red-400 font-semibold' }
  if (tc === 0)                      return { label: 'Aria calling today',  cls: 'text-gray-500' }
  if (tc >= 7 && heat === 'dead')    return { label: 'Mark as dead?',       cls: 'text-red-500/60' }
  if (tc >= 4 && heat === 'cold')    return { label: 'Going cold',          cls: 'text-yellow-500' }
  const last = [...(c.touches || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  if (last?.touch_type === 'aria_call' && last?.status === 'no_answer')
    return { label: 'Email tomorrow', cls: 'text-blue-400' }
  if (last?.touch_type === 'email' && last?.status === 'sent')
    return { label: 'Aria in 2 days', cls: 'text-blue-400' }
  if (c.next_touch_at) {
    const d = Math.ceil((new Date(c.next_touch_at) - Date.now()) / 86400000)
    if (d <= 0) return { label: 'Touch due now', cls: 'text-amber-400' }
    return { label: `Next in ${d}d`, cls: 'text-gray-500' }
  }
  return { label: '—', cls: 'text-gray-600' }
}

function smsBody(c) {
  return `Hey ${firstName(c.contact_name)} — Zach from Roofing OS.\nFree homeowner portal for roofers — your clients see real-time photos, stop calling mid-job.\nTakes 4 min: roofingos.dev`
}

function emailHref(c) {
  const subj = encodeURIComponent('Quick follow up — Roofing OS')
  const body = encodeURIComponent(
    `Hey ${firstName(c.contact_name)} — just wanted to make sure my email didn't get buried.\n\nFree homeowner portal for roofing contractors. roofingos.dev — takes 4 minutes. Worth a look?`
  )
  return `mailto:${c.email}?subject=${subj}&body=${body}`
}

function isMobile() {
  return window.innerWidth < 768 || /iPhone|iPad|Android/i.test(navigator.userAgent)
}

function handleCallClick(phone, onCallNow, campaign, setCopied) {
  if (isMobile()) {
    window.location.href = `tel:${phone}`
  } else {
    navigator.clipboard.writeText(phone).catch(() => {})
    if (setCopied) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  onCallNow(campaign)
}

// ── DailyDigest ────────────────────────────────────────────────────────────────

function DailyDigest({ campaigns, todayStats }) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const newToday    = campaigns.filter(c => new Date(c.created_at) >= todayStart).length
  const signedToday = campaigns.filter(c => c.signed_up_at && new Date(c.signed_up_at) >= todayStart).length
  const hotNow      = campaigns.filter(c => getHeat(c) === 'hot')

  const stats = [
    { label: 'Aria calls',  val: todayStats.ariaMade,     sub: `${todayStats.ariaAnswered} answered` },
    { label: 'Emails sent', val: todayStats.emailsSent,   sub: `${todayStats.emailsOpened} opened`   },
    { label: 'Hot leads',   val: hotNow.length,           sub: 'last 4h', hot: hotNow.length > 0     },
    { label: 'New today',   val: newToday,                sub: 'added'                                },
    { label: 'Signed up',   val: signedToday,             sub: 'today'                                },
    { label: 'Total',       val: campaigns.length,        sub: 'in funnel'                            },
  ]

  return (
    <div className="mb-4 rounded-xl border border-[#1e1e2e] bg-[#0c0c14] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Today's Activity</h2>
        <span className="text-[10px] text-gray-700">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Denver' })}</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mb-3">
        {stats.map(s => (
          <div key={s.label} className="text-center">
            <div className={`text-xl font-bold ${s.hot ? 'text-red-400' : 'text-white'}`}>{s.val}</div>
            <div className="text-[10px] text-gray-500 leading-tight">{s.label}</div>
            <div className="text-[10px] text-gray-700">{s.sub}</div>
          </div>
        ))}
      </div>
      {hotNow.length > 0 && (
        <div className="border-t border-[#1e1e2e] pt-3">
          <div className="text-[10px] font-bold text-red-400 mb-2 uppercase tracking-wide">🔥 Hot Right Now</div>
          <div className="flex flex-wrap gap-2">
            {hotNow.slice(0, 6).map(c => (
              <div key={c.id} className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-2.5 py-1.5">
                <span className="text-xs text-red-300 font-medium">{c.company_name}</span>
                {c.phone && (
                  isMobile()
                    ? <a href={`tel:${c.phone}`} className="text-[10px] text-red-400 hover:text-red-300 underline">Call now</a>
                    : <span className="text-[10px] text-red-400 font-mono">{c.phone}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── CampaignCard ───────────────────────────────────────────────────────────────

function CampaignCard({ c, onSelect, onStatusChange, onCallNow }) {
  const heat = getHeat(c)
  const next = getNextAction(c)
  const sortedTouches = [...(c.touches || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const lastTouch = sortedTouches[0]
  const [copied, setCopied] = useState(false)

  const heatBorderCls = {
    hot:  'border-l-2 border-l-red-500',
    warm: 'border-l-2 border-l-amber-500/70',
    cold: '',
    dead: 'opacity-40',
  }[heat] || ''

  function lastTouchDesc() {
    if (!lastTouch) return 'No touches yet'
    const icon = TOUCH_ICONS[lastTouch.touch_type] || '•'
    const type = (lastTouch.touch_type || 'touch').replace(/_/g, ' ')
    const stat = TOUCH_STATUS_LABEL[lastTouch.status] || lastTouch.status || ''
    const when = ago(lastTouch.created_at) || ''
    return `${icon} ${type}${stat ? ` — ${stat}` : ''}${when ? ` · ${when}` : ''}`
  }

  return (
    <div
      onClick={() => onSelect(c)}
      className={`bg-[#0f0f1a] border border-[#1e1e2e] rounded-lg p-3 cursor-pointer hover:border-[#2e2e3e] transition-all ${heatBorderCls}`}
    >
      {/* Company + source badge */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white leading-tight truncate">{c.company_name || '(no name)'}</div>
          {c.contact_name && <div className="text-[10px] text-gray-600 mt-0.5">{c.contact_name}</div>}
        </div>
        {c.source && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${
            c.source === 'aria'     ? 'bg-purple-500/20 text-purple-400' :
            c.source === 'email'   ? 'bg-blue-500/20 text-blue-400'     :
            c.source === 'referral'? 'bg-green-500/20 text-green-400'   :
                                     'bg-gray-500/20 text-gray-400'
          }`}>
            {c.source}
          </span>
        )}
      </div>

      {/* Phone — prominent */}
      {c.phone && (
        <div className="text-sm font-bold text-white/70 font-mono tracking-wide mb-2">{c.phone}</div>
      )}

      {/* Last touch + next action */}
      <div className="text-[10px] text-gray-600 mb-1 truncate">{lastTouchDesc()}</div>
      <div className={`text-[10px] mb-2 ${next.cls}`}>{next.label}</div>

      {/* Call + Text buttons */}
      <div className="flex gap-2 mt-1" onClick={e => e.stopPropagation()}>
        {c.phone ? (
          <>
            <div className="flex-1 flex flex-col gap-0.5">
              <button
                onClick={() => handleCallClick(c.phone, onCallNow, c, setCopied)}
                className="flex items-center justify-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 border border-green-500/30 rounded-lg py-2 text-xs font-bold text-green-400 transition-colors w-full"
              >
                {isMobile() ? '📞 Call' : (copied ? '✓ Copied!' : '📋 Copy Number')}
              </button>
              {!isMobile() && (
                <div className="text-[9px] text-gray-700 text-center">Call from your phone</div>
              )}
            </div>
            <a
              href={`sms:${c.phone}?body=${encodeURIComponent(smsBody(c))}`}
              className="flex items-center justify-center gap-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-lg px-3 py-2 text-xs font-bold text-blue-400 transition-colors"
            >
              💬 Text
            </a>
          </>
        ) : c.email ? (
          <a
            href={emailHref(c)}
            className="flex-1 flex items-center justify-center gap-1 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg py-2 text-xs font-bold text-indigo-400 transition-colors"
          >
            📧 Email
          </a>
        ) : null}
      </div>

      <div className="mt-2 text-[9px] text-gray-700">{c.touch_count || 0} touches</div>
    </div>
  )
}

// ── KanbanColumn ───────────────────────────────────────────────────────────────

function KanbanColumn({ col, campaigns, onSelect, onStatusChange, onCallNow }) {
  return (
    <div className={`flex-shrink-0 w-64 rounded-xl border ${col.border} ${col.bg} p-3`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${col.dot}`} />
          <span className="text-[10px] font-bold tracking-widest text-gray-400">{col.label}</span>
        </div>
        <span className={`text-xs font-bold ${col.count_color}`}>{campaigns.length}</span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-380px)]">
        {campaigns.length === 0 ? (
          <div className="text-[10px] text-gray-700 text-center py-6">—</div>
        ) : (
          campaigns.map(c => (
            <CampaignCard key={c.id} c={c} onSelect={onSelect} onStatusChange={onStatusChange} onCallNow={onCallNow} />
          ))
        )}
      </div>
    </div>
  )
}

// ── TimelineView ───────────────────────────────────────────────────────────────

function TimelineView({ c, onClose, onLogTouch, onStatusChange, onCallNow }) {
  const sortedTouches = [...(c.touches || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const [copied, setCopied] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-[#0c0c14] border-l border-[#1e1e2e] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="p-4 border-b border-[#1e1e2e] shrink-0">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-bold text-white">{c.company_name}</h2>
              {c.contact_name && <div className="text-xs text-gray-500 mt-0.5">{c.contact_name}</div>}
              {c.phone && <div className="text-sm font-bold text-white/70 font-mono mt-1">{c.phone}</div>}
              {c.email && <div className="text-xs text-gray-700 mt-0.5">{c.email}</div>}
            </div>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-xl leading-none mt-0.5 shrink-0">✕</button>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 mb-3">
            {c.phone && (
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleCallClick(c.phone, onCallNow, c, setCopied)}
                  className="flex items-center gap-1.5 bg-green-500/15 border border-green-500/25 rounded-lg px-4 py-2 text-sm font-bold text-green-400 hover:bg-green-500/25 transition-colors"
                >
                  {isMobile() ? '📞 Call Now' : (copied ? '✓ Copied!' : '📋 Copy Number')}
                </button>
                {!isMobile() && (
                  <div className="text-[9px] text-gray-600 text-center">Call from your phone</div>
                )}
              </div>
            )}
            {c.phone && (
              <a href={`sms:${c.phone}?body=${encodeURIComponent(smsBody(c))}`} className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-500/20 transition-colors">
                💬 Text
              </a>
            )}
            {c.email && (
              <a href={emailHref(c)} className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-1.5 text-xs text-indigo-400 hover:bg-indigo-500/20 transition-colors">
                📧 Email
              </a>
            )}
            <a href="https://roofingos.dev/portal/demo" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/20 transition-colors">
              🔗 Portal demo
            </a>
          </div>

          {/* Status picker */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-gray-600 mr-1">Status:</span>
            {STATUS_OPTIONS.map(s => (
              <button
                key={s.key}
                onClick={() => onStatusChange(c.id, s.key)}
                className={`text-[10px] font-medium px-2 py-0.5 rounded border transition-all ${
                  c.status === s.key ? s.cls : 'text-gray-600 border-transparent hover:text-gray-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Timeline</h3>
            <button
              onClick={onLogTouch}
              className="text-xs bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 px-3 py-1.5 rounded-lg hover:bg-indigo-500/30 transition-colors"
            >
              + Log touch
            </button>
          </div>

          {sortedTouches.length === 0 ? (
            <div className="text-xs text-gray-600 text-center py-12">No touches yet</div>
          ) : (
            <div>
              {sortedTouches.map(t => (
                <div key={t.id} className="flex gap-3 py-3 border-b border-[#1a1a2a] last:border-0">
                  <span className="text-base shrink-0 mt-0.5">{TOUCH_ICONS[t.touch_type] || '•'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-white capitalize">
                        {(t.touch_type || 'touch').replace(/_/g, ' ').replace('aria ', 'Aria ')}
                      </span>
                      {t.status && (
                        <span className={`text-xs ${TOUCH_STATUS_COLOR[t.status] || 'text-gray-500'}`}>
                          — {TOUCH_STATUS_LABEL[t.status] || t.status}
                        </span>
                      )}
                    </div>
                    {t.content_preview && (
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">"{t.content_preview}"</div>
                    )}
                    {t.duration_seconds > 0 && (
                      <div className="text-[10px] text-gray-600 mt-0.5">{t.duration_seconds}s</div>
                    )}
                    {t.outcome && t.outcome !== t.status && (
                      <div className="text-[10px] text-gray-600 mt-0.5">Outcome: {t.outcome}</div>
                    )}
                    {t.zach_notes && (
                      <div className="text-[11px] text-amber-300/80 mt-1 italic">"{t.zach_notes}"</div>
                    )}
                    <div className="text-[10px] text-gray-700 mt-1">{fmt(t.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── FloatingCallCard ───────────────────────────────────────────────────────────
// Bottom-right floating script card — shown after tapping Call Now

function FloatingCallCard({ c, onSave, onClose }) {
  const [outcome, setOutcome] = useState('')
  const [saving,  setSaving]  = useState(false)
  const name = firstName(c?.contact_name || c?.company_name)

  const OUTCOMES = [
    { key: 'no_answer',      label: 'No answer'      },
    { key: 'interested',     label: 'Interested'     },
    { key: 'not_interested', label: 'Not interested' },
    { key: 'signed_up',      label: 'Signed up'      },
  ]

  async function save() {
    if (!outcome) return
    setSaving(true)
    await onSave({
      touch_type: 'manual_call',
      direction:  'outbound',
      status:     outcome,
      outcome,
      zach_notes: null,
    })
    setSaving(false)
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', bottom: '80px', right: '16px',
      width: '320px', zIndex: 9999,
      background: '#1a2535',
      borderRadius: '12px',
      boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(74,158,255,0.08)' }}>
        <div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#4a9eff', letterSpacing: '0.08em' }}>📞 CALL SCRIPT</span>
          <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '8px' }}>{c?.company_name}</span>
        </div>
        <button onClick={onClose} style={{ color: '#64748b', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>✕</button>
      </div>

      {/* Script */}
      <div style={{ padding: '12px 14px', maxHeight: '280px', overflowY: 'auto', fontSize: '11px', lineHeight: 1.6 }}>

        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: '#4a9eff', fontWeight: 700, fontSize: '9px', letterSpacing: '0.1em', marginBottom: '5px' }}>OPENER</div>
          <div style={{ color: '#e2e8f0' }}>
            "Hey {name} — I'm Zach, I built a free homeowner portal for roofing contractors. Your clients see real-time photos during the job and stop calling you mid-install. Can I send you the link?"
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '9px', letterSpacing: '0.1em', marginBottom: '5px' }}>IF INTERESTED</div>
          <div style={{ color: '#cbd5e1' }}>
            "Takes 4 minutes to set up. Completely free forever. Sending you roofingos.dev right now."
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '9px', letterSpacing: '0.1em', marginBottom: '5px' }}>IF OBJECTION</div>
          <div style={{ color: '#cbd5e1' }}>
            "No credit card, no trial — actually free. CompanyCam charges $49/month for the same thing."
          </div>
        </div>

        <div>
          <div style={{ color: '#64748b', fontWeight: 700, fontSize: '9px', letterSpacing: '0.1em', marginBottom: '5px' }}>IF VOICEMAIL</div>
          <div style={{ color: '#94a3b8' }}>
            "Hey {name}, Zach from Roofing OS — built a free tool for roofers, sending you a text now."
          </div>
        </div>
      </div>

      {/* Outcome + save */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: '10px' }}>
          {OUTCOMES.map(o => (
            <label key={o.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '11px', color: outcome === o.key ? '#e2e8f0' : '#64748b', userSelect: 'none' }}>
              <input
                type="radio"
                name={`outcome-${c?.id}`}
                value={o.key}
                checked={outcome === o.key}
                onChange={() => setOutcome(o.key)}
                style={{ accentColor: '#4a9eff', cursor: 'pointer' }}
              />
              {o.label}
            </label>
          ))}
        </div>
        <button
          onClick={save}
          disabled={!outcome || saving}
          style={{
            width: '100%', padding: '8px 0',
            fontSize: '12px', fontWeight: 700,
            background: outcome ? '#4a9eff' : 'rgba(74,158,255,0.15)',
            color: outcome ? '#fff' : '#4a9eff',
            border: 'none', borderRadius: '8px',
            cursor: outcome ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s',
          }}
        >
          {saving ? 'Saving…' : 'Save & close'}
        </button>
      </div>
    </div>
  )
}

// ── LogTouchModal ──────────────────────────────────────────────────────────────

function LogTouchModal({ c, onSave, onClose }) {
  const [touchType, setTouchType] = useState('manual_call')
  const [outcome,   setOutcome]   = useState('no_answer')
  const [notes,     setNotes]     = useState('')
  const [duration,  setDuration]  = useState('')
  const [saving,    setSaving]    = useState(false)

  const TYPES = [
    { key: 'manual_call',  label: 'Called them'    },
    { key: 'manual_text',  label: 'Texted them'    },
    { key: 'manual_email', label: 'Emailed them'   },
    { key: 'inbound_call', label: 'They called me' },
    { key: 'sms',          label: 'They texted me' },
    { key: 'meeting',      label: 'Met in person'  },
  ]

  const OUTCOMES = [
    { key: 'no_answer',      label: 'No answer / voicemail'   },
    { key: 'not_interested', label: 'Talked — not interested' },
    { key: 'interested',     label: 'Talked — interested'     },
    { key: 'signed_up',      label: 'Talked — signed up'      },
    { key: 'left_message',   label: 'Left message'            },
    { key: 'sent_info',      label: 'Sent info'               },
  ]

  const isCall = touchType.includes('call') || touchType === 'meeting'

  async function save() {
    setSaving(true)
    await onSave({
      touch_type:       touchType,
      direction:        touchType.startsWith('inbound') || touchType === 'sms' ? 'inbound' : 'outbound',
      status:           outcome,
      outcome,
      duration_seconds: isCall && duration ? parseInt(duration, 10) : null,
      zach_notes:       notes.trim() || null,
    })
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[#0f0f1a] border border-[#1e1e2e] rounded-xl p-5 max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-bold text-white mb-4">Log a Touch — {c?.company_name}</h3>

        <div className="mb-4">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 block">Touch type</label>
          <div className="flex flex-col gap-1">
            {TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => setTouchType(t.key)}
                className={`text-xs text-left px-3 py-2 rounded-lg transition-colors ${
                  touchType === t.key
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
                }`}
              >
                {TOUCH_ICONS[t.key] || '•'} {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 block">Outcome</label>
          <div className="flex flex-col gap-1">
            {OUTCOMES.map(o => (
              <button
                key={o.key}
                onClick={() => setOutcome(o.key)}
                className={`text-xs text-left px-3 py-2 rounded-lg transition-colors ${
                  outcome === o.key
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {isCall && (
          <div className="mb-4">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 block">Duration (seconds)</label>
            <input
              type="number"
              value={duration}
              onChange={e => setDuration(e.target.value)}
              placeholder="e.g. 180"
              className="w-full bg-[#0a0a0f] border border-[#2e2e3e] rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/40"
            />
          </div>
        )}

        <div className="mb-5">
          <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 block">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What happened?"
            rows={3}
            className="w-full bg-[#0a0a0f] border border-[#2e2e3e] rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 resize-none"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save touch'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

const EMPTY_STATS = { ariaMade: 0, ariaAnswered: 0, emailsSent: 0, emailsOpened: 0 }

export default function Funnel() {
  const [campaigns,       setCampaigns]       = useState([])
  const [todayStats,      setTodayStats]      = useState(EMPTY_STATS)
  const [selected,        setSelected]        = useState(null)
  const [showLog,         setShowLog]         = useState(false)
  const [callingCampaign, setCallingCampaign] = useState(null)
  const [search,          setSearch]          = useState('')
  const [filter,          setFilter]          = useState('all')
  const [sort,            setSort]            = useState('last_touch')
  const [loading,         setLoading]         = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)

    const todayISO = new Date()
    todayISO.setHours(0, 0, 0, 0)
    const todayStr = todayISO.toISOString()

    const [campaignsRes, ariaRes, emailRes] = await Promise.all([
      supabase
        .from('roofing_campaigns')
        .select(`
          id, prospect_id, company_name, contact_name, phone, email,
          source, status, campaign_start, last_touch_at, next_touch_at,
          touch_count, signed_up_at, notes, assigned_to, created_at,
          touches:roofing_touches(
            id, touch_type, direction, status, content_preview,
            duration_seconds, outcome, zach_notes, created_at
          )
        `)
        .order('last_touch_at', { ascending: false, nullsFirst: false })
        .limit(400),

      supabase
        .from('roofing_aria_calls')
        .select('id, outcome, call_type')
        .gte('created_at', todayStr),

      supabase
        .from('email_log')
        .select('id, opened_at')
        .gte('created_at', todayStr),
    ])

    if (!campaignsRes.error) setCampaigns(campaignsRes.data || [])

    const ariaCalls   = ariaRes.data  || []
    const emailsSent  = emailRes.data || []
    setTodayStats({
      ariaMade:     ariaCalls.filter(c => c.call_type === 'outbound').length,
      ariaAnswered: ariaCalls.filter(c => ['answered','interested','appointment_booked'].includes(c.outcome)).length,
      emailsSent:   emailsSent.length,
      emailsOpened: emailsSent.filter(e => e.opened_at).length,
    })

    setLoading(false)
  }

  async function updateStatus(campaignId, newStatus) {
    const patch = {
      status: newStatus,
      ...(newStatus === 'signed_up' && !campaigns.find(c => c.id === campaignId)?.signed_up_at
        ? { signed_up_at: new Date().toISOString() } : {}),
    }
    await supabase.from('roofing_campaigns').update(patch).eq('id', campaignId)
    const update = c => c.id === campaignId ? { ...c, ...patch } : c
    setCampaigns(cs => cs.map(update))
    if (selected?.id === campaignId) setSelected(s => ({ ...s, ...patch }))
  }

  // saveTouch accepts campaignId explicitly so it works from both the timeline and the call modal
  async function saveTouch(campaignId, touchData) {
    const campaign = campaigns.find(c => c.id === campaignId)
    if (!campaign) return

    const now = new Date().toISOString()
    const { data: touch, error } = await supabase
      .from('roofing_touches')
      .insert({ campaign_id: campaignId, ...touchData, created_at: now })
      .select()
      .single()
    if (error || !touch) return

    const newCount  = (campaign.touch_count || 0) + 1
    const newStatus = touchData.outcome === 'signed_up'      ? 'signed_up'
                    : touchData.outcome === 'interested'     ? 'interested'
                    : touchData.outcome === 'not_interested' ? 'not_interested'
                    : campaign.status === 'new'              ? 'contacted'
                    : campaign.status

    const patch = { last_touch_at: now, touch_count: newCount, status: newStatus }
    if (newStatus === 'signed_up' && !campaign.signed_up_at) patch.signed_up_at = now

    await supabase.from('roofing_campaigns').update(patch).eq('id', campaignId)

    const updated = { ...campaign, ...patch, touches: [touch, ...(campaign.touches || [])] }
    setCampaigns(cs => cs.map(c => c.id === campaignId ? updated : c))
    if (selected?.id === campaignId) setSelected(updated)

    // Telegram on hot outcomes
    if (touchData.outcome === 'interested' || touchData.outcome === 'signed_up') {
      supabase.functions.invoke('roofing-whale-alert', {
        body: {
          type:         'manual_call_hot',
          company_name: campaign.company_name,
          contact_name: campaign.contact_name,
          phone:        campaign.phone,
          outcome:      touchData.outcome,
          notes:        touchData.zach_notes || '',
          prospect_id:  campaign.prospect_id,
        }
      }).catch(() => {})
    }
  }

  // ── Filter + sort ────────────────────────────────────────────────────────────

  const filtered = campaigns.filter(c => {
    if (search) {
      const q = search.toLowerCase()
      if (!c.company_name?.toLowerCase().includes(q) &&
          !c.contact_name?.toLowerCase().includes(q) &&
          !c.phone?.includes(q)) return false
    }
    if (filter === 'hot')   return getHeat(c) === 'hot'
    if (filter === 'zach')  return c.assigned_to === 'zach'
    if (filter === 'aria')  return c.source === 'aria'
    if (filter === 'email') return c.source === 'email'
    return true
  }).sort((a, b) => {
    if (sort === 'last_touch')   return new Date(b.last_touch_at || 0) - new Date(a.last_touch_at || 0)
    if (sort === 'most_touches') return (b.touch_count || 0) - (a.touch_count || 0)
    if (sort === 'newest')       return new Date(b.created_at) - new Date(a.created_at)
    if (sort === 'oldest')       return new Date(a.created_at) - new Date(b.created_at)
    return 0
  })

  const grouped = Object.fromEntries(
    COLUMNS.map(col => [col.key, filtered.filter(c => statusToCol(c.status) === col.key)])
  )

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">Loading campaigns…</div>
  )

  return (
    <div className="p-4 min-h-screen" style={{ overflowX: 'hidden', maxWidth: '100vw' }}>
      <DailyDigest campaigns={campaigns} todayStats={todayStats} />

      {/* Search + Filters + Sort */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search company, name, or phone…"
          className="flex-1 bg-[#0f0f1a] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/40"
        />
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
                filter === f.key
                  ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                  : 'text-gray-500 hover:text-gray-300 bg-[#0f0f1a] border-[#1e1e2e]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="bg-[#0f0f1a] border border-[#1e1e2e] rounded-lg px-2.5 py-1.5 text-[11px] text-gray-400 focus:outline-none"
        >
          <option value="last_touch">Last touch</option>
          <option value="most_touches">Most touches</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
        <button
          onClick={load}
          className="text-[11px] text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg bg-[#0f0f1a] border border-[#1e1e2e] hover:border-[#2e2e3e] transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex gap-3 overflow-x-auto pb-6">
        {COLUMNS.map(col => (
          <KanbanColumn
            key={col.key}
            col={col}
            campaigns={grouped[col.key] || []}
            onSelect={setSelected}
            onStatusChange={updateStatus}
            onCallNow={setCallingCampaign}
          />
        ))}
      </div>

      {/* Timeline slide-over */}
      {selected && !showLog && (
        <TimelineView
          c={selected}
          onClose={() => setSelected(null)}
          onLogTouch={() => setShowLog(true)}
          onStatusChange={updateStatus}
          onCallNow={setCallingCampaign}
        />
      )}

      {/* Log touch modal (from timeline) */}
      {showLog && selected && (
        <LogTouchModal
          c={selected}
          onSave={data => saveTouch(selected.id, data)}
          onClose={() => setShowLog(false)}
        />
      )}

      {/* Floating call script card (from Call Now button) */}
      {callingCampaign && (
        <FloatingCallCard
          c={callingCampaign}
          onSave={data => saveTouch(callingCampaign.id, data)}
          onClose={() => setCallingCampaign(null)}
        />
      )}
    </div>
  )
}

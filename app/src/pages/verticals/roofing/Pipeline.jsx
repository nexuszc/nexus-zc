import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

const AUTO_FOUND_SOURCES = ['serper', 'hail_zone']
const CALENDLY_URL = 'https://calendly.com/zachcurtis/30min'

const STAGES = [
  { key: 'new_lead',    label: 'New Lead',  icon: '📋', text: 'text-gray-400',   bg: 'bg-gray-500/10',   border: 'border-gray-500/20'   },
  { key: 'contacted',   label: 'Contacted', icon: '📧', text: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20'   },
  { key: 'engaged',     label: 'Engaged',   icon: '🔥', text: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20'  },
  { key: 'hot',         label: 'Hot',       icon: '🐋', text: 'text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20'   },
  { key: 'demo_booked', label: 'Booked',    icon: '📅', text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  { key: 'signed_up',   label: 'Signed Up', icon: '✅', text: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20'  },
]

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.key, s]))

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'whale',    label: '🐋 Whales' },
  { key: 'hot',      label: '🔥 Hot Opens' },
  { key: 'cold',     label: '🌡️ Going Cold' },
  { key: 'sequence', label: 'In Sequence' },
  { key: 'clicked',  label: 'Clicked' },
  { key: 'booked',   label: 'Booked' },
  { key: 'dead',     label: 'Dead' },
]

const STATUS_COLORS = {
  new:        'text-gray-400 bg-gray-500/10',
  contacted:  'text-blue-400 bg-blue-500/10',
  interested: 'text-indigo-400 bg-indigo-500/10',
  booked:     'text-green-400 bg-green-500/10',
  dead:       'text-red-400 bg-red-500/10',
  converted:  'text-emerald-400 bg-emerald-500/10',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function firstName(name) {
  return (name || '').split(' ')[0] || 'there'
}

function getNextAction(prospect) {
  const stage = prospect.funnel_stage || 'new_lead'
  const daysSince = Math.floor(
    (Date.now() - new Date(prospect.funnel_stage_updated_at || prospect.created_at).getTime()) / 86400000
  )
  if (stage === 'new_lead') {
    if (!prospect.in_sequence) return '⚡ Enroll in sequence'
    if (!prospect.call_attempts) return '📞 First call due'
    return '⏳ Waiting for response'
  }
  if (stage === 'contacted') {
    if (daysSince >= 2) return '📧 Touch 2 due today'
    return `⏳ Touch 2 in ${2 - daysSince}d`
  }
  if (stage === 'engaged') return '📞 Call now — interested'
  if (stage === 'hot') return '🐋 Call personally NOW'
  if (stage === 'demo_booked') return '📅 Demo scheduled'
  return '✅ Complete'
}

function isNextActionUrgent(prospect) {
  const stage = prospect.funnel_stage || 'new_lead'
  return stage === 'hot' || stage === 'engaged'
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1e1e2e] border border-[#2e2e3e] text-white text-sm px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-fade-in">
      <span className="text-green-400">✓</span> {message}
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#12121a] border border-[#1e1e2e] rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e2e]">
          <span className="text-white font-semibold text-sm">{title}</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function CallDialer({ prospect, onClose, onToast }) {
  const [calling, setCalling] = useState(false)
  const callAria = async () => {
    setCalling(true)
    try {
      await fetch(`${SB_URL}/functions/v1/roofing-aria-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({
          prospect_id: prospect.id,
          phone: prospect.phone,
          call_type: 'warm_follow_up',
          owner_name: prospect.owner_name,
          company_name: prospect.company_name,
        }),
      })
      onToast('Aria call queued')
      onClose()
    } catch { /* ignore */ } finally { setCalling(false) }
  }
  const directCall = () => {
    if (prospect.phone) window.location.href = `tel:${prospect.phone.replace(/[^\d+]/g, '')}`
  }
  return (
    <ModalShell title={`Call ${prospect.owner_name || prospect.company_name || 'prospect'}`} onClose={onClose}>
      <p className="text-sm text-gray-400 mb-1">{prospect.company_name}</p>
      <p className="text-lg font-mono text-white mb-5">{prospect.phone || 'No phone on file'}</p>
      <div className="space-y-2">
        <button onClick={callAria} disabled={calling || !prospect.phone}
          className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
          {calling ? 'Queuing…' : '🤖 Aria Call (AI warm follow-up)'}
        </button>
        <button onClick={directCall} disabled={!prospect.phone}
          className="w-full py-3 bg-[#1e1e2e] hover:bg-[#2a2a3a] disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors border border-[#2e2e3e]">
          📞 Direct Call
        </button>
      </div>
    </ModalShell>
  )
}

function TextComposer({ prospect, onClose, onToast }) {
  const fn = firstName(prospect.owner_name)
  const [text, setText] = useState(
    `Hey ${fn} — just wanted to follow up on Roofing OS. Worth 30 seconds to see the homeowner portal? $49/mo, no contract. — Zach`
  )
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { onToast('Copied to clipboard'); onClose() }).catch(() => {})
  }
  return (
    <ModalShell title={`Text ${prospect.owner_name || 'prospect'}`} onClose={onClose}>
      <p className="text-xs text-gray-600 mb-2">{prospect.phone || 'No phone on file'}</p>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-500 resize-none mb-3" />
      <div className="space-y-2">
        <button onClick={copy}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm transition-colors">
          Copy & Close
        </button>
        <button disabled
          className="w-full py-2.5 bg-[#1e1e2e] opacity-40 text-gray-500 font-semibold rounded-xl text-sm cursor-not-allowed border border-[#2e2e3e]">
          Send via Aria (10DLC pending)
        </button>
      </div>
    </ModalShell>
  )
}

function EmailComposer({ prospect, onClose, onToast }) {
  const fn = firstName(prospect.owner_name)
  const [subject, setSubject] = useState('Quick follow up')
  const [body, setBody] = useState(
    `Hey ${fn} —\n\nJust wanted to make sure my last email didn't get buried.\n\nWorth 30 seconds — see the homeowner portal:\nhttps://app.nexuszc.com/roofing/portal/DEMO2026ROOFINGOS\n\nFree forever. No credit card. 4 minutes to set up.\n— Zach @ Roofing OS`
  )
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!prospect.email) return
    setSending(true)
    try {
      const htmlBody = body.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#3b82f6">$1</a>')
      const html = `<div style="font-family:-apple-system,sans-serif;max-width:520px;line-height:1.7;color:#1a1a1a;padding:20px;">${htmlBody}</div>`
      const res = await fetch(`${SB_URL}/functions/v1/roofing-nudge-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ prospect_id: prospect.id, subject, html }),
      })
      if (res.ok) { onToast('Email sent'); onClose() }
      else onToast('Send failed — check email on file')
    } catch { onToast('Send failed') } finally { setSending(false) }
  }
  return (
    <ModalShell title={`Email ${prospect.owner_name || 'prospect'}`} onClose={onClose}>
      <p className="text-xs text-gray-600 mb-3">{prospect.email || 'No email on file'}</p>
      <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject"
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 mb-2" />
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={7}
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:border-indigo-500 resize-none mb-3" />
      <button onClick={send} disabled={sending || !prospect.email}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
        {sending ? 'Sending…' : 'Send Now'}
      </button>
    </ModalShell>
  )
}

function ConfirmModal({ title, message, confirmLabel, confirmClass, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false)
  const go = async () => {
    setLoading(true)
    await onConfirm()
    setLoading(false)
    onClose()
  }
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="text-sm text-gray-400 mb-5">{message}</p>
      <div className="flex gap-2">
        <button onClick={go} disabled={loading}
          className={`flex-1 py-2.5 font-semibold rounded-xl text-sm text-white transition-colors disabled:opacity-40 ${confirmClass}`}>
          {loading ? '…' : confirmLabel}
        </button>
        <button onClick={onClose}
          className="flex-1 py-2.5 font-semibold rounded-xl text-sm text-gray-400 bg-[#1e1e2e] hover:bg-[#2a2a3a] transition-colors">
          Cancel
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Add Lead Modal ───────────────────────────────────────────────────────────

function AddLeadModal({ onClose, onAdded, onToast }) {
  const [form, setForm] = useState({
    company_name: '', owner_name: '', phone: '', email: '', city: '', state: '', notes: ''
  })
  const [enrollSeq, setEnrollSeq] = useState(true)
  const [queueAria, setQueueAria] = useState(true)
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.company_name && !form.phone) return
    setSaving(true)
    try {
      const { data: prospect, error } = await supabase.from('roofing_prospects').insert({
        company_name: form.company_name || null,
        owner_name: form.owner_name || null,
        phone: form.phone || null,
        email: form.email || null,
        city: form.city || null,
        state: form.state || null,
        notes: form.notes || null,
        status: 'researched',
        funnel_stage: 'new_lead',
        funnel_entered_at: new Date().toISOString(),
        funnel_stage_updated_at: new Date().toISOString(),
        added_by: 'manual',
        in_sequence: enrollSeq && !!form.email,
        sequence_started_at: enrollSeq && form.email ? new Date().toISOString() : null,
        sequence_day: 0,
        sequence_branch: 'standard',
        sequence_paused: false,
      }).select('id, company_name, owner_name').single()

      if (error || !prospect) throw error

      if (queueAria && form.phone) {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        tomorrow.setUTCHours(16, 0, 0, 0) // 10am MDT
        await supabase.from('aria_call_queue').insert({
          prospect_id: prospect.id,
          phone: form.phone,
          call_type: 'warm_follow_up',
          fire_at: tomorrow.toISOString(),
          status: 'pending',
          priority_score: 8,
        }).catch(() => {})
      }

      const parts = []
      if (enrollSeq && form.email) parts.push('Email sequence starts today.')
      if (queueAria && form.phone) parts.push('Aria calls tomorrow at 10am.')
      onToast(`Lead added ✓${parts.length ? ' ' + parts.join(' ') : ''}`)
      onAdded()
      onClose()
    } catch (e) {
      onToast('Failed to add lead')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="Add New Lead" onClose={onClose}>
      <div className="space-y-3">
        <input type="text" placeholder="Company name *" value={form.company_name}
          onChange={e => set('company_name', e.target.value)}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        <input type="text" placeholder="Owner name" value={form.owner_name}
          onChange={e => set('owner_name', e.target.value)}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        <input type="tel" placeholder="Phone *" value={form.phone}
          onChange={e => set('phone', e.target.value)}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        <input type="email" placeholder="Email" value={form.email}
          onChange={e => set('email', e.target.value)}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        <div className="grid grid-cols-3 gap-2">
          <input type="text" placeholder="City" value={form.city}
            onChange={e => set('city', e.target.value)}
            className="col-span-2 bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
          <input type="text" placeholder="ST" value={form.state}
            onChange={e => set('state', e.target.value)}
            className="bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
        </div>
        <textarea placeholder="Notes (optional)" value={form.notes}
          onChange={e => set('notes', e.target.value)} rows={2}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none" />

        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={enrollSeq} onChange={e => setEnrollSeq(e.target.checked)}
              className="rounded border-gray-600 bg-[#0a0a0f] text-indigo-500 focus:ring-indigo-500" />
            <span className="text-xs text-gray-400">Add to email sequence immediately</span>
            {!form.email && enrollSeq && <span className="text-[10px] text-amber-500">(needs email)</span>}
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={queueAria} onChange={e => setQueueAria(e.target.checked)}
              className="rounded border-gray-600 bg-[#0a0a0f] text-indigo-500 focus:ring-indigo-500" />
            <span className="text-xs text-gray-400">Queue Aria call for tomorrow 10am</span>
            {!form.phone && queueAria && <span className="text-[10px] text-amber-500">(needs phone)</span>}
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={submit} disabled={saving || (!form.company_name && !form.phone)}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
            {saving ? 'Adding…' : 'Add Lead'}
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-gray-400 font-semibold rounded-xl text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── Funnel Stats Bar ─────────────────────────────────────────────────────────

function FunnelStatsBar({ stageCounts, totalActive, onFilterStage, activeStage }) {
  const contacted = (stageCounts.contacted || 0) + (stageCounts.engaged || 0) + (stageCounts.hot || 0) + (stageCounts.demo_booked || 0) + (stageCounts.signed_up || 0)
  const hot = (stageCounts.hot || 0) + (stageCounts.demo_booked || 0) + (stageCounts.signed_up || 0)
  const signed = stageCounts.signed_up || 0

  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0

  return (
    <div className="mb-5">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-2">
        {STAGES.map(s => {
          const count = stageCounts[s.key] || 0
          const isActive = activeStage === s.key
          return (
            <button
              key={s.key}
              onClick={() => onFilterStage(isActive ? null : s.key)}
              className={`rounded-xl border p-3 text-left transition-all ${
                isActive
                  ? `${s.bg} ${s.border} ring-1 ring-current`
                  : `bg-[#12121a] border-[#1e1e2e] hover:${s.border}`
              }`}
            >
              <div className={`text-xl font-black ${s.text}`}>{count}</div>
              <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-0.5 leading-tight">
                {s.icon} {s.label}
              </div>
            </button>
          )
        })}
      </div>
      {totalActive > 0 && (
        <div className="text-[11px] text-gray-600 px-1">
          New → Contacted: <span className="text-gray-400">{pct(contacted, totalActive)}%</span>
          {' · '}Contacted → Hot: <span className="text-gray-400">{pct(hot, Math.max(contacted, 1))}%</span>
          {' · '}Hot → Closed: <span className="text-gray-400">{pct(signed, Math.max(hot, 1))}%</span>
        </div>
      )}
    </div>
  )
}

// ─── Funnel Card ──────────────────────────────────────────────────────────────

function FunnelCard({ p, log, onModal, onAction, onToast, compact = false }) {
  const [acting, setActing] = useState(null)
  const stage = STAGE_MAP[p.funnel_stage] || STAGE_MAP.new_lead
  const lastLog = log?.find(l => l.prospect_id === p.id && l.last_touched_at)
  const nextAction = getNextAction(p)
  const urgent = isNextActionUrgent(p)

  const act = async (type) => {
    if (['call', 'text', 'email'].includes(type)) { onModal(type, p); return }
    setActing(type)
    await onAction(p, type)
    setActing(null)
  }

  const bookDemo = async () => {
    setActing('book_demo')
    try {
      const fn = firstName(p.owner_name)
      const html = `<div style="font-family:-apple-system,sans-serif;max-width:520px;line-height:1.7;color:#1a1a1a;padding:20px;">
<p>Hey ${fn} —</p>
<p>I'd love to walk you through Roofing OS live — usually takes about 20 minutes.</p>
<p><a href="${CALENDLY_URL}" style="color:#3b82f6;font-weight:600;">Book a time here →</a></p>
<p>Or reply to this email and we'll find something that works.</p>
<p>— Zach @ Roofing OS</p>
</div>`
      await fetch(`${SB_URL}/functions/v1/roofing-nudge-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ prospect_id: p.id, subject: 'Book a quick demo', html }),
      }).catch(() => {})

      const now = new Date().toISOString()
      await supabase.from('roofing_prospects').update({
        demo_booked_at: now,
        funnel_stage: 'demo_booked',
        funnel_stage_updated_at: now,
      }).eq('id', p.id)
      await supabase.from('funnel_stage_history').insert({
        prospect_id: p.id, from_stage: 'hot', to_stage: 'demo_booked', reason: 'manual_book_demo',
      }).catch(() => {})
      onToast('Demo invite sent')
      await onAction(p, 'reload')
    } finally { setActing(null) }
  }

  return (
    <div className={`rounded-xl border p-3 transition-colors ${
      p.funnel_stage === 'hot'
        ? 'bg-[#0e1a1a] border-cyan-500/30'
        : p.funnel_stage === 'engaged'
        ? 'bg-[#1a150a] border-amber-500/20'
        : 'bg-[#12121a] border-[#1e1e2e]'
    }`}>
      {/* Header */}
      <div className="mb-2">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {p.company_name || p.owner_name || '—'}
            </div>
            {p.owner_name && p.company_name && (
              <div className="text-[11px] text-gray-500 truncate">{p.owner_name}</div>
            )}
          </div>
          <button onClick={() => act('dead')} disabled={acting === 'dead'}
            className="text-[11px] text-gray-700 hover:text-red-400 transition-colors shrink-0 disabled:opacity-40">
            {acting === 'dead' ? '…' : '✕'}
          </button>
        </div>
        {(p.city || p.state) && (
          <div className="text-[11px] text-gray-600 mt-0.5">{[p.city, p.state].filter(Boolean).join(', ')}</div>
        )}
      </div>

      {/* Last touch */}
      <div className="text-[10px] text-gray-600 mb-2">
        {p.last_touched_at || p.last_contact_at
          ? `Last touch ${ago(p.last_touched_at || p.last_contact_at)} ago`
          : p.created_at ? `Added ${ago(p.created_at)} ago` : '—'}
      </div>

      {/* Next action */}
      <div className={`text-[11px] font-semibold mb-3 ${urgent ? 'text-red-400' : 'text-gray-500'}`}>
        {nextAction}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        {p.funnel_stage === 'hot' && (
          <button onClick={() => act('call')}
            className="flex-1 min-w-0 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg text-xs transition-colors">
            📞 Call
          </button>
        )}
        {p.funnel_stage !== 'hot' && (
          <button onClick={() => act('call')}
            className="py-1.5 px-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-cyan-400 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e]">
            📞
          </button>
        )}
        <button onClick={() => act('text')}
          className="py-1.5 px-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-blue-400 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e]">
          💬
        </button>
        <button onClick={() => act('email')}
          className="py-1.5 px-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-violet-400 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e]">
          ✉️
        </button>
        {p.funnel_stage === 'new_lead' && (
          <button onClick={() => act('enroll')} disabled={acting === 'enroll' || !p.email}
            className="py-1.5 px-2 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white font-semibold rounded-lg text-xs transition-colors">
            {acting === 'enroll' ? '…' : '+ Seq'}
          </button>
        )}
        {p.funnel_stage === 'hot' && (
          <button onClick={bookDemo} disabled={acting === 'book_demo'}
            className="py-1.5 px-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white font-semibold rounded-lg text-xs transition-colors">
            {acting === 'book_demo' ? '…' : '📅 Book'}
          </button>
        )}
        {['hot', 'engaged'].includes(p.funnel_stage) && (
          <button onClick={() => act('book')} disabled={acting === 'book'}
            className="py-1.5 px-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white font-semibold rounded-lg text-xs transition-colors">
            {acting === 'book' ? '…' : '✓'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Funnel View (kanban + accordion) ────────────────────────────────────────

function FunnelView({ prospects, log, onModal, onAction, onToast }) {
  const [openStages, setOpenStages] = useState(new Set(['hot', 'engaged']))

  const byStage = {}
  for (const s of STAGES) byStage[s.key] = []
  for (const p of prospects) {
    const key = p.funnel_stage || 'new_lead'
    if (byStage[key]) byStage[key].push(p)
  }

  const toggle = (key) => setOpenStages(s => {
    const next = new Set(s)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  return (
    <>
      {/* Desktop kanban */}
      <div className="hidden md:flex gap-3 overflow-x-auto pb-4">
        {STAGES.map(s => {
          const cards = byStage[s.key] || []
          return (
            <div key={s.key} className="shrink-0 w-52 flex flex-col">
              <div className={`flex items-center gap-1.5 mb-2 px-1`}>
                <span className="text-sm">{s.icon}</span>
                <span className={`text-xs font-bold uppercase tracking-wider ${s.text}`}>{s.label}</span>
                <span className={`text-xs font-bold ${s.text} ml-auto`}>{cards.length}</span>
              </div>
              <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
                {cards.map(p => (
                  <FunnelCard key={p.id} p={p} log={log} onModal={onModal} onAction={onAction} onToast={onToast} />
                ))}
                {cards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-[#1e1e2e] p-4 text-center text-xs text-gray-700">
                    Empty
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Mobile accordion — hot/engaged expanded by default */}
      <div className="md:hidden space-y-2">
        {STAGES.slice().reverse().map(s => {
          const cards = byStage[s.key] || []
          const isOpen = openStages.has(s.key)
          return (
            <div key={s.key} className={`rounded-xl border overflow-hidden ${s.border} ${s.bg}`}>
              <button
                onClick={() => toggle(s.key)}
                className="w-full flex items-center gap-2 px-4 py-3"
              >
                <span className="text-base">{s.icon}</span>
                <span className={`text-sm font-bold ${s.text}`}>{s.label}</span>
                <span className={`text-xs font-bold ${s.text} bg-black/20 px-1.5 py-0.5 rounded-full`}>{cards.length}</span>
                <span className="ml-auto text-gray-600 text-sm">{isOpen ? '▴' : '▾'}</span>
              </button>
              {isOpen && cards.length > 0 && (
                <div className="px-3 pb-3 space-y-2">
                  {cards.map(p => (
                    <FunnelCard key={p.id} p={p} log={log} onModal={onModal} onAction={onAction} onToast={onToast} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ─── Whale Card + Whale Queue ─────────────────────────────────────────────────

function WhaleCard({ p, onModal, onAction, onToast }) {
  const [acting, setActing] = useState(null)
  const act = async (type) => {
    if (['call', 'text', 'email'].includes(type)) { onModal(type, p); return }
    setActing(type)
    await onAction(p, type)
    setActing(null)
  }
  return (
    <div className="bg-[#0e1a1a] border border-cyan-500/30 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-base">🐋</span>
            <span className="text-white font-semibold text-sm">{p.owner_name || '—'}</span>
          </div>
          <p className="text-xs text-gray-500">{p.company_name || ''}</p>
          <p className="text-xs text-cyan-400 mt-0.5">Clicked portal · {ago(p.whale_alerted_at)} ago</p>
        </div>
        <span className="text-xs text-gray-600">{p.city || ''}</span>
      </div>
      <div className="whale-actions">
        <button onClick={() => act('call')} className="whale-call-btn py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg text-xs transition-colors">
          📞 Call
        </button>
        <button onClick={() => act('text')} className="py-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-gray-300 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e]">💬 Text</button>
        <button onClick={() => act('email')} className="py-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-gray-300 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e]">✉️ Email</button>
        <button onClick={() => act('book')} disabled={acting === 'book'} className="py-2 bg-green-700 hover:bg-green-600 text-white font-semibold rounded-lg text-xs transition-colors disabled:opacity-40">{acting === 'book' ? '…' : '✓ Booked'}</button>
        <button onClick={() => act('dead')} disabled={acting === 'dead'} className="py-2 bg-[#1e1e2e] hover:bg-red-900/30 text-gray-500 hover:text-red-400 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e] disabled:opacity-40">{acting === 'dead' ? '…' : '✕ Dead'}</button>
      </div>
    </div>
  )
}

function WhaleQueue({ whales, onModal, onAction, onToast }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!whales.length) return null
  return (
    <div className="w-full mb-6 bg-[#080f10] border border-cyan-500/20 rounded-xl overflow-hidden">
      <button onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-cyan-500/5 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-base">🐋</span>
          <span className="text-cyan-300 font-semibold text-sm">Whale Queue</span>
          <span className="bg-cyan-500/20 text-cyan-400 text-xs font-bold px-2 py-0.5 rounded-full">{whales.length}</span>
        </div>
        <span className="text-gray-600 text-sm">{collapsed ? '▾' : '▴'}</span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {whales.map(p => (
            <WhaleCard key={p.id} p={p} onModal={onModal} onAction={onAction} onToast={onToast} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Badge + ProspectRow (list view) ─────────────────────────────────────────

function Badge({ status }) {
  const cls = STATUS_COLORS[status] || 'text-gray-500 bg-gray-800'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>
      {status}
    </span>
  )
}

function ProspectRow({ p, log, onAction, onModal }) {
  const [expanded, setExpanded] = useState(false)
  const [acting, setActing] = useState(null)
  const hotOpens = log?.filter(l => l.prospect_id === p.id && l.open_count >= 2)
  const lastOpen = log?.find(l => l.prospect_id === p.id && l.last_opened_at)
  const isAutoFound = AUTO_FOUND_SOURCES.includes(p.source) && p.created_at > new Date(Date.now() - 86400000).toISOString()
  const isWhale = p.whale_alerted && !p.outcome
  const nextAction = getNextAction(p)
  const urgent = isNextActionUrgent(p)

  const act = async (type) => {
    if (['call', 'text', 'email'].includes(type)) { onModal(type, p); return }
    setActing(type)
    try { await onAction(p, type) } finally { setActing(null) }
  }

  return (
    <>
      <tr onClick={() => setExpanded(e => !e)}
        className={`border-b border-[#1e1e2e] hover:bg-white/[0.02] cursor-pointer transition-colors ${isWhale ? 'bg-cyan-500/[0.04]' : ''}`}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {isWhale && <span className="text-base leading-none">🐋</span>}
            {hotOpens?.length > 0 && <span className="text-base leading-none">🔥</span>}
            {isAutoFound && <span className="text-base leading-none" title="Auto-found">🤖</span>}
            <div>
              <div className="text-sm font-semibold text-white">{p.owner_name || p.company_name || '—'}</div>
              <div className="text-xs text-gray-500">{p.company_name && p.owner_name ? p.company_name : ''}</div>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
          <div className="text-sm text-gray-400 font-mono">{p.phone || '—'}</div>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          {p.funnel_stage ? (
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${STAGE_MAP[p.funnel_stage]?.bg || ''} ${STAGE_MAP[p.funnel_stage]?.text || ''}`}>
              {STAGE_MAP[p.funnel_stage]?.label || p.funnel_stage}
            </span>
          ) : <Badge status={p.status || 'new'} />}
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
          <div className={`text-xs font-medium ${urgent ? 'text-red-400' : 'text-gray-600'}`}>
            {nextAction}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
            <button onClick={() => act('nudge')} disabled={acting === 'nudge'}
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors disabled:opacity-40">
              {acting === 'nudge' ? '…' : 'Nudge'}
            </button>
            <button onClick={() => act('call')} className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded hover:bg-cyan-500/10 transition-colors">Call</button>
            <button onClick={() => act('text')} className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors">Text</button>
            <button onClick={() => act('email')} className="text-[11px] font-semibold text-violet-400 hover:text-violet-300 px-2 py-1 rounded hover:bg-violet-500/10 transition-colors">Email</button>
            <button onClick={() => act('dead')} disabled={acting === 'dead'}
              className="text-[11px] font-semibold text-gray-600 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/5 transition-colors disabled:opacity-40">✕</button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className={`border-b border-[#1e1e2e] ${isWhale ? 'bg-cyan-500/[0.04]' : 'bg-[#0e0e18]'}`}>
          <td colSpan={5} className="px-4 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div><div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Email</div><div className="text-gray-300">{p.email || '—'}</div></div>
              <div><div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">City / State</div><div className="text-gray-300">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</div></div>
              <div><div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Score</div><div className="text-gray-300">{p.lead_score ?? '—'}</div></div>
              <div><div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Touches</div><div className="text-gray-300">{log?.filter(l => l.prospect_id === p.id).length ?? 0}</div></div>
              <div className="col-span-2"><div className="text-gray-600 uppercase tracking-widest text-[10px] mb-1">Notes</div><div className="text-gray-300">{p.notes || '—'}</div></div>
              <div className="col-span-2 flex flex-wrap gap-2 pt-1">
                <button onClick={() => act('call')} className="text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1.5 rounded-lg transition-colors">📞 Call</button>
                <button onClick={() => act('text')} className="text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors">💬 Text</button>
                <button onClick={() => act('email')} className="text-xs font-semibold bg-violet-700 hover:bg-violet-600 text-white px-3 py-1.5 rounded-lg transition-colors">✉️ Email</button>
                <button onClick={() => act('book')} disabled={acting === 'book'} className="text-xs font-semibold bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">{acting === 'book' ? '…' : 'Mark Booked'}</button>
                <button onClick={() => act('enroll')} disabled={acting === 'enroll'} className="text-xs font-semibold bg-indigo-700 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">{acting === 'enroll' ? '…' : 'Enroll Sequence'}</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

export default function Pipeline() {
  const [prospects, setProspects] = useState([])
  const [log, setLog] = useState([])
  const [autoFoundToday, setAutoFoundToday] = useState(0)
  const [filter, setFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list' | 'funnel'
  const [adding, setAdding] = useState(false)
  const [modal, setModal] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg) => setToast(msg), [])
  const closeModal = useCallback(() => setModal(null), [])

  const load = useCallback(async () => {
    const since24h = new Date(Date.now() - 86400000).toISOString()
    const [{ data: pros }, { data: logs }, { count: autoFound }] = await Promise.all([
      supabase.from('roofing_prospects').select('*').order('whale_alerted_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(300),
      supabase.from('roofing_outreach_log').select('prospect_id, touch_number, open_count, last_opened_at, direction').order('last_opened_at', { ascending: false }).limit(500),
      supabase.from('roofing_prospects').select('id', { count: 'exact', head: true }).in('source', AUTO_FOUND_SOURCES).gte('created_at', since24h),
    ])
    setProspects(pros || [])
    setLog(logs || [])
    setAutoFoundToday(autoFound || 0)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const whales = prospects.filter(p => p.whale_alerted && !p.outcome)
  const activeProspects = prospects.filter(p => p.funnel_stage !== 'dead')

  const stageCounts = {}
  for (const p of activeProspects) {
    const s = p.funnel_stage || 'new_lead'
    stageCounts[s] = (stageCounts[s] || 0) + 1
  }

  const filtered = prospects.filter(p => {
    if (search) {
      const q = search.toLowerCase()
      if (!`${p.owner_name} ${p.company_name} ${p.phone} ${p.email}`.toLowerCase().includes(q)) return false
    }
    if (stageFilter) return (p.funnel_stage || 'new_lead') === stageFilter
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

  const openModal = useCallback((type, prospect) => {
    if (type === 'book' || type === 'dead') { setConfirm({ type, prospect }) }
    else { setModal({ type, prospect }) }
  }, [])

  const handleAction = useCallback(async (prospect, type) => {
    if (type === 'nudge') {
      await fetch(`${SB_URL}/functions/v1/roofing-outreach-sequencer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ prospect_id: prospect.id }),
      }).catch(() => {})
      showToast('Nudge sent')
    } else if (type === 'book') {
      const now = new Date().toISOString()
      await supabase.from('roofing_prospects').update({ status: 'booked', funnel_stage: 'demo_booked', funnel_stage_updated_at: now }).eq('id', prospect.id)
      await supabase.from('funnel_stage_history').insert({ prospect_id: prospect.id, from_stage: prospect.funnel_stage || 'hot', to_stage: 'demo_booked', reason: 'manual_mark_booked' }).catch(() => {})
      showToast('Marked as booked')
      await load()
    } else if (type === 'dead') {
      const now = new Date().toISOString()
      await supabase.from('roofing_prospects').update({ status: 'dead', outcome: 'dead', funnel_stage: 'dead', funnel_stage_updated_at: now }).eq('id', prospect.id)
      await supabase.from('funnel_stage_history').insert({ prospect_id: prospect.id, from_stage: prospect.funnel_stage || 'new_lead', to_stage: 'dead', reason: 'manual_mark_dead' }).catch(() => {})
      showToast('Marked as dead')
      await load()
    } else if (type === 'enroll') {
      await fetch(`${SB_URL}/functions/v1/roofing-outreach-sequencer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ prospect_id: prospect.id, enroll: true }),
      }).catch(() => {})
      showToast('Enrolled in sequence')
    } else if (type === 'reload') {
      await load()
    }
  }, [load, showToast])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Pipeline</h1>
          <p className="text-gray-500 text-sm mt-0.5">{activeProspects.length} active · {stageCounts.dead || 0} dead</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-[#12121a] border border-[#1e1e2e] rounded-lg p-0.5">
            <button onClick={() => setView('list')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
              📋 List
            </button>
            <button onClick={() => setView('funnel')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${view === 'funnel' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
              🎯 Funnel
            </button>
          </div>
          <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">Refresh</button>
          <button onClick={() => setAdding(true)}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors">
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

      {/* Funnel stats bar — always visible */}
      {!loading && (
        <FunnelStatsBar
          stageCounts={stageCounts}
          totalActive={activeProspects.length}
          onFilterStage={(s) => { setStageFilter(s); if (s) setView('list') }}
          activeStage={stageFilter}
        />
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="skeleton h-10 w-full rounded-xl" />)}</div>
      ) : view === 'funnel' ? (
        <FunnelView
          prospects={activeProspects}
          log={log}
          onModal={openModal}
          onAction={handleAction}
          onToast={showToast}
        />
      ) : (
        <>
          {/* List view */}
          <WhaleQueue whales={whales} onModal={openModal} onAction={handleAction} onToast={showToast} />

          {stageFilter && (
            <div className="mb-3 flex items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${STAGE_MAP[stageFilter]?.bg} ${STAGE_MAP[stageFilter]?.text}`}>
                {STAGE_MAP[stageFilter]?.icon} {STAGE_MAP[stageFilter]?.label}
              </span>
              <button onClick={() => setStageFilter(null)} className="text-xs text-gray-600 hover:text-gray-400">Clear filter ✕</button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input type="text" placeholder="Search name, company, phone..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="bg-[#12121a] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500 sm:w-64" />
            {!stageFilter && (
              <div className="flex gap-1.5 flex-wrap">
                {FILTERS.map(f => (
                  <button key={f.key} onClick={() => setFilter(f.key)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${filter === f.key ? 'bg-indigo-600 text-white' : 'bg-[#12121a] text-gray-500 hover:text-gray-300 border border-[#1e1e2e]'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-12 text-center"><p className="text-gray-600 text-sm">No prospects match this filter.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1e1e2e]">
                      <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest">Prospect</th>
                      <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden sm:table-cell">Phone</th>
                      <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden md:table-cell">Stage</th>
                      <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden lg:table-cell">Next Action</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => (
                      <ProspectRow key={p.id} p={p} log={log} onAction={handleAction} onModal={openModal} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <JobsSection />
        </>
      )}

      {/* Modals */}
      {adding && <AddLeadModal onClose={() => setAdding(false)} onAdded={load} onToast={showToast} />}
      {modal?.type === 'call' && <CallDialer prospect={modal.prospect} onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'text' && <TextComposer prospect={modal.prospect} onClose={closeModal} onToast={showToast} />}
      {modal?.type === 'email' && <EmailComposer prospect={modal.prospect} onClose={closeModal} onToast={showToast} />}
      {confirm?.type === 'book' && (
        <ConfirmModal title="Mark as Booked" message={`Mark ${confirm.prospect.owner_name || confirm.prospect.company_name || 'this prospect'} as booked?`}
          confirmLabel="Yes, Booked" confirmClass="bg-green-700 hover:bg-green-600"
          onConfirm={() => handleAction(confirm.prospect, 'book')} onClose={() => setConfirm(null)} />
      )}
      {confirm?.type === 'dead' && (
        <ConfirmModal title="Mark as Dead" message={`Remove ${confirm.prospect.owner_name || confirm.prospect.company_name || 'this prospect'} from active pipeline?`}
          confirmLabel="Yes, Dead" confirmClass="bg-red-800 hover:bg-red-700"
          onConfirm={() => handleAction(confirm.prospect, 'dead')} onClose={() => setConfirm(null)} />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

// ─── Jobs Section ─────────────────────────────────────────────────────────────

const JOB_STATUS_COLORS = {
  lead: 'text-gray-400', assessed: 'text-blue-400', contracted: 'text-violet-400',
  materials_ordered: 'text-amber-400', scheduled: 'text-orange-400',
  in_progress: 'text-green-400', complete: 'text-emerald-400',
  invoiced: 'text-pink-400', paid: 'text-gray-500',
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
        supabase.from('portal_activities').select('job_id, title, created_at').in('job_id', ids).order('created_at', { ascending: false }),
        supabase.from('portal_photos').select('job_id').in('job_id', ids),
      ])
      const actMap = {}
      for (const a of acts || []) { if (!actMap[a.job_id]) actMap[a.job_id] = a }
      const photoMap = {}
      for (const p of photos || []) { photoMap[p.job_id] = (photoMap[p.job_id] || 0) + 1 }
      setActivities(actMap)
      setPhotoCounts(photoMap)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="mt-10">
      <div className="mb-4">
        <h2 className="text-base font-bold text-white">Active Jobs</h2>
        <p className="text-gray-600 text-xs mt-0.5">Real-time from call/text intake</p>
      </div>
      <div className="bg-[#12121a] rounded-xl border border-[#1e1e2e] overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="skeleton h-14 w-full rounded-lg" />)}</div>
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
                        <span className="text-gray-500">{lastAct.title}</span>{' · '}{ago(lastAct.created_at)} ago
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-right">
                    {photos > 0 && <span className="text-xs text-gray-600">{photos} photo{photos !== 1 ? 's' : ''}</span>}
                    {j.contract_amount > 0 && <span className="text-sm font-semibold text-amber-400">${j.contract_amount.toLocaleString()}</span>}
                    {j.portal_sent_at && <span className="text-[10px] text-green-600 font-semibold">Portal ✓</span>}
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

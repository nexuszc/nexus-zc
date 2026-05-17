import { useEffect, useState, useCallback, useRef } from 'react'
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

const AUTO_FOUND_SOURCES = ['serper', 'hail_zone']

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
    if (prospect.phone) {
      window.location.href = `tel:${prospect.phone.replace(/[^\d+]/g, '')}`
    } else {
      navigator.clipboard.writeText(prospect.phone || '').catch(() => {})
    }
  }

  return (
    <ModalShell title={`Call ${prospect.owner_name || 'prospect'}`} onClose={onClose}>
      <p className="text-sm text-gray-400 mb-1">{prospect.company_name}</p>
      <p className="text-lg font-mono text-white mb-5">{prospect.phone || 'No phone on file'}</p>
      <div className="space-y-2">
        <button
          onClick={callAria}
          disabled={calling || !prospect.phone}
          className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          {calling ? 'Queuing…' : '🤖 Aria Call (AI warm follow-up)'}
        </button>
        <button
          onClick={directCall}
          disabled={!prospect.phone}
          className="w-full py-3 bg-[#1e1e2e] hover:bg-[#2a2a3a] disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors border border-[#2e2e3e]"
        >
          📞 Direct Call
        </button>
      </div>
    </ModalShell>
  )
}

function TextComposer({ prospect, onClose, onToast }) {
  const firstName = (prospect.owner_name || 'there').split(' ')[0]
  const [text, setText] = useState(
    `Hey ${firstName} — just wanted to follow up on Roofing OS. Worth 30 seconds to see the homeowner portal? $49/mo, no contract. — Zach`
  )

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      onToast('Copied to clipboard')
      onClose()
    }).catch(() => {})
  }

  return (
    <ModalShell title={`Text ${prospect.owner_name || 'prospect'}`} onClose={onClose}>
      <p className="text-xs text-gray-600 mb-2">{prospect.phone || 'No phone on file'}</p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-xl px-3 py-2.5 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none mb-3"
      />
      <div className="space-y-2">
        <button
          onClick={copy}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Copy & Close
        </button>
        <button
          disabled
          className="w-full py-2.5 bg-[#1e1e2e] opacity-40 text-gray-500 font-semibold rounded-xl text-sm cursor-not-allowed border border-[#2e2e3e]"
        >
          Send via Aria (10DLC pending)
        </button>
      </div>
    </ModalShell>
  )
}

function EmailComposer({ prospect, onClose, onToast }) {
  const firstName = (prospect.owner_name || 'there').split(' ')[0]
  const [subject, setSubject] = useState('Quick follow up')
  const [body, setBody] = useState(
    `Hey ${firstName} —\n\nJust wanted to make sure my last email didn't get buried.\n\nWorth 30 seconds — see the homeowner portal that roofing contractors are using to close more jobs:\nhttps://app.nexuszc.com/roofing/portal/DEMO2026ROOFINGOS\n\n$49/month. No contract.\n— Zach @ Roofing OS`
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
      if (res.ok) {
        onToast('Email sent')
        onClose()
      } else {
        onToast('Send failed — check email on file')
      }
    } catch { onToast('Send failed') } finally { setSending(false) }
  }

  return (
    <ModalShell title={`Email ${prospect.owner_name || 'prospect'}`} onClose={onClose}>
      <p className="text-xs text-gray-600 mb-3">{prospect.email || 'No email on file'}</p>
      <input
        type="text"
        value={subject}
        onChange={e => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-xl px-3 py-2 placeholder-gray-600 focus:outline-none focus:border-indigo-500 mb-2"
      />
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={7}
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] text-white text-sm rounded-xl px-3 py-2.5 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none mb-3"
      />
      <button
        onClick={send}
        disabled={sending || !prospect.email}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors"
      >
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
        <button
          onClick={go}
          disabled={loading}
          className={`flex-1 py-2.5 font-semibold rounded-xl text-sm text-white transition-colors disabled:opacity-40 ${confirmClass}`}
        >
          {loading ? '…' : confirmLabel}
        </button>
        <button onClick={onClose} className="flex-1 py-2.5 font-semibold rounded-xl text-sm text-gray-400 bg-[#1e1e2e] hover:bg-[#2a2a3a] transition-colors">
          Cancel
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Whale Card ───────────────────────────────────────────────────────────────

function WhaleCard({ p, onModal, onAction, onToast }) {
  const [acting, setActing] = useState(null)

  const act = async (type) => {
    if (type === 'call' || type === 'text' || type === 'email') {
      onModal(type, p)
      return
    }
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
        <button
          onClick={() => act('call')}
          className="whale-call-btn py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg text-xs transition-colors"
        >
          📞 Call
        </button>
        <button
          onClick={() => act('text')}
          className="py-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-gray-300 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e]"
        >
          💬 Text
        </button>
        <button
          onClick={() => act('email')}
          className="py-2 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-gray-300 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e]"
        >
          ✉️ Email
        </button>
        <button
          onClick={() => act('book')}
          disabled={acting === 'book'}
          className="py-2 bg-green-700 hover:bg-green-600 text-white font-semibold rounded-lg text-xs transition-colors disabled:opacity-40"
        >
          {acting === 'book' ? '…' : '✓ Booked'}
        </button>
        <button
          onClick={() => act('dead')}
          disabled={acting === 'dead'}
          className="py-2 bg-[#1e1e2e] hover:bg-red-900/30 text-gray-500 hover:text-red-400 font-semibold rounded-lg text-xs transition-colors border border-[#2e2e3e] disabled:opacity-40"
        >
          {acting === 'dead' ? '…' : '✕ Dead'}
        </button>
      </div>
    </div>
  )
}

// ─── Whale Queue ──────────────────────────────────────────────────────────────

function WhaleQueue({ whales, onModal, onAction, onToast }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!whales.length) return null

  return (
    <div className="mb-6 bg-[#080f10] border border-cyan-500/20 rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-cyan-500/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🐋</span>
          <span className="text-cyan-300 font-semibold text-sm">Whale Queue</span>
          <span className="bg-cyan-500/20 text-cyan-400 text-xs font-bold px-2 py-0.5 rounded-full">{whales.length}</span>
        </div>
        <span className="text-gray-600 text-sm">{collapsed ? '▾' : '▴'}</span>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {whales.map(p => (
            <WhaleCard key={p.id} p={p} onModal={onModal} onAction={onAction} onToast={onToast} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Badge + ProspectRow ──────────────────────────────────────────────────────

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

  const act = async (type) => {
    if (type === 'call' || type === 'text' || type === 'email') {
      onModal(type, p)
      return
    }
    setActing(type)
    try { await onAction(p, type) } finally { setActing(null) }
  }

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        className={`border-b border-[#1e1e2e] hover:bg-white/[0.02] cursor-pointer transition-colors ${isWhale ? 'bg-cyan-500/[0.04]' : ''}`}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {isWhale && <span className="text-base leading-none">🐋</span>}
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
          <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => act('nudge')}
              disabled={acting === 'nudge'}
              className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-500/10 transition-colors disabled:opacity-40"
            >
              {acting === 'nudge' ? '…' : 'Nudge'}
            </button>
            <button
              onClick={() => act('call')}
              className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded hover:bg-cyan-500/10 transition-colors"
            >
              Call
            </button>
            <button
              onClick={() => act('text')}
              className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors"
            >
              Text
            </button>
            <button
              onClick={() => act('email')}
              className="text-[11px] font-semibold text-violet-400 hover:text-violet-300 px-2 py-1 rounded hover:bg-violet-500/10 transition-colors"
            >
              Email
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
        <tr className={`border-b border-[#1e1e2e] ${isWhale ? 'bg-cyan-500/[0.04]' : 'bg-[#0e0e18]'}`}>
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
              <div className="col-span-2 flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => act('call')}
                  className="text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  📞 Call
                </button>
                <button
                  onClick={() => act('text')}
                  className="text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  💬 Text
                </button>
                <button
                  onClick={() => act('email')}
                  className="text-xs font-semibold bg-violet-700 hover:bg-violet-600 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  ✉️ Email
                </button>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Pipeline() {
  const [prospects, setProspects] = useState([])
  const [log, setLog] = useState([])
  const [autoFoundToday, setAutoFoundToday] = useState(0)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newForm, setNewForm] = useState({ owner_name: '', company_name: '', phone: '', email: '' })
  const [modal, setModal] = useState(null) // { type: 'call'|'text'|'email'|'book'|'dead', prospect }
  const [confirm, setConfirm] = useState(null) // { type: 'book'|'dead', prospect }
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg) => setToast(msg), [])
  const closeModal = useCallback(() => setModal(null), [])

  const load = useCallback(async () => {
    const since24h = new Date(Date.now() - 86400000).toISOString()
    const [{ data: pros }, { data: logs }, { count: autoFound }] = await Promise.all([
      supabase.from('roofing_prospects').select('*').order('whale_alerted_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(200),
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

  const openModal = useCallback((type, prospect) => {
    if (type === 'book' || type === 'dead') {
      setConfirm({ type, prospect })
    } else {
      setModal({ type, prospect })
    }
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
      await supabase.from('roofing_prospects').update({ status: 'booked' }).eq('id', prospect.id)
      showToast('Marked as booked')
      await load()
    } else if (type === 'dead') {
      await supabase.from('roofing_prospects').update({ status: 'dead', outcome: 'dead' }).eq('id', prospect.id)
      showToast('Marked as dead')
      await load()
    } else if (type === 'enroll') {
      await fetch(`${SB_URL}/functions/v1/roofing-outreach-sequencer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ prospect_id: prospect.id, enroll: true }),
      }).catch(() => {})
      showToast('Enrolled in sequence')
    }
  }, [load, showToast])

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

      {/* Whale Queue */}
      <WhaleQueue whales={whales} onModal={openModal} onAction={handleAction} onToast={showToast} />

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
                  <ProspectRow key={p.id} p={p} log={log} onAction={handleAction} onModal={openModal} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <JobsSection />

      {/* Modals */}
      {modal?.type === 'call' && (
        <CallDialer prospect={modal.prospect} onClose={closeModal} onToast={showToast} />
      )}
      {modal?.type === 'text' && (
        <TextComposer prospect={modal.prospect} onClose={closeModal} onToast={showToast} />
      )}
      {modal?.type === 'email' && (
        <EmailComposer prospect={modal.prospect} onClose={closeModal} onToast={showToast} />
      )}
      {confirm?.type === 'book' && (
        <ConfirmModal
          title="Mark as Booked"
          message={`Mark ${confirm.prospect.owner_name || 'this prospect'} as booked?`}
          confirmLabel="Yes, Booked"
          confirmClass="bg-green-700 hover:bg-green-600"
          onConfirm={() => handleAction(confirm.prospect, 'book')}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm?.type === 'dead' && (
        <ConfirmModal
          title="Mark as Dead"
          message={`Remove ${confirm.prospect.owner_name || 'this prospect'} from active pipeline?`}
          confirmLabel="Yes, Dead"
          confirmClass="bg-red-800 hover:bg-red-700"
          onConfirm={() => handleAction(confirm.prospect, 'dead')}
          onClose={() => setConfirm(null)}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

// ─── Jobs Section ─────────────────────────────────────────────────────────────

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

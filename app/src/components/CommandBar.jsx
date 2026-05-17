import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

const QUICK_ACTIONS = [
  { label: 'Pipeline — Whale Queue',   icon: '🐋', path: '/roofing/pipeline' },
  { label: 'Pipeline — All Prospects', icon: '📋', path: '/roofing/pipeline' },
  { label: 'Roofing Content',          icon: '✍️', path: '/roofing/content' },
  { label: 'Calls Queue',              icon: '📞', path: '/roofing/calls' },
  { label: 'Contractors',              icon: '🏠', path: '/roofing/contractors' },
  { label: 'System Health',            icon: '⚙️', path: '/roofing/system' },
  { label: 'Brain',                    icon: '🧠', path: '/brain' },
  { label: 'Home',                     icon: '🏡', path: '/' },
]

export default function CommandBar({ open, onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [prospects, setProspects] = useState([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const searchTimer = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setProspects([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const searchProspects = useCallback(async (q) => {
    if (!q || q.length < 2) { setProspects([]); return }
    setSearching(true)
    const { data } = await supabase
      .from('roofing_prospects')
      .select('id, owner_name, company_name, phone, email, status, whale_alerted')
      .or(`owner_name.ilike.%${q}%,company_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(6)
    setProspects(data || [])
    setSearching(false)
  }, [])

  const handleQuery = (val) => {
    setQuery(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => searchProspects(val), 250)
  }

  const go = (path) => {
    navigate(path)
    onClose()
  }

  const filteredActions = QUICK_ACTIONS.filter(a =>
    !query || a.label.toLowerCase().includes(query.toLowerCase())
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4" onClick={onClose}>
      <div
        className="bg-[#12121a] border border-[#2e2e3e] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1e1e2e]">
          <span className="text-gray-600 text-lg shrink-0">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleQuery(e.target.value)}
            placeholder="Search prospects, navigate…"
            className="flex-1 bg-transparent text-white text-sm placeholder-gray-600 focus:outline-none"
          />
          {searching && <span className="text-gray-600 text-xs">…</span>}
          <kbd className="text-[10px] text-gray-700 bg-[#1e1e2e] border border-[#2e2e3e] px-1.5 py-0.5 rounded">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {/* Prospect results */}
          {prospects.length > 0 && (
            <div className="py-2">
              <div className="px-4 pb-1 text-[10px] text-gray-600 uppercase tracking-widest font-bold">Prospects</div>
              {prospects.map(p => (
                <button
                  key={p.id}
                  onClick={() => go('/roofing/pipeline')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors text-left"
                >
                  <span className="text-base shrink-0">{p.whale_alerted ? '🐋' : '👤'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium truncate">{p.owner_name || '—'}</div>
                    <div className="text-xs text-gray-600 truncate">{p.company_name || p.email || p.phone || ''}</div>
                  </div>
                  <span className="text-[10px] text-gray-600 shrink-0">{p.status || 'new'}</span>
                </button>
              ))}
            </div>
          )}

          {/* Quick actions */}
          {filteredActions.length > 0 && (
            <div className="py-2">
              {prospects.length > 0 && <div className="h-px bg-[#1e1e2e] mx-4 mb-2" />}
              <div className="px-4 pb-1 text-[10px] text-gray-600 uppercase tracking-widest font-bold">Navigate</div>
              {filteredActions.map(a => (
                <button
                  key={a.label}
                  onClick={() => go(a.path)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors text-left"
                >
                  <span className="text-base shrink-0">{a.icon}</span>
                  <span className="text-sm text-gray-300">{a.label}</span>
                </button>
              ))}
            </div>
          )}

          {!searching && query.length >= 2 && prospects.length === 0 && filteredActions.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-600">No results for "{query}"</div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-[#1e1e2e] flex items-center gap-4 text-[10px] text-gray-700">
          <span><kbd className="bg-[#1e1e2e] border border-[#2e2e3e] rounded px-1">↵</kbd> select</span>
          <span><kbd className="bg-[#1e1e2e] border border-[#2e2e3e] rounded px-1">Esc</kbd> close</span>
          <span><kbd className="bg-[#1e1e2e] border border-[#2e2e3e] rounded px-1">⌘K</kbd> anywhere</span>
        </div>
      </div>
    </div>
  )
}

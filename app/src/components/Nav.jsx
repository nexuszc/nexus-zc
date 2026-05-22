import { useState, useEffect, useCallback } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import CommandBar from './CommandBar'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

const Icon = ({ path, cls = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cls}>
    <path d={path} />
  </svg>
)

const ICONS = {
  home:    'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  brain:   'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  calls:   'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  signout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  bolt:    'M13 10V3L4 14h7v7l9-11h-7z',
  more:    'M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z',
  search:  'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
}

function NavItem({ to, icon, label, end = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
          isActive
            ? 'bg-indigo-500/10 text-indigo-400'
            : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
        }`
      }
    >
      <Icon path={ICONS[icon]} cls="w-4 h-4 shrink-0" />
      {label}
    </NavLink>
  )
}

export default function Nav({ session }) {
  const location  = useLocation()
  const navigate  = useNavigate()
  const [moreOpen, setMoreOpen]   = useState(false)
  const [cmdOpen, setCmdOpen]     = useState(false)

  const isRoofing = location.pathname.startsWith('/roofing') &&
    !location.pathname.startsWith('/roofing/login') &&
    !location.pathname.startsWith('/roofing/portal')

  const signOut = () => {
    supabase.auth.signOut()
    navigate('/login')
  }

  const triggerCore = async () => {
    await fetch(`${SB_URL}/functions/v1/nexus-core`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify({ trigger: 'manual' }),
    }).catch(() => {})
  }

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen(o => !o)
      }
      if (e.key === 'Escape') setCmdOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 w-60 bg-[#0c0c14] border-r border-[#1e1e2e] z-30 overflow-y-auto">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-[#1e1e2e]">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-900/50">
            <span className="text-white font-black text-sm">N</span>
          </div>
          <div>
            <div className="text-white font-bold text-sm tracking-tight">Nexus ZC</div>
            <div className="text-indigo-400 text-[10px] uppercase tracking-widest font-semibold">Command Center</div>
          </div>
        </div>

        {/* Search / Command bar trigger */}
        <div className="px-3 pt-3">
          <button
            onClick={() => setCmdOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg text-sm text-gray-600 hover:text-gray-400 hover:border-[#2e2e3e] transition-all"
          >
            <Icon path={ICONS.search} cls="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-left text-xs">Search…</span>
            <kbd className="text-[10px] bg-[#1e1e2e] border border-[#2e2e3e] px-1 rounded">⌘K</kbd>
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {isRoofing ? (
            /* ── Roofing OS mode: 5 tabs ── */
            <>
              <NavLink
                to="/"
                end
                className="flex items-center gap-2 px-3 py-1.5 mb-3 text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
              >
                ← Nexus Home
              </NavLink>
              <div className="text-[10px] text-gray-700 font-bold uppercase tracking-widest px-3 pb-2">Roofing OS</div>
              {[
                { to: '/roofing',            label: 'Dashboard', icon: '🏠', end: true },
                { to: '/roofing/admin/jobs', label: 'Jobs',      icon: '🔨' },
                { to: '/roofing/funnel',     label: 'Funnel',    icon: '🎯' },
                { to: '/roofing/content',  label: 'Content',   icon: '📋' },
                { to: '/roofing/settings', label: 'Settings',  icon: '⚙️' },
              ].map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-indigo-500/10 text-indigo-400'
                        : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
                    }`
                  }
                >
                  <span className="text-base leading-none shrink-0">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </>
          ) : (
            /* ── Default Nexus mode ── */
            <>
              <div className="text-[10px] text-gray-700 font-bold uppercase tracking-widest px-3 pb-2 pt-1">Nexus</div>
              <NavItem to="/" icon="home" label="Home" end />
              <NavItem to="/brain" icon="brain" label="Brain" />

              <div className="pt-4">
                <div className="text-[10px] text-gray-700 font-bold uppercase tracking-widest px-3 pb-2 border-t border-[#1e1e2e] pt-3">Verticals</div>
                <NavLink
                  to="/roofing"
                  className={() =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isRoofing
                        ? 'bg-indigo-500/10 text-indigo-400'
                        : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
                    }`
                  }
                >
                  <span className="text-base leading-none shrink-0">🏠</span>
                  Roofing OS
                </NavLink>
                <div className="mt-1 space-y-0.5 opacity-35 pointer-events-none select-none">
                  <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600">
                    <span className="text-base leading-none">💰</span>
                    <span>Cash Out Refi OS</span>
                    <span className="ml-auto text-[9px] bg-gray-800 text-gray-600 px-1.5 py-0.5 rounded font-medium uppercase">Soon</span>
                  </div>
                  <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600">
                    <span className="text-base leading-none">🌡️</span>
                    <span>HVAC OS</span>
                    <span className="ml-auto text-[9px] bg-gray-800 text-gray-600 px-1.5 py-0.5 rounded font-medium uppercase">Soon</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </nav>

        {/* Bottom */}
        <div className="px-3 pb-4 space-y-0.5 border-t border-[#1e1e2e] pt-3">
          <button
            onClick={triggerCore}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-indigo-400 hover:bg-indigo-500/5 transition-all"
          >
            <Icon path={ICONS.bolt} cls="w-4 h-4 shrink-0" />
            Run Nexus Core
          </button>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-300 hover:bg-white/[0.04] transition-all"
          >
            <Icon path={ICONS.signout} cls="w-4 h-4 shrink-0" />
            Sign out
          </button>
          <div className="px-3 pt-2">
            <p className="text-[10px] text-gray-700 truncate">{session?.user?.email}</p>
          </div>
        </div>
      </aside>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0c0c14] border-t border-[#1e1e2e] flex items-stretch h-16 safe-bottom">
        {isRoofing ? (
          /* Roofing mode — 5 roofing tabs */
          <>
            {[
              { to: '/roofing',            label: 'Dash',     icon: '🏠', end: true  },
              { to: '/roofing/admin/jobs', label: 'Jobs',     icon: '🔨'             },
              { to: '/roofing/funnel',     label: 'Funnel',   icon: '🎯'             },
              { to: '/roofing/content',  label: 'Content',  icon: '📋'             },
              { to: '/roofing/settings', label: 'Settings', icon: '⚙️'             },
            ].map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isActive ? 'text-indigo-400' : 'text-gray-600'}`
                }
              >
                <span className="text-xl leading-none">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </>
        ) : (
          /* Default Nexus mode */
          <>
            <NavLink to="/" end className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isActive ? 'text-indigo-400' : 'text-gray-600'}`
            }>
              <Icon path={ICONS.home} cls="w-5 h-5" />
              Home
            </NavLink>

            <NavLink to="/brain" className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isActive ? 'text-indigo-400' : 'text-gray-600'}`
            }>
              <Icon path={ICONS.brain} cls="w-5 h-5" />
              Brain
            </NavLink>

            <NavLink to="/roofing" className={() =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isRoofing ? 'text-indigo-400' : 'text-gray-600'}`
            }>
              <span className="text-xl leading-none">🏠</span>
              Roofing
            </NavLink>

            <button
              onClick={() => setCmdOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-gray-600"
            >
              <Icon path={ICONS.search} cls="w-5 h-5" />
              Search
            </button>

            <button
              onClick={() => setMoreOpen(o => !o)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${moreOpen ? 'text-indigo-400' : 'text-gray-600'}`}
            >
              <Icon path={ICONS.more} cls="w-5 h-5" />
              More
            </button>
          </>
        )}
      </nav>

      {/* Mobile "More" tray */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute bottom-16 left-0 right-0 bg-[#12121a] border-t border-[#1e1e2e] rounded-t-2xl overflow-hidden">
            <div className="px-4 py-4 space-y-1">
              <button
                onClick={() => { setMoreOpen(false); triggerCore() }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-400 hover:text-indigo-400 hover:bg-indigo-500/5 transition-all w-full"
              >
                <Icon path={ICONS.bolt} cls="w-5 h-5" />
                Run Nexus Core
              </button>
              <NavLink
                to="/roofing/calls"
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-400 hover:text-gray-200 hover:bg-white/[0.04] transition-all"
              >
                <Icon path={ICONS.calls} cls="w-5 h-5" />
                Calls
              </NavLink>
            </div>
            <div className="border-t border-[#1e1e2e] px-4 py-3">
              <button
                onClick={() => { setMoreOpen(false); signOut() }}
                className="flex items-center gap-3 px-3 py-2 text-sm text-gray-500 hover:text-white transition-colors w-full"
              >
                <Icon path={ICONS.signout} cls="w-5 h-5" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Command bar overlay */}
      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </>
  )
}

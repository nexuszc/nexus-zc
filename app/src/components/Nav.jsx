import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

// SVG icon helper
const Icon = ({ path, cls = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cls}>
    <path d={path} />
  </svg>
)

const ICONS = {
  home:    'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  brain:   'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  pipeline:'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2',
  content: 'M15 10l4.553-2.069A1 1 0 0121 8.82v6.362a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  calls:   'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
  contractors: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  system:  'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
  settings:'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  signout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  chevron: 'M19 9l-7 7-7-7',
  more:    'M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z',
  bolt:    'M13 10V3L4 14h7v7l9-11h-7z',
  x:       'M6 18L18 6M6 6l12 12',
}

const ROOFING_SUB = [
  { to: '/roofing/pipeline',     icon: 'pipeline',     label: 'Pipeline' },
  { to: '/roofing/content',      icon: 'content',      label: 'Content' },
  { to: '/roofing/calls',        icon: 'calls',        label: 'Calls' },
  { to: '/roofing/contractors',  icon: 'contractors',  label: 'Contractors' },
  { to: '/roofing/system',       icon: 'system',       label: 'System' },
]

function NavItem({ to, icon, label, end = false, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
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
  const location = useLocation()
  const navigate = useNavigate()
  const [roofingOpen, setRoofingOpen] = useState(
    location.pathname.startsWith('/roofing/')
  )
  const [moreOpen, setMoreOpen] = useState(false)

  const isRoofingActive = location.pathname.startsWith('/roofing/')

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

  return (
    <>
      {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
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

        {/* Main nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <div className="text-[10px] text-gray-700 font-bold uppercase tracking-widest px-3 pb-1">Nexus</div>
          <NavItem to="/" icon="home" label="Home" end />
          <NavItem to="/brain" icon="brain" label="Brain" />

          {/* Roofing OS section */}
          <div className="pt-4 pb-1">
            <div className="text-[10px] text-gray-700 font-bold uppercase tracking-widest px-3 pb-2 border-t border-[#1e1e2e] pt-3">Roofing OS</div>

            {/* Roofing OS */}
            <button
              onClick={() => setRoofingOpen(o => !o)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                isRoofingActive ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
              }`}
            >
              <span className="text-base leading-none">🏠</span>
              <span className="flex-1 text-left">Roofing OS</span>
              <Icon
                path={ICONS.chevron}
                cls={`w-3.5 h-3.5 transition-transform ${roofingOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {roofingOpen && (
              <div className="ml-3 pl-4 border-l border-[#1e1e2e] mt-0.5 space-y-0.5">
                {ROOFING_SUB.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-all ${
                        isActive
                          ? 'text-indigo-400 bg-indigo-500/10'
                          : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
                      }`
                    }
                  >
                    <Icon path={ICONS[item.icon]} cls="w-3.5 h-3.5 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}

            {/* Coming soon verticals */}
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

      {/* ── Mobile bottom nav ──────────────────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0c0c14] border-t border-[#1e1e2e] flex items-stretch h-16 safe-bottom">
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
        <NavLink to="/roofing/pipeline" className={({ isActive }) =>
          `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${
            location.pathname.startsWith('/roofing/') ? 'text-indigo-400' : 'text-gray-600'
          }`
        }>
          <span className="text-xl leading-none">🏠</span>
          Roofing
        </NavLink>
        <NavLink to="/roofing/calls" className={({ isActive }) =>
          `flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${isActive ? 'text-indigo-400' : 'text-gray-600'}`
        }>
          <Icon path={ICONS.calls} cls="w-5 h-5" />
          Calls
        </NavLink>
        <button
          onClick={() => setMoreOpen(o => !o)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors ${moreOpen ? 'text-indigo-400' : 'text-gray-600'}`}
        >
          <Icon path={ICONS.more} cls="w-5 h-5" />
          More
        </button>
      </nav>

      {/* Mobile "More" tray */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="absolute bottom-16 left-0 right-0 bg-[#12121a] border-t border-[#1e1e2e] rounded-t-2xl animate-slide-up overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <div className="text-[10px] text-gray-600 font-bold uppercase tracking-widest mb-2">Roofing OS</div>
              {ROOFING_SUB.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all ${
                      isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-300'
                    }`
                  }
                >
                  <Icon path={ICONS[item.icon]} cls="w-5 h-5 shrink-0" />
                  {item.label}
                </NavLink>
              ))}
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
    </>
  )
}

import { useState, useRef, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

// ── Icons ─────────────────────────────────────────────────────────────────────
const Ico = ({ d, cls = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className={cls}>
    <path fillRule="evenodd" d={d} clipRule="evenodd" />
  </svg>
)
const PATHS = {
  grid:    'M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  users:   'M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z',
  list:    'M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h9a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z',
  doc:     'M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z',
  robot:   'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z',
  roof:    'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z',
  crew:    'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v1h-3zM4.75 12.094A5.973 5.973 0 004 15v1H1v-1a3 3 0 013.75-2.906z',
  menu:    'M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z',
  x:       'M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z',
  signout: 'M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z',
  check:   'M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z',
  bolt:    'M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z',
  plus:    'M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z',
  chevron: 'M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z',
}

const MAIN_NAV = [
  { to: '/',          icon: 'grid',  label: 'Dashboard', end: true },
  { to: '/clients',   icon: 'users', label: 'Clients' },
  { to: '/leads',     icon: 'list',  label: 'Leads' },
  { to: '/documents', icon: 'doc',   label: 'Documents' },
  { to: '/va',        icon: 'robot', label: 'VA' },
]
const ROOFING_NAV = [
  { to: '/roofing',      icon: 'roof', label: 'Dashboard' },
  { to: '/roofing/crew', icon: 'crew', label: 'Crew' },
]

export default function Layout({ session }) {
  const navigate   = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userOpen,   setUserOpen]   = useState(false)
  const [roofOpen,   setRoofOpen]   = useState(false)
  const [agentState, setAgentState] = useState('idle')   // idle | loading | done | error
  const [approveState, setApproveState] = useState('idle')
  const userRef  = useRef(null)
  const roofRef  = useRef(null)

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false)
      if (roofRef.current && !roofRef.current.contains(e.target)) setRoofOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const runAgent = async () => {
    if (agentState === 'loading') return
    setAgentState('loading')
    try {
      await fetch(`${SB_URL}/functions/v1/nexus-core`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SB_KEY}` },
        body: JSON.stringify({ trigger: 'manual' }),
      })
      setAgentState('done')
    } catch { setAgentState('error') }
    setTimeout(() => setAgentState('idle'), 3000)
  }

  const approveAll = async () => {
    if (approveState === 'loading') return
    setApproveState('loading')
    try {
      const { data: abilities } = await supabase.from('nexus_ability_proposals')
        .select('id').in('status', ['proposed', 'pending']).limit(5)
      const { data: actions } = await supabase.from('nexus_action_queue')
        .select('id').eq('status', 'pending').limit(5)
      const ops = []
      if (abilities?.length) ops.push(supabase.from('nexus_ability_proposals').update({ status: 'approved' }).in('id', abilities.map(a => a.id)))
      if (actions?.length)   ops.push(supabase.from('nexus_action_queue').update({ status: 'approved' }).in('id', actions.map(a => a.id)))
      if (ops.length) await Promise.all(ops)
      setApproveState('done')
    } catch { setApproveState('error') }
    setTimeout(() => setApproveState('idle'), 3000)
  }

  const navLinkClass = ({ isActive }) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive
        ? 'bg-violet-600/15 text-violet-300'
        : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
    }`

  const roofLinkClass = ({ isActive }) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive
        ? 'bg-orange-500/15 text-orange-300'
        : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
    }`

  const agentLabel  = agentState === 'loading' ? 'Running…' : agentState === 'done' ? 'Triggered ✓' : agentState === 'error' ? 'Error' : 'Run Agent'
  const approveLabel = approveState === 'loading' ? 'Approving…' : approveState === 'done' ? 'Approved ✓' : approveState === 'error' ? 'Error' : 'Approve All'

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white">

      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <nav className="h-14 bg-[#060608] border-b border-white/[0.06] flex items-center gap-0 px-4 lg:px-6 shrink-0 relative z-40">

        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-2.5 mr-6 shrink-0 group">
          <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-violet-900/50 group-hover:bg-violet-500 transition-colors">
            <span className="text-white font-black text-sm leading-none">N</span>
          </div>
          <div className="hidden sm:block leading-none">
            <div className="text-white font-bold text-sm tracking-tight">Nexus</div>
            <div className="text-violet-400 text-[9px] font-bold tracking-[0.2em] uppercase -mt-0.5">ZC</div>
          </div>
        </NavLink>

        {/* Main nav — desktop */}
        <div className="hidden lg:flex items-center gap-0.5">
          {MAIN_NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <Ico d={PATHS[item.icon]} cls="w-3.5 h-3.5 opacity-70" />
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* Roofing OS dropdown — desktop */}
        <div className="hidden lg:block relative ml-1" ref={roofRef}>
          <button
            onClick={() => setRoofOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-500 hover:text-orange-300 hover:bg-orange-500/5 transition-all ml-1 border-l border-white/[0.04] pl-4"
          >
            <Ico d={PATHS.roof} cls="w-3.5 h-3.5" />
            <span className="text-orange-400/80">Roofing</span>
            <Ico d={PATHS.chevron} cls={`w-3 h-3 transition-transform ${roofOpen ? 'rotate-180' : ''}`} />
          </button>
          {roofOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-44 bg-[#0e0e12] border border-white/10 rounded-xl shadow-xl shadow-black/50 overflow-hidden animate-scale-in">
              {ROOFING_NAV.map(item => (
                <NavLink key={item.to} to={item.to} onClick={() => setRoofOpen(false)}
                  className={({ isActive }) => `flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors ${isActive ? 'text-orange-300 bg-orange-500/10' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                  <Ico d={PATHS[item.icon]} cls="w-3.5 h-3.5" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Quick action buttons — desktop */}
        <div className="hidden lg:flex items-center gap-2 mr-3">
          <button onClick={runAgent}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              agentState === 'done'    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5' :
              agentState === 'loading' ? 'border-violet-500/30 text-violet-400 bg-violet-500/5 cursor-wait' :
              agentState === 'error'   ? 'border-red-500/40 text-red-400' :
              'border-violet-500/20 text-violet-400 hover:border-violet-500/50 hover:bg-violet-500/5'
            }`}>
            <Ico d={PATHS.bolt} cls="w-3 h-3" />
            {agentLabel}
          </button>
          <button onClick={approveAll}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              approveState === 'done'    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5' :
              approveState === 'loading' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5 cursor-wait' :
              'border-emerald-500/20 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/5'
            }`}>
            <Ico d={PATHS.check} cls="w-3 h-3" />
            {approveLabel}
          </button>
        </div>

        {/* User menu — desktop */}
        <div className="hidden lg:block relative" ref={userRef}>
          <button
            onClick={() => setUserOpen(o => !o)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all border border-white/[0.04]"
          >
            <div className="w-5 h-5 rounded-md bg-violet-700 flex items-center justify-center">
              <span className="text-[9px] font-bold text-white">
                {session?.user?.email?.[0]?.toUpperCase() || 'Z'}
              </span>
            </div>
            <span className="hidden xl:block max-w-[120px] truncate">{session?.user?.email}</span>
            <Ico d={PATHS.chevron} cls={`w-3 h-3 transition-transform ${userOpen ? 'rotate-180' : ''}`} />
          </button>
          {userOpen && (
            <div className="absolute top-full right-0 mt-1.5 w-52 bg-[#0e0e12] border border-white/10 rounded-xl shadow-xl shadow-black/50 overflow-hidden animate-scale-in">
              <div className="px-4 py-3 border-b border-white/[0.04]">
                <p className="text-xs text-gray-500 truncate">{session?.user?.email}</p>
                <p className="text-xs text-gray-700 mt-0.5">Nexus ZC · Internal</p>
              </div>
              <button
                onClick={() => { setUserOpen(false); supabase.auth.signOut() }}
                className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-gray-500 hover:text-white hover:bg-white/5 transition-colors"
              >
                <Ico d={PATHS.signout} cls="w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          onClick={() => setMobileOpen(o => !o)}
        >
          <Ico d={mobileOpen ? PATHS.x : PATHS.menu} cls="w-5 h-5" />
        </button>
      </nav>

      {/* ── Mobile drawer ────────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30 pt-14">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative bg-[#0a0a0c] border-b border-white/[0.06] animate-slide-up">
            <div className="px-4 py-4 space-y-1">
              {MAIN_NAV.map(item => (
                <NavLink key={item.to} to={item.to} end={item.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-violet-600/15 text-violet-300' : 'text-gray-400 hover:text-white hover:bg-white/5'}`
                  }>
                  <Ico d={PATHS[item.icon]} cls="w-4 h-4" />
                  {item.label}
                </NavLink>
              ))}
              <div className="pt-2 border-t border-white/[0.04] mt-2">
                <p className="text-[10px] font-bold text-orange-500/60 uppercase tracking-widest px-3 mb-1">Roofing OS</p>
                {ROOFING_NAV.map(item => (
                  <NavLink key={item.to} to={item.to} onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-orange-500/15 text-orange-300' : 'text-gray-400 hover:text-white hover:bg-white/5'}`
                    }>
                    <Ico d={PATHS[item.icon]} cls="w-4 h-4" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
              <div className="pt-2 border-t border-white/[0.04] mt-2 flex gap-2">
                <button onClick={() => { setMobileOpen(false); runAgent() }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-violet-500/30 text-violet-400">
                  <Ico d={PATHS.bolt} cls="w-3.5 h-3.5" /> Run Agent
                </button>
                <button onClick={() => { setMobileOpen(false); approveAll() }}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-emerald-500/30 text-emerald-400">
                  <Ico d={PATHS.check} cls="w-3.5 h-3.5" /> Approve All
                </button>
              </div>
              <div className="pt-2 border-t border-white/[0.04] mt-2">
                <p className="text-xs text-gray-600 px-3 mb-2 truncate">{session?.user?.email}</p>
                <button onClick={() => supabase.auth.signOut()}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-white transition-colors">
                  <Ico d={PATHS.signout} cls="w-4 h-4" /> Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Page content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

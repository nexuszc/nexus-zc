import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const Icon = ({ path, className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
    <path fillRule="evenodd" d={path} clipRule="evenodd" />
  </svg>
)

const ICONS = {
  dashboard: 'M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  clients:   'M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z',
  leads:     'M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h9a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z',
  documents: 'M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z',
  va:        'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z',
  roofing:   'M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z',
  crew:      'M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v1h-3zM4.75 12.094A5.973 5.973 0 004 15v1H1v-1a3 3 0 013.75-2.906z',
  menu:      'M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z',
  close:     'M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z',
  signout:   'M3 3a1 1 0 011 1v12a1 1 0 11-2 0V4a1 1 0 011-1zm7.707 3.293a1 1 0 010 1.414L9.414 9H17a1 1 0 110 2H9.414l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z',
}

const NAV = [
  {
    section: null,
    items: [
      { to: '/',          icon: 'dashboard',  label: 'Dashboard',    end: true },
      { to: '/clients',   icon: 'clients',    label: 'Clients' },
      { to: '/leads',     icon: 'leads',      label: 'Leads' },
      { to: '/documents', icon: 'documents',  label: 'Documents' },
      { to: '/va',        icon: 'va',         label: 'VA Interface' },
    ],
  },
  {
    section: 'Roofing OS',
    accent: true,
    items: [
      { to: '/roofing',       icon: 'roofing', label: 'Dashboard' },
      { to: '/roofing/crew',  icon: 'crew',    label: 'Crew' },
    ],
  },
]

function NavItem({ to, icon, label, end, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group ${
          isActive
            ? 'bg-violet-600/15 text-violet-300 shadow-[inset_2px_0_0_#7c3aed]'
            : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
        }`
      }
    >
      <Icon path={ICONS[icon]} className="w-4 h-4 shrink-0 transition-colors" />
      {label}
    </NavLink>
  )
}

function RoofingNavItem({ to, icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-orange-500/15 text-orange-300 shadow-[inset_2px_0_0_#ea580c]'
            : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60'
        }`
      }
    >
      <Icon path={ICONS[icon]} className="w-4 h-4 shrink-0" />
      {label}
    </NavLink>
  )
}

export default function Layout({ session }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const close = () => setSidebarOpen(false)

  const Sidebar = () => (
    <aside className="w-56 bg-gray-950 border-r border-gray-800/60 flex flex-col h-full">
      {/* Wordmark */}
      <div className="px-4 py-5 flex items-center gap-3 border-b border-gray-800/40">
        <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-violet-900/40">
          <span className="text-white font-black text-sm leading-none">N</span>
        </div>
        <div className="leading-none">
          <div className="text-white font-bold text-sm tracking-tight">Nexus</div>
          <div className="text-violet-400 text-xs font-semibold tracking-widest uppercase mt-0.5">ZC</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-5' : ''}>
            {group.section && (
              <div className="flex items-center gap-2 px-3 mb-2">
                <span className={`text-xs font-bold uppercase tracking-widest ${group.accent ? 'text-orange-500/70' : 'text-gray-600'}`}>
                  {group.section}
                </span>
                <div className={`flex-1 h-px ${group.accent ? 'bg-orange-900/40' : 'bg-gray-800/60'}`} />
              </div>
            )}
            {group.items.map(item =>
              group.accent
                ? <RoofingNavItem key={item.to} {...item} onClick={close} />
                : <NavItem key={item.to} {...item} onClick={close} />
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-800/40">
        <p className="text-xs text-gray-600 truncate mb-2">{session?.user?.email}</p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          <Icon path={ICONS.signout} className="w-3.5 h-3.5" />
          Sign out
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
          <div className="relative z-50 w-56 animate-slide-up">
            <Sidebar />
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-800/60 bg-gray-950 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <Icon path={ICONS.menu} className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-violet-600 rounded flex items-center justify-center">
              <span className="text-white font-black text-xs">N</span>
            </div>
            <span className="font-bold text-sm text-white">Nexus ZC</span>
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="px-4 py-5 lg:px-8 lg:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

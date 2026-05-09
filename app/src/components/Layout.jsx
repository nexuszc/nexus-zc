import { Outlet, NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Layout({ session }) {
  const signOut = () => supabase.auth.signOut()

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col p-4">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-white">NEXUS</h1>
          <p className="text-xs text-gray-500 mt-1">{session?.user?.email}</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {[
            { to: '/', label: '📊 Dashboard' },
            { to: '/clients', label: '🧠 Clients' },
            { to: '/leads', label: '📋 Leads' },
            { to: '/documents', label: '📄 Documents' },
            { to: '/va', label: '🎯 VA Interface' },
            { to: '/roofing', label: '🏠 Roofing OS' },
            { to: '/roofing/crew', label: '👷 Crew' },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={signOut}
          className="text-xs text-gray-500 hover:text-white mt-4 text-left"
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}

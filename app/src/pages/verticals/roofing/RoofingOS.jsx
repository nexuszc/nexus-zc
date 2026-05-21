import { useLocation, useNavigate } from 'react-router-dom'
import RoofingOverview from './RoofingOverview'
import Pipeline        from './Pipeline'
import Content         from './Content'
import Calls           from './Calls'
import Contractors     from './Contractors'
import System          from './System'
import Outbound        from './Outbound'

const TABS = [
  { key: 'overview',    label: 'Overview',     path: '/roofing' },
  { key: 'pipeline',    label: 'Pipeline',     path: '/roofing/pipeline' },
  { key: 'content',     label: 'Content',      path: '/roofing/content' },
  { key: 'outbound',    label: 'Outbound',     path: '/roofing/outbound' },
  { key: 'calls',       label: 'Calls',        path: '/roofing/calls' },
  { key: 'contractors', label: 'Contractors',  path: '/roofing/contractors' },
  { key: 'system',      label: 'System',       path: '/roofing/system' },
]

function activeTab(pathname) {
  if (pathname === '/roofing')                         return 'overview'
  if (pathname.startsWith('/roofing/pipeline'))        return 'pipeline'
  if (pathname.startsWith('/roofing/content'))         return 'content'
  if (pathname.startsWith('/roofing/outbound'))        return 'outbound'
  if (pathname.startsWith('/roofing/calls'))           return 'calls'
  if (pathname.startsWith('/roofing/contractors'))     return 'contractors'
  if (pathname.startsWith('/roofing/system'))          return 'system'
  return 'overview'
}

export default function RoofingOS() {
  const location = useLocation()
  const navigate  = useNavigate()
  const tab       = activeTab(location.pathname)

  return (
    <div className="min-h-screen">
      {/* Vertical header + sub-tab bar */}
      <div className="bg-[#0c0c14] border-b border-[#1e1e2e]">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center gap-2.5 pt-4 pb-3">
            <span className="text-base">🏠</span>
            <h1 className="text-sm font-bold text-white tracking-tight">Roofing OS</h1>
          </div>
          {/* Sub-tabs — scrollable on mobile */}
          <div className="flex gap-0 -mb-px overflow-x-auto scrollbar-none">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => navigate(t.path)}
                className={`px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'overview'    && <RoofingOverview />}
      {tab === 'pipeline'    && <Pipeline />}
      {tab === 'content'     && <Content />}
      {tab === 'outbound'    && <Outbound />}
      {tab === 'calls'       && <Calls />}
      {tab === 'contractors' && <Contractors />}
      {tab === 'system'      && <System />}
    </div>
  )
}

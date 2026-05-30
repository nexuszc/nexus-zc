import { useLocation, useNavigate } from 'react-router-dom'
import RoofingOverview from './RoofingOverview'
import AdminJobs       from './AdminJobs'
import Funnel          from './Funnel'
import Content         from './Content'
import System          from './System'

// ── 6 tabs — each navigates to a standalone page ───────────────────────────

const TABS = [
  { key: 'overview',   label: 'Overview',   path: '/roofing/dashboard'  },
  { key: 'marketing',  label: 'Marketing',  path: '/roofing/marketing'  },
  { key: 'seo',        label: 'SEO',        path: '/roofing/seo'        },
  { key: 'sales',      label: 'Sales',      path: '/roofing/sales'      },
  { key: 'finance',    label: 'Finance',    path: '/roofing/finance'    },
  { key: 'customers',  label: 'Customers',  path: '/roofing/customers'  },
  { key: 'system',     label: 'System',     path: '/roofing/product-status' },
]

function activeTab(pathname) {
  if (pathname.startsWith('/roofing/marketing'))        return 'marketing'
  if (pathname.startsWith('/roofing/seo'))              return 'seo'
  if (pathname.startsWith('/roofing/sales'))            return 'sales'
  if (pathname.startsWith('/roofing/finance'))          return 'finance'
  if (pathname.startsWith('/roofing/customers'))        return 'customers'
  if (pathname.startsWith('/roofing/system')
    || pathname.startsWith('/roofing/admin/settings'))  return 'system'
  return 'overview'
}

export default function RoofingOS() {
  const location = useLocation()
  const navigate = useNavigate()
  const tab      = activeTab(location.pathname)

  return (
    <div className="min-h-screen">
      {/* Header + 5-tab bar */}
      <div className="bg-[#0c0c14] border-b border-[#1e1e2e]">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-center justify-between pt-4 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="text-base">🏠</span>
              <h1 className="text-sm font-bold text-white tracking-tight">Roofing OS</h1>
            </div>
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 tracking-widest">⚡ ADMIN</span>
          </div>
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

      {/* Tab content — standalone tabs navigate away; system renders inline */}
      {tab === 'overview'  && <RoofingOverview />}
      {tab === 'system'    && <System />}
    </div>
  )
}

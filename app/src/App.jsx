import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import VAInterface from './pages/VAInterface'
import Leads from './pages/Leads'
import ClientPortal from './pages/ClientPortal'
import Documents from './pages/Documents'
import RoofingDashboard from './pages/roofing/RoofingDashboard'
import RoofingJobDetail from './pages/roofing/RoofingJobDetail'
import RoofingNewJob from './pages/roofing/RoofingNewJob'
import RoofingPortal from './pages/roofing/RoofingPortal'
import RoofingLogin from './pages/roofing/RoofingLogin'
import RoofingSettings from './pages/roofing/RoofingSettings'
import RoofingCrew from './pages/roofing/RoofingCrew'
import RoofingOnboarding from './pages/roofing/RoofingOnboarding'
import RoofingMeasurements from './pages/roofing/RoofingMeasurements'
import RoofingIntegrations from './pages/roofing/RoofingIntegrations'
import RoofingSchedule from './pages/roofing/RoofingSchedule'
import RoofingEstimate from './pages/roofing/RoofingEstimate'
import RoofingCrewMobile from './pages/roofing/RoofingCrewMobile'
import RoofingCanvass from './pages/roofing/RoofingCanvass'
import RoofingTeam from './pages/roofing/RoofingTeam'
import RoofingOnboardingSetup from './pages/roofing/RoofingOnboardingSetup'
import OutreachDashboard from './pages/OutreachDashboard'
import { ContractorProvider } from './context/ContractorContext'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'

import Home        from './pages/Home'
import Brain        from './pages/Brain'
import RoofingOS    from './pages/verticals/roofing/RoofingOS'
import AEDashboard  from './pages/verticals/roofing/AEDashboard'
import AELogin      from './pages/verticals/roofing/AELogin'
import NexusDashboard  from './pages/NexusDashboard'
import RoofingVertical from './pages/roofing/RoofingVertical'
import RoofingMarketing from './pages/roofing/RoofingMarketing'
import RoofingSalesPage from './pages/roofing/RoofingSales'
import RoofingFinancePage from './pages/roofing/RoofingFinance'
import RoofingCustomersPage from './pages/roofing/RoofingCustomers'

function ContractorRoute({ session }) {
  if (!session) return <Navigate to="/roofing/login" />
  return <Outlet />
}

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_IN' && session && window.location.pathname === '/') {
        supabase
          .from('contractor_accounts')
          .select('id')
          .eq('owner_email', session.user.email)
          .maybeSingle()
          .then(({ data }) => { if (data) window.location.replace('/roofing/jobs') })
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-[#0a0a0f] text-white">
      <div className="text-gray-600 text-sm">Loading…</div>
    </div>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
        {/* Public — token-based, no auth required */}
        <Route path="/portal/:token" element={<ClientPortal />} />
        <Route path="/roofing/portal/:token" element={<RoofingPortal />} />
        <Route path="/roofing/crew/:token" element={<RoofingCrewMobile />} />
        <Route path="/roofing/login" element={<RoofingLogin />} />
        <Route path="/roofing/ae" element={<AEDashboard />} />
        <Route path="/roofing/ae/login" element={<AELogin />} />

        {/* Contractor routes — own auth gate, outside admin Layout */}
        <Route element={<ContractorRoute session={session} />}>
          <Route element={<ContractorProvider />}>
            <Route path="/roofing/jobs" element={<RoofingDashboard />} />
            <Route path="/roofing/jobs/new" element={<RoofingNewJob />} />
            <Route path="/roofing/jobs/:id" element={<RoofingJobDetail />} />
            <Route path="/roofing/crew" element={<RoofingCrew />} />
            <Route path="/roofing/settings" element={<RoofingSettings />} />
            <Route path="/roofing/onboarding" element={<RoofingOnboarding />} />
            <Route path="/roofing/measurements" element={<RoofingMeasurements />} />
            <Route path="/roofing/integrations" element={<RoofingIntegrations />} />
            <Route path="/roofing/schedule" element={<RoofingSchedule />} />
            <Route path="/roofing/estimate/:id" element={<RoofingEstimate />} />
            <Route path="/roofing/canvass" element={<RoofingCanvass />} />
            <Route path="/roofing/onboarding-setup" element={<RoofingOnboardingSetup />} />
          </Route>
        </Route>

        {/* Nexus admin standalone pages — ProtectedRoute, no Layout shell */}
        <Route element={<ProtectedRoute session={session} />}>
          <Route path="/"                  element={<NexusDashboard />} />
          <Route path="/roofing/dashboard" element={<RoofingVertical />} />
          <Route path="/roofing/marketing" element={<RoofingMarketing />} />
          <Route path="/roofing/sales"     element={<RoofingSalesPage />} />
          <Route path="/roofing/finance"   element={<RoofingFinancePage />} />
          <Route path="/roofing/customers" element={<RoofingCustomersPage />} />
        </Route>

        <Route element={<ProtectedRoute session={session} />}>
          <Route element={<Layout session={session} />}>
            {/* Legacy home — kept for breadcrumb links that haven't migrated */}
            <Route path="/home" element={<Home />} />
            <Route path="/brain" element={<Brain />} />

            {/* Roofing OS vertical — all sub-tabs handled inside RoofingOS */}
            {/* Roofing OS — 5 tabs: Dashboard / Jobs / Funnel / Content / Settings */}
            <Route path="/roofing"             element={<RoofingOS />} />
            <Route path="/roofing/admin/jobs"  element={<RoofingOS />} />
            <Route path="/roofing/funnel"      element={<RoofingOS />} />
            <Route path="/roofing/content"     element={<RoofingOS />} />
            <Route path="/roofing/admin/settings" element={<RoofingOS />} />
            <Route path="/roofing/system"      element={<RoofingOS />} />

            {/* Legacy routes kept intact */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/va" element={<VAInterface />} />
            <Route path="/outreach" element={<OutreachDashboard />} />
            <Route path="/roofing/team" element={<RoofingTeam />} />

          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

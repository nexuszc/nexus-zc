import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import RoofingCrew from './pages/roofing/RoofingCrew'
import RoofingOnboarding from './pages/roofing/RoofingOnboarding'
import OutreachDashboard from './pages/OutreachDashboard'
import { ContractorProvider } from './context/ContractorContext'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'

// New dashboard pages
import Home from './pages/Home'
import Brain from './pages/Brain'
import Pipeline from './pages/verticals/roofing/Pipeline'
import Content from './pages/verticals/roofing/Content'
import Calls from './pages/verticals/roofing/Calls'
import Contractors from './pages/verticals/roofing/Contractors'
import System from './pages/verticals/roofing/System'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
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
        <Route path="/roofing/login" element={<RoofingLogin />} />
        <Route element={<ProtectedRoute session={session} />}>
          <Route element={<Layout session={session} />}>
            {/* New command center */}
            <Route path="/" element={<Home />} />
            <Route path="/brain" element={<Brain />} />

            {/* Roofing OS verticals */}
            <Route path="/roofing/pipeline" element={<Pipeline />} />
            <Route path="/roofing/content" element={<Content />} />
            <Route path="/roofing/calls" element={<Calls />} />
            <Route path="/roofing/contractors" element={<Contractors />} />
            <Route path="/roofing/system" element={<System />} />

            {/* Legacy routes kept intact */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/va" element={<VAInterface />} />
            <Route path="/outreach" element={<OutreachDashboard />} />
            <Route element={<ContractorProvider />}>
              <Route path="/roofing" element={<RoofingDashboard />} />
              <Route path="/roofing/jobs/new" element={<RoofingNewJob />} />
              <Route path="/roofing/jobs/:id" element={<RoofingJobDetail />} />
              <Route path="/roofing/crew" element={<RoofingCrew />} />
              <Route path="/roofing/onboarding" element={<RoofingOnboarding />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

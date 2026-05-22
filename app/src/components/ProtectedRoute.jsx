import { Navigate, Outlet } from 'react-router-dom'

const ADMIN_EMAILS = ['zach@nexuszc.com']

export default function ProtectedRoute({ session }) {
  if (!session) return <Navigate to="/login" />
  // Contractor routes have their own ContractorRoute guard — let them through
  if (window.location.pathname.startsWith('/roofing')) return <Outlet />
  if (!ADMIN_EMAILS.includes(session.user?.email?.toLowerCase())) {
    window.location.href = 'https://roofingos.dev'
    return null
  }
  return <Outlet />
}

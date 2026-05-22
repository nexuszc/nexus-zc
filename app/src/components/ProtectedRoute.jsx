import { Navigate, Outlet } from 'react-router-dom'

const ADMIN_EMAILS = ['zach@nexuszc.com']

export default function ProtectedRoute({ session }) {
  if (!session) return <Navigate to="/login" />
  if (!ADMIN_EMAILS.includes(session.user?.email?.toLowerCase())) {
    window.location.href = 'https://roofingos.dev'
    return null
  }
  return <Outlet />
}

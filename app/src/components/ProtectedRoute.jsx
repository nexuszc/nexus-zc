import { Navigate, Outlet } from 'react-router-dom'

export default function ProtectedRoute({ session }) {
  return session ? <Outlet /> : <Navigate to="/login" />
}

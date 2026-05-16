import { Outlet } from 'react-router-dom'
import Nav from './Nav'

export default function Layout({ session }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <Nav session={session} />
      {/* Offset for sidebar on desktop, bottom nav on mobile */}
      <main className="lg:ml-60 pb-16 lg:pb-0 min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}

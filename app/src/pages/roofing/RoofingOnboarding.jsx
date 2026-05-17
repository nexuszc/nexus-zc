// Contractor onboarding is at roofingos.dev — not here.
// app.nexuszc.com is the owner dashboard for Nexus ZC internal use.
export default function RoofingOnboarding() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold text-white mb-3">Contractor Signup</h1>
        <p className="text-gray-400 text-sm mb-6">
          Roofing OS contractor accounts are created at roofingos.dev.
          This dashboard is for internal use only.
        </p>
        <a
          href="https://roofingos.dev"
          className="inline-block bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-6 py-3 font-medium text-sm transition-colors"
        >
          Go to roofingos.dev →
        </a>
      </div>
    </div>
  )
}

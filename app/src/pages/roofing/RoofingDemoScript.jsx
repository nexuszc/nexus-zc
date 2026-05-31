import { useNavigate } from 'react-router-dom'

const STEPS = [
  {
    num: 1, time: '~30 sec', icon: '🌐', title: 'The Landing Page',
    say: "Before I show you anything — just pull up roofingos.dev on your phone. Just the homepage.",
    action: "They go to roofingos.dev",
    outcome: "They see the landing page — professional, fast, no clutter",
    link: { label: 'Open roofingos.dev →', href: 'https://roofingos.dev' },
  },
  {
    num: 2, time: '~60 sec', icon: '📝', title: 'Sign Up Free',
    say: "Hit Start Free. Three fields — company name, your name, email. No credit card. You're in your dashboard in 30 seconds.",
    action: "They fill 3 fields and submit",
    outcome: "Magic link to inbox — one click → live dashboard",
    link: { label: 'Open Signup →', href: 'https://app.roofingos.dev/roofing/signup' },
  },
  {
    num: 3, time: '~60 sec', icon: '🏠', title: 'Create First Job',
    say: "Now create a job — put in any homeowner name and address. Pick Insurance. Hit Create Job. Takes 20 seconds.",
    action: "They fill name + address + type → tap Create",
    outcome: "Job appears instantly in the kanban board",
    link: { label: 'Open New Job →', href: 'https://app.roofingos.dev/roofing/jobs/new' },
  },
  {
    num: 4, time: '~60 sec', icon: '📱', title: 'Send Homeowner Portal',
    say: "Tap the job. Hit Send Portal. Your homeowner gets a text and email with a link — no app download, no login. They just tap and see their job.",
    action: "Open job → tap Send Portal button",
    outcome: "Homeowner gets text + email with their portal link",
    link: null,
  },
  {
    num: 5, time: '~60 sec', icon: '🎉', title: 'What the Homeowner Sees',
    say: "This is exactly what your homeowner sees when they tap that link. Real-time status, photos, insurance updates, documents, direct messaging. All from their phone. No app.",
    action: "Show the demo portal",
    outcome: "They see a professional, branded portal with real data",
    link: { label: 'Open Demo Portal →', href: 'https://roofingos.dev/portal/DEMO2026ROOFINGOS', green: true },
  },
]

const CLOSE = {
  icon: '💰', title: 'The Close',
  say: "It's free. You just used the entire product in 4 minutes. JobNimbus charges $200 a month for less than this. What questions do you have?",
  action: "Let them talk. Don't fill silence.",
  outcome: 'Then ask: "Want me to set up your first real job right now?"',
  link: { label: 'Monday Demo Portal →', href: 'https://roofingos.dev/portal/MONDAYDEMO2026', yellow: true },
}

const LINKS = [
  { label: 'Landing page', href: 'https://roofingos.dev', text: 'roofingos.dev' },
  { label: 'Signup', href: 'https://app.roofingos.dev/roofing/signup', text: 'app.roofingos.dev/roofing/signup' },
  { label: 'Demo portal (Sarah Johnson)', href: 'https://roofingos.dev/portal/DEMO2026ROOFINGOS', text: 'DEMO2026ROOFINGOS' },
  { label: 'Monday demo portal', href: 'https://roofingos.dev/portal/MONDAYDEMO2026', text: 'MONDAYDEMO2026' },
  { label: 'Contractor demo view', href: 'https://roofingos.dev/demo/contractor', text: 'roofingos.dev/demo/contractor' },
]

function StepCard({ step }) {
  const btnColor = step.link?.green ? '#16a34a' : step.link?.yellow ? '#d97706' : '#3b82f6'
  return (
    <div style={{ background: '#111827', borderRadius: 14, padding: 18, marginBottom: 12, borderLeft: '4px solid #3b82f6' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>Step {step.num}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#4b5563' }}>{step.time}</span>
      </div>
      <p style={{ fontSize: 19, fontWeight: 800, color: '#fff', margin: '0 0 10px' }}>{step.icon} {step.title}</p>
      <div style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: 10, padding: '12px 14px', fontSize: 15, color: '#93c5fd', lineHeight: 1.65, marginBottom: 10 }}>
        "{step.say}"
      </div>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 4px' }}><span style={{ color: '#9ca3af', fontWeight: 600 }}>They do:</span> {step.action}</p>
      <p style={{ fontSize: 13, color: '#22c55e', fontWeight: 600, margin: '0 0 10px' }}>✓ {step.outcome}</p>
      {step.link && (
        <a href={step.link.href} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-block', background: btnColor, color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
          {step.link.label}
        </a>
      )}
    </div>
  )
}

export default function RoofingDemoScript() {
  const navigate = useNavigate()
  return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', color: '#fff', fontFamily: "-apple-system,'Inter',system-ui,sans-serif", padding: '20px 16px 48px', maxWidth: 620, margin: '0 auto' }}>

      <button onClick={() => navigate('/roofing/dashboard')} style={{ background: 'none', border: 'none', color: '#4a9eff', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 20, padding: 0 }}>
        ← Roofing OS
      </button>

      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#3b82f6', marginBottom: 4 }}>🎯 Monday Demo Script</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 12 }}>5 steps · 5 minutes · one close</p>

      <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 24, textAlign: 'center' }}>
        <p style={{ color: '#93c5fd', fontSize: 14, fontWeight: 700, margin: 0 }}>Goal: contractor is signed up and has sent a portal before the call ends.</p>
      </div>

      {STEPS.map(s => <StepCard key={s.num} step={s} />)}

      <div style={{ background: '#111827', borderRadius: 14, padding: 18, marginBottom: 12, borderLeft: '4px solid #f59e0b' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 6px' }}>The Close</p>
        <p style={{ fontSize: 19, fontWeight: 800, color: '#fff', margin: '0 0 10px' }}>{CLOSE.icon} {CLOSE.title}</p>
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 10, padding: '12px 14px', fontSize: 15, color: '#fcd34d', lineHeight: 1.65, marginBottom: 10 }}>
          "{CLOSE.say}"
        </div>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 4px' }}><span style={{ color: '#9ca3af', fontWeight: 600 }}>Action:</span> {CLOSE.action}</p>
        <p style={{ fontSize: 13, color: '#22c55e', fontWeight: 600, margin: '0 0 10px' }}>✓ {CLOSE.outcome}</p>
        <a href={CLOSE.link.href} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-block', background: '#d97706', color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
          {CLOSE.link.label}
        </a>
      </div>

      <div style={{ background: '#111827', borderRadius: 14, padding: 18, marginTop: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Quick Links</p>
        {LINKS.map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 13, color: '#9ca3af' }}>{l.label}</span>
            <a href={l.href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#60a5fa', textDecoration: 'none', fontWeight: 600 }}>{l.text}</a>
          </div>
        ))}
      </div>
    </div>
  )
}

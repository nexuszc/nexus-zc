import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const STAGE_ORDER = ['lead','estimate_sent','contract_signed','materials_ordered','scheduled','in_progress','inspection','complete','paid']

function PayButton({ label, amountCents, jobId, paymentType, onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [stripeInstance, setStripeInstance] = useState(null)
  const [stripeElements, setStripeElements] = useState(null)
  const cardRef = useRef(null)

  const startPayment = async () => {
    setLoading(true)
    setError('')
    const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
    if (!pk) { setError('Payment not configured yet.'); setLoading(false); return }

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ action: 'create_payment_intent', job_id: jobId, amount_cents: amountCents, payment_type: paymentType }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false); return }

    const loadStripe = () => new Promise(resolve => {
      if (window.Stripe) return resolve()
      const s = document.createElement('script')
      s.src = 'https://js.stripe.com/v3/'
      s.onload = resolve
      document.head.appendChild(s)
    })
    await loadStripe()

    const stripe = window.Stripe(pk)
    const els = stripe.elements({ clientSecret: data.client_secret, appearance: { theme: 'night' } })
    const cardEl = els.create('payment')
    setStripeInstance(stripe)
    setStripeElements(els)
    setShowForm(true)
    setLoading(false)
    setTimeout(() => { if (cardRef.current) cardEl.mount(cardRef.current) }, 50)
  }

  const confirmPayment = async () => {
    setLoading(true)
    const { error: stripeError } = await stripeInstance.confirmPayment({
      elements: stripeElements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })
    if (stripeError) { setError(stripeError.message); setLoading(false) }
    else onSuccess()
  }

  if (!showForm) {
    return (
      <div>
        {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px' }}>{error}</p>}
        <button onClick={startPayment} disabled={loading}
          style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 24px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '600', width: '100%', fontSize: '15px' }}>
          {loading ? 'Loading...' : label}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div ref={cardRef} style={{ marginBottom: '12px' }} />
      {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px' }}>{error}</p>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => setShowForm(false)}
          style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={confirmPayment} disabled={loading}
          style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '600', flex: 1 }}>
          {loading ? 'Processing...' : 'Pay Now'}
        </button>
      </div>
    </div>
  )
}

export default function RoofingPortal() {
  const { token } = useParams()
  const [job, setJob] = useState(null)
  const [contractor, setContractor] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [photos, setPhotos] = useState([])
  const [messages, setMessages] = useState([])
  const [docs, setDocs] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [activeTab, setActiveTab] = useState('status')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lightboxPhoto, setLightboxPhoto] = useState(null)

  useEffect(() => { loadPortal() }, [token])

  const loadPortal = async () => {
    const portalRes = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/roofing_jobs?portal_token=eq.${token}&select=*`,
      {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      }
    )
    const portalRows = await portalRes.json()
    console.log('Portal fetch status:', portalRes.status, portalRows)
    const jobData = Array.isArray(portalRows) ? portalRows[0] : null

    if (!portalRes.ok || !jobData) {
      console.error('Portal lookup failed:', portalRes.status, portalRows)
      setError('Invalid portal link. Please contact your contractor.')
      setLoading(false)
      return
    }

    setJob(jobData)
    setContractor(jobData.clients)

    const [{ data: t }, { data: p }, { data: m }, { data: d }] = await Promise.all([
      supabase.from('job_timeline').select('*').eq('job_id', jobData.id).order('created_at'),
      supabase.from('job_photos').select('*').eq('job_id', jobData.id).order('created_at'),
      supabase.from('job_messages').select('*').eq('job_id', jobData.id).order('created_at'),
      supabase.from('job_documents').select('doc_type, title, content, signed').eq('job_id', jobData.id),
    ])

    setTimeline(t || [])
    setPhotos(p || [])
    setMessages(m || [])
    setDocs(d || [])
    setLoading(false)
  }

  const sendMessage = async () => {
    if (!newMessage.trim()) return
    const msg = newMessage
    await supabase.from('job_messages').insert({ job_id: job.id, sender: 'homeowner', message: msg })
    setNewMessage('')
    // Notify contractor via SMS/email
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/roofing-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ event: 'homeowner_message', job_id: job.id, data: { message: msg } }),
    })
    loadPortal()
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#6b7280' }}>Loading your portal...</p>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#ef4444' }}>{error}</p>
    </div>
  )

  const brandColor = contractor?.primary_color || '#3b82f6'
  const currentStageIndex = STAGE_ORDER.indexOf(job?.status || 'lead')
  const progressPct = Math.round(((currentStageIndex + 1) / STAGE_ORDER.length) * 100)

  const tabs = [
    { id: 'status', label: '📊 Status' },
    { id: 'photos', label: '📷 Photos' },
    { id: 'documents', label: '📄 Documents' },
    { id: 'messages', label: `💬 Messages${messages.filter(m => !m.read && m.sender === 'contractor').length > 0 ? ' 🔴' : ''}` },
    { id: 'payments', label: '💳 Payments' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: 'white', fontFamily: 'system-ui, sans-serif' }}>
      {/* Lightbox */}
      {lightboxPhoto && (
        <div onClick={() => setLightboxPhoto(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, cursor: 'pointer' }}>
          <img src={lightboxPhoto} alt="photo" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: '8px' }} />
          <span style={{ position: 'absolute', top: '16px', right: '20px', color: '#fff', fontSize: '24px', lineHeight: 1 }}>✕</span>
        </div>
      )}

      {/* Branded header */}
      <div style={{ background: brandColor, padding: '24px 20px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          {contractor?.logo_url && (
            <img src={contractor.logo_url} alt="logo" style={{ height: '40px', marginBottom: '8px', objectFit: 'contain' }} />
          )}
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#fff', margin: 0 }}>{contractor?.name}</h1>
          {contractor?.company_tagline && (
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '13px', marginTop: '4px' }}>{contractor.company_tagline}</p>
          )}
          {contractor?.phone && <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>{contractor.phone}</p>}
        </div>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
        {/* Job summary card */}
        <div style={{ background: '#111', border: '1px solid #1f2937', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '4px' }}>{job.homeowner_name}</h2>
          <p style={{ color: '#9ca3af', fontSize: '14px' }}>{job.property_address}</p>

          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', color: '#9ca3af' }}>Job Progress</span>
              <span style={{ fontSize: '13px', color: brandColor, fontWeight: '600' }}>{progressPct}%</span>
            </div>
            <div style={{ height: '8px', background: '#1f2937', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: brandColor, borderRadius: '4px', transition: 'width 0.5s ease' }} />
            </div>
            <p style={{ fontSize: '13px', color: 'white', marginTop: '8px', fontWeight: '500' }}>
              Current: {job.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', background: '#111', borderRadius: '12px', padding: '4px', marginBottom: '16px', overflowX: 'auto' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                flexShrink: 0, padding: '8px 10px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: '500', transition: 'all 0.2s',
                background: activeTab === t.id ? '#1f2937' : 'transparent',
                color: activeTab === t.id ? 'white' : '#6b7280',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* STATUS TAB */}
        {activeTab === 'status' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {timeline.map((t, i) => (
              <div key={t.id} style={{
                display: 'flex', gap: '12px', padding: '12px 16px', borderRadius: '12px', border: '1px solid',
                background: t.completed ? 'rgba(16,185,129,0.05)' : '#111',
                borderColor: t.completed ? 'rgba(16,185,129,0.2)' : '#1f2937',
              }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0,
                  background: t.completed ? '#10b981' : '#1f2937',
                  color: t.completed ? 'white' : '#6b7280', fontSize: '14px',
                }}>
                  {t.completed ? '✓' : i + 1}
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: '600', color: t.completed ? 'white' : '#6b7280' }}>{t.title}</p>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{t.description}</p>
                  {t.completed_at && <p style={{ fontSize: '11px', color: '#10b981', marginTop: '4px' }}>✓ {new Date(t.completed_at).toLocaleDateString()}</p>}
                </div>
              </div>
            ))}
            {!timeline.length && <p style={{ color: '#6b7280', textAlign: 'center', padding: '32px 0' }}>Timeline loading...</p>}
          </div>
        )}

        {/* PHOTOS TAB — Your Project Photos */}
        {activeTab === 'photos' && (
          <div>
            <p style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>Your Project Photos</p>
            {['before', 'during', 'after'].map(phase => {
              const phasePhotos = photos.filter(p => p.phase === phase)
              if (!phasePhotos.length) return null
              return (
                <div key={phase} style={{ marginBottom: '20px' }}>
                  <p style={{ fontSize: '11px', color: '#6b7280', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>{phase}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {phasePhotos.map(p => (
                      <div key={p.id} onClick={() => setLightboxPhoto(p.photo_url)}
                        style={{ borderRadius: '8px', overflow: 'hidden', background: '#1f2937', aspectRatio: '4/3', cursor: 'pointer' }}>
                        <img src={p.photo_url} alt={p.caption || phase} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {!photos.length && <p style={{ color: '#6b7280', textAlign: 'center', padding: '32px 0' }}>No photos yet. Check back once work begins.</p>}
          </div>
        )}

        {/* DOCUMENTS TAB */}
        {activeTab === 'documents' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {docs.map((d, i) => (
              <div key={i} style={{ background: '#111', border: '1px solid #1f2937', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <p style={{ fontWeight: '600', fontSize: '14px' }}>{d.title}</p>
                  {d.signed && <span style={{ fontSize: '11px', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: '12px' }}>Signed</span>}
                </div>
                <p style={{ fontSize: '12px', color: '#6b7280' }}>{d.doc_type.replace(/_/g, ' ')}</p>
              </div>
            ))}
            {!docs.length && <p style={{ color: '#6b7280', textAlign: 'center', padding: '32px 0' }}>No documents yet.</p>}
          </div>
        )}

        {/* MESSAGES TAB */}
        {activeTab === 'messages' && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px', maxHeight: '300px', overflowY: 'auto' }}>
              {messages.map(m => (
                <div key={m.id} style={{
                  padding: '10px 14px', borderRadius: '12px', fontSize: '14px',
                  background: m.sender === 'contractor' ? '#1f3a5f' : '#1f2937',
                  marginLeft: m.sender === 'contractor' ? '0' : '32px',
                  marginRight: m.sender === 'homeowner' ? '0' : '32px',
                }}>
                  <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>{m.sender === 'contractor' ? contractor?.name : 'You'}</p>
                  <p>{m.message}</p>
                </div>
              ))}
              {!messages.length && <p style={{ color: '#6b7280', textAlign: 'center', padding: '16px 0' }}>No messages yet</p>}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={newMessage} onChange={e => setNewMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage()}
                placeholder="Message your contractor..."
                style={{ flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: '8px', padding: '10px 14px', color: 'white', fontSize: '14px', outline: 'none' }} />
              <button onClick={sendMessage}
                style={{ background: brandColor, border: 'none', borderRadius: '8px', padding: '10px 16px', color: 'white', cursor: 'pointer', fontWeight: '600' }}>
                Send
              </button>
            </div>
          </div>
        )}

        {/* PAYMENTS TAB */}
        {activeTab === 'payments' && (
          <div style={{ background: '#111', border: '1px solid #1f2937', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Payments</h3>
            {job.contract_amount ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#9ca3af', marginBottom: '8px' }}>
                  <span>Contract total</span>
                  <span style={{ color: 'white' }}>${job.contract_amount?.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#9ca3af', marginBottom: '20px' }}>
                  <span>Amount paid</span>
                  <span style={{ color: '#10b981' }}>${(job.amount_paid || 0)?.toLocaleString()}</span>
                </div>

                {job.final_payment_paid ? (
                  <p style={{ color: '#10b981', textAlign: 'center', fontWeight: '600', padding: '12px' }}>✓ Paid in full</p>
                ) : (
                  <div>
                    {!job.deposit_paid && job.deposit_amount && (
                      <PayButton
                        label={`Pay Deposit — $${job.deposit_amount?.toLocaleString()}`}
                        amountCents={Math.round(job.deposit_amount * 100)}
                        jobId={job.id}
                        paymentType="deposit"
                        onSuccess={loadPortal}
                      />
                    )}
                    {job.deposit_paid && job.contract_amount > (job.amount_paid || 0) && (
                      <PayButton
                        label={`Pay Remaining Balance — $${(job.contract_amount - (job.amount_paid || 0))?.toLocaleString()}`}
                        amountCents={Math.round((job.contract_amount - (job.amount_paid || 0)) * 100)}
                        jobId={job.id}
                        paymentType="final"
                        onSuccess={loadPortal}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p style={{ color: '#6b7280', textAlign: 'center', padding: '16px 0' }}>Payment details will appear here once your contract is finalized.</p>
            )}
          </div>
        )}

        <p style={{ textAlign: 'center', color: '#374151', fontSize: '11px', marginTop: '32px' }}>
          Powered by Roofing OS
        </p>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const C = {
  bg: '#0f1923', surface: '#1a2535', surface2: '#243044',
  text: '#ffffff', muted: '#8896a8',
  border: 'rgba(255,255,255,0.08)',
  primary: '#4a9eff', success: '#22c55e',
  warning: '#f59e0b', danger: '#ef4444',
}
const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const COMMON_ITEMS = [
  { description: 'Remove & dispose old roofing', qty: 1, unit: 'job', price: 0 },
  { description: 'Install felt underlayment', qty: 1, unit: 'job', price: 0 },
  { description: 'Install shingles', qty: 1, unit: 'sq', price: 0 },
  { description: 'Ridge cap shingles', qty: 1, unit: 'LF', price: 0 },
  { description: 'Drip edge', qty: 1, unit: 'LF', price: 0 },
  { description: 'Flashing', qty: 1, unit: 'job', price: 0 },
  { description: 'Dump fee', qty: 1, unit: 'flat', price: 0 },
  { description: 'Permit fee', qty: 1, unit: 'flat', price: 0 },
]

function newItem(description = '') {
  return { id: Date.now() + Math.random(), description, qty: 1, unit: 'job', price: 0 }
}

export default function RoofingEstimate() {
  const { id: jobId } = useParams()
  const navigate = useNavigate()
  const { contractor } = useContractor()
  const sigCanvas = useRef(null)
  const [drawing, setDrawing] = useState(false)
  const lastPos = useRef(null)

  const [job, setJob] = useState(null)
  const [estimate, setEstimate] = useState(null)
  const [lineItems, setLineItems] = useState([newItem()])
  const [taxRate, setTaxRate] = useState(0)
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('draft')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [showSigPad, setShowSigPad] = useState(false)
  const [sigName, setSigName] = useState('')
  const [savingSig, setSavingSig] = useState(false)

  useEffect(() => {
    const load = async () => {
      const [{ data: j }, { data: est }] = await Promise.all([
        supabase.from('roofing_jobs').select('*').eq('id', jobId).single(),
        supabase.from('job_estimates').select('*').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      setJob(j)
      if (est) {
        setEstimate(est)
        setLineItems(est.line_items?.length ? est.line_items : [newItem()])
        setTaxRate(est.tax_rate || 0)
        setNotes(est.notes || '')
        setStatus(est.status || 'draft')
      }
      setLoading(false)
    }
    load()
  }, [jobId])

  const subtotal = lineItems.reduce((s, item) => s + (parseFloat(item.qty) || 0) * (parseFloat(item.price) || 0), 0)
  const taxAmount = subtotal * (parseFloat(taxRate) || 0) / 100
  const total = subtotal + taxAmount

  const addItem = (preset = null) => {
    if (preset) {
      setLineItems(prev => [...prev, { ...newItem(preset.description), qty: preset.qty, unit: preset.unit, price: preset.price }])
    } else {
      setLineItems(prev => [...prev, newItem()])
    }
  }

  const updateItem = (id, field, value) => {
    setLineItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item))
  }

  const removeItem = (id) => {
    setLineItems(prev => prev.filter(item => item.id !== id))
  }

  const saveEstimate = async (newStatus = null) => {
    setSaving(true)
    const payload = {
      job_id: jobId,
      contractor_id: contractor?.id,
      line_items: lineItems,
      subtotal_cents: Math.round(subtotal * 100),
      tax_rate: parseFloat(taxRate) || 0,
      total_cents: Math.round(total * 100),
      notes,
      status: newStatus || status,
    }
    if (estimate?.id) {
      await supabase.from('job_estimates').update(payload).eq('id', estimate.id)
    } else {
      const { data: created } = await supabase.from('job_estimates').insert(payload).select('id').single()
      if (created) setEstimate({ id: created.id, ...payload })
    }
    if (newStatus) setStatus(newStatus)
    setSaving(false)
  }

  const sendEstimate = async () => {
    await saveEstimate('sent')
    setSending(true)
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ event: 'document_ready', job_id: jobId, data: { doc_type: 'estimate' } }),
    }).catch(() => {})
    await supabase.from('job_estimates').update({ sent_at: new Date().toISOString() }).eq('id', estimate?.id).catch(() => {})
    setSending(false)
  }

  // Signature pad
  const startDraw = (e) => {
    setDrawing(true)
    const canvas = sigCanvas.current
    const rect = canvas.getBoundingClientRect()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
    lastPos.current = { x, y }
  }

  const draw = (e) => {
    if (!drawing || !sigCanvas.current) return
    e.preventDefault()
    const canvas = sigCanvas.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
    ctx.beginPath()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(x, y)
    ctx.stroke()
    lastPos.current = { x, y }
  }

  const stopDraw = () => setDrawing(false)

  const clearSig = () => {
    const canvas = sigCanvas.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  const submitSignature = async () => {
    setSavingSig(true)
    const canvas = sigCanvas.current
    const sigData = canvas.toDataURL('image/png')
    const now = new Date().toISOString()
    const payload = { signed_at: now, signed_by: sigName || job?.homeowner_name, signature_data: sigData, status: 'signed' }
    if (estimate?.id) {
      await supabase.from('job_estimates').update(payload).eq('id', estimate.id)
    } else {
      const saved = await saveEstimate('signed')
    }
    // Also update job status
    await supabase.from('roofing_jobs').update({ status: 'contract_signed' }).eq('id', jobId)
    // Send confirmation
    await fetch(`${SUPABASE_URL}/functions/v1/roofing-notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ event: 'document_ready', job_id: jobId, data: { doc_type: 'signed estimate' } }),
    }).catch(() => {})
    setSavingSig(false)
    setShowSigPad(false)
    setStatus('signed')
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: C.muted }}>Loading…</p>
      </div>
    )
  }

  const estimateNumber = estimate?.id?.slice(-6).toUpperCase() || 'NEW'

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '100px' }}>
      {/* Signature pad modal */}
      {showSigPad && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: C.surface, borderRadius: '20px', padding: '24px', width: '100%', maxWidth: '480px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: '700', color: C.text, textAlign: 'center' }}>Sign to Approve Estimate</p>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: C.muted, textAlign: 'center' }}>Sign below to approve ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder={job?.homeowner_name || 'Your full name'}
              style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 12px', fontSize: '13px', color: C.text, outline: 'none', marginBottom: '12px' }} />
            <canvas
              ref={sigCanvas} width={440} height={180}
              style={{ width: '100%', height: '150px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: '10px', cursor: 'crosshair', touchAction: 'none' }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
            />
            <p style={{ margin: '6px 0 12px', fontSize: '11px', color: C.muted, textAlign: 'center' }}>Draw your signature above</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={clearSig} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px', fontSize: '14px', color: C.text, cursor: 'pointer', fontWeight: '600' }}>Clear</button>
              <button onClick={submitSignature} disabled={savingSig}
                style={{ flex: 2, background: savingSig ? 'rgba(34,197,94,0.3)' : C.success, color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                {savingSig ? 'Saving…' : '✓ Submit Signature'}
              </button>
            </div>
            <button onClick={() => setShowSigPad(false)} style={{ marginTop: '10px', width: '100%', background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: '14px' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: 'rgba(15,25,35,0.85)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.border}`, padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
        <button onClick={() => navigate(`/roofing/jobs/${jobId}`)} style={{ fontSize: '12px', color: C.muted, background: 'none', border: 'none', cursor: 'pointer', display: 'block', marginBottom: '6px' }}>← Back to Job</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: C.text }}>💰 Estimate</h1>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: C.muted }}>{job?.homeowner_name} — #{estimateNumber}</p>
          </div>
          <span style={{ fontSize: '12px', fontWeight: '700', padding: '4px 10px', borderRadius: '20px', background: status === 'signed' ? 'rgba(34,197,94,0.15)' : status === 'sent' ? 'rgba(74,158,255,0.15)' : 'rgba(255,255,255,0.06)', color: status === 'signed' ? C.success : status === 'sent' ? C.primary : C.muted }}>
            {status === 'signed' ? '✓ Signed' : status === 'sent' ? '📨 Sent' : 'Draft'}
          </span>
        </div>
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Header info */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {[
              { label: 'Contractor', value: contractor?.company_name || 'Your Company' },
              { label: 'Date', value: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
              { label: 'Homeowner', value: job?.homeowner_name },
              { label: 'Address', value: job?.property_address },
            ].map(f => (
              <div key={f.label} style={{ background: C.surface2, borderRadius: '8px', padding: '10px 12px' }}>
                <p style={{ margin: '0 0 2px', fontSize: '11px', color: C.muted }}>{f.label}</p>
                <p style={{ margin: 0, fontSize: '13px', color: C.text, fontWeight: '500' }}>{f.value || '—'}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Line items */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Line Items</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 52px 52px 70px 28px', gap: '6px' }}>
              {['Description','Qty','Unit','Price',''].map(h => (
                <p key={h} style={{ margin: 0, fontSize: '10px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</p>
              ))}
            </div>

            {lineItems.map(item => (
              <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr 52px 52px 70px 28px', gap: '6px', alignItems: 'center' }}>
                <input value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)}
                  placeholder="Description"
                  style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '7px 9px', fontSize: '13px', color: C.text, outline: 'none' }} />
                <input type="number" value={item.qty} onChange={e => updateItem(item.id, 'qty', e.target.value)} min="0"
                  style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '7px 6px', fontSize: '13px', color: C.text, outline: 'none', textAlign: 'center' }} />
                <input value={item.unit} onChange={e => updateItem(item.id, 'unit', e.target.value)}
                  style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '7px 6px', fontSize: '13px', color: C.text, outline: 'none', textAlign: 'center' }} />
                <input type="number" value={item.price} onChange={e => updateItem(item.id, 'price', e.target.value)} min="0" placeholder="0"
                  style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '7px 8px', fontSize: '13px', color: C.text, outline: 'none', textAlign: 'right' }} />
                <button onClick={() => removeItem(item.id)}
                  style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px' }}>×</button>
              </div>
            ))}
          </div>

          {/* Add item buttons */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={() => addItem()}
              style={{ background: 'rgba(74,158,255,0.12)', border: `1px solid rgba(74,158,255,0.25)`, borderRadius: '8px', padding: '6px 12px', fontSize: '12px', fontWeight: '600', color: C.primary, cursor: 'pointer' }}>
              + Custom
            </button>
            {COMMON_ITEMS.slice(0, 4).map(item => (
              <button key={item.description} onClick={() => addItem(item)}
                style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '5px 10px', fontSize: '11px', color: C.muted, cursor: 'pointer' }}>
                + {item.description.split(' ').slice(0,2).join(' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '14px', color: C.muted }}>Subtotal</span>
              <span style={{ fontSize: '14px', fontWeight: '600', color: C.text }}>${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '14px', color: C.muted }}>Tax</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} min="0" max="20" placeholder="0"
                  style={{ width: '52px', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '6px', padding: '5px 8px', fontSize: '13px', color: C.text, outline: 'none', textAlign: 'right' }} />
                <span style={{ fontSize: '13px', color: C.muted }}>%</span>
                <span style={{ fontSize: '14px', fontWeight: '500', color: C.text }}>${taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '16px', fontWeight: '700', color: C.text }}>Total</span>
              <span style={{ fontSize: '20px', fontWeight: '800', color: C.success }}>${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '16px' }}>
          <p style={{ margin: '0 0 8px', fontSize: '12px', color: C.muted, fontWeight: '500' }}>Notes</p>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Scope of work, warranty terms, payment schedule…"
            style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: C.text, resize: 'vertical', outline: 'none', lineHeight: 1.5 }} />
        </div>

        {/* Signed confirmation */}
        {status === 'signed' && (
          <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '14px', padding: '14px 16px' }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: C.success }}>✅ Signed and approved</p>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={() => saveEstimate()}  disabled={saving}
            style={{ background: saving ? 'rgba(74,158,255,0.3)' : 'rgba(74,158,255,0.12)', border: `1px solid rgba(74,158,255,0.3)`, color: C.primary, borderRadius: '10px', padding: '11px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
            {saving ? 'Saving…' : '💾 Save Draft'}
          </button>
          <button onClick={sendEstimate} disabled={sending}
            style={{ background: sending ? 'rgba(74,158,255,0.3)' : C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '11px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
            {sending ? 'Sending…' : '📨 Send to Homeowner'}
          </button>
          {status !== 'signed' && (
            <button onClick={() => setShowSigPad(true)}
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: C.success, borderRadius: '10px', padding: '11px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
              ✍️ Get Signature
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState, useRef } from 'react'
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

const SHOTS = [
  { id: 'front',        label: 'Front of House',      icon: '🏠', instruction: 'Stand at the street. Face the house directly. Fit the entire front in frame.', tip: 'Include the full roofline' },
  { id: 'front_left',   label: 'Front-Left Corner',   icon: '↖️', instruction: 'Move to the left corner. Show both the front and left side of the house.', tip: 'Show the corner of the roof' },
  { id: 'left',         label: 'Left Side',            icon: '◀️', instruction: 'Stand facing the full left side of the house.', tip: 'Fit the full side in frame' },
  { id: 'back_left',    label: 'Back-Left Corner',     icon: '↙️', instruction: 'Move to the back-left corner. Show both the left and back sides.', tip: 'Show the corner clearly' },
  { id: 'back',         label: 'Back of House',        icon: '🔄', instruction: 'Face the full back of the house.', tip: 'Include the full roofline' },
  { id: 'back_right',   label: 'Back-Right Corner',    icon: '↘️', instruction: 'Move to the back-right corner.', tip: 'Show both sides of the corner' },
  { id: 'right',        label: 'Right Side',           icon: '▶️', instruction: 'Face the full right side of the house.', tip: 'Fit the full side in frame' },
  { id: 'front_right',  label: 'Front-Right Corner',   icon: '↗️', instruction: 'Move to the front-right corner.', tip: 'Show corner of roof clearly' },
  { id: 'roof_overview', label: 'Roof from Street',    icon: '🔭', instruction: 'Step back to show as much of the roof as possible from ground level.', tip: 'Show the roofline and pitch' },
  { id: 'damage_primary', label: 'Primary Damage Area', icon: '⚠️', instruction: 'Capture the main area of storm damage or visible wear.', tip: 'Get close enough to show detail' },
]

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function RoofingInspection() {
  const { id: jobId }          = useParams()
  const navigate               = useNavigate()
  const { contractor }         = useContractor()
  const fileInputRef           = useRef(null)

  const [step, setStep]        = useState(0)   // 0=start, 1-10=shot, 11=review
  const [photos, setPhotos]    = useState({})  // { shotId: { file, preview } }
  const [preview, setPreview]  = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]        = useState(false)

  const currentShot = step >= 1 && step <= 10 ? SHOTS[step - 1] : null

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file || !currentShot) return
    const reader = new FileReader()
    reader.onload = (ev) => setPreview({ file, dataUrl: ev.target.result })
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const confirmPhoto = () => {
    if (!preview || !currentShot) return
    setPhotos(p => ({ ...p, [currentShot.id]: preview }))
    setPreview(null)
    if (step < 10) setStep(s => s + 1)
    else setStep(11)
  }

  const retake = () => setPreview(null)

  const uploadPhoto = async (shotId, file) => {
    const ext  = file.type === 'image/png' ? 'png' : 'jpg'
    const path = `${jobId}/${shotId}_${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('inspection-photos')
      .upload(path, file, { contentType: file.type, upsert: true })
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage
      .from('inspection-photos')
      .getPublicUrl(path)
    return publicUrl
  }

  const submitInspection = async () => {
    setSubmitting(true)
    try {
      const entries = Object.entries(photos)
      for (const [shotId, { file }] of entries) {
        const url = await uploadPhoto(shotId, file)
        await supabase.from('job_inspection_photos').insert({
          job_id: jobId,
          angle: shotId,
          url,
          processing_status: 'pending',
        })
      }
      // Mark job for visualization processing
      await supabase.from('roofing_jobs')
        .update({ visualization_requested: true })
        .eq('id', jobId)
      setDone(true)
    } catch (e) {
      console.error(e)
      alert('Upload failed. Please check your connection and try again.')
    }
    setSubmitting(false)
  }

  const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

  // ── DONE ──────────────────────────────────────────────────────────────
  if (done) return (
    <div style={{ ...font, background: C.bg, minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', color: C.text, maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: 72, marginBottom: 20 }}>🎉</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 12px' }}>Inspection submitted!</h1>
      <p style={{ fontSize: 15, color: C.muted, margin: '0 0 8px', lineHeight: 1.6 }}>
        Your homeowner's color visualization will be ready in about 5 minutes.
      </p>
      <p style={{ fontSize: 13, color: 'rgba(136,150,168,0.7)', margin: '0 0 32px' }}>
        They'll see it in the Colors tab of their portal.
      </p>
      <button onClick={() => navigate(`/roofing/jobs/${jobId}`)}
        style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '14px 32px', fontSize: 16, fontWeight: 700, cursor: 'pointer', minHeight: 52 }}>
        Back to Job →
      </button>
    </div>
  )

  // ── START ─────────────────────────────────────────────────────────────
  if (step === 0) return (
    <div style={{ ...font, background: C.bg, minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '0 0 32px', color: C.text, maxWidth: 480, margin: '0 auto' }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate(`/roofing/jobs/${jobId}`)}
          style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', padding: '8px 0', minHeight: 44 }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Roof Inspection</span>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 80, marginBottom: 24 }}>📷</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 12px', lineHeight: 1.2 }}>Start Roof Inspection</h1>
        <p style={{ fontSize: 15, color: C.muted, margin: '0 0 8px', lineHeight: 1.6 }}>
          Take 10 photos from the guided angles below.
        </p>
        <p style={{ fontSize: 13, color: 'rgba(136,150,168,0.6)', margin: '0 0 40px' }}>
          10 photos required · Takes ~5 minutes
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 40 }}>
          {SHOTS.map(s => (
            <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: C.surface, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{s.icon}</div>
              <span style={{ fontSize: 9, color: C.muted, textAlign: 'center', maxWidth: 50 }}>{s.label}</span>
            </div>
          ))}
        </div>
        <button onClick={() => setStep(1)}
          style={{ width: '100%', maxWidth: 320, background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '16px', fontSize: 17, fontWeight: 700, cursor: 'pointer', minHeight: 56 }}>
          Start Inspection →
        </button>
      </div>
    </div>
  )

  // ── REVIEW ────────────────────────────────────────────────────────────
  if (step === 11) return (
    <div style={{ ...font, background: C.bg, minHeight: '100dvh', color: C.text, maxWidth: 480, margin: '0 auto', paddingBottom: 100 }}>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => setStep(10)}
          style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', padding: '8px 0', minHeight: 44 }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 16, color: C.text }}>Review Photos</span>
      </div>
      <p style={{ fontSize: 14, color: C.muted, padding: '0 20px', marginBottom: 20 }}>
        Review all 10 photos. Tap to retake any.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 20px', marginBottom: 24 }}>
        {SHOTS.map((shot, i) => {
          const p = photos[shot.id]
          return (
            <div key={shot.id} onClick={() => setStep(i + 1)}
              style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: C.surface, border: `1px solid ${p ? 'rgba(34,197,94,0.4)' : C.border}`, aspectRatio: '4/3', cursor: 'pointer' }}>
              {p ? (
                <img src={p.dataUrl} alt={shot.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 6 }}>
                  <span style={{ fontSize: 24 }}>{shot.icon}</span>
                  <span style={{ fontSize: 10, color: C.muted, textAlign: 'center' }}>{shot.label}</span>
                </div>
              )}
              <div style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: '50%', background: p ? C.success : C.danger, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>
                {p ? '✓' : '!'}
              </div>
              {p && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', padding: '4px 8px' }}>
                  <p style={{ margin: 0, fontSize: 9, color: '#fff', fontWeight: 600 }}>Tap to retake</p>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ padding: '0 20px' }}>
        {Object.keys(photos).length < 10 && (
          <p style={{ color: C.warning, fontSize: 13, margin: '0 0 12px', textAlign: 'center' }}>
            {10 - Object.keys(photos).length} photo{10 - Object.keys(photos).length !== 1 ? 's' : ''} still needed
          </p>
        )}
        <button
          onClick={submitInspection}
          disabled={submitting || Object.keys(photos).length < 10}
          style={{ width: '100%', background: Object.keys(photos).length < 10 ? 'rgba(74,158,255,0.3)' : C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '16px', fontSize: 17, fontWeight: 700, cursor: Object.keys(photos).length < 10 ? 'default' : 'pointer', minHeight: 56 }}>
          {submitting ? 'Uploading…' : `Submit Inspection ✅`}
        </button>
      </div>
    </div>
  )

  // ── CAPTURE STEP ──────────────────────────────────────────────────────
  const existing = photos[currentShot?.id]
  return (
    <div style={{ ...font, background: C.bg, minHeight: '100dvh', color: C.text, maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <button onClick={() => { setPreview(null); setStep(s => Math.max(1, s - 1)) }}
          style={{ background: 'none', border: 'none', color: C.muted, fontSize: 22, cursor: 'pointer', padding: '8px 0', minHeight: 44 }}>‹</button>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 12, color: C.muted, fontWeight: 600 }}>Step {step} of 10</p>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{currentShot?.label}</p>
        </div>
        <button onClick={() => { setPreview(null); setStep(11) }}
          style={{ background: 'none', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', padding: '8px', minHeight: 44 }}>
          Review
        </button>
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 4, padding: '12px 20px', flexShrink: 0 }}>
        {SHOTS.map((s, i) => (
          <div key={s.id} style={{ flex: 1, height: 4, borderRadius: 2, background: photos[s.id] ? C.success : i === step - 1 ? C.primary : C.border, transition: 'background 0.2s' }} />
        ))}
      </div>

      {/* Preview or placeholder */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px 0' }}>
        {preview ? (
          <div style={{ flex: 1, position: 'relative', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
            <img src={preview.dataUrl} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '4px 10px' }}>
              <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>Preview</span>
            </div>
          </div>
        ) : existing ? (
          <div style={{ flex: 1, position: 'relative', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
            <img src={existing.dataUrl} alt="captured" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(34,197,94,0.8)', borderRadius: 8, padding: '4px 10px' }}>
              <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>✓ Captured</span>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, borderRadius: 16, background: C.surface, border: `2px dashed ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 48 }}>{currentShot?.icon}</span>
            <p style={{ margin: 0, fontSize: 15, color: C.muted, textAlign: 'center', padding: '0 32px', lineHeight: 1.5 }}>{currentShot?.instruction}</p>
            <p style={{ margin: 0, fontSize: 12, color: 'rgba(136,150,168,0.6)', fontWeight: 600 }}>💡 {currentShot?.tip}</p>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 24 }}>
          {preview ? (
            <>
              <button onClick={confirmPhoto}
                style={{ background: C.success, color: '#fff', border: 'none', borderRadius: 14, padding: '15px', fontSize: 16, fontWeight: 700, cursor: 'pointer', minHeight: 54 }}>
                ✅ Use this photo
              </button>
              <button onClick={retake}
                style={{ background: 'transparent', color: C.text, border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px', fontSize: 15, fontWeight: 600, cursor: 'pointer', minHeight: 50 }}>
                🔄 Retake
              </button>
            </>
          ) : (
            <>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment"
                onChange={handleFileChange}
                style={{ display: 'none' }} />
              <button onClick={() => fileInputRef.current?.click()}
                style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: 14, padding: '15px', fontSize: 16, fontWeight: 700, cursor: 'pointer', minHeight: 54, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>📷</span> Take Photo
              </button>
              <input type="file" accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                id="photo-library" />
              <label htmlFor="photo-library"
                style={{ background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 14, padding: '13px', fontSize: 14, fontWeight: 500, cursor: 'pointer', minHeight: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                Choose from Library
              </label>
              {existing && (
                <button onClick={() => { if (step < 10) setStep(s => s + 1); else setStep(11) }}
                  style={{ background: 'transparent', color: C.primary, border: 'none', fontSize: 14, cursor: 'pointer', padding: '8px', minHeight: 44 }}>
                  Keep existing & continue →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const C = {
  bg: '#0f1923', surface: '#1a2535', surface2: '#243044',
  text: '#ffffff', muted: '#8896a8',
  border: 'rgba(255,255,255,0.08)',
  primary: '#4a9eff', success: '#22c55e',
  warning: '#f59e0b', danger: '#ef4444',
}
const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

const PHASE_LABELS = {
  pre_installation: 'Before',
  during_tearoff: 'Tearoff',
  during_installation: 'Install',
  post_installation: 'After',
  damage: 'Damage',
  material: 'Material',
}

export default function RoofingCrewMobile() {
  const { token } = useParams()
  const [job, setJob] = useState(null)
  const [assignment, setAssignment] = useState(null)
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadPhase, setUploadPhase] = useState('during_installation')
  const [statusUpdated, setStatusUpdated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [token])

  const load = async () => {
    // Look up by crew token
    const { data: asgn } = await supabase
      .from('crew_assignments')
      .select('*, roofing_jobs(*)')
      .eq('id', token)
      .maybeSingle()

    if (!asgn) {
      // Try job_schedule token
      const { data: sched } = await supabase
        .from('job_schedule')
        .select('*, roofing_jobs(*)')
        .eq('id', token)
        .maybeSingle()

      if (!sched) {
        setError('Link not found. Ask your supervisor for a valid link.')
        setLoading(false)
        return
      }
      setJob(sched.roofing_jobs)
      setAssignment({ name: sched.crew_lead, role: 'crew_lead', scheduled_date: sched.scheduled_date })
    } else {
      setJob(asgn.roofing_jobs)
      setAssignment(asgn)
    }

    const jobId = asgn?.job_id || (await supabase.from('job_schedule').select('job_id').eq('id', token).maybeSingle())?.data?.job_id
    if (jobId) {
      const { data: p } = await supabase.from('portal_photos').select('*').eq('job_id', jobId).order('taken_at', { ascending: false })
      setPhotos(p || [])
    }
    setLoading(false)
  }

  const getGPS = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 }
    )
  })

  const uploadPhotos = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length || !job) return
    setUploading(true)
    const coords = await getGPS()
    for (const file of files) {
      const path = `${job.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { data: up, error: upErr } = await supabase.storage.from('job-photos').upload(path, file)
      if (!upErr && up) {
        const { data: { publicUrl } } = supabase.storage.from('job-photos').getPublicUrl(path)
        await supabase.from('portal_photos').insert({
          job_id: job.id,
          url: publicUrl,
          phase: uploadPhase,
          uploaded_by: 'crew',
          uploaded_by_role: assignment?.role || 'crew',
          is_public: true,
          source: 'crew_upload',
          file_size_bytes: file.size,
          taken_at: new Date().toISOString(),
          gps_lat: coords?.lat || null,
          gps_lng: coords?.lng || null,
          crew_member: assignment?.name || null,
        })
      }
    }
    setUploading(false)
    load()
  }

  const markArrived = async () => {
    if (!job) return
    await supabase.from('roofing_jobs').update({ status: 'in_progress', actual_start_date: new Date().toISOString().split('T')[0] }).eq('id', job.id)
    setJob(j => ({ ...j, status: 'in_progress' }))
    setStatusUpdated(true)
  }

  const markComplete = async () => {
    if (!job) return
    await supabase.from('roofing_jobs').update({ status: 'inspection' }).eq('id', job.id)
    setJob(j => ({ ...j, status: 'inspection' }))
    setStatusUpdated(true)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: C.muted }}>Loading…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, ...font, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <p style={{ color: C.danger, textAlign: 'center' }}>{error}</p>
      </div>
    )
  }

  const todayPhotos = photos.filter(p => p.taken_at && p.taken_at.startsWith(new Date().toISOString().split('T')[0]))

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '40px' }}>
      {/* Header */}
      <div style={{ background: C.surface, padding: '20px', borderBottom: `1px solid ${C.border}` }}>
        <p style={{ margin: '0 0 2px', fontSize: '11px', color: C.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Crew Portal</p>
        <h1 style={{ margin: '0 0 2px', fontSize: '20px', fontWeight: '800', color: C.text }}>{job?.homeowner_name || 'Job'}</h1>
        <p style={{ margin: 0, fontSize: '14px', color: C.muted }}>{job?.property_address}</p>
        {assignment?.name && (
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: C.primary, fontWeight: '600' }}>👷 {assignment.name} — {assignment.role?.replace('_', ' ')}</p>
        )}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Status */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job Status</p>
          <p style={{ margin: '0 0 14px', fontSize: '18px', fontWeight: '700', color: C.text }}>
            {job?.status === 'in_progress' ? '🔨 In Progress' : job?.status === 'scheduled' ? '📅 Scheduled' : job?.status === 'inspection' ? '🔍 Awaiting Inspection' : job?.status || 'Unknown'}
          </p>
          {assignment?.scheduled_date && (
            <p style={{ margin: '0 0 14px', fontSize: '13px', color: C.muted }}>
              Scheduled: {new Date(assignment.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          )}
          {statusUpdated ? (
            <p style={{ fontSize: '14px', color: C.success, fontWeight: '600' }}>✓ Status updated</p>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              {job?.status !== 'in_progress' && (
                <button onClick={markArrived} style={{ flex: 1, background: C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                  ✓ I've Arrived
                </button>
              )}
              {(job?.status === 'in_progress' || job?.status === 'scheduled') && (
                <button onClick={markComplete} style={{ flex: 1, background: C.success, color: '#fff', border: 'none', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                  ✓ Work Complete
                </button>
              )}
            </div>
          )}
        </div>

        {/* Photo upload */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>📸 Upload Photos</p>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {Object.entries(PHASE_LABELS).map(([key, label]) => (
              <button key={key} onClick={() => setUploadPhase(key)}
                style={{ padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', background: uploadPhase === key ? C.primary : 'rgba(255,255,255,0.06)', color: uploadPhase === key ? '#fff' : C.muted }}>
                {label}
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '2px dashed rgba(255,255,255,0.15)', borderRadius: '14px', padding: '28px', cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1, background: 'rgba(255,255,255,0.02)' }}>
            <input type="file" accept="image/*" multiple capture="environment" onChange={uploadPhotos} disabled={uploading} style={{ display: 'none' }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: '0 0 4px', fontSize: '32px' }}>📷</p>
              <p style={{ margin: 0, fontSize: '14px', color: C.muted, fontWeight: '600' }}>{uploading ? 'Uploading…' : 'Take or upload photos'}</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'rgba(136,150,168,0.5)' }}>GPS tagged automatically</p>
            </div>
          </label>
          {todayPhotos.length > 0 && (
            <p style={{ margin: '10px 0 0', fontSize: '12px', color: C.success, fontWeight: '600' }}>✓ {todayPhotos.length} photo{todayPhotos.length !== 1 ? 's' : ''} uploaded today</p>
          )}
        </div>

        {/* Recent photos */}
        {photos.length > 0 && (
          <div>
            <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent Photos ({photos.length})</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {photos.slice(0, 12).map(p => (
                <div key={p.id} style={{ aspectRatio: '1', borderRadius: '10px', overflow: 'hidden', background: C.surface2, position: 'relative' }}>
                  <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {p.gps_lat && (
                    <div style={{ position: 'absolute', bottom: '3px', left: '3px', background: 'rgba(0,0,0,0.7)', color: '#4ade80', fontSize: '9px', padding: '1px 4px', borderRadius: '3px', fontWeight: '700' }}>📍</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

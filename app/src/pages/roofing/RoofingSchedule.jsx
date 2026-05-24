import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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

const DAY_COLORS = ['#4a9eff','#22c55e','#f59e0b','#a78bfa','#fb923c','#2dd4bf','#f472b6']

function getWeekDates(anchor) {
  const d = new Date(anchor)
  d.setDate(d.getDate() - d.getDay()) // Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(d)
    day.setDate(d.getDate() + i)
    return day
  })
}

export default function RoofingSchedule() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { contractor, session } = useContractor()
  const focusJobId = searchParams.get('job')

  const [weekAnchor, setWeekAnchor] = useState(new Date())
  const [schedules, setSchedules] = useState([])
  const [jobs, setJobs] = useState([])
  const [crewMembers, setCrewMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    job_id: focusJobId || '',
    scheduled_date: new Date().toISOString().split('T')[0],
    start_time: '08:00',
    crew_lead: '',
    material_delivery_date: '',
    notes: '',
  })

  const weekDates = getWeekDates(weekAnchor)

  const load = async () => {
    const weekStart = weekDates[0].toISOString().split('T')[0]
    const weekEnd = weekDates[6].toISOString().split('T')[0]

    const [
      { data: scheds },
      { data: jobList },
      { data: crew },
    ] = await Promise.all([
      supabase.from('job_schedule')
        .select('*, roofing_jobs(homeowner_name, property_address, status)')
        .gte('scheduled_date', weekStart)
        .lte('scheduled_date', weekEnd)
        .order('start_time'),
      supabase.from('roofing_jobs')
        .select('id, homeowner_name, property_address, status')
        .not('status', 'in', '("complete","paid")')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('contractor_employees')
        .select('id, name, role, phone')
        .eq('active', true)
        .limit(20),
    ])

    setSchedules(scheds || [])
    setJobs(jobList || [])
    setCrewMembers(crew || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [weekAnchor])

  useEffect(() => {
    if (focusJobId) {
      setForm(f => ({ ...f, job_id: focusJobId }))
      setShowModal(true)
    }
  }, [focusJobId])

  const openNewSchedule = (date) => {
    setEditingSchedule(null)
    setForm({
      job_id: '',
      scheduled_date: date || new Date().toISOString().split('T')[0],
      start_time: '08:00',
      crew_lead: '',
      material_delivery_date: '',
      notes: '',
    })
    setShowModal(true)
  }

  const openEdit = (sched) => {
    setEditingSchedule(sched)
    setForm({
      job_id: sched.job_id,
      scheduled_date: sched.scheduled_date,
      start_time: sched.start_time || '08:00',
      crew_lead: sched.crew_lead || '',
      material_delivery_date: sched.material_delivery_date || '',
      notes: sched.notes || '',
    })
    setShowModal(true)
  }

  const saveSchedule = async () => {
    if (!form.job_id || !form.scheduled_date) return
    setSaving(true)

    const payload = {
      job_id: form.job_id,
      contractor_id: contractor?.id,
      scheduled_date: form.scheduled_date,
      start_time: form.start_time || null,
      crew_lead: form.crew_lead || null,
      material_delivery_date: form.material_delivery_date || null,
      notes: form.notes || null,
    }

    if (editingSchedule) {
      await supabase.from('job_schedule').update(payload).eq('id', editingSchedule.id)
    } else {
      await supabase.from('job_schedule').insert(payload)
      // Update job status to scheduled
      await supabase.from('roofing_jobs').update({ status: 'scheduled' }).eq('id', form.job_id)
    }

    setSaving(false)
    setShowModal(false)
    load()
  }

  const deleteSchedule = async (schedId) => {
    await supabase.from('job_schedule').delete().eq('id', schedId)
    setShowModal(false)
    load()
  }

  const prevWeek = () => {
    const d = new Date(weekAnchor)
    d.setDate(d.getDate() - 7)
    setWeekAnchor(d)
  }
  const nextWeek = () => {
    const d = new Date(weekAnchor)
    d.setDate(d.getDate() + 7)
    setWeekAnchor(d)
  }

  const jobsOnDate = (date) => {
    const dateStr = date.toISOString().split('T')[0]
    return schedules.filter(s => s.scheduled_date === dateStr)
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{ background: 'rgba(15,25,35,0.85)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.border}`, padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <button onClick={() => navigate('/roofing/jobs')} style={{ fontSize: '12px', color: C.muted, background: 'none', border: 'none', cursor: 'pointer', display: 'block', marginBottom: '4px' }}>← Jobs</button>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: C.text }}>📅 Schedule</h1>
          </div>
          <button onClick={() => openNewSchedule(today)}
            style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
            + Schedule Job
          </button>
        </div>

        {/* Week nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={prevWeek} style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '6px 12px', color: C.text, cursor: 'pointer', fontSize: '14px' }}>←</button>
          <span style={{ fontSize: '14px', fontWeight: '600', color: C.text }}>
            {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button onClick={nextWeek} style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '6px 12px', color: C.text, cursor: 'pointer', fontSize: '14px' }}>→</button>
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{ padding: '16px 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '8px' }}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: '10px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
          {weekDates.map((date, di) => {
            const dateStr = date.toISOString().split('T')[0]
            const isToday = dateStr === today
            const dayJobs = jobsOnDate(date)
            return (
              <div key={dateStr}
                style={{ minHeight: '100px', background: isToday ? 'rgba(74,158,255,0.06)' : C.surface, border: `1px solid ${isToday ? 'rgba(74,158,255,0.3)' : C.border}`, borderRadius: '10px', padding: '6px 5px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                onClick={() => openNewSchedule(dateStr)}
                onMouseEnter={e => !isToday && (e.currentTarget.style.borderColor = 'rgba(74,158,255,0.25)')}
                onMouseLeave={e => !isToday && (e.currentTarget.style.borderColor = C.border)}
              >
                <p style={{ margin: '0 0 5px', fontSize: '11px', fontWeight: isToday ? '700' : '500', color: isToday ? C.primary : C.muted, textAlign: 'center' }}>
                  {date.getDate()}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {dayJobs.map((s, si) => (
                    <div key={s.id}
                      onClick={e => { e.stopPropagation(); openEdit(s) }}
                      style={{ background: DAY_COLORS[si % DAY_COLORS.length] + '22', border: `1px solid ${DAY_COLORS[si % DAY_COLORS.length]}44`, borderRadius: '4px', padding: '3px 4px', fontSize: '9px', fontWeight: '600', color: DAY_COLORS[si % DAY_COLORS.length], lineHeight: 1.2, cursor: 'pointer' }}>
                      {s.start_time && <span style={{ opacity: 0.7 }}>{s.start_time.slice(0,5)} </span>}
                      {s.roofing_jobs?.homeowner_name?.split(' ')[0] || 'Job'}
                    </div>
                  ))}
                </div>
                {dayJobs.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50px' }}>
                    <span style={{ fontSize: '18px', opacity: 0.15 }}>+</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Upcoming list */}
      {schedules.length > 0 && (
        <div style={{ padding: '0 16px 16px' }}>
          <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>This Week</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {schedules.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)).map(s => (
              <div key={s.id} onClick={() => openEdit(s)}
                style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(74,158,255,0.3)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
              >
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: '14px', fontWeight: '600', color: C.text }}>{s.roofing_jobs?.homeowner_name || 'Unknown'}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>{s.roofing_jobs?.property_address}</p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: '600', color: C.primary }}>
                    {new Date(s.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {s.start_time && <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>{s.start_time.slice(0,5)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Schedule modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: C.surface, borderRadius: '20px 20px 0 0', padding: '24px 20px', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <p style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: C.text }}>{editingSchedule ? 'Edit Schedule' : 'Schedule a Job'}</p>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: '22px', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Job selector */}
              <div>
                <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '500' }}>Job</p>
                <select value={form.job_id} onChange={e => setForm(f => ({ ...f, job_id: e.target.value }))}
                  style={{ width: '100%', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: form.job_id ? C.text : C.muted, outline: 'none' }}>
                  <option value="">Select a job…</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.homeowner_name} — {j.property_address}</option>
                  ))}
                </select>
              </div>

              {/* Date + Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '500' }}>Install Date</p>
                  <input type="date" value={form.scheduled_date} onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: C.text, outline: 'none' }} />
                </div>
                <div>
                  <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '500' }}>Start Time</p>
                  <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: C.text, outline: 'none' }} />
                </div>
              </div>

              {/* Crew Lead */}
              <div>
                <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '500' }}>Crew Lead</p>
                {crewMembers.length > 0 ? (
                  <select value={form.crew_lead} onChange={e => setForm(f => ({ ...f, crew_lead: e.target.value }))}
                    style={{ width: '100%', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: form.crew_lead ? C.text : C.muted, outline: 'none' }}>
                    <option value="">Select crew lead…</option>
                    {crewMembers.map(m => (
                      <option key={m.id} value={m.name}>{m.name} ({m.role})</option>
                    ))}
                  </select>
                ) : (
                  <input value={form.crew_lead} onChange={e => setForm(f => ({ ...f, crew_lead: e.target.value }))}
                    placeholder="Crew lead name"
                    style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: C.text, outline: 'none' }} />
                )}
              </div>

              {/* Material delivery */}
              <div>
                <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '500' }}>Material Delivery Date</p>
                <input type="date" value={form.material_delivery_date} onChange={e => setForm(f => ({ ...f, material_delivery_date: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: C.text, outline: 'none' }} />
              </div>

              {/* Notes */}
              <div>
                <p style={{ margin: '0 0 5px', fontSize: '12px', color: C.muted, fontWeight: '500' }}>Notes</p>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Additional notes…"
                  style={{ width: '100%', boxSizing: 'border-box', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 11px', fontSize: '13px', color: C.text, outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
              </div>

              <button onClick={saveSchedule} disabled={saving || !form.job_id || !form.scheduled_date}
                style={{ background: saving ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '12px', fontSize: '15px', fontWeight: '700', cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Saving…' : editingSchedule ? 'Update Schedule' : 'Schedule Job'}
              </button>

              {editingSchedule && (
                <button onClick={() => deleteSchedule(editingSchedule.id)}
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: C.danger, borderRadius: '10px', padding: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                  Remove from Schedule
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

const RESULTS = [
  { value: 'no_answer',      label: 'No Answer',     color: C.muted,    emoji: '🚪' },
  { value: 'not_interested', label: 'Not Interested', color: C.danger,   emoji: '❌' },
  { value: 'interested',     label: 'Interested',     color: C.warning,  emoji: '🟡' },
  { value: 'callback',       label: 'Callback',       color: '#60a5fa',  emoji: '📅' },
  { value: 'signed',         label: 'Signed!',        color: C.success,  emoji: '✅' },
]

const CLOSER_SCRIPT = [
  { step: 'Open', text: 'Hey there! I\'m [Name] with [Company]. We were just down the street replacing [Neighbor]\'s roof — we actually have some extra crew time today. Mind if I take a quick look at yours while we\'re in the neighborhood?' },
  { step: 'Storm angle', text: 'Did you know the hail storm last [month] caused damage that most homeowners can\'t see from the ground? Insurance typically covers this at zero out-of-pocket to you. Takes about 10 minutes to check.' },
  { step: 'Objection: busy', text: 'Totally get it. I just need 5 minutes on the roof — you don\'t even need to be there. If there\'s nothing, I\'ll let you know and we\'re out of your hair. If there is damage, you\'ll want to know before your insurance window closes.' },
  { step: 'Objection: no damage', text: 'I\'d love to prove you right! If the roof is perfect, I\'ll tell you straight. I\'d rather check 10 roofs and find nothing than miss one that needs help. Can I just take a quick look?' },
  { step: 'Close', text: 'Great — I can be up there in 5 minutes. Are you the homeowner? And is this a good number to reach you at? I\'ll text you my findings.' },
]

export default function RoofingCanvass() {
  const navigate = useNavigate()
  const { contractor } = useContractor()
  const [knocks, setKnocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showScript, setShowScript] = useState(false)
  const [form, setForm] = useState({ address: '', homeowner_name: '', phone: '', email: '', result: 'no_answer', notes: '', knocked_by: '' })
  const [saving, setSaving] = useState(false)
  const [filterResult, setFilterResult] = useState('all')
  const [convertingId, setConvertingId] = useState(null)

  useEffect(() => { load() }, [contractor])

  const load = async () => {
    if (!contractor?.id) return
    const { data } = await supabase
      .from('canvass_knocks')
      .select('*')
      .eq('contractor_id', contractor.id)
      .order('knocked_at', { ascending: false })
    setKnocks(data || [])
    setLoading(false)
  }

  const getGPS = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => resolve(null), { timeout: 5000 })
  })

  const saveKnock = async () => {
    if (!form.address.trim()) return
    setSaving(true)
    const coords = await getGPS()
    await supabase.from('canvass_knocks').insert({
      contractor_id: contractor.id,
      address: form.address.trim(),
      homeowner_name: form.homeowner_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      result: form.result,
      notes: form.notes.trim() || null,
      knocked_by: form.knocked_by.trim() || null,
      knocked_at: new Date().toISOString(),
      lat: coords?.lat || null,
      lng: coords?.lng || null,
    })
    setForm({ address: '', homeowner_name: '', phone: '', email: '', result: 'no_answer', notes: '', knocked_by: '' })
    setSaving(false)
    setShowAdd(false)
    load()
  }

  const convertToJob = async (knock) => {
    setConvertingId(knock.id)
    const { data: job } = await supabase.from('roofing_jobs').insert({
      contractor_id: contractor.id,
      homeowner_name: knock.homeowner_name || 'Unknown',
      homeowner_phone: knock.phone || null,
      homeowner_email: knock.email || null,
      property_address: knock.address,
      status: 'lead',
      source: 'canvass',
      portal_token: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single()
    if (job) {
      await supabase.from('canvass_knocks').update({ converted_job_id: job.id }).eq('id', knock.id)
      navigate(`/roofing/jobs/${job.id}`)
    }
    setConvertingId(null)
  }

  const todayKnocks = knocks.filter(k => k.knocked_at?.startsWith(new Date().toISOString().split('T')[0]))
  const interestedCount = knocks.filter(k => k.result === 'interested' || k.result === 'callback').length
  const signedCount = knocks.filter(k => k.result === 'signed').length

  const displayKnocks = filterResult === 'all' ? knocks : knocks.filter(k => k.result === filterResult)

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{ background: 'rgba(15,25,35,0.9)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.border}`, padding: '14px 20px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <button onClick={() => navigate('/roofing/jobs')} style={{ fontSize: '12px', color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 4px', display: 'block' }}>← Back</button>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: C.text }}>🗺️ Canvassing</h1>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowScript(v => !v)}
              style={{ background: 'rgba(74,158,255,0.12)', border: `1px solid rgba(74,158,255,0.25)`, color: C.primary, borderRadius: '10px', padding: '8px 14px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
              📝 Script
            </button>
            <button onClick={() => setShowAdd(v => !v)}
              style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '8px 14px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
              + Log Knock
            </button>
          </div>
        </div>
      </div>

      {/* Closer script panel */}
      {showScript && (
        <div style={{ margin: '12px 20px', background: C.surface, border: `1px solid rgba(74,158,255,0.25)`, borderRadius: '16px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: C.primary }}>📝 Door-to-Door Closer Script</p>
            <button onClick={() => setShowScript(false)} style={{ background: 'none', border: 'none', color: C.muted, fontSize: '16px', cursor: 'pointer' }}>×</button>
          </div>
          {CLOSER_SCRIPT.map((s, i) => (
            <div key={i} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: i < CLOSER_SCRIPT.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: '700', color: C.primary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.step}</p>
              <p style={{ margin: 0, fontSize: '14px', color: C.text, lineHeight: 1.5, fontStyle: 'italic' }}>"{s.text}"</p>
            </div>
          ))}
        </div>
      )}

      {/* Add knock form */}
      {showAdd && (
        <div style={{ margin: '12px 20px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '16px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: '700', color: C.text }}>Log a Knock</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Address *" style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 12px', fontSize: '14px', color: C.text, outline: 'none' }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <input value={form.homeowner_name} onChange={e => setForm(f => ({ ...f, homeowner_name: e.target.value }))}
                placeholder="Homeowner name" style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 12px', fontSize: '13px', color: C.text, outline: 'none' }} />
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="Phone" style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 12px', fontSize: '13px', color: C.text, outline: 'none' }} />
            </div>
            <p style={{ margin: '4px 0 4px', fontSize: '11px', color: C.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Result</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {RESULTS.map(r => (
                <button key={r.value} onClick={() => setForm(f => ({ ...f, result: r.value }))}
                  style={{ padding: '6px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', background: form.result === r.value ? 'rgba(74,158,255,0.2)' : 'rgba(255,255,255,0.06)', color: form.result === r.value ? C.primary : C.muted }}>
                  {r.emoji} {r.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <input value={form.knocked_by} onChange={e => setForm(f => ({ ...f, knocked_by: e.target.value }))}
                placeholder="Sales rep name" style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 12px', fontSize: '13px', color: C.text, outline: 'none' }} />
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Email (optional)" style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 12px', fontSize: '13px', color: C.text, outline: 'none' }} />
            </div>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Notes…"
              style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '9px 12px', fontSize: '13px', color: C.text, outline: 'none', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={saveKnock} disabled={saving || !form.address.trim()}
                style={{ flex: 1, background: saving ? 'rgba(74,158,255,0.4)' : C.primary, color: '#fff', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Log Knock'}
              </button>
              <button onClick={() => setShowAdd(false)} style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, color: C.muted, borderRadius: '8px', padding: '10px 16px', fontSize: '14px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '12px 20px 0' }}>
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
          {[
            { label: 'Today', value: todayKnocks.length, color: C.primary },
            { label: 'Interested', value: interestedCount, color: C.warning },
            { label: 'Signed', value: signedCount, color: C.success },
          ].map(s => (
            <div key={s.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '12px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 2px', fontSize: '24px', fontWeight: '800', color: s.color }}>{s.value}</p>
              <p style={{ margin: 0, fontSize: '11px', color: C.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filter */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <button onClick={() => setFilterResult('all')}
            style={{ padding: '4px 11px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: filterResult === 'all' ? C.primary : 'rgba(255,255,255,0.06)', color: filterResult === 'all' ? '#fff' : C.muted }}>
            All ({knocks.length})
          </button>
          {RESULTS.map(r => {
            const count = knocks.filter(k => k.result === r.value).length
            if (!count) return null
            return (
              <button key={r.value} onClick={() => setFilterResult(r.value)}
                style={{ padding: '4px 11px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600', background: filterResult === r.value ? 'rgba(74,158,255,0.2)' : 'rgba(255,255,255,0.06)', color: filterResult === r.value ? C.primary : C.muted }}>
                {r.emoji} {r.label} ({count})
              </button>
            )
          })}
        </div>

        {/* Knock list */}
        {loading ? (
          <p style={{ textAlign: 'center', color: C.muted, padding: '40px 0' }}>Loading…</p>
        ) : displayKnocks.length === 0 ? (
          <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: '12px', padding: '40px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: '28px' }}>🚪</p>
            <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: '600', color: C.text }}>No knocks logged yet</p>
            <p style={{ margin: 0, fontSize: '13px', color: C.muted }}>Tap "+ Log Knock" to start tracking doors</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {displayKnocks.map(knock => {
              const resultMeta = RESULTS.find(r => r.value === knock.result) || RESULTS[0]
              const isConverted = !!knock.converted_job_id
              return (
                <div key={knock.id} style={{ background: C.surface, border: `1px solid ${knock.result === 'signed' ? 'rgba(34,197,94,0.3)' : knock.result === 'interested' ? 'rgba(245,158,11,0.2)' : C.border}`, borderRadius: '14px', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '16px' }}>{resultMeta.emoji}</span>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {knock.homeowner_name || knock.address}
                        </p>
                      </div>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {knock.homeowner_name ? knock.address : null}
                      </p>
                      <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
                        {knock.knocked_by && <span style={{ fontSize: '11px', color: C.muted }}>👤 {knock.knocked_by}</span>}
                        {knock.phone && <span style={{ fontSize: '11px', color: C.muted }}>📞 {knock.phone}</span>}
                        <span style={{ fontSize: '11px', color: C.muted }}>{new Date(knock.knocked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      {knock.notes && <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'rgba(136,150,168,0.7)', fontStyle: 'italic' }}>{knock.notes}</p>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                      <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '20px', background: `${resultMeta.color}20`, color: resultMeta.color }}>{resultMeta.label}</span>
                      {(knock.result === 'interested' || knock.result === 'signed' || knock.result === 'callback') && !isConverted && (
                        <button onClick={() => convertToJob(knock)} disabled={convertingId === knock.id}
                          style={{ background: C.primary, color: '#fff', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>
                          {convertingId === knock.id ? '…' : '→ Job'}
                        </button>
                      )}
                      {isConverted && <span style={{ fontSize: '11px', color: C.success, fontWeight: '600' }}>✓ Job created</span>}
                      {knock.lat && (
                        <a href={`https://maps.google.com/?q=${knock.lat},${knock.lng}`} target="_blank" rel="noopener"
                          style={{ fontSize: '11px', color: C.primary, textDecoration: 'none' }}>📍 Map</a>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

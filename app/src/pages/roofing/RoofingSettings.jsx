import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const C = {
  bg: '#0f1923', surface: '#1a2535', surface2: '#243044',
  text: '#ffffff', muted: '#8896a8',
  border: 'rgba(255,255,255,0.08)',
  primary: '#4a9eff', success: '#22c55e',
  danger: '#ef4444',
}

function Section({ title, children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '16px', padding: '24px', marginBottom: '16px' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '15px', fontWeight: '600', color: C.text }}>{title}</h2>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: '14px', color: C.text }}>{label}</span>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer',
          background: checked ? C.primary : 'rgba(255,255,255,0.12)',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <div style={{
          position: 'absolute', top: '2px',
          left: checked ? '22px' : '2px',
          width: '20px', height: '20px', borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }} />
      </div>
    </div>
  )
}

export default function RoofingSettings() {
  const navigate = useNavigate()
  const { contractor } = useContractor()
  const [form, setForm] = useState({ company_name: '', owner_phone: '', google_review_link: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notifications, setNotifications] = useState({
    new_message: true, portal_viewed: true, supplement_update: false,
  })
  const [employees, setEmployees] = useState([])
  const [addingCrew, setAddingCrew] = useState(false)
  const [newCrew, setNewCrew] = useState({ name: '', phone: '', role: 'crew' })
  const [manufacturers, setManufacturers] = useState([])
  const [activeColorIds, setActiveColorIds] = useState(new Set())
  const [expandedMfg, setExpandedMfg] = useState(null)

  useEffect(() => {
    if (contractor) {
      setForm({ company_name: contractor.company_name || '', owner_phone: contractor.owner_phone || '', google_review_link: contractor.google_review_link || '' })
      supabase.from('contractor_employees')
        .select('id, name, phone, role, is_owner, active')
        .eq('contractor_id', contractor.id)
        .eq('active', true)
        .order('is_owner', { ascending: false })
        .then(({ data }) => setEmployees(data || []))
      supabase.from('product_manufacturers')
        .select('id, name, roofing_products(id, name, product_colors(id, name, hex_color))')
        .order('name')
        .then(({ data }) => setManufacturers(data || []))
      supabase.from('contractor_products')
        .select('color_id')
        .eq('contractor_id', contractor.id)
        .eq('is_active', true)
        .then(({ data }) => setActiveColorIds(new Set((data || []).map(r => r.color_id))))
    }
  }, [contractor])

  const saveProfile = async () => {
    if (!contractor?.id) return
    setSaving(true)
    await supabase.from('contractor_accounts').update({
      company_name: form.company_name,
      owner_phone: form.owner_phone,
      google_review_link: form.google_review_link || null,
    }).eq('id', contractor.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const addCrewMember = async () => {
    if (!newCrew.name.trim()) return
    await supabase.from('contractor_employees').insert({
      contractor_id: contractor.id,
      name: newCrew.name.trim(),
      phone: newCrew.phone.trim() || null,
      role: newCrew.role,
      is_owner: false,
      active: true,
    })
    setNewCrew({ name: '', phone: '', role: 'crew' })
    setAddingCrew(false)
    const { data } = await supabase.from('contractor_employees')
      .select('id, name, phone, role, is_owner, active')
      .eq('contractor_id', contractor.id)
      .eq('active', true)
      .order('is_owner', { ascending: false })
    setEmployees(data || [])
  }

  const toggleColor = async (colorId) => {
    const isActive = activeColorIds.has(colorId)
    const next = new Set(activeColorIds)
    if (isActive) {
      next.delete(colorId)
      setActiveColorIds(next)
      await supabase.from('contractor_products')
        .update({ is_active: false })
        .eq('contractor_id', contractor.id)
        .eq('color_id', colorId)
    } else {
      next.add(colorId)
      setActiveColorIds(next)
      await supabase.from('contractor_products')
        .upsert({ contractor_id: contractor.id, color_id: colorId, is_active: true },
          { onConflict: 'contractor_id,color_id' })
    }
  }

  const addAllColors = async (product) => {
    const colorIds = (product.product_colors || []).map(c => c.id)
    if (!colorIds.length) return
    const next = new Set(activeColorIds)
    colorIds.forEach(id => next.add(id))
    setActiveColorIds(next)
    await supabase.from('contractor_products')
      .upsert(
        colorIds.map(color_id => ({ contractor_id: contractor.id, color_id, is_active: true })),
        { onConflict: 'contractor_id,color_id' }
      )
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/roofing/login')
  }

  const planStr = (contractor?.plan || 'free').toUpperCase()
  const isFree = planStr === 'FREE' || planStr === 'TRIAL'
  const trialEnd = contractor?.trial_ends_at
    ? new Date(contractor.trial_ends_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: C.surface2, border: `1px solid ${C.border}`,
    borderRadius: '10px', padding: '12px 14px',
    fontSize: '15px', color: C.text, outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    marginBottom: '12px',
  }

  const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font, paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{
        background: 'rgba(15,25,35,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '16px 20px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => navigate('/roofing/jobs')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: C.muted, padding: 0 }}>←</button>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: C.text }}>Settings</h1>
        </div>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>

        {/* Company Profile */}
        <Section title="Company Profile">
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Company Name</label>
          <input
            value={form.company_name}
            onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))}
            style={inputStyle}
            onFocus={e => { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
            onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }}
          />
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Phone</label>
          <input
            value={form.owner_phone}
            onChange={e => setForm(p => ({ ...p, owner_phone: e.target.value }))}
            placeholder="(720) 555-0100"
            style={inputStyle}
            onFocus={e => { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
            onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }}
          />
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Google Review Link</label>
          <input
            value={form.google_review_link}
            onChange={e => setForm(p => ({ ...p, google_review_link: e.target.value }))}
            placeholder="https://g.page/r/your-business/review"
            style={inputStyle}
            onFocus={e => { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
            onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }}
          />
          {form.google_review_link && (
            <p style={{ fontSize: '11px', color: C.muted, margin: '-8px 0 12px' }}>
              ✓ Used in review request SMS after job completion
            </p>
          )}
          <button
            onClick={saveProfile}
            disabled={saving}
            style={{
              background: saved ? C.success : C.primary,
              color: '#fff', border: 'none', borderRadius: '10px', padding: '12px 24px',
              fontSize: '14px', fontWeight: '700', cursor: saving ? 'default' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </Section>

        {/* Current Plan */}
        <Section title="Current Plan">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <span style={{ fontSize: '22px', fontWeight: '700', color: C.text }}>{planStr}</span>
            <span style={{
              fontSize: '12px', fontWeight: '700', padding: '5px 12px', borderRadius: '20px',
              background: isFree ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
              color: isFree ? '#f59e0b' : C.success,
            }}>
              {isFree ? 'Free Trial' : 'Active'}
            </span>
          </div>
          {trialEnd && <p style={{ fontSize: '13px', color: C.muted, margin: '0 0 16px' }}>Trial ends {trialEnd}</p>}
          {isFree && (
            <a
              href={`https://roofingos.dev/upgrade?contractor_id=${contractor?.id}`}
              target="_blank" rel="noopener"
              style={{ display: 'inline-block', background: C.primary, color: '#fff', textDecoration: 'none', borderRadius: '10px', padding: '12px 24px', fontSize: '14px', fontWeight: '700' }}
            >
              Upgrade Plan →
            </a>
          )}
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <Toggle label="New homeowner message" checked={notifications.new_message} onChange={v => setNotifications(p => ({ ...p, new_message: v }))} />
          <Toggle label="Portal viewed by homeowner" checked={notifications.portal_viewed} onChange={v => setNotifications(p => ({ ...p, portal_viewed: v }))} />
          <Toggle label="Supplement status update" checked={notifications.supplement_update} onChange={v => setNotifications(p => ({ ...p, supplement_update: v }))} />
          <button style={{ marginTop: '16px', background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '10px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            Save Preferences
          </button>
        </Section>

        {/* Team */}
        <Section title="Team">
          {employees.map(emp => (
            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: '14px', fontWeight: '600', color: C.text }}>{emp.name} {emp.is_owner && '👑'}</p>
                <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>{emp.role}{emp.phone ? ` · ${emp.phone}` : ''}</p>
              </div>
            </div>
          ))}
          {employees.length === 0 && (
            <p style={{ color: C.muted, fontSize: '13px', margin: '0 0 16px' }}>No crew members yet.</p>
          )}

          {addingCrew ? (
            <div style={{ marginTop: '16px', padding: '16px', background: C.surface2, borderRadius: '12px' }}>
              <input
                placeholder="Name *"
                value={newCrew.name}
                onChange={e => setNewCrew(p => ({ ...p, name: e.target.value }))}
                style={{ ...inputStyle, marginBottom: '8px' }}
                onFocus={e => { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
                onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }}
              />
              <input
                placeholder="Phone (optional)"
                value={newCrew.phone}
                onChange={e => setNewCrew(p => ({ ...p, phone: e.target.value }))}
                style={{ ...inputStyle, marginBottom: '8px' }}
                onFocus={e => { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(74,158,255,0.15)' }}
                onBlur={e => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none' }}
              />
              <select
                value={newCrew.role}
                onChange={e => setNewCrew(p => ({ ...p, role: e.target.value }))}
                style={{ ...inputStyle, marginBottom: '12px', appearance: 'none' }}
              >
                <option value="crew">Crew</option>
                <option value="sales">Sales</option>
                <option value="pm">Project Manager</option>
                <option value="office">Office</option>
              </select>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={addCrewMember}
                  style={{ flex: 1, background: C.primary, color: '#fff', border: 'none', borderRadius: '10px', padding: '11px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
                >
                  Add Member
                </button>
                <button
                  onClick={() => setAddingCrew(false)}
                  style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: '10px', padding: '11px 16px', fontSize: '14px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingCrew(true)}
              style={{ marginTop: '16px', background: 'transparent', border: `1px solid ${C.border}`, color: C.text, borderRadius: '10px', padding: '11px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', width: '100%' }}
            >
              + Add Crew Member
            </button>
          )}
        </Section>

        {/* Products & Colors */}
        <Section title="Products & Colors">
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: C.muted }}>
            Choose which shingle colors to show homeowners in their portal.
          </p>
          {manufacturers.map(mfg => {
            const isOpen = expandedMfg === mfg.id
            const totalColors = (mfg.roofing_products || []).reduce((n, p) => n + (p.product_colors || []).length, 0)
            const activeCount = (mfg.roofing_products || []).reduce((n, p) =>
              n + (p.product_colors || []).filter(c => activeColorIds.has(c.id)).length, 0)
            return (
              <div key={mfg.id} style={{ marginBottom: '8px', border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
                <div
                  onClick={() => setExpandedMfg(isOpen ? null : mfg.id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', cursor: 'pointer', background: isOpen ? C.surface2 : 'transparent' }}
                >
                  <div>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: C.text }}>{mfg.name}</span>
                    {activeCount > 0 && (
                      <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', background: 'rgba(74,158,255,0.15)', color: C.primary }}>
                        {activeCount} active
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: C.muted }}>{totalColors} colors</span>
                    <span style={{ color: C.muted, fontSize: '14px', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: '4px 16px 16px', borderTop: `1px solid ${C.border}` }}>
                    {(mfg.roofing_products || []).map(product => (
                      <div key={product.id} style={{ marginTop: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{product.name}</span>
                          <button
                            onClick={() => addAllColors(product)}
                            style={{ fontSize: '11px', fontWeight: '700', color: C.primary, background: 'rgba(74,158,255,0.12)', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}
                          >
                            Add All
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {(product.product_colors || []).map(color => {
                            const on = activeColorIds.has(color.id)
                            return (
                              <button
                                key={color.id}
                                onClick={() => toggleColor(color.id)}
                                title={color.name}
                                style={{
                                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                                }}
                              >
                                <div style={{
                                  width: '36px', height: '36px', borderRadius: '50%',
                                  background: color.hex_color || '#555',
                                  border: on ? `3px solid ${C.primary}` : `2px solid ${C.border}`,
                                  boxShadow: on ? `0 0 0 2px rgba(74,158,255,0.3)` : 'none',
                                  transition: 'border 0.15s, box-shadow 0.15s',
                                }} />
                                <span style={{ fontSize: '9px', color: on ? C.primary : C.muted, fontWeight: on ? '700' : '400', maxWidth: '44px', textAlign: 'center', lineHeight: '1.2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {color.name}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {manufacturers.length === 0 && (
            <p style={{ color: C.muted, fontSize: '13px', margin: 0 }}>Loading products…</p>
          )}
          {activeColorIds.size > 0 && (
            <p style={{ margin: '16px 0 0', fontSize: '12px', color: C.success }}>
              ✓ {activeColorIds.size} color{activeColorIds.size !== 1 ? 's' : ''} active — homeowners will see these in their portal
            </p>
          )}
        </Section>

        {/* Tools */}
        <Section title="Tools">
          {[
            { label: 'Roof Measurements', desc: 'Aerial measurements & material estimates', path: '/roofing/measurements', icon: '📐' },
            { label: 'Integrations', desc: 'Connect CompanyCam, Stripe, and more', path: '/roofing/integrations', icon: '🔌' },
            { label: 'Product Roadmap', desc: 'See every feature and what you have unlocked', path: '/roofing/roadmap', icon: '🗺️' },
          ].map(tool => (
            <div
              key={tool.path}
              onClick={() => navigate(tool.path)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 0', borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '20px' }}>{tool.icon}</span>
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: '14px', fontWeight: '600', color: C.text }}>{tool.label}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>{tool.desc}</p>
                </div>
              </div>
              <span style={{ color: C.muted, fontSize: '16px' }}>›</span>
            </div>
          ))}
        </Section>

        {/* Account */}
        <Section title="Account">
          <button
            onClick={handleSignOut}
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: C.danger, borderRadius: '10px', padding: '12px 24px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', width: '100%' }}
          >
            Sign Out
          </button>
        </Section>
      </div>

      {/* Bottom nav */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: C.surface, borderTop: `1px solid ${C.border}`,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)', height: '64px',
      }}>
        {[
          { icon: '🏠', label: 'Jobs', path: '/roofing/jobs' },
          { icon: '＋', label: 'New Job', path: '/roofing/jobs/new' },
          { icon: '👥', label: 'Crew', path: '/roofing/crew' },
          { icon: '⚙️', label: 'Settings', path: '/roofing/settings' },
        ].map(t => {
          const active = window.location.pathname === t.path
          return (
            <button
              key={t.path}
              onClick={() => navigate(t.path)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '8px 0', border: 'none',
                background: 'none', cursor: 'pointer',
                color: active ? C.primary : C.muted,
                position: 'relative',
              }}
            >
              {active && (
                <div style={{
                  position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                  width: '32px', height: '3px', borderRadius: '0 0 3px 3px',
                  background: C.primary,
                }} />
              )}
              <span style={{ fontSize: '22px', lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: '10px', marginTop: '3px', fontWeight: active ? '700' : '500' }}>{t.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

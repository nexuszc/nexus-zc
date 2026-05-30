import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const STATUS_CONFIG = {
  live:   { label: 'Live',   color: '#10b981', dot: '●' },
  beta:   { label: 'Beta',   color: '#f59e0b', dot: '◑' },
  paused: { label: 'Paused', color: '#ef4444', dot: '⏸' },
  stub:   { label: 'Stub',   color: '#6b7280', dot: '○' },
}

const VERSION_COLOR = {
  'V4': '#a78bfa', 'V3': '#3b82f6',
  'V2': '#10b981', 'V1': '#6b7280',
  'Stub': '#374151', 'V0': '#1f2937',
}

export default function RoofingProductStatus() {
  const [features, setFeatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    supabase
      .from('roofing_product_versions')
      .select('*')
      .order('tier_order', { ascending: true })
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        setFeatures(data || [])
        setLoading(false)
      })
  }, [])

  const save = async (id, field, value) => {
    try {
      await supabase
        .from('roofing_product_versions')
        .update({ [field]: value })
        .eq('id', id)
    } catch {}
    setFeatures(f => f.map(x => x.id === id ? { ...x, [field]: value } : x))
    setEditing(null)
  }

  const categories = [...new Set(features.map(f => f.category))].filter(Boolean)

  const categoryScore = (cat) => {
    const items = features.filter(f => f.category === cat)
    const live = items.filter(f => f.status === 'live').length
    return Math.round((live / items.length) * 100)
  }

  const tiers = ['free', 'starter', 'pro', 'custom']
  const tierScore = (tier) => {
    const items = features.filter(f => f.tier === tier)
    const live = items.filter(f => f.status === 'live').length
    return { live, total: items.length, pct: items.length ? Math.round((live / items.length) * 100) : 0 }
  }

  const filtered = features.filter(f => {
    if (filter === 'live')       return f.status === 'live'
    if (filter === 'paused')     return f.status === 'paused'
    if (filter === 'stub')       return f.status === 'stub'
    if (filter === 'needs_work') return f.status === 'paused' || f.status === 'stub'
    return true
  })

  if (loading) return (
    <div style={{ background: '#0a0f1a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
      Loading product status...
    </div>
  )

  return (
    <div style={{ background: '#0a0f1a', minHeight: '100vh', color: '#f9fafb', fontFamily: '-apple-system,sans-serif' }}>

      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
            ← <a href="/roofing/dashboard" style={{ color: '#6b7280', textDecoration: 'none' }}>Roofing OS</a>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>Product Status</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            {features.filter(f => f.status === 'live').length} live · {features.filter(f => f.status === 'beta').length} beta · {features.filter(f => f.status === 'paused').length} paused · {features.filter(f => f.status === 'stub').length} stubs
          </p>
        </div>
      </div>

      {/* Tier summary bars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, padding: '20px 24px 0' }}>
        {tiers.map(tier => {
          const s = tierScore(tier)
          return (
            <div key={tier} style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{tier}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', marginBottom: 6 }}>{s.pct}%</div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, height: 4, marginBottom: 6 }}>
                <div style={{
                  width: `${s.pct}%`, height: '100%', borderRadius: 4, transition: 'width 0.3s',
                  background: s.pct === 100 ? '#10b981' : s.pct > 60 ? '#3b82f6' : '#f59e0b',
                }} />
              </div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{s.live}/{s.total} live</div>
            </div>
          )
        })}
      </div>

      {/* Category health pills */}
      <div style={{ padding: '20px 24px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>By Category</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {categories.map(cat => {
            const score = categoryScore(cat)
            const color = score === 100 ? '#10b981' : score > 60 ? '#3b82f6' : '#f59e0b'
            const bg = score === 100 ? 'rgba(16,185,129,0.15)' : score > 60 ? 'rgba(59,130,246,0.15)' : 'rgba(245,158,11,0.15)'
            return (
              <div key={cat} style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color }}>{score}%</div>
                <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{cat}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '20px 24px 0' }}>
        {[['all', 'All'], ['live', 'Live'], ['needs_work', 'Needs Work'], ['paused', 'Paused'], ['stub', 'Stubs']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)} style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid',
            borderColor: filter === val ? '#3b82f6' : 'rgba(255,255,255,0.08)',
            background: filter === val ? 'rgba(59,130,246,0.15)' : 'transparent',
            color: filter === val ? '#3b82f6' : '#6b7280',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>

      {/* Feature table */}
      <div style={{ padding: 24 }}>
        {categories.map(cat => {
          const catFeatures = filtered.filter(f => f.category === cat)
          if (!catFeatures.length) return null
          return (
            <div key={cat} style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>{cat}</div>
                <div style={{ fontSize: 11, color: '#374151', background: '#111827', borderRadius: 4, padding: '2px 6px' }}>
                  {catFeatures.filter(f => f.status === 'live').length}/{catFeatures.length}
                </div>
              </div>
              <div style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
                {catFeatures.map((f, i) => (
                  <div key={f.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 60px 80px 40px',
                    alignItems: 'center', padding: '12px 16px', gap: 12,
                    borderBottom: i < catFeatures.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}>
                    {/* Name + description */}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{f.feature_name}</div>
                      <div style={{ fontSize: 12, color: '#4b5563' }}>{f.description}</div>
                    </div>

                    {/* Version — click to edit */}
                    <div onClick={() => setEditing(`${f.id}-version`)} style={{
                      background: VERSION_COLOR[f.version] || '#1f2937',
                      borderRadius: 6, padding: '3px 8px',
                      fontSize: 11, fontWeight: 800, color: '#fff',
                      cursor: 'pointer', textAlign: 'center',
                    }}>
                      {editing === `${f.id}-version` ? (
                        <select autoFocus defaultValue={f.version}
                          onBlur={e => save(f.id, 'version', e.target.value)}
                          onChange={e => save(f.id, 'version', e.target.value)}
                          style={{ background: '#1f2937', border: 'none', color: '#fff', fontSize: 11, width: '100%' }}>
                          {['V4', 'V3', 'V2', 'V1', 'Stub', 'V0'].map(v => <option key={v}>{v}</option>)}
                        </select>
                      ) : (f.version || 'V1')}
                    </div>

                    {/* Status — click to edit */}
                    <div onClick={() => setEditing(`${f.id}-status`)} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                      {editing === `${f.id}-status` ? (
                        <select autoFocus defaultValue={f.status}
                          onBlur={e => save(f.id, 'status', e.target.value)}
                          onChange={e => save(f.id, 'status', e.target.value)}
                          style={{ background: '#1f2937', border: 'none', color: '#fff', fontSize: 11 }}>
                          {['live', 'beta', 'paused', 'stub'].map(s => <option key={s}>{s}</option>)}
                        </select>
                      ) : (
                        <>
                          <span style={{ color: STATUS_CONFIG[f.status]?.color || '#6b7280', fontSize: 10 }}>
                            {STATUS_CONFIG[f.status]?.dot}
                          </span>
                          <span style={{ fontSize: 12, color: STATUS_CONFIG[f.status]?.color || '#6b7280', fontWeight: 600 }}>
                            {STATUS_CONFIG[f.status]?.label || f.status}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Tier */}
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#374151', textTransform: 'uppercase' }}>{f.tier}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
  purple: '#a78bfa',
}
const font = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }

const TIERS = [
  { key: 'free',    label: 'Free',    price: '$0',    color: C.muted,    level: 1 },
  { key: 'starter', label: 'Starter', price: '$149',  color: C.primary,  level: 2 },
  { key: 'pro',     label: 'Pro',     price: '$499',  color: C.purple,   level: 3 },
  { key: 'custom',  label: 'Custom',  price: '$3k+',  color: C.warning,  level: 4 },
]

const TIER_LEVEL = { free: 1, starter: 2, pro: 3, custom: 4 }

function tierLevel(plan) {
  return TIER_LEVEL[plan] || 1
}

function isUnlocked(featureTier, contractorPlan) {
  return tierLevel(featureTier) <= tierLevel(contractorPlan || 'free')
}

function statusDot(feature, contractorPlan) {
  if (!isUnlocked(feature.tier, contractorPlan)) return 'locked'
  if (feature.status === 'coming_soon') return 'soon'
  if (feature.status === 'beta') return 'beta'
  return 'live'
}

// Ring SVG for tier progress
function ProgressRing({ pct, color, size = 52, stroke = 5 }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  )
}

function TierCard({ tier, contractorPlan, total, liveCount }) {
  const myLevel = tierLevel(contractorPlan || 'free')
  const active = myLevel >= tier.level
  const current = myLevel === tier.level
  const pct = total === 0 ? 0 : Math.round((liveCount / total) * 100)
  const locked = !active

  return (
    <div style={{
      background: current
        ? `linear-gradient(135deg, rgba(${tier.key === 'pro' ? '167,139,250' : tier.key === 'starter' ? '74,158,255' : tier.key === 'warning' ? '245,158,11' : '136,150,168'},0.12) 0%, rgba(255,255,255,0.03) 100%)`
        : C.surface,
      border: `2px solid ${current ? tier.color : locked ? C.border : 'rgba(255,255,255,0.12)'}`,
      borderRadius: '18px', padding: '16px',
      display: 'flex', alignItems: 'center', gap: '14px',
      opacity: locked ? 0.6 : 1,
      position: 'relative', overflow: 'hidden',
    }}>
      {current && (
        <div style={{
          position: 'absolute', top: '8px', right: '10px',
          background: tier.color, borderRadius: '8px',
          padding: '2px 8px', fontSize: '9px', fontWeight: '800',
          color: '#fff', letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>YOUR PLAN</div>
      )}

      <div style={{ position: 'relative' }}>
        <ProgressRing pct={active ? pct : 0} color={tier.color} />
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: '700',
          color: active ? tier.color : C.muted,
        }}>
          {locked ? '🔒' : `${pct}%`}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '2px' }}>
          <span style={{ fontSize: '15px', fontWeight: '800', color: active ? C.text : C.muted }}>{tier.label}</span>
          <span style={{ fontSize: '12px', color: tier.color, fontWeight: '600' }}>{tier.price}/mo</span>
        </div>
        <div style={{ fontSize: '11px', color: C.muted }}>
          {locked ? 'Locked — upgrade to unlock' : `${liveCount} of ${total} features live`}
        </div>
      </div>
    </div>
  )
}

function FeaturePill({ state, tier }) {
  if (state === 'locked') {
    const t = TIERS.find(t => t.key === tier)
    return (
      <span style={{
        fontSize: '10px', fontWeight: '700', color: t?.color || C.muted,
        background: `rgba(136,150,168,0.1)`, border: `1px solid rgba(136,150,168,0.2)`,
        borderRadius: '6px', padding: '2px 6px', letterSpacing: '0.04em', textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>
        {t?.label || tier}
      </span>
    )
  }
  if (state === 'beta') {
    return (
      <span style={{
        fontSize: '10px', fontWeight: '700', color: C.warning,
        background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
        borderRadius: '6px', padding: '2px 6px', whiteSpace: 'nowrap',
      }}>BETA</span>
    )
  }
  if (state === 'soon') {
    return (
      <span style={{
        fontSize: '10px', fontWeight: '700', color: C.muted,
        background: 'rgba(136,150,168,0.08)', border: `1px solid ${C.border}`,
        borderRadius: '6px', padding: '2px 6px', whiteSpace: 'nowrap',
      }}>SOON</span>
    )
  }
  return null
}

function FeatureRow({ feature, contractorPlan }) {
  const state = statusDot(feature, contractorPlan)
  const locked = state === 'locked'

  const stateIcon = {
    live:   <span style={{ color: C.success, fontSize: '13px', flexShrink: 0 }}>✓</span>,
    beta:   <span style={{ color: C.warning, fontSize: '13px', flexShrink: 0 }}>◑</span>,
    soon:   <span style={{ color: C.muted,   fontSize: '13px', flexShrink: 0 }}>○</span>,
    locked: <span style={{ color: C.muted,   fontSize: '13px', flexShrink: 0 }}>—</span>,
  }[state]

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: '10px 0',
      borderBottom: `1px solid ${C.border}`,
      opacity: locked ? 0.55 : 1,
    }}>
      <div style={{ marginTop: '1px' }}>{stateIcon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: '600', color: locked ? C.muted : C.text }}>
            {feature.feature_name}
          </span>
          <FeaturePill state={state} tier={feature.tier} />
        </div>
        {feature.description && (
          <div style={{ fontSize: '11px', color: C.muted, marginTop: '2px', lineHeight: 1.4 }}>
            {feature.description}
          </div>
        )}
      </div>
    </div>
  )
}

function CategorySection({ category, features, contractorPlan }) {
  const [open, setOpen] = useState(true)
  const liveCount = features.filter(f => isUnlocked(f.tier, contractorPlan) && f.status === 'live').length
  const total = features.length

  return (
    <div style={{ marginBottom: '12px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 0', gap: '8px',
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {category}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: C.success, fontWeight: '600' }}>
            {liveCount}/{total}
          </span>
          <span style={{ fontSize: '14px', color: C.muted, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>
            ‹
          </span>
        </div>
      </button>
      {open && (
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: '14px',
          padding: '0 14px',
        }}>
          {features.map((f, i) => (
            <div key={f.feature_key} style={{ borderBottom: i < features.length - 1 ? undefined : 'none' }}>
              <FeatureRow feature={f} contractorPlan={contractorPlan} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RoofingRoadmap() {
  const navigate = useNavigate()
  const { contractor, loading: ctxLoading } = useContractor()
  const [features, setFeatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')

  const plan = contractor?.plan || 'free'
  const myLevel = tierLevel(plan)

  useEffect(() => {
    supabase
      .from('roofing_product_versions')
      .select('*')
      .order('category')
      .order('sort_order')
      .then(({ data }) => {
        setFeatures(data || [])
        setLoading(false)
      })
  }, [])

  const filteredFeatures = features.filter(f => {
    if (activeFilter === 'mine')   return isUnlocked(f.tier, plan)
    if (activeFilter === 'locked') return !isUnlocked(f.tier, plan)
    return true
  })

  // Group by category
  const byCategory = filteredFeatures.reduce((acc, f) => {
    acc[f.category] = acc[f.category] || []
    acc[f.category].push(f)
    return acc
  }, {})

  // Tier stats
  const tierStats = TIERS.map(t => {
    const tierFeatures = features.filter(f => f.tier === t.key)
    const liveCount = tierFeatures.filter(f => f.status === 'live').length
    return { ...t, total: tierFeatures.length, liveCount }
  })

  const totalUnlocked = features.filter(f => isUnlocked(f.tier, plan) && f.status === 'live').length
  const totalLive = features.filter(f => f.status === 'live').length

  const nextTier = TIERS.find(t => t.level === myLevel + 1)

  return (
    <div style={{ minHeight: '100vh', background: C.bg, ...font }}>

      {/* Header */}
      <div style={{
        background: 'rgba(15,25,35,0.9)', backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.border}`,
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: '12px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <button onClick={() => navigate('/roofing/jobs')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: C.muted, padding: 0, lineHeight: 1 }}>←</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: '17px', fontWeight: '700', color: C.text }}>Product Roadmap</h1>
          <p style={{ margin: 0, fontSize: '12px', color: C.muted }}>
            {totalUnlocked} of {totalLive} features unlocked
          </p>
        </div>
        {plan !== 'free' && (
          <div style={{
            background: TIERS.find(t => t.key === plan)?.color
              ? `${TIERS.find(t => t.key === plan)?.color}22`
              : 'rgba(255,255,255,0.05)',
            border: `1px solid ${TIERS.find(t => t.key === plan)?.color || C.border}`,
            borderRadius: '10px', padding: '4px 10px',
            fontSize: '11px', fontWeight: '700',
            color: TIERS.find(t => t.key === plan)?.color || C.text,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {plan}
          </div>
        )}
      </div>

      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '20px 16px 80px' }}>

        {/* Tier progress track */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '24px' }}>
          {tierStats.map(t => (
            <TierCard
              key={t.key}
              tier={t}
              contractorPlan={plan}
              total={t.total}
              liveCount={t.liveCount}
            />
          ))}
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
          {[
            { key: 'all',    label: 'All Features' },
            { key: 'mine',   label: 'My Plan' },
            { key: 'locked', label: 'Locked' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              style={{
                flex: 1, background: activeFilter === f.key ? C.primary : C.surface,
                border: `1px solid ${activeFilter === f.key ? C.primary : C.border}`,
                borderRadius: '10px', padding: '8px 0',
                fontSize: '12px', fontWeight: '600',
                color: activeFilter === f.key ? '#fff' : C.muted,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Feature categories */}
        {loading || ctxLoading ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: C.muted, fontSize: '14px' }}>
            Loading features...
          </div>
        ) : Object.keys(byCategory).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: C.muted }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>
              {activeFilter === 'locked' ? '🔓' : '🎉'}
            </div>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: C.text }}>
              {activeFilter === 'locked' ? 'Nothing locked — you have it all' : 'No features found'}
            </p>
          </div>
        ) : (
          Object.entries(byCategory).map(([cat, catFeatures]) => (
            <CategorySection
              key={cat}
              category={cat}
              features={catFeatures}
              contractorPlan={plan}
            />
          ))
        )}

        {/* Upgrade CTA */}
        {nextTier && activeFilter !== 'mine' && (
          <div style={{
            marginTop: '24px',
            background: `linear-gradient(135deg, rgba(74,158,255,0.08) 0%, rgba(167,139,250,0.06) 100%)`,
            border: `1px solid ${nextTier.color}44`,
            borderRadius: '18px', padding: '20px', textAlign: 'center',
          }}>
            <p style={{ margin: '0 0 4px', fontSize: '11px', fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Next level
            </p>
            <p style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: '800', color: C.text }}>
              Unlock {nextTier.label}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: C.muted }}>
              {features.filter(f => f.tier === nextTier.key && f.status === 'live').length} more features —{' '}
              <span style={{ color: nextTier.color, fontWeight: '700' }}>{nextTier.price}/mo</span>
            </p>
            <button
              onClick={() => navigate('/roofing/upgrade')}
              style={{
                background: nextTier.color, color: '#fff', border: 'none',
                borderRadius: '12px', padding: '13px 28px',
                fontSize: '15px', fontWeight: '700', cursor: 'pointer',
                transition: 'filter 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.1)'}
              onMouseLeave={e => e.currentTarget.style.filter = 'none'}
            >
              Upgrade to {nextTier.label} →
            </button>
          </div>
        )}

      </div>
    </div>
  )
}

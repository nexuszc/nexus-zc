import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  published: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e' },
  approved:  { bg: 'rgba(74,158,255,0.15)', color: '#4a9eff' },
  needs_review: { bg: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  draft:     { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' },
  pending:   { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  rejected:  { bg: 'rgba(107,114,128,0.15)', color: '#6b7280' },
}

const SOURCE_COLORS = {
  competitor_blog:    { bg: 'rgba(239,68,68,0.15)',    color: '#ef4444' },
  reddit:             { bg: 'rgba(139,92,246,0.15)',   color: '#a78bfa' },
  autocomplete:       { bg: 'rgba(74,158,255,0.15)',   color: '#4a9eff' },
  portal_messages:    { bg: 'rgba(34,197,94,0.15)',    color: '#22c55e' },
  competitor_preset:  { bg: 'rgba(245,158,11,0.15)',   color: '#f59e0b' },
}

const COMPETITOR_COLORS = {
  companycam:         { bg: 'rgba(74,158,255,0.15)',   color: '#4a9eff' },
  jobnimbus:          { bg: 'rgba(34,197,94,0.15)',    color: '#22c55e' },
  acculynx:           { bg: 'rgba(245,158,11,0.15)',   color: '#f59e0b' },
  salesrabbit:        { bg: 'rgba(239,68,68,0.15)',    color: '#ef4444' },
  roofr:              { bg: 'rgba(139,92,246,0.15)',   color: '#a78bfa' },
}

// ─── Helper functions ────────────────────────────────────────────────────────

function fmtNum(n) {
  if (n == null) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function posColor(pos) {
  if (!pos) return '#9ca3af'
  if (pos <= 3) return '#22c55e'
  if (pos <= 10) return '#f59e0b'
  return '#9ca3af'
}

function getCompetitorKey(str) {
  if (!str) return null
  const s = str.toLowerCase()
  if (s.includes('companycam')) return 'companycam'
  if (s.includes('jobnimbus') || s.includes('job nimbus')) return 'jobnimbus'
  if (s.includes('acculynx')) return 'acculynx'
  if (s.includes('salesrabbit') || s.includes('sales rabbit')) return 'salesrabbit'
  if (s.includes('roofr')) return 'roofr'
  return null
}

function getSourceKey(str) {
  if (!str) return null
  const s = str.toLowerCase().replace(/[- ]/g, '_')
  if (SOURCE_COLORS[s]) return s
  return null
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function Chip({ label, scheme, style: extraStyle }) {
  const s = scheme || { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' }
  return (
    <span style={{
      display: 'inline-block',
      background: s.bg,
      color: s.color,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.03em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      ...extraStyle,
    }}>
      {label}
    </span>
  )
}

function StatusChip({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.draft
  return <Chip label={status?.replace(/_/g, ' ') || 'unknown'} scheme={s} />
}

function SkeletonCard() {
  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1f2937',
      borderRadius: 12,
      padding: 20,
      animation: 'pulse 1.5s ease-in-out infinite',
    }}>
      <div style={{ background: '#1f2937', borderRadius: 6, height: 12, width: '40%', marginBottom: 12 }} />
      <div style={{ background: '#1f2937', borderRadius: 6, height: 28, width: '60%', marginBottom: 8 }} />
      <div style={{ background: '#1f2937', borderRadius: 6, height: 10, width: '30%' }} />
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || '#fff' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 12, color: '#6b7a8d', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Card({ children, style: extra, redBorder, blueBorder }) {
  return (
    <div style={{
      background: '#111827',
      border: `1px solid ${redBorder ? '#ef4444' : blueBorder ? '#4a9eff' : '#1f2937'}`,
      borderRadius: 12,
      padding: '20px 24px',
      ...extra,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0 }}>{children}</h2>
      {action}
    </div>
  )
}

function BtnPrimary({ children, onClick, disabled, style: extra }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? '#374151' : '#4a9eff',
        color: disabled ? '#6b7280' : '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...extra,
      }}
    >
      {children}
    </button>
  )
}

function BtnDanger({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? '#374151' : '#ef4444',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function BtnGhost({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        color: disabled ? '#4b5563' : '#9ca3af',
        border: `1px solid ${disabled ? '#1f2937' : '#374151'}`,
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function EmptyState({ icon, message }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#6b7280' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 14 }}>{message}</div>
    </div>
  )
}

function TableHeader({ cols }) {
  return (
    <thead>
      <tr style={{ borderBottom: '1px solid #1f2937' }}>
        {cols.map((c, i) => (
          <th
            key={i}
            style={{
              textAlign: c.right ? 'right' : 'left',
              padding: '8px 12px',
              fontSize: 11,
              color: '#9ca3af',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              whiteSpace: 'nowrap',
            }}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function RoofingSEO() {
  const navigate = useNavigate()

  // Data state
  const [stats, setStats]               = useState(null)
  const [needsReview, setNeedsReview]   = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [competitorPosts, setCompetitorPosts] = useState([])
  const [keywords, setKeywords]         = useState([])
  const [recentPosts, setRecentPosts]   = useState([])
  const [allPosts, setAllPosts]         = useState([])
  const [pillars, setPillars]           = useState([])

  // 100X SEO state
  const [locationPages, setLocationPages]   = useState([])
  const [vsPages, setVsPages]               = useState([])
  const [competitorGaps, setCompetitorGaps] = useState([])
  const [questions, setQuestions]           = useState([])
  const [tools, setTools]                   = useState([])

  // UI state
  const [loading, setLoading]           = useState(true)
  const [activeTab, setActiveTab]       = useState('overview')
  const [postsPage, setPostsPage]       = useState(0)
  const [postsSort, setPostsSort]       = useState('date')
  const [triggering, setTriggering]     = useState({}) // map of id/keyword → bool
  const [actionMsg, setActionMsg]       = useState(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [
        statsRes,
        needsReviewRes,
        opportunitiesRes,
        competitorRes,
        keywordsRes,
        recentRes,
        allPostsRes,
        pillarsRes,
        locationPagesRes,
        vsPagesRes,
        competitorGapsRes,
        questionsRes,
        toolsRes,
      ] = await Promise.all([
        supabase
          .from('seo_performance')
          .select('*')
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .maybeSingle()
          .catch(() => ({ data: null })),

        supabase
          .from('seo_posts')
          .select('id, title, keyword, quality_score, quality_details, created_at')
          .eq('status', 'needs_review')
          .order('created_at', { ascending: false })
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_posts')
          .select('id, title, slug, keyword, google_position, google_impressions, google_clicks')
          .eq('status', 'published')
          .gte('google_position', 4)
          .lte('google_position', 15)
          .gte('google_impressions', 5)
          .order('google_impressions', { ascending: false })
          .limit(10)
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_competitor_content')
          .select('*')
          .order('discovered_at', { ascending: false })
          .limit(20)
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_keyword_queue')
          .select('*')
          .eq('status', 'pending')
          .order('intent_score', { ascending: false })
          .limit(20)
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_posts')
          .select('*')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(5)
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_posts')
          .select('id, title, slug, status, published_at, google_impressions, google_clicks, google_position, quality_score')
          .order('created_at', { ascending: false })
          .limit(100)
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_pillars')
          .select('*')
          .order('created_at', { ascending: false })
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_location_pages')
          .select('id, city, state_code, slug, hail_risk, status, google_impressions, google_clicks')
          .order('population', { ascending: false })
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_vs_pages')
          .select('id, competitor, slug, status, published_at, google_impressions, google_clicks')
          .order('created_at', { ascending: false })
          .catch(() => ({ data: [] })),

        supabase
          .from('competitor_pages')
          .select('id, competitor, url, keyword, priority_score, gap_status, discovered_at')
          .eq('gap_status', 'uncovered')
          .order('priority_score', { ascending: false })
          .limit(50)
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_questions')
          .select('id, question, seed_keyword, intent_score, audience, status')
          .eq('status', 'pending')
          .order('intent_score', { ascending: false })
          .limit(30)
          .catch(() => ({ data: [] })),

        supabase
          .from('seo_tools')
          .select('id, name, slug, tool_type, status, monthly_visits')
          .order('created_at', { ascending: false })
          .catch(() => ({ data: [] })),
      ])

      setStats(statsRes.data)
      setNeedsReview(needsReviewRes.data || [])
      setOpportunities(opportunitiesRes.data || [])
      setCompetitorPosts(competitorRes.data || [])
      setKeywords(keywordsRes.data || [])
      setRecentPosts(recentRes.data || [])
      setAllPosts(allPostsRes.data || [])
      setPillars(pillarsRes.data || [])
      setLocationPages(locationPagesRes.data || [])
      setVsPages(vsPagesRes.data || [])
      setCompetitorGaps(competitorGapsRes.data || [])
      setQuestions(questionsRes.data || [])
      setTools(toolsRes.data || [])
    } catch (err) {
      console.error('RoofingSEO fetchAll error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Actions ────────────────────────────────────────────────────────────────

  function setTrigger(key, val) {
    setTriggering(prev => ({ ...prev, [key]: val }))
  }

  function flash(msg, isError = false) {
    setActionMsg({ text: msg, error: isError })
    setTimeout(() => setActionMsg(null), 3000)
  }

  async function callEdgeFunction(fnName, body) {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${fnName} returned ${res.status}`)
    return res
  }

  async function triggerWriter(keyword, triggerKey) {
    const key = triggerKey || keyword
    setTrigger(key, true)
    try {
      await callEdgeFunction('seo-content-writer', { keyword })
      flash(`Writing post for "${keyword}"…`)
      await fetchAll()
    } catch (err) {
      flash(`Failed to trigger writer: ${err.message}`, true)
    } finally {
      setTrigger(key, false)
    }
  }

  async function triggerBoost(slug) {
    setTrigger(slug, true)
    try {
      await callEdgeFunction('seo-performance-tracker', { post_slug: slug })
      flash(`Boosting "${slug}"…`)
    } catch (err) {
      flash(`Boost failed: ${err.message}`, true)
    } finally {
      setTrigger(slug, false)
    }
  }

  async function triggerKeywordFinder() {
    setTrigger('keyword-finder', true)
    try {
      await callEdgeFunction('seo-keyword-finder', { scheduled: true })
      flash('Keyword finder running…')
      await fetchAll()
    } catch (err) {
      flash(`Keyword finder failed: ${err.message}`, true)
    } finally {
      setTrigger('keyword-finder', false)
    }
  }

  async function triggerScheduledWrite() {
    setTrigger('scheduled-write', true)
    try {
      await callEdgeFunction('seo-content-writer', { scheduled: true })
      flash('Content writer triggered…')
      await fetchAll()
    } catch (err) {
      flash(`Writer failed: ${err.message}`, true)
    } finally {
      setTrigger('scheduled-write', false)
    }
  }

  async function triggerPillarBuild(slug) {
    setTrigger(`pillar-${slug}`, true)
    try {
      await callEdgeFunction('seo-pillar-builder', { pillar_slug: slug })
      flash(`Building pillar "${slug}"…`)
      await fetchAll()
    } catch (err) {
      flash(`Pillar build failed: ${err.message}`, true)
    } finally {
      setTrigger(`pillar-${slug}`, false)
    }
  }

  async function approvePost(id) {
    setTrigger(`approve-${id}`, true)
    try {
      const { error } = await supabase.from('seo_posts').update({ status: 'approved' }).eq('id', id)
      if (error) throw error
      flash('Post approved.')
      await fetchAll()
    } catch (err) {
      flash(`Approve failed: ${err.message}`, true)
    } finally {
      setTrigger(`approve-${id}`, false)
    }
  }

  async function deletePost(id) {
    if (!window.confirm('Delete this post permanently?')) return
    setTrigger(`delete-${id}`, true)
    try {
      const { error } = await supabase.from('seo_posts').delete().eq('id', id)
      if (error) throw error
      flash('Post deleted.')
      await fetchAll()
    } catch (err) {
      flash(`Delete failed: ${err.message}`, true)
    } finally {
      setTrigger(`delete-${id}`, false)
    }
  }

  async function skipKeyword(id) {
    setTrigger(`skip-${id}`, true)
    try {
      const { error } = await supabase.from('seo_keyword_queue').update({ status: 'rejected' }).eq('id', id)
      if (error) throw error
      setKeywords(prev => prev.filter(k => k.id !== id))
    } catch (err) {
      flash(`Skip failed: ${err.message}`, true)
    } finally {
      setTrigger(`skip-${id}`, false)
    }
  }

  // ── Posts table sorting ────────────────────────────────────────────────────

  function sortedPosts() {
    const copy = [...allPosts]
    if (postsSort === 'date') copy.sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0))
    else if (postsSort === 'impressions') copy.sort((a, b) => (b.google_impressions || 0) - (a.google_impressions || 0))
    else if (postsSort === 'position') copy.sort((a, b) => (a.google_position || 999) - (b.google_position || 999))
    else if (postsSort === 'quality') copy.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))
    return copy
  }

  const PAGE_SIZE = 20
  const pagedPosts = sortedPosts().slice(postsPage * PAGE_SIZE, (postsPage + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(allPosts.length / PAGE_SIZE)

  // ── Stats derived ─────────────────────────────────────────────────────────

  const thisMonthPosts = allPosts.filter(p => {
    if (!p.published_at) return false
    const d = new Date(p.published_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  const totalPublished = allPosts.filter(p => p.status === 'published').length

  // ─────────────────────────────────────────────────────────────────────────
  // TAB: Overview
  // ─────────────────────────────────────────────────────────────────────────

  function OverviewTab() {
    const todayPost = recentPosts[0] || null

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Stat Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <StatCard
                label="Total Published"
                value={totalPublished}
                sub="live posts"
                color="#22c55e"
              />
              <StatCard
                label="This Month"
                value={thisMonthPosts}
                sub="new posts"
                color="#4a9eff"
              />
              <StatCard
                label="Impressions"
                value={fmtNum(stats?.total_impressions)}
                sub={stats?.snapshot_date ? fmtDate(stats.snapshot_date) : 'last snapshot'}
              />
              <StatCard
                label="Clicks"
                value={fmtNum(stats?.total_clicks)}
                sub="organic"
              />
              <StatCard
                label="Avg Position"
                value={stats?.avg_position ? stats.avg_position.toFixed(1) : '—'}
                sub="lower is better"
                color={posColor(stats?.avg_position)}
              />
              <StatCard
                label="Top 10 Rankings"
                value={stats?.top_10_count ?? '—'}
                sub="keywords in top 10"
                color="#4a9eff"
              />
              <StatCard
                label="Location Pages"
                value={`${locationPages.filter(p => p.status === 'published').length}/50`}
                sub="cities published"
                color="#a78bfa"
              />
              <StatCard
                label="VS Pages"
                value={`${vsPages.filter(p => p.status === 'published').length}/6`}
                sub="comparisons live"
                color="#f59e0b"
              />
              <StatCard
                label="Competitor Gaps"
                value={competitorGaps.length}
                sub="uncovered topics"
                color="#ef4444"
              />
              <StatCard
                label="Questions Queued"
                value={questions.length}
                sub="from AlsoAsked"
                color="#22c55e"
              />
              <StatCard
                label="Free Tools"
                value={`${tools.filter(t => t.status === 'published').length}/${tools.length}`}
                sub="tools live"
                color="#4a9eff"
              />
            </>
          )}
        </div>

        {/* Needs Review */}
        <div>
          <SectionTitle>
            Needs Review
            {needsReview.length > 0 && (
              <Chip label={`${needsReview.length} pending`} scheme={STATUS_COLORS.needs_review} />
            )}
          </SectionTitle>
          {loading ? (
            <SkeletonCard />
          ) : needsReview.length === 0 ? (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#22c55e' }}>
                <span style={{ fontSize: 20 }}>✓</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>All posts cleared — nothing needs review</span>
              </div>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {needsReview.map(post => {
                const details = (() => {
                  if (!post.quality_details) return null
                  if (typeof post.quality_details === 'string') {
                    try { return JSON.parse(post.quality_details) } catch { return null }
                  }
                  return post.quality_details
                })()

                return (
                  <Card key={post.id} redBorder>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
                            {post.title || '(Untitled)'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {post.keyword && (
                              <Chip label={post.keyword} scheme={{ bg: 'rgba(74,158,255,0.1)', color: '#4a9eff' }} />
                            )}
                            {post.quality_score != null && (
                              <span style={{ fontSize: 12, color: '#9ca3af' }}>
                                Quality: <span style={{ color: post.quality_score >= 5 ? '#22c55e' : '#f59e0b', fontWeight: 700 }}>
                                  {post.quality_score}/7
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          <BtnPrimary
                            onClick={() => approvePost(post.id)}
                            disabled={triggering[`approve-${post.id}`]}
                          >
                            {triggering[`approve-${post.id}`] ? '…' : 'Approve'}
                          </BtnPrimary>
                          <BtnDanger
                            onClick={() => deletePost(post.id)}
                            disabled={triggering[`delete-${post.id}`]}
                          >
                            {triggering[`delete-${post.id}`] ? '…' : 'Delete'}
                          </BtnDanger>
                        </div>
                      </div>

                      {details && typeof details === 'object' && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {Object.entries(details).map(([check, passed]) => (
                            <div
                              key={check}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                fontSize: 12,
                                color: passed ? '#22c55e' : '#ef4444',
                              }}
                            >
                              <span>{passed ? '✓' : '✗'}</span>
                              <span>{check.replace(/_/g, ' ')}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{ fontSize: 11, color: '#4b5563' }}>{fmtDate(post.created_at)}</div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Today's Post */}
        <div>
          <SectionTitle>Today's Post</SectionTitle>
          {loading ? (
            <SkeletonCard />
          ) : !todayPost ? (
            <Card blueBorder>
              <EmptyState icon="📝" message="No posts published yet" />
            </Card>
          ) : (
            <Card blueBorder>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
                    {todayPost.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {todayPost.keyword && (
                      <Chip label={todayPost.keyword} scheme={{ bg: 'rgba(74,158,255,0.1)', color: '#4a9eff' }} />
                    )}
                    <StatusChip status={todayPost.status} />
                    {todayPost.quality_score != null && (
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>
                        Score <span style={{ fontWeight: 700, color: todayPost.quality_score >= 5 ? '#22c55e' : '#f59e0b' }}>
                          {todayPost.quality_score}/7
                        </span>
                      </span>
                    )}
                    {todayPost.word_count && (
                      <span style={{ fontSize: 12, color: '#6b7280' }}>{todayPost.word_count.toLocaleString()} words</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#4b5563' }}>Published {fmtDate(todayPost.published_at)}</div>
                </div>
                {todayPost.slug && (
                  <a
                    href={`https://roofingos.dev/blog/${todayPost.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: 'transparent',
                      color: '#4a9eff',
                      border: '1px solid #374151',
                      borderRadius: 8,
                      padding: '8px 16px',
                      fontSize: 13,
                      textDecoration: 'none',
                      flexShrink: 0,
                    }}
                  >
                    Preview ↗
                  </a>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Ranking Opportunities */}
        <div>
          <SectionTitle>Ranking Opportunities (Position 4–15)</SectionTitle>
          <Card>
            {loading ? (
              <SkeletonCard />
            ) : opportunities.length === 0 ? (
              <EmptyState icon="📊" message="No ranking opportunities found — need more posts with GSC data" />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <TableHeader cols={[
                  { label: 'Title' },
                  { label: 'Keyword' },
                  { label: 'Position', right: true },
                  { label: 'Impressions', right: true },
                  { label: 'Clicks', right: true },
                  { label: 'Action' },
                ]} />
                <tbody>
                  {opportunities.map(post => (
                    <tr key={post.id} style={{ borderBottom: '1px solid #111827' }}>
                      <td style={{ padding: '12px', fontSize: 14, color: '#d1d5db', maxWidth: 280 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {post.title}
                        </div>
                      </td>
                      <td style={{ padding: '12px', fontSize: 13 }}>
                        {post.keyword && (
                          <Chip label={post.keyword} scheme={{ bg: 'rgba(74,158,255,0.08)', color: '#4a9eff' }} />
                        )}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, fontWeight: 700, color: posColor(post.google_position) }}>
                        {post.google_position ? `#${post.google_position}` : '—'}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#d1d5db' }}>
                        {fmtNum(post.google_impressions)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#d1d5db' }}>
                        {fmtNum(post.google_clicks)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <BtnGhost
                          onClick={() => triggerBoost(post.slug)}
                          disabled={triggering[post.slug]}
                        >
                          {triggering[post.slug] ? '…' : 'Boost →'}
                        </BtnGhost>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* Pillars Overview */}
        <div>
          <SectionTitle>Pillar Pages</SectionTitle>
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : pillars.length === 0 ? (
            <Card>
              <EmptyState icon="🏛️" message="No pillar pages yet" />
            </Card>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {pillars.map(pillar => (
                <Card key={pillar.id}>
                  <div style={{ marginBottom: 8 }}>
                    <StatusChip status={pillar.status} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 6, lineHeight: 1.3 }}>
                    {pillar.title || pillar.keyword || '(Untitled)'}
                  </div>
                  {pillar.word_count && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
                      {pillar.word_count.toLocaleString()} words
                    </div>
                  )}
                  {pillar.status === 'draft' && pillar.slug && (
                    <BtnPrimary
                      onClick={() => triggerPillarBuild(pillar.slug)}
                      disabled={triggering[`pillar-${pillar.slug}`]}
                      style={{ width: '100%', textAlign: 'center' }}
                    >
                      {triggering[`pillar-${pillar.slug}`] ? 'Building…' : 'Build →'}
                    </BtnPrimary>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB: Posts
  // ─────────────────────────────────────────────────────────────────────────

  function PostsTab() {
    const sortOptions = [
      { value: 'date',        label: 'Date' },
      { value: 'impressions', label: 'Impressions' },
      { value: 'position',    label: 'Position' },
      { value: 'quality',     label: 'Quality' },
    ]

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: 14, color: '#6b7280' }}>{allPosts.length} posts total</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Sort:</span>
            {sortOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setPostsSort(opt.value); setPostsPage(0) }}
                style={{
                  background: postsSort === opt.value ? '#4a9eff' : 'transparent',
                  color: postsSort === opt.value ? '#fff' : '#9ca3af',
                  border: `1px solid ${postsSort === opt.value ? '#4a9eff' : '#374151'}`,
                  borderRadius: 6,
                  padding: '5px 10px',
                  fontSize: 12,
                  fontWeight: postsSort === opt.value ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 24 }}><SkeletonCard /></div>
          ) : allPosts.length === 0 ? (
            <EmptyState icon="📄" message="No posts found" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <TableHeader cols={[
                  { label: 'Title' },
                  { label: 'Status' },
                  { label: 'Published' },
                  { label: 'Impr', right: true },
                  { label: 'Clicks', right: true },
                  { label: 'Pos', right: true },
                  { label: 'Score', right: true },
                  { label: '' },
                ]} />
                <tbody>
                  {pagedPosts.map(post => (
                    <tr
                      key={post.id}
                      style={{ borderBottom: '1px solid #1a2235' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#131b2c'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 12px', maxWidth: 300 }}>
                        <div style={{ fontSize: 13, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {post.title || '(Untitled)'}
                        </div>
                        {post.slug && (
                          <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>{post.slug}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <StatusChip status={post.status} />
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                        {fmtDate(post.published_at)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: '#d1d5db' }}>
                        {fmtNum(post.google_impressions)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: '#d1d5db' }}>
                        {fmtNum(post.google_clicks)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: posColor(post.google_position) }}>
                        {post.google_position ? `#${post.google_position}` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: post.quality_score >= 5 ? '#22c55e' : post.quality_score ? '#f59e0b' : '#6b7280' }}>
                        {post.quality_score != null ? `${post.quality_score}/7` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {post.slug && (
                          <a
                            href={`https://roofingos.dev/blog/${post.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: 12,
                              color: '#4a9eff',
                              textDecoration: 'none',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Preview ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 16 }}>
            <BtnGhost onClick={() => setPostsPage(p => Math.max(0, p - 1))} disabled={postsPage === 0}>
              ← Prev
            </BtnGhost>
            <span style={{ fontSize: 13, color: '#9ca3af' }}>
              Page {postsPage + 1} of {totalPages}
            </span>
            <BtnGhost onClick={() => setPostsPage(p => Math.min(totalPages - 1, p + 1))} disabled={postsPage === totalPages - 1}>
              Next →
            </BtnGhost>
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB: Keywords
  // ─────────────────────────────────────────────────────────────────────────

  function KeywordsTab() {
    return (
      <div>
        <SectionTitle>
          Keyword Queue
          <Chip label={`${keywords.length} pending`} scheme={{ bg: 'rgba(74,158,255,0.15)', color: '#4a9eff' }} />
        </SectionTitle>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 24 }}><SkeletonCard /></div>
          ) : keywords.length === 0 ? (
            <EmptyState icon="🔑" message="No pending keywords — run keyword finder to populate queue" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <TableHeader cols={[
                  { label: 'Keyword' },
                  { label: 'Intent Score', right: true },
                  { label: 'Volume', right: true },
                  { label: 'Source' },
                  { label: 'Actions' },
                ]} />
                <tbody>
                  {keywords.map(kw => {
                    const srcKey = getSourceKey(kw.source)
                    const srcScheme = srcKey ? SOURCE_COLORS[srcKey] : { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' }
                    return (
                      <tr
                        key={kw.id}
                        style={{ borderBottom: '1px solid #1a2235' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#131b2c'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '12px' }}>
                          <div style={{ fontSize: 14, color: '#d1d5db', fontWeight: 500 }}>{kw.keyword}</div>
                          {kw.notes && (
                            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>{kw.notes}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <span style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: kw.intent_score >= 80 ? '#22c55e' : kw.intent_score >= 50 ? '#f59e0b' : '#9ca3af',
                          }}>
                            {kw.intent_score ?? '—'}
                          </span>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right', fontSize: 13, color: '#9ca3af' }}>
                          {fmtNum(kw.search_volume)}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <Chip label={kw.source?.replace(/_/g, ' ') || 'unknown'} scheme={srcScheme} />
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <BtnPrimary
                              onClick={() => triggerWriter(kw.keyword, `kw-${kw.id}`)}
                              disabled={triggering[`kw-${kw.id}`]}
                            >
                              {triggering[`kw-${kw.id}`] ? 'Writing…' : 'Write Now'}
                            </BtnPrimary>
                            <BtnGhost
                              onClick={() => skipKeyword(kw.id)}
                              disabled={triggering[`skip-${kw.id}`]}
                            >
                              {triggering[`skip-${kw.id}`] ? '…' : 'Skip'}
                            </BtnGhost>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB: Competitors
  // ─────────────────────────────────────────────────────────────────────────

  function CompetitorsTab() {
    // Determine if a counter post exists in allPosts for a given keyword
    function hasCounterPost(keyword) {
      if (!keyword) return false
      return allPosts.some(p =>
        p.keyword?.toLowerCase() === keyword.toLowerCase() && p.status === 'published'
      )
    }

    return (
      <div>
        <SectionTitle>
          Competitor Content Intel
          <Chip
            label={`${competitorPosts.length} tracked`}
            scheme={{ bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
          />
        </SectionTitle>

        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 24 }}><SkeletonCard /></div>
          ) : competitorPosts.length === 0 ? (
            <EmptyState icon="🕵️" message="No competitor content tracked yet" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <TableHeader cols={[
                  { label: 'Competitor' },
                  { label: 'Their Title' },
                  { label: 'Keyword' },
                  { label: 'Counter?' },
                  { label: 'Discovered' },
                  { label: 'Action' },
                ]} />
                <tbody>
                  {competitorPosts.map(cp => {
                    const cKey = getCompetitorKey(cp.competitor || cp.source || cp.domain)
                    const cScheme = cKey ? COMPETITOR_COLORS[cKey] : { bg: 'rgba(107,114,128,0.15)', color: '#9ca3af' }
                    const competitorName = cp.competitor || cp.source || cp.domain || 'Unknown'
                    const counterExists = hasCounterPost(cp.keyword)

                    return (
                      <tr
                        key={cp.id}
                        style={{ borderBottom: '1px solid #1a2235' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#131b2c'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                          <Chip label={competitorName} scheme={cScheme} />
                        </td>
                        <td style={{ padding: '12px', maxWidth: 260 }}>
                          <div style={{ fontSize: 13, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cp.title || '—'}
                          </div>
                          {cp.url && (
                            <a
                              href={cp.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: 11, color: '#4b5563', textDecoration: 'none' }}
                            >
                              {cp.url.length > 40 ? cp.url.slice(0, 40) + '…' : cp.url}
                            </a>
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {cp.keyword && (
                            <Chip label={cp.keyword} scheme={{ bg: 'rgba(74,158,255,0.08)', color: '#4a9eff' }} />
                          )}
                        </td>
                        <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                          {counterExists ? (
                            <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Published</span>
                          ) : (
                            <span style={{ fontSize: 12, color: '#4b5563' }}>Not yet</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                          {fmtDate(cp.discovered_at)}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {!counterExists && cp.keyword && (
                            <BtnPrimary
                              onClick={() => triggerWriter(cp.keyword, `comp-${cp.id}`)}
                              disabled={triggering[`comp-${cp.id}`]}
                            >
                              {triggering[`comp-${cp.id}`] ? 'Writing…' : 'Write Counter'}
                            </BtnPrimary>
                          )}
                          {counterExists && (
                            <span style={{ fontSize: 12, color: '#4b5563' }}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB: Pillars
  // ─────────────────────────────────────────────────────────────────────────

  function PillarsTab() {
    return (
      <div>
        <SectionTitle>
          Pillar Pages
          <span style={{ fontSize: 13, color: '#6b7280' }}>Long-form authority content</span>
        </SectionTitle>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : pillars.length === 0 ? (
          <Card>
            <EmptyState icon="🏛️" message="No pillar pages yet. Pillar pages are seeded in the seo_pillars table." />
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
            {pillars.map(pillar => (
              <Card key={pillar.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <StatusChip status={pillar.status || 'draft'} />
                  {pillar.google_position && (
                    <span style={{ fontSize: 12, color: posColor(pillar.google_position), fontWeight: 700 }}>
                      #{pillar.google_position}
                    </span>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 4, lineHeight: 1.3 }}>
                    {pillar.title || '(Untitled)'}
                  </div>
                  {pillar.keyword && (
                    <Chip
                      label={pillar.keyword}
                      scheme={{ bg: 'rgba(74,158,255,0.1)', color: '#4a9eff' }}
                    />
                  )}
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {pillar.word_count && (
                    <div>
                      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Words</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#d1d5db' }}>{pillar.word_count.toLocaleString()}</div>
                    </div>
                  )}
                  {pillar.google_impressions != null && (
                    <div>
                      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Impr</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#d1d5db' }}>{fmtNum(pillar.google_impressions)}</div>
                    </div>
                  )}
                  {pillar.google_clicks != null && (
                    <div>
                      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clicks</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#d1d5db' }}>{fmtNum(pillar.google_clicks)}</div>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 12, color: '#4b5563' }}>Created {fmtDate(pillar.created_at)}</div>

                <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
                  {(!pillar.status || pillar.status === 'draft') && pillar.slug && (
                    <BtnPrimary
                      onClick={() => triggerPillarBuild(pillar.slug)}
                      disabled={triggering[`pillar-${pillar.slug}`]}
                      style={{ flex: 1, textAlign: 'center' }}
                    >
                      {triggering[`pillar-${pillar.slug}`] ? 'Building…' : 'Build Pillar →'}
                    </BtnPrimary>
                  )}
                  {pillar.status === 'published' && pillar.slug && (
                    <a
                      href={`https://roofingos.dev/blog/${pillar.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        flex: 1,
                        display: 'block',
                        textAlign: 'center',
                        background: 'transparent',
                        color: '#4a9eff',
                        border: '1px solid #374151',
                        borderRadius: 8,
                        padding: '8px 16px',
                        fontSize: 13,
                        textDecoration: 'none',
                        fontWeight: 500,
                      }}
                    >
                      View Live →
                    </a>
                  )}
                  {pillar.status === 'approved' && pillar.slug && (
                    <BtnGhost
                      onClick={() => triggerPillarBuild(pillar.slug)}
                      disabled={triggering[`pillar-${pillar.slug}`]}
                    >
                      {triggering[`pillar-${pillar.slug}`] ? 'Publishing…' : 'Publish →'}
                    </BtnGhost>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TAB: Content Map
  // ─────────────────────────────────────────────────────────────────────────

  function ContentMapTab() {
    const [buildingLocation, setBuildingLocation] = useState(null)
    const [buildingVs, setBuildingVs]             = useState(null)
    const [buildingQuestion, setBuildingQuestion] = useState(null)

    const locationPublished  = locationPages.filter(p => p.status === 'published')
    const locationPending    = locationPages.filter(p => p.status === 'pending')
    const vsPublished        = vsPages.filter(p => p.status === 'published')
    const vsPending          = vsPages.filter(p => p.status === 'pending')

    const HAIL_COLORS = {
      high:   { bg: 'rgba(239,68,68,.15)',    color: '#f87171' },
      medium: { bg: 'rgba(245,158,11,.15)',   color: '#fbbf24' },
      low:    { bg: 'rgba(100,116,139,.15)',  color: '#94a3b8' },
    }

    const COMP_DISPLAY = {
      companycam:  'CompanyCam',
      jobnimbus:   'JobNimbus',
      acculynx:    'AccuLynx',
      salesrabbit: 'SalesRabbit',
      eagleview:   'EagleView',
      hover:       'Hover',
    }

    async function triggerLocationBuild(slug) {
      setBuildingLocation(slug)
      try {
        // Trigger via content-writer edge function as a keyword
        await callEdgeFunction('seo-content-writer', { keyword: `roofing software ${slug.replace('roofing-software-', '').replace(/-/g, ' ')}`, location_slug: slug })
        flash(`Building location page: ${slug}`)
        await fetchAll()
      } catch (err) {
        flash(`Failed: ${err.message}`, true)
      } finally {
        setBuildingLocation(null)
      }
    }

    async function triggerVsBuild(slug) {
      setBuildingVs(slug)
      try {
        await callEdgeFunction('seo-content-writer', { keyword: `roofing os vs ${slug.replace('roofing-os-vs-', '').replace(/-/g, ' ')}`, vs_slug: slug })
        flash(`Building VS page: ${slug}`)
        await fetchAll()
      } catch (err) {
        flash(`Failed: ${err.message}`, true)
      } finally {
        setBuildingVs(null)
      }
    }

    async function triggerQuestionWrite(q) {
      setBuildingQuestion(q.id)
      try {
        await callEdgeFunction('seo-content-writer', { keyword: q.question })
        flash(`Writing post for: "${q.question}"`)
        await fetchAll()
      } catch (err) {
        flash(`Failed: ${err.message}`, true)
      } finally {
        setBuildingQuestion(null)
      }
    }

    async function triggerCompetitorGap(gap) {
      setTrigger(`gap-${gap.id}`, true)
      try {
        await callEdgeFunction('seo-content-writer', { keyword: gap.keyword })
        flash(`Writing counter: "${gap.keyword}"`)
        await fetchAll()
      } catch (err) {
        flash(`Failed: ${err.message}`, true)
      } finally {
        setTrigger(`gap-${gap.id}`, false)
      }
    }

    async function runCompetitorHunter() {
      setTrigger('comp-hunter', true)
      try {
        await callEdgeFunction('seo-competitor-hunter', { scheduled: true })
        flash('Competitor hunter running — scanning all sitemaps…')
        setTimeout(fetchAll, 5000)
      } catch (err) {
        flash(`Failed: ${err.message}`, true)
      } finally {
        setTrigger('comp-hunter', false)
      }
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* ─── Location Pages ─────────────────────────────── */}
        <div>
          <SectionTitle>
            Location Pages
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Chip
                label={`${locationPublished.length}/50 live`}
                scheme={{ bg: 'rgba(167,139,250,.15)', color: '#a78bfa' }}
              />
              <a
                href="https://roofingos.dev/locations/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#4b5563', textDecoration: 'none' }}
              >
                View index ↗
              </a>
            </div>
          </SectionTitle>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 8,
          }}>
            {locationPages.map(page => {
              const hailScheme = HAIL_COLORS[page.hail_risk] || HAIL_COLORS.low
              const isPublished = page.status === 'published'
              return (
                <div
                  key={page.id}
                  style={{
                    background: isPublished ? 'rgba(34,197,94,.05)' : '#111827',
                    border: `1px solid ${isPublished ? 'rgba(34,197,94,.3)' : '#1e293b'}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: isPublished ? '#d1fae5' : '#d1d5db' }}>
                      {page.city}
                    </span>
                    <span style={{ fontSize: 10, color: '#6b7280' }}>{page.state_code}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Chip label={page.hail_risk} scheme={hailScheme} style={{ fontSize: 9 }} />
                    {isPublished
                      ? <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>✓ Live</span>
                      : <button
                          onClick={() => triggerLocationBuild(page.slug)}
                          disabled={buildingLocation === page.slug}
                          style={{
                            background: 'transparent',
                            color: '#3b82f6',
                            border: '1px solid #1e3a5f',
                            borderRadius: 5,
                            padding: '2px 7px',
                            fontSize: 10,
                            cursor: 'pointer',
                          }}
                        >
                          {buildingLocation === page.slug ? '…' : 'Build'}
                        </button>
                    }
                  </div>
                  {page.google_impressions > 0 && (
                    <span style={{ fontSize: 10, color: '#6b7280' }}>{fmtNum(page.google_impressions)} impr</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ─── VS Pages ───────────────────────────────────── */}
        <div>
          <SectionTitle>
            VS Comparison Pages
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Chip
                label={`${vsPublished.length}/6 live`}
                scheme={{ bg: 'rgba(245,158,11,.15)', color: '#f59e0b' }}
              />
              <a
                href="https://roofingos.dev/vs/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#4b5563', textDecoration: 'none' }}
              >
                View index ↗
              </a>
            </div>
          </SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {vsPages.map(page => {
              const isPublished = page.status === 'published'
              const display = COMP_DISPLAY[page.competitor] || page.competitor
              return (
                <Card key={page.id} style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>
                      vs {display}
                    </div>
                    {isPublished
                      ? <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700 }}>✓ Live</span>
                      : <Chip label="pending" scheme={STATUS_COLORS.pending} />
                    }
                  </div>
                  <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 12 }}>{page.slug}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {isPublished
                      ? <>
                          <a
                            href={`https://roofingos.dev/vs/${page.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 12, color: '#4a9eff' }}
                          >
                            View ↗
                          </a>
                          {page.google_impressions > 0 && (
                            <span style={{ fontSize: 11, color: '#6b7280' }}>{fmtNum(page.google_impressions)} impr</span>
                          )}
                        </>
                      : <BtnPrimary
                          onClick={() => triggerVsBuild(page.slug)}
                          disabled={buildingVs === page.slug}
                          style={{ padding: '6px 14px', fontSize: 12 }}
                        >
                          {buildingVs === page.slug ? 'Writing…' : 'Build Now →'}
                        </BtnPrimary>
                    }
                  </div>
                </Card>
              )
            })}
          </div>
        </div>

        {/* ─── Free Tools ─────────────────────────────────── */}
        <div>
          <SectionTitle>
            Free Tools
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Chip
                label={`${tools.filter(t => t.status === 'published').length}/${tools.length} live`}
                scheme={{ bg: 'rgba(74,158,255,.15)', color: '#4a9eff' }}
              />
              <a
                href="https://roofingos.dev/tools/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#4b5563', textDecoration: 'none' }}
              >
                View index ↗
              </a>
            </div>
          </SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <TableHeader cols={[
                { label: 'Tool' },
                { label: 'Type' },
                { label: 'Status' },
                { label: 'Visits/mo', right: true },
                { label: '' },
              ]} />
              <tbody>
                {tools.map(tool => (
                  <tr key={tool.id} style={{ borderBottom: '1px solid #1a2235' }}>
                    <td style={{ padding: '12px', fontSize: 14, color: '#d1d5db', fontWeight: 500 }}>{tool.name}</td>
                    <td style={{ padding: '12px' }}>
                      <Chip
                        label={tool.tool_type || 'tool'}
                        scheme={{ bg: 'rgba(74,158,255,.1)', color: '#4a9eff' }}
                      />
                    </td>
                    <td style={{ padding: '12px' }}>
                      <StatusChip status={tool.status} />
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', fontSize: 13, color: '#9ca3af' }}>
                      {tool.monthly_visits > 0 ? fmtNum(tool.monthly_visits) : '—'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {tool.status === 'published' && (
                        <a
                          href={`https://roofingos.dev/tools/${tool.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 12, color: '#4a9eff' }}
                        >
                          View ↗
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        {/* ─── Competitor Gaps ─────────────────────────────── */}
        <div>
          <SectionTitle>
            Competitor Gaps
            <div style={{ display: 'flex', gap: 8 }}>
              <Chip label={`${competitorGaps.length} uncovered`} scheme={{ bg: 'rgba(239,68,68,.15)', color: '#ef4444' }} />
              <BtnGhost
                onClick={runCompetitorHunter}
                disabled={triggering['comp-hunter']}
              >
                {triggering['comp-hunter'] ? 'Scanning…' : '🕵️ Scan Sitemaps'}
              </BtnGhost>
            </div>
          </SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {competitorGaps.length === 0 ? (
              <EmptyState icon="✓" message="No uncovered gaps found yet — run sitemap scanner to discover gaps" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <TableHeader cols={[
                    { label: 'Competitor' },
                    { label: 'Their URL / Keyword' },
                    { label: 'Priority', right: true },
                    { label: 'Found' },
                    { label: 'Action' },
                  ]} />
                  <tbody>
                    {competitorGaps.map(gap => {
                      const cKey = gap.competitor?.toLowerCase()
                      const cScheme = COMPETITOR_COLORS[cKey] || { bg: 'rgba(107,114,128,.15)', color: '#9ca3af' }
                      return (
                        <tr
                          key={gap.id}
                          style={{ borderBottom: '1px solid #1a2235' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#131b2c'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                            <Chip label={gap.competitor} scheme={cScheme} />
                          </td>
                          <td style={{ padding: '10px 12px', maxWidth: 320 }}>
                            <div style={{ fontSize: 13, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {gap.keyword || '(no keyword)'}
                            </div>
                            {gap.url && (
                              <a
                                href={gap.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 10, color: '#4b5563' }}
                              >
                                {gap.url.length > 50 ? gap.url.slice(0, 50) + '…' : gap.url}
                              </a>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                            <span style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: gap.priority_score >= 10 ? '#ef4444' : gap.priority_score >= 7 ? '#f59e0b' : '#6b7280',
                            }}>
                              {gap.priority_score}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                            {fmtDate(gap.discovered_at)}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {gap.keyword && (
                              <BtnPrimary
                                onClick={() => triggerCompetitorGap(gap)}
                                disabled={triggering[`gap-${gap.id}`]}
                                style={{ padding: '6px 12px', fontSize: 12 }}
                              >
                                {triggering[`gap-${gap.id}`] ? 'Writing…' : 'Write Counter'}
                              </BtnPrimary>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* ─── Questions Queue ─────────────────────────────── */}
        <div>
          <SectionTitle>
            Questions Queue
            <Chip label={`${questions.length} pending`} scheme={{ bg: 'rgba(34,197,94,.15)', color: '#22c55e' }} />
          </SectionTitle>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {questions.length === 0 ? (
              <EmptyState icon="❓" message="No questions queued — questions are fetched nightly via Google Autocomplete" />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <TableHeader cols={[
                    { label: 'Question' },
                    { label: 'Audience' },
                    { label: 'Score', right: true },
                    { label: 'Seed' },
                    { label: 'Action' },
                  ]} />
                  <tbody>
                    {questions.map(q => (
                      <tr
                        key={q.id}
                        style={{ borderBottom: '1px solid #1a2235' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#131b2c'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '10px 12px', maxWidth: 340 }}>
                          <div style={{ fontSize: 13, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {q.question}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <Chip
                            label={q.audience}
                            scheme={
                              q.audience === 'homeowner'
                                ? { bg: 'rgba(34,197,94,.12)', color: '#22c55e' }
                                : q.audience === 'adjuster'
                                ? { bg: 'rgba(245,158,11,.12)', color: '#f59e0b' }
                                : { bg: 'rgba(74,158,255,.12)', color: '#4a9eff' }
                            }
                          />
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: q.intent_score >= 12 ? '#22c55e' : '#9ca3af' }}>
                          {q.intent_score}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: '#6b7280' }}>
                          {q.seed_keyword}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <BtnPrimary
                            onClick={() => triggerQuestionWrite(q)}
                            disabled={buildingQuestion === q.id}
                            style={{ padding: '6px 12px', fontSize: 12 }}
                          >
                            {buildingQuestion === q.id ? 'Writing…' : 'Write Now'}
                          </BtnPrimary>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

      </div>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TABS CONFIG
  // ─────────────────────────────────────────────────────────────────────────

  const TABS = [
    { id: 'overview',    label: 'Overview',      badge: needsReview.length > 0 ? needsReview.length : null },
    { id: 'content-map', label: 'Content Map',   badge: competitorGaps.length > 0 ? competitorGaps.length : null },
    { id: 'posts',       label: 'Posts',         badge: allPosts.length || null },
    { id: 'keywords',    label: 'Keywords',      badge: keywords.length || null },
    { id: 'competitors', label: 'Competitors',   badge: null },
    { id: 'pillars',     label: 'Pillars',       badge: pillars.length || null },
  ]

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0f1a',
      color: '#fff',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* Sticky Header */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(10,15,26,0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #1f2937',
        padding: '0 24px',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', height: 60, display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Back */}
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'transparent',
              color: '#9ca3af',
              border: 'none',
              fontSize: 13,
              cursor: 'pointer',
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            ← Nexus
          </button>

          {/* Logo + Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'linear-gradient(135deg, #4a9eff, #22c55e)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              flexShrink: 0,
            }}>
              📈
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>SEO Machine</div>
              <div style={{ fontSize: 11, color: '#4b5563', lineHeight: 1 }}>RoofingOS</div>
            </div>
          </div>

          {/* Header Actions */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <BtnGhost
              onClick={triggerKeywordFinder}
              disabled={triggering['keyword-finder']}
            >
              {triggering['keyword-finder'] ? 'Running…' : '🔍 Run Keywords'}
            </BtnGhost>
            <BtnPrimary
              onClick={triggerScheduledWrite}
              disabled={triggering['scheduled-write']}
            >
              {triggering['scheduled-write'] ? 'Writing…' : '✍️ Write Post'}
            </BtnPrimary>
          </div>
        </div>
      </div>

      {/* Tab Nav */}
      <div style={{
        background: '#0a0f1a',
        borderBottom: '1px solid #1f2937',
        padding: '0 24px',
        overflowX: 'auto',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', gap: 4, paddingTop: 8, paddingBottom: 0 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: activeTab === tab.id ? 'rgba(74,158,255,0.15)' : 'transparent',
                color: activeTab === tab.id ? '#4a9eff' : '#9ca3af',
                border: activeTab === tab.id ? '1px solid rgba(74,158,255,0.3)' : '1px solid transparent',
                borderRadius: '8px 8px 0 0',
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: activeTab === tab.id ? 600 : 400,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                marginBottom: -1,
              }}
            >
              {tab.label}
              {tab.badge != null && (
                <span style={{
                  background: tab.id === 'overview' && needsReview.length > 0
                    ? 'rgba(239,68,68,0.2)'
                    : 'rgba(74,158,255,0.2)',
                  color: tab.id === 'overview' && needsReview.length > 0 ? '#ef4444' : '#4a9eff',
                  borderRadius: 10,
                  padding: '1px 7px',
                  fontSize: 11,
                  fontWeight: 700,
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Toast notification */}
      {actionMsg && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 999,
          background: actionMsg.error ? '#ef4444' : '#22c55e',
          color: '#fff',
          borderRadius: 10,
          padding: '12px 20px',
          fontSize: 14,
          fontWeight: 500,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          maxWidth: 360,
        }}>
          {actionMsg.text}
        </div>
      )}

      {/* Main Content */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 24px' }}>
        {activeTab === 'overview'    && <OverviewTab />}
        {activeTab === 'content-map' && <ContentMapTab />}
        {activeTab === 'posts'       && <PostsTab />}
        {activeTab === 'keywords'    && <KeywordsTab />}
        {activeTab === 'competitors' && <CompetitorsTab />}
        {activeTab === 'pillars'     && <PillarsTab />}
      </div>

      {/* Pulse animation via global style injection */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

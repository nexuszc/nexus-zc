import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const PLATFORM_COLOR = {
  reddit: '#ff4500',
  linkedin: '#0077b5',
  x: '#000000',
}

const STATUS_COLOR = {
  found: '#6b7280',
  draft_ready: '#f59e0b',
  approved: '#3b82f6',
  posted: '#22c55e',
  rejected: '#ef4444',
  pending: '#f59e0b',
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: '#1a1f2e', borderRadius: 10, padding: '14px 18px', minWidth: 100 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function OpportunityCard({ opp, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{
      background: '#1a1f2e',
      borderRadius: 10,
      padding: 16,
      borderLeft: `3px solid ${PLATFORM_COLOR[opp.platform] || '#6b7280'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              background: PLATFORM_COLOR[opp.platform] || '#6b7280',
              color: '#fff',
              padding: '2px 7px',
              borderRadius: 4,
              textTransform: 'uppercase',
            }}>r/{opp.subreddit}</span>
            <span style={{
              fontSize: 10,
              background: STATUS_COLOR[opp.status] || '#6b7280',
              color: '#fff',
              padding: '2px 7px',
              borderRadius: 4,
            }}>{opp.status}</span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>score {opp.score}</span>
          </div>
          <a
            href={opp.thread_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
          >
            {opp.thread_title}
          </a>
          {opp.thread_body && (
            <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
              {opp.thread_body.slice(0, 120)}…
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          {opp.status !== 'approved' && opp.status !== 'posted' && opp.status !== 'rejected' && (
            <>
              <button
                onClick={() => onApprove(opp.id)}
                style={{
                  background: '#22c55e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >Approve</button>
              <button
                onClick={() => onReject(opp.id)}
                style={{
                  background: '#374151',
                  color: '#9ca3af',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >Reject</button>
            </>
          )}
        </div>
      </div>

      {opp.draft_reply && (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: '1px solid #374151',
              color: '#9ca3af',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >{expanded ? 'Hide draft' : 'View draft reply'}</button>
          {expanded && (
            <div style={{
              marginTop: 8,
              background: '#111827',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              color: '#d1d5db',
              lineHeight: 1.6,
              fontStyle: 'italic',
              whiteSpace: 'pre-wrap',
            }}>
              {opp.draft_reply}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QueueCard({ item, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false)
  const scheduled = item.scheduled_for
    ? new Date(item.scheduled_for).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div style={{
      background: '#1a1f2e',
      borderRadius: 10,
      padding: 16,
      borderLeft: `3px solid ${PLATFORM_COLOR[item.platform] || '#6b7280'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              background: PLATFORM_COLOR[item.platform] || '#6b7280',
              color: '#fff',
              padding: '2px 7px',
              borderRadius: 4,
              textTransform: 'uppercase',
            }}>{item.platform}</span>
            <span style={{
              fontSize: 10,
              background: STATUS_COLOR[item.status] || '#6b7280',
              color: '#fff',
              padding: '2px 7px',
              borderRadius: 4,
            }}>{item.status}</span>
            {scheduled && (
              <span style={{ fontSize: 11, color: '#9ca3af' }}>📅 {scheduled}</span>
            )}
          </div>
          {item.post_title && (
            <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>
              From: {item.post_title}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          {item.status === 'pending' && (
            <>
              <button
                onClick={() => onApprove(item.id)}
                style={{
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >Approve</button>
              <button
                onClick={() => onReject(item.id)}
                style={{
                  background: '#374151',
                  color: '#9ca3af',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >Reject</button>
            </>
          )}
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: '1px solid #374151',
          color: '#9ca3af',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 11,
          cursor: 'pointer',
          marginTop: 6,
        }}
      >{expanded ? 'Hide content' : 'View content'}</button>
      {expanded && (
        <div style={{
          marginTop: 8,
          background: '#111827',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 13,
          color: '#d1d5db',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}>
          {item.content}
        </div>
      )}
    </div>
  )
}

export default function RoofingSocial() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('reddit')
  const [opportunities, setOpportunities] = useState([])
  const [queue, setQueue] = useState([])
  const [posted, setPosted] = useState([])
  const [loading, setLoading] = useState(true)

  async function loadAll() {
    setLoading(true)
    const [opps, queueItems, postedItems] = await Promise.all([
      supabase
        .from('social_opportunities')
        .select('*')
        .neq('status', 'rejected')
        .order('score', { ascending: false })
        .limit(50),
      supabase
        .from('social_queue')
        .select('*')
        .neq('status', 'posted')
        .neq('status', 'rejected')
        .order('scheduled_for', { ascending: true })
        .limit(50),
      supabase
        .from('social_queue')
        .select('*')
        .eq('status', 'posted')
        .order('posted_at', { ascending: false })
        .limit(20),
    ])
    setOpportunities(opps.data || [])
    setQueue(queueItems.data || [])
    setPosted(postedItems.data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  async function approveOpportunity(id) {
    await supabase.from('social_opportunities').update({ status: 'approved' }).eq('id', id)
    setOpportunities(prev => prev.map(o => o.id === id ? { ...o, status: 'approved' } : o))
  }

  async function rejectOpportunity(id) {
    await supabase.from('social_opportunities').update({ status: 'rejected' }).eq('id', id)
    setOpportunities(prev => prev.filter(o => o.id !== id))
  }

  async function approveQueueItem(id) {
    await supabase.from('social_queue').update({ status: 'approved' }).eq('id', id)
    setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'approved' } : q))
  }

  async function rejectQueueItem(id) {
    await supabase.from('social_queue').update({ status: 'rejected' }).eq('id', id)
    setQueue(prev => prev.filter(q => q.id !== id))
  }

  const redditReady = opportunities.filter(o => o.status === 'draft_ready').length
  const queuePending = queue.filter(q => q.status === 'pending').length
  const queueApproved = queue.filter(q => q.status === 'approved').length
  const postsLive = posted.length

  const TABS = [
    { id: 'reddit', label: `Reddit (${opportunities.length})` },
    { id: 'queue', label: `Post Queue (${queue.length})` },
    { id: 'posted', label: `Posted (${postsLive})` },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1a1f2e', borderBottom: '1px solid #2d3748', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button
          onClick={() => navigate('/roofing/dashboard')}
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14, padding: 0 }}
        >← Nexus</button>
        <span style={{ color: '#4b5563' }}>|</span>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Social Monitoring</span>
      </div>

      <div style={{ padding: '20px 16px', maxWidth: 800, margin: '0 auto' }}>
        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          <StatCard label="Reddit Ready" value={redditReady} color="#ff4500" />
          <StatCard label="Queue Pending" value={queuePending} color="#f59e0b" />
          <StatCard label="Queue Approved" value={queueApproved} color="#3b82f6" />
          <StatCard label="Posts Live" value={postsLive} color="#22c55e" />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 16, background: '#1a1f2e', borderRadius: 8, padding: 4 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1,
                background: tab === t.id ? '#7c3aed' : 'none',
                color: tab === t.id ? '#fff' : '#9ca3af',
                border: 'none',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 13,
                fontWeight: tab === t.id ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >{t.label}</button>
          ))}
        </div>

        {loading && (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>Loading…</div>
        )}

        {/* Reddit Tab */}
        {!loading && tab === 'reddit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {opportunities.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No opportunities yet — cron runs at 8am, 2pm, and 8pm UTC.
              </div>
            ) : (
              opportunities.map(opp => (
                <OpportunityCard
                  key={opp.id}
                  opp={opp}
                  onApprove={approveOpportunity}
                  onReject={rejectOpportunity}
                />
              ))
            )}
          </div>
        )}

        {/* Post Queue Tab */}
        {!loading && tab === 'queue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {queue.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No posts in queue.
              </div>
            ) : (
              queue.map(item => (
                <QueueCard
                  key={item.id}
                  item={item}
                  onApprove={approveQueueItem}
                  onReject={rejectQueueItem}
                />
              ))
            )}
          </div>
        )}

        {/* Posted Tab */}
        {!loading && tab === 'posted' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {posted.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>
                No posts live yet.
              </div>
            ) : (
              posted.map(item => (
                <QueueCard
                  key={item.id}
                  item={item}
                  onApprove={() => {}}
                  onReject={() => {}}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

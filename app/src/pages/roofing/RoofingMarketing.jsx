import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function relativeTime(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function relativeNextSend(dateStr) {
  if (!dateStr) return '—'
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff < 0) return 'Now'
  const hrs = Math.floor(diff / 3600000)
  if (hrs < 24) return hrs === 0 ? 'Soon' : `In ${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

function truncate(str, n) {
  if (!str) return '—'
  return str.length > n ? str.slice(0, n) + '…' : str
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: color || '#ffffff' }}>{value ?? '—'}</p>
      {sub && <p className="text-[11px]" style={{ color: '#6b7a9d' }}>{sub}</p>}
    </div>
  )
}

function Toast({ msg }) {
  if (!msg) return null
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#7c3aed' }}>
      {msg}
    </div>
  )
}

export default function RoofingMarketing() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('email')
  const [toast, setToast] = useState(null)

  const [emailStats, setEmailStats] = useState({ sent: 0, opened: 0, clicked: 0, bounced: 0 })
  const [whoOpened, setWhoOpened] = useState([])
  const [sequences, setSequences] = useState([])

  const [ytStats, setYtStats] = useState({ live: 0, queued: 0, thisWeek: 0 })
  const [ytVideos, setYtVideos] = useState([])
  const [ytQueue, setYtQueue] = useState([])
  const [ytLoading, setYtLoading] = useState(false)

  const [funnelCounts, setFunnelCounts] = useState([])
  const [subjectPerf, setSubjectPerf] = useState([])

  const [contentRows, setContentRows] = useState([])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  const fetchEmailTab = useCallback(async () => {
    const { data: all } = await supabase.from('email_log').select('status, opened_at, clicked_at')
    if (all) {
      const sent = all.filter(r => r.status !== 'bounced').length
      const opened = all.filter(r => r.opened_at).length
      const clicked = all.filter(r => r.clicked_at).length
      const bounced = all.filter(r => r.status === 'bounced').length
      setEmailStats({ sent, opened, clicked, bounced })
    }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { data: logs } = await supabase
      .from('roofing_outreach_log')
      .select('id, prospect_id, subject, first_opened_at, touch_number')
      .eq('opened', true)
      .gt('first_opened_at', todayStart.toISOString())
      .order('first_opened_at', { ascending: false })
      .limit(20)

    if (logs && logs.length > 0) {
      const ids = [...new Set(logs.map(l => l.prospect_id).filter(Boolean))]
      const { data: prospects } = await supabase
        .from('roofing_prospects')
        .select('id, owner_name, company_name, phone')
        .in('id', ids)
      const pMap = {}
      if (prospects) prospects.forEach(p => { pMap[p.id] = p })
      setWhoOpened(logs.map(l => ({ ...l, prospect: pMap[l.prospect_id] || {} })))
    } else {
      setWhoOpened([])
    }

    const { data: seqs } = await supabase
      .from('email_sequences')
      .select('prospect_email, current_touch, status, next_touch_at')
      .eq('status', 'active')
      .eq('unsubscribed', false)
      .limit(20)
    setSequences(seqs || [])
  }, [])

  const fetchYoutubeTab = useCallback(async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    const { count: live } = await supabase
      .from('roofing_content')
      .select('*', { count: 'exact', head: true })
      .not('published_url', 'is', null)
      .ilike('type', '%youtube%')

    const { count: queued } = await supabase
      .from('roofing_content')
      .select('*', { count: 'exact', head: true })
      .eq('youtube_upload_ready', true)
      .is('published_url', null)

    const { count: thisWeek } = await supabase
      .from('roofing_content')
      .select('*', { count: 'exact', head: true })
      .not('published_url', 'is', null)
      .gt('youtube_posted_at', sevenDaysAgo)

    setYtStats({ live: live || 0, queued: queued || 0, thisWeek: thisWeek || 0 })

    const { data: videos } = await supabase
      .from('roofing_content')
      .select('id, title, type, youtube_posted_at, published_url')
      .not('published_url', 'is', null)
      .ilike('type', '%youtube%')
      .order('youtube_posted_at', { ascending: false })
      .limit(20)
    setYtVideos(videos || [])

    const { data: renderQ } = await supabase
      .from('roofing_content')
      .select('id, title, created_at')
      .eq('youtube_upload_ready', true)
      .is('published_url', null)
      .limit(5)
    setYtQueue(renderQ || [])
  }, [])

  const fetchOutreachTab = useCallback(async () => {
    const { data: prospects } = await supabase
      .from('roofing_prospects')
      .select('funnel_stage')
    if (prospects) {
      const counts = {}
      prospects.forEach(p => {
        counts[p.funnel_stage] = (counts[p.funnel_stage] || 0) + 1
      })
      const total = prospects.length
      const stages = ['new_lead', 'contacted', 'interested', 'hot', 'signed_up', 'dead']
      setFunnelCounts(stages.map(s => ({ stage: s, count: counts[s] || 0, total })))
    }

    const { data: subj } = await supabase
      .from('roofing_outreach_log')
      .select('subject, opened')
      .limit(500)
    if (subj) {
      const map = {}
      subj.forEach(r => {
        if (!r.subject) return
        if (!map[r.subject]) map[r.subject] = { sent: 0, opened: 0 }
        map[r.subject].sent++
        if (r.opened) map[r.subject].opened++
      })
      const rows = Object.entries(map)
        .map(([subject, v]) => ({ subject, ...v }))
        .sort((a, b) => b.sent - a.sent)
        .slice(0, 10)
      setSubjectPerf(rows)
    }
  }, [])

  const fetchContentTab = useCallback(async () => {
    const { data } = await supabase
      .from('roofing_content')
      .select('id, title, type, status, created_at, youtube_upload_ready, published_url')
      .or('status.in.(draft,approved),published_url.not.is.null')
      .order('created_at', { ascending: false })
      .limit(30)
    setContentRows(data || [])
  }, [])

  useEffect(() => {
    if (activeTab === 'email') fetchEmailTab()
    if (activeTab === 'youtube') fetchYoutubeTab()
    if (activeTab === 'outreach') fetchOutreachTab()
    if (activeTab === 'content') fetchContentTab()
  }, [activeTab, fetchEmailTab, fetchYoutubeTab, fetchOutreachTab, fetchContentTab])

  const copyPhone = (phone) => {
    if (!phone) return
    navigator.clipboard.writeText(phone).then(() => showToast('Copied!'))
  }

  const forceUpload = async (contentId) => {
    setYtLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || ANON_KEY
      const res = await fetch(`${SUPABASE_URL}/functions/v1/roofing-youtube-uploader`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ force_upload: true, limit: 1, content_id: contentId }),
      })
      if (res.ok) showToast('Upload queued!')
      else showToast('Upload failed')
    } catch {
      showToast('Error')
    } finally {
      setYtLoading(false)
    }
  }

  const updateContentStatus = async (id, status) => {
    await supabase.from('roofing_content').update({ status }).eq('id', id)
    fetchContentTab()
  }

  const tabs = ['email', 'youtube', 'outreach', 'content']
  const tabLabels = { email: 'Email', youtube: 'YouTube', outreach: 'Outreach', content: 'Content' }

  const openRate = emailStats.sent > 0 ? ((emailStats.opened / emailStats.sent) * 100).toFixed(1) : '0.0'
  const clickRate = emailStats.sent > 0 ? ((emailStats.clicked / emailStats.sent) * 100).toFixed(1) : '0.0'
  const openRateColor = parseFloat(openRate) > 20 ? '#22c55e' : parseFloat(openRate) > 10 ? '#f59e0b' : '#ffffff'

  const stageMeta = {
    new_lead: { label: 'New Lead', color: '#4a9eff' },
    contacted: { label: 'Contacted', color: '#f59e0b' },
    interested: { label: 'Interested', color: '#fb923c' },
    hot: { label: 'Hot', color: '#ef4444' },
    signed_up: { label: 'Signed Up', color: '#22c55e' },
    dead: { label: 'Dead', color: '#6b7280' },
  }

  const statusPill = (status) => {
    if (status === 'draft') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(107,114,128,0.2)', color: '#9ca3af' }}>Draft</span>
    if (status === 'approved') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e' }}>Approved</span>
    if (status === 'published') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(74,158,255,0.2)', color: '#4a9eff' }}>Published</span>
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(107,114,128,0.15)', color: '#6b7a9d' }}>{status || '—'}</span>
  }

  return (
    <div className="min-h-screen" style={{ background: '#0a0d1a', color: '#ffffff' }}>
      <Toast msg={toast} />

      <header className="sticky top-0 z-10 flex items-center justify-between px-4" style={{ height: '56px', background: 'rgba(10,13,26,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(74,158,255,0.2)' }}>
        <button onClick={() => navigate('/roofing/dashboard')} className="flex items-center gap-1 text-sm font-medium transition-opacity hover:opacity-70" style={{ color: '#4a9eff' }}>
          ← Roofing OS
        </button>
        <span className="text-sm font-bold tracking-widest uppercase">Marketing</span>
        <div className="w-24" />
      </header>

      <div className="flex border-b" style={{ borderColor: 'rgba(74,158,255,0.15)' }}>
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-5 py-3 text-sm font-medium transition-colors"
            style={{
              color: activeTab === tab ? '#4a9eff' : '#6b7a9d',
              borderBottom: activeTab === tab ? '2px solid #4a9eff' : '2px solid transparent',
              background: 'transparent',
            }}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      <div className="p-4 max-w-7xl mx-auto">
        {activeTab === 'email' && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard label="Total Sent" value={emailStats.sent.toLocaleString()} />
              <StatCard label="Total Opened" value={emailStats.opened.toLocaleString()} />
              <StatCard label="Total Clicked" value={emailStats.clicked.toLocaleString()} />
              <StatCard label="Bounced" value={emailStats.bounced.toLocaleString()} color="#ef4444" />
              <StatCard label="Open Rate" value={openRate + '%'} color={openRateColor} />
              <StatCard label="Click Rate" value={clickRate + '%'} />
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#6b7a9d' }}>Who Opened Today</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(74,158,255,0.15)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(74,158,255,0.05)' }}>
                      {['Company', 'Name', 'Phone', 'Subject', 'Time', ''].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7a9d' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {whoOpened.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-sm" style={{ color: '#6b7a9d' }}>No opens today yet</td></tr>
                    )}
                    {whoOpened.map(row => (
                      <tr key={row.id} className="border-b" style={{ background: '#12172b', borderColor: 'rgba(255,255,255,0.05)' }}>
                        <td className="px-3 py-2.5 font-medium">{row.prospect?.company_name || '—'}</td>
                        <td className="px-3 py-2.5" style={{ color: '#6b7a9d' }}>{row.prospect?.owner_name || '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-xs">{row.prospect?.phone || '—'}</td>
                        <td className="px-3 py-2.5" style={{ color: '#6b7a9d' }}>{truncate(row.subject, 40)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{relativeTime(row.first_opened_at)}</td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => copyPhone(row.prospect?.phone)}
                            className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
                            style={{ background: 'rgba(74,158,255,0.15)', color: '#4a9eff' }}
                          >
                            📞 Call
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#6b7a9d' }}>Active Sequences</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(74,158,255,0.15)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(74,158,255,0.05)' }}>
                      {['Email', 'Step', 'Status', 'Next Send'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7a9d' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sequences.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-sm" style={{ color: '#6b7a9d' }}>No active sequences</td></tr>
                    )}
                    {sequences.map((seq, i) => (
                      <tr key={i} className="border-b" style={{ background: '#12172b', borderColor: 'rgba(255,255,255,0.05)' }}>
                        <td className="px-3 py-2.5 font-mono text-xs">{truncate(seq.prospect_email, 30)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(74,158,255,0.15)', color: '#4a9eff' }}>
                            {seq.current_touch || 1}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                            {seq.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{relativeNextSend(seq.next_touch_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: '#0f1520', border: '1px solid rgba(74,158,255,0.1)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#6b7a9d' }}>Email Health</p>
              {[
                'From: Zach from Roofing OS <zach@roofingos.dev> ✅',
                'Domain: roofingos.dev ✅',
                'Webhook: Active ✅',
                'Unsubscribe: mailto:unsubscribe@roofingos.dev ✅',
              ].map(line => (
                <p key={line} className="text-sm" style={{ color: '#ffffff' }}>{line}</p>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'youtube' && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatCard label="Videos Live" value={ytStats.live} />
              <StatCard label="In Queue" value={ytStats.queued} color="#f59e0b" />
              <StatCard label="This Week" value={ytStats.thisWeek} color="#22c55e" />
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#6b7a9d' }}>Published Videos</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(74,158,255,0.15)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(74,158,255,0.05)' }}>
                      {['Title', 'Type', 'Published', 'Link'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7a9d' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ytVideos.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-sm" style={{ color: '#6b7a9d' }}>No videos published yet</td></tr>
                    )}
                    {ytVideos.map(v => (
                      <tr key={v.id} className="border-b" style={{ background: '#12172b', borderColor: 'rgba(255,255,255,0.05)' }}>
                        <td className="px-3 py-2.5 font-medium">{truncate(v.title, 50)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{v.type || '—'}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{relativeTime(v.youtube_posted_at)}</td>
                        <td className="px-3 py-2.5">
                          <a href={v.published_url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium transition-opacity hover:opacity-70" style={{ color: '#4a9eff' }}>
                            View →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#6b7a9d' }}>Render Queue</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(74,158,255,0.15)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(74,158,255,0.05)' }}>
                      {['Title', 'Status', 'Created', 'Action'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7a9d' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ytQueue.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-sm" style={{ color: '#6b7a9d' }}>Queue is empty</td></tr>
                    )}
                    {ytQueue.map(item => (
                      <tr key={item.id} className="border-b" style={{ background: '#12172b', borderColor: 'rgba(255,255,255,0.05)' }}>
                        <td className="px-3 py-2.5 font-medium">{truncate(item.title, 50)}</td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>Ready to upload</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{relativeTime(item.created_at)}</td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => forceUpload(item.id)}
                            disabled={ytLoading}
                            className="px-2 py-1 rounded text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                            style={{ background: 'rgba(124,58,237,0.25)', color: '#a78bfa' }}
                          >
                            {ytLoading ? '…' : '▶ Upload'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'outreach' && (
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#6b7a9d' }}>Prospects by Status</p>
              <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: '#12172b', border: '1px solid rgba(74,158,255,0.15)' }}>
                {funnelCounts.map(({ stage, count, total }) => {
                  const meta = stageMeta[stage] || { label: stage, color: '#6b7a9d' }
                  const pct = total > 0 ? (count / total) * 100 : 0
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className="text-xs font-medium w-24 shrink-0" style={{ color: '#6b7a9d' }}>{meta.label}</span>
                      <div className="flex-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)', height: '8px' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: meta.color }} />
                      </div>
                      <span className="text-xs font-bold w-8 text-right" style={{ color: meta.color }}>{count}</span>
                      <span className="text-[10px] w-10 text-right" style={{ color: '#6b7a9d' }}>{pct.toFixed(0)}%</span>
                    </div>
                  )
                })}
                {funnelCounts.length === 0 && <p className="text-sm text-center py-4" style={{ color: '#6b7a9d' }}>No data</p>}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: '#6b7a9d' }}>Subject Line Performance</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(74,158,255,0.15)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'rgba(74,158,255,0.05)' }}>
                      {['Subject', 'Sent', 'Opened', 'Rate'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7a9d' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {subjectPerf.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-sm" style={{ color: '#6b7a9d' }}>No data</td></tr>
                    )}
                    {subjectPerf.map((row, i) => {
                      const rate = row.sent > 0 ? ((row.opened / row.sent) * 100).toFixed(1) : '0.0'
                      const rateColor = parseFloat(rate) > 30 ? '#22c55e' : parseFloat(rate) > 15 ? '#f59e0b' : '#ef4444'
                      return (
                        <tr key={i} className="border-b" style={{ background: '#12172b', borderColor: 'rgba(255,255,255,0.05)' }}>
                          <td className="px-3 py-2.5 max-w-xs">{truncate(row.subject, 55)}</td>
                          <td className="px-3 py-2.5 text-center">{row.sent}</td>
                          <td className="px-3 py-2.5 text-center">{row.opened}</td>
                          <td className="px-3 py-2.5 text-center font-bold" style={{ color: rateColor }}>{rate}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'content' && (
          <div className="flex flex-col gap-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6b7a9d' }}>Content Queue</p>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(74,158,255,0.15)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'rgba(74,158,255,0.05)' }}>
                    {['Title', 'Channel', 'Status', 'Created', 'Actions'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7a9d' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contentRows.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-sm" style={{ color: '#6b7a9d' }}>No content</td></tr>
                  )}
                  {contentRows.map(row => {
                    const effectiveStatus = row.published_url ? 'published' : row.status
                    return (
                      <tr key={row.id} className="border-b" style={{ background: '#12172b', borderColor: 'rgba(255,255,255,0.05)' }}>
                        <td className="px-3 py-2.5 font-medium max-w-xs">{truncate(row.title, 45)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{row.type || '—'}</td>
                        <td className="px-3 py-2.5">{statusPill(effectiveStatus)}</td>
                        <td className="px-3 py-2.5 text-xs" style={{ color: '#6b7a9d' }}>{relativeTime(row.created_at)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {row.status === 'draft' && (
                              <>
                                <button
                                  onClick={() => updateContentStatus(row.id, 'approved')}
                                  className="px-2 py-1 rounded text-[10px] font-semibold transition-opacity hover:opacity-80"
                                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                                >
                                  ✓ Approve
                                </button>
                                <button
                                  onClick={() => updateContentStatus(row.id, 'rejected')}
                                  className="px-2 py-1 rounded text-[10px] font-semibold transition-opacity hover:opacity-80"
                                  style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                                >
                                  ✗ Reject
                                </button>
                              </>
                            )}
                            {row.status === 'approved' && row.youtube_upload_ready && (
                              <button
                                onClick={() => forceUpload(row.id)}
                                disabled={ytLoading}
                                className="px-2 py-1 rounded text-[10px] font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
                                style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}
                              >
                                ▶ Upload to YouTube
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const SB_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

function ago(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function SectionTitle({ children }) {
  return <h2 className="text-[10px] text-gray-600 uppercase tracking-widest font-bold mb-3">{children}</h2>
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

export default function Brain() {
  const [directives, setDirectives] = useState([])
  const [projects, setProjects]     = useState([])
  const [cycles, setCycles]         = useState([])
  const [decisions, setDecisions]   = useState([])
  const [research, setResearch]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState('focus')
  const [chatMsg, setChatMsg]       = useState('')
  const [chatReply, setChatReply]   = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  const load = useCallback(async () => {
    const [
      { data: dirs },
      { data: projs },
      { data: cyc },
      { data: dec },
      { data: res },
    ] = await Promise.all([
      supabase.from('nexus_directives').select('*').eq('status', 'active').order('priority').limit(10),
      supabase.from('projects').select('id, name, category, status, description').neq('category', 'archived').order('updated_at', { ascending: false }).limit(20),
      supabase.from('nexus_agent_cycles').select('*').order('created_at', { ascending: false }).limit(10),
      supabase.from('nexus_decisions').select('*').order('created_at', { ascending: false }).limit(15),
      supabase.from('nexus_research_findings').select('*').order('created_at', { ascending: false }).limit(10),
    ])
    setDirectives(dirs || [])
    setProjects(projs || [])
    setCycles(cyc || [])
    setDecisions(dec || [])
    setResearch(res || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const sendChat = async () => {
    if (!chatMsg.trim()) return
    setChatLoading(true)
    setChatReply('')
    try {
      const res = await fetch(`${SB_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
        body: JSON.stringify({ message: chatMsg, channel: 'web' }),
      })
      const data = await res.json()
      setChatReply(data.response || data.reply || data.message || JSON.stringify(data))
      setChatMsg('')
    } catch (e) {
      setChatReply('Error connecting to Brain.')
    } finally {
      setChatLoading(false)
    }
  }

  const triggerCore = async () => {
    await fetch(`${SB_URL}/functions/v1/nexus-core`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify({ trigger: 'manual' }),
    }).catch(() => {})
  }

  const TABS = [
    { key: 'focus',     label: 'Focus' },
    { key: 'projects',  label: 'Projects' },
    { key: 'cycles',    label: 'Cycles' },
    { key: 'decisions', label: 'Decisions' },
    { key: 'research',  label: 'Research' },
    { key: 'chat',      label: 'Ask Brain' },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Brain</h1>
          <p className="text-gray-500 text-sm mt-0.5">Nexus intelligence layer</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
            Refresh
          </button>
          <button
            onClick={triggerCore}
            className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            Run Core
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              tab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-[#12121a] text-gray-500 hover:text-gray-300 border border-[#1e1e2e]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && tab !== 'chat' ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="skeleton h-20 w-full rounded-xl" />)}
        </div>
      ) : tab === 'focus' ? (
        <div className="space-y-3">
          <SectionTitle>Active Priorities</SectionTitle>
          {directives.length === 0 ? (
            <Card><p className="text-gray-600 text-sm text-center py-4">No active directives.</p></Card>
          ) : directives.map((d, i) => (
            <Card key={d.id}>
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center justify-center shrink-0">
                  <span className="text-indigo-400 font-black text-xs">{i + 1}</span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{d.title}</div>
                  {d.description && <p className="text-xs text-gray-500 mt-1">{d.description}</p>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : tab === 'projects' ? (
        <div className="space-y-2">
          {projects.length === 0 ? (
            <Card><p className="text-gray-600 text-sm text-center py-4">No projects found.</p></Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest">Project</th>
                    <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest hidden sm:table-cell">Category</th>
                    <th className="px-4 py-3 text-left text-[10px] text-gray-600 font-bold uppercase tracking-widest">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr key={p.id} className="border-b border-[#1e1e2e] last:border-0 hover:bg-white/[0.01]">
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-white">{p.name}</div>
                        {p.description && <div className="text-xs text-gray-600 line-clamp-1">{p.description}</div>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-xs text-gray-500 capitalize">{p.category}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold capitalize ${
                          p.status === 'active'   ? 'text-green-400' :
                          p.status === 'building' ? 'text-indigo-400' :
                          p.status === 'paused'   ? 'text-amber-400' :
                          'text-gray-500'
                        }`}>{p.status || 'active'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      ) : tab === 'cycles' ? (
        <div className="space-y-3">
          {cycles.length === 0 ? (
            <Card><p className="text-gray-600 text-sm text-center py-4">No agent cycles recorded.</p></Card>
          ) : cycles.map(c => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold text-white">{c.trigger || 'scheduled'}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      c.status === 'complete' ? 'text-green-400 bg-green-500/10' :
                      c.status === 'error'    ? 'text-red-400 bg-red-500/10' :
                      'text-amber-400 bg-amber-500/10'
                    }`}>{c.status}</span>
                  </div>
                  {c.summary && <p className="text-xs text-gray-500">{c.summary?.slice(0, 200)}</p>}
                  {c.actions_taken != null && (
                    <div className="text-[10px] text-gray-700 mt-1">{c.actions_taken} actions · {ago(c.created_at)}</div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : tab === 'decisions' ? (
        <div className="space-y-3">
          {decisions.length === 0 ? (
            <Card><p className="text-gray-600 text-sm text-center py-4">No decisions logged.</p></Card>
          ) : decisions.map(d => (
            <Card key={d.id}>
              <div className="text-sm font-semibold text-white mb-1">{d.decision}</div>
              {d.rationale && <p className="text-xs text-gray-500">{d.rationale?.slice(0, 200)}</p>}
              <div className="text-[10px] text-gray-700 mt-1.5 flex gap-3">
                <span>{ago(d.created_at)}</span>
                {d.outcome && <span className="text-indigo-400">Outcome: {d.outcome}</span>}
              </div>
            </Card>
          ))}
        </div>
      ) : tab === 'research' ? (
        <div className="space-y-3">
          {research.length === 0 ? (
            <Card><p className="text-gray-600 text-sm text-center py-4">No research findings yet.</p></Card>
          ) : research.map(r => (
            <Card key={r.id}>
              <div className="text-sm font-semibold text-white mb-1">{r.topic || r.query}</div>
              {r.summary && <p className="text-xs text-gray-500">{r.summary?.slice(0, 300)}</p>}
              <div className="text-[10px] text-gray-700 mt-1.5">{ago(r.created_at)}</div>
            </Card>
          ))}
        </div>
      ) : (
        /* Chat tab */
        <div className="space-y-4">
          <div className="text-xs text-gray-600 mb-2">Ask anything — Nexus will respond using your full memory and context.</div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Ask Nexus..."
              value={chatMsg}
              onChange={e => setChatMsg(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !chatLoading && sendChat()}
              className="flex-1 bg-[#12121a] border border-[#1e1e2e] text-white text-sm rounded-lg px-3 py-2.5 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={sendChat}
              disabled={chatLoading || !chatMsg.trim()}
              className="text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
            >
              {chatLoading ? '…' : 'Send'}
            </button>
          </div>
          {chatReply && (
            <Card>
              <div className="text-[10px] text-indigo-400 uppercase tracking-widest mb-2">Nexus</div>
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{chatReply}</p>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

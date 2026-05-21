import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

const SB_URL = import.meta.env.VITE_SUPABASE_URL
const TOKEN_KEY = 'ae_session_token'

const PRIORITY_LABELS = {
  1: { label: 'URGENT',    cls: 'text-red-400 bg-red-500/10' },
  2: { label: 'IMPORTANT', cls: 'text-amber-400 bg-amber-500/10' },
  3: { label: 'DAILY',     cls: 'text-indigo-400 bg-indigo-500/10' },
  4: { label: 'EOD',       cls: 'text-gray-400 bg-gray-500/10' },
}

function callAETasks(token, body) {
  return fetch(`${SB_URL}/functions/v1/ae-tasks`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token, ...body }),
  }).then(r => r.json())
}

function PhoneButton({ steps }) {
  const stepsText = JSON.stringify(steps || [])
  const match = stepsText.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)
  if (!match) return null
  const raw = match[0].replace(/\D/g, '')
  return (
    <a
      href={`tel:+1${raw}`}
      className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
    >
      <span>📞</span>
      <span className="font-mono tracking-wide">{match[0]}</span>
      <span>Call now</span>
    </a>
  )
}

function TaskCard({ task, token, onRefresh }) {
  const [copying, setCopying]         = useState(false)
  const [escalating, setEscalating]   = useState(false)
  const [escalateOpen, setEscalateOpen] = useState(false)
  const [reason, setReason]           = useState('')
  const [completing, setCompleting]   = useState(false)

  const badge = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS[3]
  const steps = Array.isArray(task.steps) ? task.steps
    : (typeof task.steps === 'string' ? JSON.parse(task.steps || '[]') : [])

  const copyText = async () => {
    if (!task.copy_text) return
    setCopying(true)
    try { await navigator.clipboard.writeText(task.copy_text) } catch {}
    setTimeout(() => setCopying(false), 1500)
  }

  const markDone = async () => {
    setCompleting(true)
    await callAETasks(token, { action: 'complete', task_id: task.id })
    onRefresh()
  }

  const submitEscalation = async () => {
    if (!reason.trim()) return
    setEscalating(true)
    await callAETasks(token, { action: 'escalate', task_id: task.id, reason })
    onRefresh()
  }

  const isDone      = task.status === 'completed'
  const isEscalated = task.status === 'escalated'

  return (
    <div className={`bg-[#12121a] border rounded-2xl p-5 ${
      isDone || isEscalated ? 'border-[#1a1a28] opacity-50' : 'border-[#1e1e2e]'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full mt-0.5 ${badge.cls}`}>
            {badge.label}
          </span>
          <h3 className="text-base font-bold text-white leading-tight">{task.title}</h3>
        </div>
        {task.time_estimate_minutes && (
          <span className="shrink-0 text-[11px] text-gray-600">{task.time_estimate_minutes} min</span>
        )}
      </div>

      {task.description && (
        <p className="text-sm text-gray-400 mb-4">{task.description}</p>
      )}

      {/* Phone button for hot leads / welcome calls */}
      {(task.task_type === 'hot_lead_followup' || task.task_type === 'welcome_call') && (
        <div className="mb-4">
          <PhoneButton steps={steps} />
        </div>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <ol className="space-y-2 mb-4">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm text-gray-300">
              <span className="shrink-0 w-5 h-5 bg-[#1e1e2e] rounded-full flex items-center justify-center text-[10px] text-gray-500 font-bold mt-0.5">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {/* Copy button */}
      {task.copy_text && (
        <button
          onClick={copyText}
          className="text-xs font-semibold text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg mb-4 transition-colors"
        >
          {copying ? '✓ Copied!' : task.task_type === 'hot_lead_followup' || task.task_type === 'welcome_call'
            ? 'Copy script'
            : 'Copy post'}
        </button>
      )}

      {/* Status display for done/escalated */}
      {isDone && (
        <p className="text-xs text-green-500 font-semibold">✓ Completed</p>
      )}
      {isEscalated && (
        <p className="text-xs text-gray-500">
          {task.escalation_status === 'resolved' ? 'Zach handled this.' : 'Escalated — waiting on Zach.'}
        </p>
      )}

      {/* Action buttons */}
      {!isDone && !isEscalated && (
        <div className="flex flex-col gap-2 mt-2">
          {!escalateOpen ? (
            <div className="flex gap-2">
              <button
                onClick={markDone}
                disabled={completing}
                className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
              >
                {completing ? '…' : 'Mark done'}
              </button>
              <button
                onClick={() => setEscalateOpen(true)}
                className="flex-1 bg-[#1e1e2e] hover:bg-[#2a2a3e] text-gray-400 hover:text-gray-300 text-sm font-semibold py-2.5 rounded-xl transition-colors"
              >
                Can't complete — escalate
              </button>
            </div>
          ) : (
            <div>
              <textarea
                autoFocus
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="What happened? (required)"
                rows={3}
                className="w-full bg-[#0c0c14] border border-[#2a2a3e] rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500 mb-2 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={submitEscalation}
                  disabled={escalating || !reason.trim()}
                  className="flex-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
                >
                  {escalating ? '…' : 'Submit escalation'}
                </button>
                <button
                  onClick={() => { setEscalateOpen(false); setReason('') }}
                  className="px-4 text-gray-500 hover:text-gray-300 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AEDashboard() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const [token, setToken]     = useState(null)
  const [ae, setAe]           = useState(null)
  const [tasks, setTasks]     = useState([])
  const [stats, setStats]     = useState({})
  const [loading, setLoading] = useState(true)

  // Extract token from URL or localStorage
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      localStorage.setItem(TOKEN_KEY, urlToken)
      // Clean URL
      window.history.replaceState({}, '', '/roofing/ae')
    }
    const saved = urlToken || localStorage.getItem(TOKEN_KEY)
    if (!saved) {
      navigate('/roofing/ae/login', { replace: true })
      return
    }
    setToken(saved)
  }, []) // eslint-disable-line

  const load = useCallback(async (tok) => {
    const data = await callAETasks(tok, { action: 'get' })
    if (data.error === 'invalid_token') {
      localStorage.removeItem(TOKEN_KEY)
      navigate('/roofing/ae/login', { replace: true })
      return
    }
    setAe(data.ae)
    setTasks(data.tasks || [])
    setStats(data.stats || {})
    setLoading(false)
  }, [navigate])

  useEffect(() => {
    if (token) load(token)
  }, [token, load])

  const refresh = () => {
    if (token) load(token)
  }

  if (!token || loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-gray-600 text-sm">Loading…</div>
      </div>
    )
  }

  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const doneTasks    = tasks.filter(t => t.status === 'completed')
  const totalMin     = pendingTasks.reduce((s, t) => s + (t.time_estimate_minutes || 0), 0)
  const totalHours   = +(totalMin / 60).toFixed(1)
  const progress     = tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">🏠</span>
              <h1 className="text-base font-bold text-white">Roofing OS — AE</h1>
            </div>
            {ae && <p className="text-gray-600 text-xs mt-0.5">{ae.email}</p>}
          </div>
          <button
            onClick={refresh}
            className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-3.5 text-center">
            <div className="text-2xl font-black text-green-400">{doneTasks.length}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Done today</div>
          </div>
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-3.5 text-center">
            <div className={`text-2xl font-black ${pendingTasks.length > 0 ? 'text-white' : 'text-green-400'}`}>
              {pendingTasks.length}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Remaining</div>
          </div>
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-3.5 text-center">
            <div className={`text-2xl font-black ${(stats.signups_today || 0) > 0 ? 'text-green-400' : 'text-white'}`}>
              {stats.signups_today || 0}
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Signups today</div>
          </div>
        </div>

        {/* Progress bar */}
        {tasks.length > 0 && (
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-600 mb-1.5">
              <span>{doneTasks.length} of {tasks.length} tasks complete</span>
              <span>~{totalHours}h remaining</span>
            </div>
            <div className="h-2 bg-[#1e1e2e] rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Task list — pending first, then done */}
        {tasks.length === 0 ? (
          <div className="bg-[#12121a] border border-[#1e1e2e] rounded-2xl p-10 text-center">
            <p className="text-3xl mb-3">✅</p>
            <p className="text-white font-semibold">No tasks yet</p>
            <p className="text-gray-500 text-sm mt-1">Tasks are generated each morning at 7 AM MT.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingTasks.map(task => (
              <TaskCard key={task.id} task={task} token={token} onRefresh={refresh} />
            ))}
            {doneTasks.length > 0 && (
              <div className="mt-6">
                <p className="text-[10px] text-gray-700 uppercase tracking-widest font-bold mb-3">
                  Completed ({doneTasks.length})
                </p>
                {doneTasks.map(task => (
                  <TaskCard key={task.id} task={task} token={token} onRefresh={refresh} />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function VAInterface() {
  const [profile, setProfile] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [taskQueue, setTaskQueue] = useState(null)
  const [activeTask, setActiveTask] = useState(null)
  const [callLog, setCallLog] = useState({ lead_name: '', lead_phone: '', outcome: '', notes: '', callback_date: '' })
  const [prompt, setPrompt] = useState('')
  const [generatingPrompt, setGeneratingPrompt] = useState(false)
  const [loggingCall, setLoggingCall] = useState(false)
  const [logSuccess, setLogSuccess] = useState(false)
  const [view, setView] = useState('tasks') // 'tasks' | 'call' | 'prompt'
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadVAData()
  }, [])

  const loadVAData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: vaProfile } = await supabase
      .from('va_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    setProfile(vaProfile)

    if (vaProfile) {
      const { data: vaAssignments } = await supabase
        .from('va_assignments')
        .select('id, client_id, clients(id, name, deal_type, client_context(core_offer, goals, script))')
        .eq('va_name', vaProfile.name)
        .eq('status', 'active')

      setAssignments(vaAssignments || [])

      if (vaAssignments?.length === 1) {
        await selectClient(vaAssignments[0])
      }
    }

    setLoading(false)
  }

  const selectClient = async (assignment) => {
    setSelectedClient(assignment)
    setView('tasks')

    const today = new Date().toISOString().split('T')[0]
    const { data: queue } = await supabase
      .from('va_task_queues')
      .select('*')
      .eq('va_assignment_id', assignment.id)
      .eq('date', today)
      .maybeSingle()

    setTaskQueue(queue)

    if (!queue) {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-va-tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      })
      const { data: newQueue } = await supabase
        .from('va_task_queues')
        .select('*')
        .eq('va_assignment_id', assignment.id)
        .eq('date', today)
        .maybeSingle()
      setTaskQueue(newQueue)
    }
  }

  const generateCallPrompt = async () => {
    if (!selectedClient) return
    setGeneratingPrompt(true)
    const ctx = selectedClient.clients?.client_context?.[0]
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        message: `generate script: ${selectedClient.clients?.name} | objective: ${activeTask?.title || 'qualify interest'} | context: ${JSON.stringify(ctx)}`,
        channel: 'web',
      }),
    })
    const data = await res.json()
    setPrompt(data.reply || 'Could not generate prompt.')
    setGeneratingPrompt(false)
  }

  const logCall = async () => {
    if (!selectedClient || !callLog.outcome) return
    setLoggingCall(true)

    const { data: { user } } = await supabase.auth.getUser()
    const { data: vaProfile } = await supabase.from('va_profiles').select('id').eq('user_id', user.id).single()

    await supabase.from('call_logs').insert({
      client_id: selectedClient.client_id,
      va_profile_id: vaProfile?.id,
      lead_name: callLog.lead_name,
      lead_phone: callLog.lead_phone,
      outcome: callLog.outcome,
      notes: callLog.notes,
      callback_date: callLog.callback_date || null,
    })

    await supabase.from('entries').insert({
      client_id: selectedClient.client_id,
      source: 'web',
      role: 'user',
      content: `CALL LOG: ${callLog.lead_name} (${callLog.lead_phone}) — ${callLog.outcome}. ${callLog.notes}`,
      entry_type: 'note',
      importance: 7,
      tags: ['call-log', callLog.outcome],
      classification_status: 'complete',
    })

    setCallLog({ lead_name: '', lead_phone: '', outcome: '', notes: '', callback_date: '' })
    setLogSuccess(true)
    setTimeout(() => setLogSuccess(false), 3000)
    setLoggingCall(false)
    setView('tasks')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-white">Loading...</div>
  )

  if (!profile) return (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-white p-6">
      <div className="text-center">
        <p className="text-xl font-bold mb-2">VA Profile Not Found</p>
        <p className="text-gray-400 text-sm">Contact your administrator to set up your profile.</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">VA Interface</h2>
          <p className="text-gray-400 text-sm">Welcome, {profile.name}</p>
        </div>
        {logSuccess && <span className="text-green-400 text-sm">Logged!</span>}
      </div>

      {assignments.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {assignments.map(a => (
            <button key={a.id} onClick={() => selectClient(a)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${selectedClient?.id === a.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
              {a.clients?.name}
            </button>
          ))}
        </div>
      )}

      {selectedClient && (
        <>
          <div className="flex gap-1 mb-4 bg-gray-900 rounded-lg p-1">
            {['tasks', 'call', 'prompt'].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${view === v ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
                {v === 'tasks' ? 'Tasks' : v === 'call' ? 'Log Call' : 'Script'}
              </button>
            ))}
          </div>

          {view === 'tasks' && (
            <div className="space-y-3">
              {taskQueue?.tasks?.length ? (
                <>
                  {taskQueue.daily_focus && (
                    <p className="text-blue-400 text-sm mb-3">{taskQueue.daily_focus}</p>
                  )}
                  {taskQueue.tasks.map((task) => (
                    <div key={task.id}
                      onClick={() => { setActiveTask(task); setView('call'); }}
                      className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-4 cursor-pointer transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-white font-medium text-sm">{task.title}</p>
                          <p className="text-gray-400 text-xs mt-1">{task.description}</p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                          task.priority === 'high' ? 'bg-red-900/40 text-red-400' :
                          task.priority === 'medium' ? 'bg-yellow-900/40 text-yellow-400' :
                          'bg-gray-700 text-gray-400'
                        }`}>{task.priority}</span>
                      </div>
                      <p className="text-gray-500 text-xs mt-2">~{task.estimated_minutes} min · {task.type}</p>
                    </div>
                  ))}
                </>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
                  <p className="text-gray-400">Generating your task queue...</p>
                </div>
              )}
            </div>
          )}

          {view === 'call' && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
              {activeTask && (
                <div className="bg-gray-800 rounded-lg p-3 mb-2">
                  <p className="text-blue-400 text-xs font-semibold">ACTIVE TASK</p>
                  <p className="text-white text-sm mt-1">{activeTask.title}</p>
                </div>
              )}
              <input type="text" placeholder="Lead name" value={callLog.lead_name}
                onChange={e => setCallLog(p => ({ ...p, lead_name: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
              <input type="tel" placeholder="Phone number" value={callLog.lead_phone}
                onChange={e => setCallLog(p => ({ ...p, lead_phone: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
              <select value={callLog.outcome}
                onChange={e => setCallLog(p => ({ ...p, outcome: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500">
                <option value="">Select outcome...</option>
                <option value="interested">Interested</option>
                <option value="callback">Callback requested</option>
                <option value="not_interested">Not interested</option>
                <option value="no_answer">No answer</option>
                <option value="wrong_number">Wrong number</option>
              </select>
              {callLog.outcome === 'callback' && (
                <input type="datetime-local" value={callLog.callback_date}
                  onChange={e => setCallLog(p => ({ ...p, callback_date: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
              )}
              <textarea placeholder="Notes from the call..." value={callLog.notes}
                onChange={e => setCallLog(p => ({ ...p, notes: e.target.value }))}
                rows={3} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500 resize-none" />
              <button onClick={logCall} disabled={loggingCall || !callLog.outcome}
                className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded px-4 py-3 text-sm font-medium transition-colors">
                {loggingCall ? 'Logging...' : 'Log Call to Nexus'}
              </button>
            </div>
          )}

          {view === 'prompt' && (
            <div className="space-y-3">
              <button onClick={generateCallPrompt} disabled={generatingPrompt}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded px-4 py-3 text-sm font-medium transition-colors">
                {generatingPrompt ? 'Generating...' : 'Generate Call Script'}
              </button>
              {prompt && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-2">Your script:</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{prompt}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function VAInterface() {
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [context, setContext] = useState(null)
  const [objective, setObjective] = useState('')
  const [prompt, setPrompt] = useState('')
  const [callLog, setCallLog] = useState('')
  const [generating, setGenerating] = useState(false)
  const [logging, setLogging] = useState(false)
  const [logSuccess, setLogSuccess] = useState(false)

  useEffect(() => {
    supabase
      .from('clients')
      .select('id, name, deal_type')
      .eq('status', 'active')
      .then(({ data }) => setClients(data || []))
  }, [])

  const selectClient = async (client) => {
    setSelectedClient(client)
    setPrompt('')
    setCallLog('')
    setLogSuccess(false)
    const { data } = await supabase
      .from('client_context')
      .select('*')
      .eq('client_id', client.id)
      .maybeSingle()
    setContext(data)
  }

  const generatePrompt = async () => {
    if (!selectedClient || !objective) return
    setGenerating(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          message: `prompt: ${selectedClient.name} | objective: ${objective} | context: ${JSON.stringify(context)}`,
          channel: 'web',
        }),
      })
      const data = await res.json()
      setPrompt(data.reply || 'No prompt generated')
    } catch {
      setPrompt('Error generating prompt. Try again.')
    }
    setGenerating(false)
  }

  const logCall = async () => {
    if (!selectedClient || !callLog) return
    setLogging(true)
    await supabase.from('entries').insert({
      client_id: selectedClient.id,
      role: 'user',
      source: 'web',
      content: callLog,
      entry_type: 'note',
      importance: 5,
      classification_status: 'complete',
      tags: ['call-log'],
    })
    setCallLog('')
    setLogSuccess(true)
    setTimeout(() => setLogSuccess(false), 3000)
    setLogging(false)
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-white mb-6">VA Interface</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
        <h3 className="text-xs text-gray-400 font-semibold uppercase mb-3">Select Client</h3>
        <div className="flex flex-wrap gap-2">
          {clients.map(c => (
            <button
              key={c.id}
              onClick={() => selectClient(c)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                selectedClient?.id === c.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {c.name}
            </button>
          ))}
          {clients.length === 0 && (
            <p className="text-gray-500 text-sm">No active clients yet</p>
          )}
        </div>
      </div>

      {selectedClient && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
            <h3 className="text-xs text-gray-400 font-semibold uppercase mb-3">Generate Prompt</h3>
            <input
              type="text"
              placeholder="What's the objective? (e.g. qualify interest in reverse mortgage)"
              value={objective}
              onChange={e => setObjective(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500 mb-3"
            />
            <button
              onClick={generatePrompt}
              disabled={generating || !objective}
              className="bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate Prompt'}
            </button>
            {prompt && (
              <div className="mt-4 bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-2">Your prompt:</p>
                <p className="text-sm text-white whitespace-pre-wrap">{prompt}</p>
              </div>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs text-gray-400 font-semibold uppercase mb-3">Log Call Outcome</h3>
            <textarea
              placeholder="What happened on the call? Who did you speak with, what was their response, any next steps?"
              value={callLog}
              onChange={e => setCallLog(e.target.value)}
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500 mb-3 resize-none"
            />
            <button
              onClick={logCall}
              disabled={logging || !callLog}
              className="bg-green-700 hover:bg-green-600 text-white rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {logging ? 'Logging...' : 'Log to Nexus'}
            </button>
            {logSuccess && (
              <p className="text-green-400 text-xs mt-2">✅ Logged to Nexus</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

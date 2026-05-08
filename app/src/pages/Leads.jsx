import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const STATUS_COLORS = {
  not_called: 'bg-gray-700 text-gray-300',
  called: 'bg-blue-900/40 text-blue-400',
  interested: 'bg-green-900/40 text-green-400',
  not_interested: 'bg-red-900/40 text-red-400',
  callback: 'bg-yellow-900/40 text-yellow-400',
  closed: 'bg-purple-900/40 text-purple-400',
}

export default function Leads() {
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [leads, setLeads] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newLead, setNewLead] = useState({ name: '', phone: '', email: '', notes: '' })

  useEffect(() => {
    supabase.from('clients').select('id, name').eq('status', 'active')
      .then(({ data }) => { setClients(data || []); setLoading(false) })
  }, [])

  const selectClient = (client) => {
    setSelectedClient(client)
    loadLeads(client.id, filter)
  }

  const loadLeads = async (clientId, statusFilter) => {
    let query = supabase.from('leads').select('*').eq('client_id', clientId).order('priority').order('created_at')
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    const { data } = await query
    setLeads(data || [])
  }

  const updateStatus = async (leadId, status) => {
    await supabase.from('leads').update({ status, updated_at: new Date().toISOString() }).eq('id', leadId)
    loadLeads(selectedClient.id, filter)
  }

  const addLead = async () => {
    if (!selectedClient || !newLead.name) return
    await supabase.from('leads').insert({
      client_id: selectedClient.id,
      name: newLead.name,
      phone: newLead.phone,
      email: newLead.email,
      notes: newLead.notes,
    })
    setNewLead({ name: '', phone: '', email: '', notes: '' })
    setAdding(false)
    loadLeads(selectedClient.id, filter)
  }

  const stats = {
    total: leads.length,
    interested: leads.filter(l => l.status === 'interested').length,
    callback: leads.filter(l => l.status === 'callback').length,
    notCalled: leads.filter(l => l.status === 'not_called').length,
  }

  if (loading) return <p className="text-gray-400">Loading...</p>

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold text-white mb-6">Lead Pipeline</h2>

      <div className="flex gap-2 mb-6 flex-wrap">
        {clients.map(c => (
          <button key={c.id} onClick={() => selectClient(c)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${selectedClient?.id === c.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
            {c.name}
          </button>
        ))}
        {clients.length === 0 && <p className="text-gray-500 text-sm">No active clients</p>}
      </div>

      {selectedClient && (
        <>
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total', value: stats.total, color: 'text-white' },
              { label: 'Interested', value: stats.interested, color: 'text-green-400' },
              { label: 'Callback', value: stats.callback, color: 'text-yellow-400' },
              { label: 'Not Called', value: stats.notCalled, color: 'text-gray-400' },
            ].map(s => (
              <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-gray-500 text-xs mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1">
              {['all', 'not_called', 'interested', 'callback'].map(f => (
                <button key={f} onClick={() => { setFilter(f); loadLeads(selectedClient.id, f) }}
                  className={`px-3 py-1 rounded text-xs transition-colors ${filter === f ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>
                  {f.replace('_', ' ')}
                </button>
              ))}
            </div>
            <button onClick={() => setAdding(!adding)}
              className="bg-blue-600 hover:bg-blue-500 text-white rounded px-3 py-1.5 text-sm transition-colors">
              + Add Lead
            </button>
          </div>

          {adding && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4 space-y-2">
              <input placeholder="Name *" value={newLead.name}
                onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
              <input placeholder="Phone" value={newLead.phone}
                onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
              <input placeholder="Email" value={newLead.email}
                onChange={e => setNewLead(p => ({ ...p, email: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
              <textarea placeholder="Notes" value={newLead.notes}
                onChange={e => setNewLead(p => ({ ...p, notes: e.target.value }))}
                rows={2} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500 resize-none" />
              <div className="flex gap-2">
                <button onClick={addLead} className="bg-green-700 hover:bg-green-600 text-white rounded px-4 py-2 text-sm flex-1">Add</button>
                <button onClick={() => setAdding(false)} className="bg-gray-700 hover:bg-gray-600 text-white rounded px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {leads.map(lead => (
              <div key={lead.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium">{lead.name}</p>
                    {lead.phone && <p className="text-gray-400 text-xs mt-0.5">{lead.phone}</p>}
                    {lead.notes && <p className="text-gray-500 text-xs mt-1">{lead.notes.slice(0, 100)}</p>}
                    {lead.callback_date && (
                      <p className="text-yellow-400 text-xs mt-1">Callback: {new Date(lead.callback_date).toLocaleDateString()}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[lead.status] || STATUS_COLORS.not_called}`}>
                      {lead.status.replace('_', ' ')}
                    </span>
                    <select value={lead.status}
                      onChange={e => updateStatus(lead.id, e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none">
                      <option value="not_called">Not called</option>
                      <option value="called">Called</option>
                      <option value="interested">Interested</option>
                      <option value="not_interested">Not interested</option>
                      <option value="callback">Callback</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
            {leads.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">No leads yet. Add one above.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

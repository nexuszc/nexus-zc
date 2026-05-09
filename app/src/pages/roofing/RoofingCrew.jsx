import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const ROLES = ['foreman', 'laborer', 'salesperson']

export default function RoofingCrew() {
  const { contractorClientId } = useContractor()
  const [crew, setCrew] = useState([])
  const [form, setForm] = useState({ name: '', role: 'laborer', phone: '', email: '' })
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!contractorClientId) return
    const { data } = await supabase
      .from('crew_members')
      .select('*')
      .eq('client_id', contractorClientId)
      .order('created_at', { ascending: false })
    setCrew(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [contractorClientId])

  const addMember = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setAdding(true)
    await supabase.from('crew_members').insert({ ...form, client_id: contractorClientId })
    setForm({ name: '', role: 'laborer', phone: '', email: '' })
    setAdding(false)
    load()
  }

  const toggleActive = async (id, active) => {
    await supabase.from('crew_members').update({ active: !active }).eq('id', id)
    load()
  }

  if (loading) return <p className="text-gray-400">Loading...</p>

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-white mb-6">Crew Management</h2>

      {/* Add crew member */}
      <form onSubmit={addMember} className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6 space-y-3">
        <h3 className="text-xs text-gray-400 font-semibold uppercase">Add Crew Member</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Full name"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Role</label>
            <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500">
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Phone</label>
            <input type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
              placeholder="(303) 555-0100"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="crew@example.com"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500" />
          </div>
        </div>
        <button type="submit" disabled={adding || !form.name}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors">
          {adding ? 'Adding...' : '+ Add Member'}
        </button>
      </form>

      {/* Crew list */}
      <div className="space-y-2">
        <h3 className="text-xs text-gray-400 font-semibold uppercase mb-3">
          Team ({crew.filter(c => c.active).length} active)
        </h3>
        {crew.map(member => (
          <div key={member.id}
            className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${member.active ? 'bg-gray-900 border-gray-800' : 'bg-gray-950 border-gray-900 opacity-50'}`}>
            <div>
              <p className="text-white font-medium text-sm">{member.name}</p>
              <p className="text-gray-500 text-xs mt-0.5">
                {member.role}
                {member.phone && ` · ${member.phone}`}
                {member.email && ` · ${member.email}`}
              </p>
            </div>
            <button
              onClick={() => toggleActive(member.id, member.active)}
              className={`text-xs px-3 py-1 rounded-full transition-colors ${member.active ? 'bg-green-900/40 text-green-400 hover:bg-red-900/40 hover:text-red-400' : 'bg-gray-800 text-gray-400 hover:bg-green-900/40 hover:text-green-400'}`}>
              {member.active ? 'Active' : 'Inactive'}
            </button>
          </div>
        ))}
        {crew.length === 0 && (
          <p className="text-gray-500 text-center py-8">No crew members yet. Add your first team member above.</p>
        )}
      </div>
    </div>
  )
}

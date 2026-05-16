import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const ROLES = ['owner', 'pm', 'sales', 'crew', 'admin']

const ROLE_COLORS = {
  owner:  'bg-orange-900/40 text-orange-300 ring-1 ring-orange-600/30',
  pm:     'bg-blue-900/40 text-blue-300 ring-1 ring-blue-600/30',
  sales:  'bg-violet-900/40 text-violet-300 ring-1 ring-violet-600/30',
  crew:   'bg-green-900/40 text-green-300 ring-1 ring-green-600/30',
  admin:  'bg-gray-800 text-gray-300 ring-1 ring-gray-600/30',
}

function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />
}

export default function RoofingTeam() {
  const { contractorClientId, contractor } = useContractor()
  const [contractors, setContractors] = useState([])
  const [teamByContractor, setTeamByContractor] = useState({})
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState({}) // contractorId → bool
  const [forms, setForms] = useState({})   // contractorId → {name,phone,role}

  const load = async () => {
    const { data: accounts } = await supabase
      .from('contractor_accounts')
      .select('id, company_name, owner_name, owner_phone, plan, subscription_status')
      .order('created_at', { ascending: false })

    const { data: members } = await supabase
      .from('contractor_team_members')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false })

    const byContractor = {}
    for (const m of members || []) {
      if (!byContractor[m.contractor_id]) byContractor[m.contractor_id] = []
      byContractor[m.contractor_id].push(m)
    }

    setContractors(accounts || [])
    setTeamByContractor(byContractor)
    setLoading(false)
  }

  useEffect(() => { load() }, [contractorClientId])

  const getForm = (contractorId) =>
    forms[contractorId] || { name: '', phone: '', role: 'pm' }

  const setForm = (contractorId, updates) =>
    setForms(prev => ({ ...prev, [contractorId]: { ...getForm(contractorId), ...updates } }))

  const addMember = async (e, contractorId) => {
    e.preventDefault()
    const form = getForm(contractorId)
    if (!form.name.trim() || !form.phone.trim()) return

    // Normalize phone to E.164
    const digits = form.phone.replace(/\D/g, '')
    const normalized = digits.length === 10 ? `+1${digits}` : `+${digits}`

    setAdding(prev => ({ ...prev, [contractorId]: true }))
    const { error } = await supabase.from('contractor_team_members').insert({
      contractor_id: contractorId,
      name: form.name.trim(),
      phone: normalized,
      role: form.role,
    })

    if (!error) {
      setForms(prev => ({ ...prev, [contractorId]: { name: '', phone: '', role: 'pm' } }))
    }
    setAdding(prev => ({ ...prev, [contractorId]: false }))
    load()
  }

  const removeMember = async (memberId) => {
    await supabase.from('contractor_team_members').update({ active: false }).eq('id', memberId)
    load()
  }

  if (loading) return (
    <div className="px-6 lg:px-10 pt-8 space-y-4">
      {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
    </div>
  )

  return (
    <div className="animate-fade-in">
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-600/[0.06] via-transparent to-transparent pointer-events-none" />
        <div className="relative px-6 lg:px-10 pt-8 pb-8">
          <p className="text-[10px] font-bold text-orange-600/60 uppercase tracking-[0.2em] mb-1.5">Roofing OS · Team</p>
          <h1 className="text-[28px] font-black text-white tracking-tight leading-none mb-1">Team Members</h1>
          <p className="text-gray-500 text-sm">Register numbers so team members can call or text updates.</p>
        </div>
      </div>

      <div className="px-6 lg:px-10 py-6 space-y-6">
        {contractors.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 border-dashed rounded-xl py-12 text-center">
            <p className="text-gray-400 text-sm">No contractor accounts yet.</p>
          </div>
        ) : contractors.map(account => {
          const members = teamByContractor[account.id] || []
          const isAdding = adding[account.id]
          const form = getForm(account.id)

          return (
            <div key={account.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* Account header */}
              <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3">
                <div>
                  <p className="text-white font-semibold">{account.company_name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{account.owner_name} · {account.plan || 'free'} plan</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  account.subscription_status === 'active'
                    ? 'bg-green-900/40 text-green-400'
                    : 'bg-gray-800 text-gray-500'
                }`}>
                  {account.subscription_status || 'inactive'}
                </span>
              </div>

              {/* Team members list */}
              <div className="divide-y divide-gray-800/60">
                {members.length === 0 ? (
                  <p className="px-5 py-4 text-gray-600 text-sm">No team members yet.</p>
                ) : members.map(m => (
                  <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-gray-400">
                          {(m.name || '?')[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{m.name}</p>
                        <p className="text-xs text-gray-500">{m.phone}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ROLE_COLORS[m.role] || ROLE_COLORS.admin}`}>
                        {m.role}
                      </span>
                      <button
                        onClick={() => removeMember(m.id)}
                        className="text-gray-600 hover:text-red-400 text-xs transition-colors px-2 py-1 rounded hover:bg-red-900/20"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add member form */}
              <form onSubmit={(e) => addMember(e, account.id)}
                className="px-5 py-4 border-t border-gray-800 bg-gray-950/40">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">Add Member</p>
                <div className="flex gap-2 flex-wrap">
                  <input
                    type="text"
                    placeholder="Name"
                    value={form.name}
                    onChange={e => setForm(account.id, { name: e.target.value })}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-600/60 w-32 flex-1 min-w-[120px]"
                  />
                  <input
                    type="tel"
                    placeholder="Phone"
                    value={form.phone}
                    onChange={e => setForm(account.id, { phone: e.target.value })}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-600/60 w-36 flex-1 min-w-[130px]"
                  />
                  <select
                    value={form.role}
                    onChange={e => setForm(account.id, { role: e.target.value })}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-600/60"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    type="submit"
                    disabled={isAdding || !form.name.trim() || !form.phone.trim()}
                    className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all"
                  >
                    {isAdding ? 'Adding...' : '+ Add'}
                  </button>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Once added, this person can call or text +1 (720) 292-1930 for zero-keyboard job updates.
                </p>
              </form>
            </div>
          )
        })}
      </div>
    </div>
  )
}

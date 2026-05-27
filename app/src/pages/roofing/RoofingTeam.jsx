import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const ROLES = ['owner', 'admin', 'salesman', 'inspector', 'canvasser', 'crew_lead', 'crew_member']

const ROLE_META = {
  owner:       { label: 'Owner',       color: 'bg-orange-900/40 text-orange-300',  perms: ['Full access to everything'] },
  admin:       { label: 'Admin',       color: 'bg-purple-900/40 text-purple-300',  perms: ['Manage jobs', 'Manage team', 'View financials'] },
  salesman:    { label: 'Salesman',    color: 'bg-blue-900/40 text-blue-300',      perms: ['Create jobs', 'Send portal', 'View own jobs'] },
  inspector:   { label: 'Inspector',   color: 'bg-cyan-900/40 text-cyan-300',      perms: ['Start inspections', 'Upload photos'] },
  canvasser:   { label: 'Canvasser',   color: 'bg-yellow-900/40 text-yellow-300',  perms: ['Create leads', 'Door-knock tracker'] },
  crew_lead:   { label: 'Crew Lead',   color: 'bg-green-900/40 text-green-300',    perms: ['Update job status', 'Upload photos'] },
  crew_member: { label: 'Crew Member', color: 'bg-gray-800 text-gray-400',         perms: ['Upload photos', 'Mark tasks done'] },
}

export default function RoofingTeam() {
  const [contractors, setContractors] = useState([])
  const [employees, setEmployees] = useState({})  // contractorId → []
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [addingTo, setAddingTo] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', role: 'crew_member' })
  const [saving, setSaving] = useState(false)
  const [inviteSent, setInviteSent] = useState({})  // employeeId → bool

  const load = async () => {
    setLoading(true)
    const { data: accounts } = await supabase
      .from('contractor_accounts')
      .select('id, company_name, owner_name, owner_phone, plan, subscription_status')
      .order('created_at', { ascending: false })

    const { data: emps } = await supabase
      .from('contractor_employees')
      .select('*')
      .eq('active', true)
      .order('is_owner', { ascending: false })

    const byContractor = {}
    for (const e of emps || []) {
      if (!byContractor[e.contractor_id]) byContractor[e.contractor_id] = []
      byContractor[e.contractor_id].push(e)
    }

    setContractors(accounts || [])
    setEmployees(byContractor)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const addEmployee = async (contractorId) => {
    if (!form.name.trim()) return
    setSaving(true)
    const digits = (form.phone || '').replace(/\D/g, '')
    const phone = digits.length === 10 ? `+1${digits}` : digits.length > 10 ? `+${digits}` : null

    await supabase.from('contractor_employees').insert({
      contractor_id: contractorId,
      name: form.name.trim(),
      phone,
      role: form.role,
      is_owner: form.role === 'owner',
      active: true,
    })

    setForm({ name: '', phone: '', role: 'crew_member' })
    setAddingTo(null)
    setSaving(false)
    load()
  }

  const removeEmployee = async (empId) => {
    await supabase.from('contractor_employees').update({ active: false }).eq('id', empId)
    load()
  }

  const sendSmsInvite = async (emp, contractorId) => {
    if (!emp.phone) return
    const token = Math.random().toString(36).substring(2, 10).toUpperCase()
    await supabase.from('contractor_employees')
      .update({ invite_token: token })
      .eq('id', emp.id)
    setInviteSent(prev => ({ ...prev, [emp.id]: true }))
    setTimeout(() => setInviteSent(prev => ({ ...prev, [emp.id]: false })), 3000)
  }

  if (loading) {
    return (
      <div className="px-6 lg:px-10 pt-8 space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-gray-900 animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/[0.06] via-transparent to-transparent pointer-events-none" />
        <div className="relative px-6 lg:px-10 pt-8 pb-8">
          <p className="text-[10px] font-bold text-blue-500/60 uppercase tracking-[0.2em] mb-1.5">Roofing OS · Admin</p>
          <h1 className="text-[28px] font-black text-white tracking-tight leading-none mb-1">Team Roster</h1>
          <p className="text-gray-500 text-sm">{Object.values(employees).reduce((n, arr) => n + arr.length, 0)} employees across {contractors.length} contractors</p>
        </div>
      </div>

      {/* Role legend */}
      <div className="px-6 lg:px-10 py-4 flex flex-wrap gap-2 border-b border-white/[0.04]">
        {ROLES.map(r => (
          <span key={r} className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${ROLE_META[r]?.color}`}>
            {ROLE_META[r]?.label}
          </span>
        ))}
      </div>

      <div className="px-6 lg:px-10 py-6 space-y-4">
        {contractors.length === 0 ? (
          <div className="bg-gray-900 border border-dashed border-gray-800 rounded-xl py-12 text-center">
            <p className="text-gray-500 text-sm">No contractor accounts yet.</p>
          </div>
        ) : contractors.map(account => {
          const emps = employees[account.id] || []
          const isExpanded = expandedId === account.id

          return (
            <div key={account.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* Account row */}
              <div
                onClick={() => setExpandedId(isExpanded ? null : account.id)}
                className="px-5 py-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
                    {(account.company_name || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate">{account.company_name}</p>
                    <p className="text-gray-500 text-xs">{emps.length} employee{emps.length !== 1 ? 's' : ''} · {account.plan || 'free'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    account.subscription_status === 'active'
                      ? 'bg-green-900/40 text-green-400'
                      : 'bg-gray-800 text-gray-500'
                  }`}>
                    {account.subscription_status || 'inactive'}
                  </span>
                  <span className="text-gray-600 text-sm">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>

              {isExpanded && (
                <>
                  {/* Employee list */}
                  <div className="border-t border-gray-800 divide-y divide-gray-800/60">
                    {emps.length === 0 ? (
                      <p className="px-5 py-4 text-gray-600 text-sm">No employees yet.</p>
                    ) : emps.map(emp => {
                      const meta = ROLE_META[emp.role] || ROLE_META.crew_member
                      return (
                        <div key={emp.id} className="px-5 py-3 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-gray-400">
                              {(emp.name || '?')[0].toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-white">{emp.name}{emp.is_owner && ' 👑'}</p>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${meta.color}`}>{meta.label}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{emp.phone || 'No phone'}</p>
                            <p className="text-[10px] text-gray-600 mt-0.5">{meta.perms.join(' · ')}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {emp.phone && (
                              <button
                                onClick={() => sendSmsInvite(emp, account.id)}
                                className={`text-xs px-2 py-1 rounded transition-colors ${
                                  inviteSent[emp.id]
                                    ? 'bg-green-900/40 text-green-400'
                                    : 'bg-blue-900/30 text-blue-400 hover:bg-blue-900/50'
                                }`}
                              >
                                {inviteSent[emp.id] ? '✓ Sent' : 'Invite'}
                              </button>
                            )}
                            {!emp.is_owner && (
                              <button
                                onClick={() => removeEmployee(emp.id)}
                                className="text-gray-600 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-900/20 transition-colors"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Add employee */}
                  <div className="border-t border-gray-800 px-5 py-4 bg-gray-950/40">
                    {addingTo === account.id ? (
                      <div>
                        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">New Employee</p>
                        <div className="flex gap-2 flex-wrap mb-2">
                          <input
                            type="text"
                            placeholder="Full name *"
                            value={form.name}
                            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-600/60 flex-1 min-w-[140px]"
                          />
                          <input
                            type="tel"
                            placeholder="Phone"
                            value={form.phone}
                            onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-600/60 w-36"
                          />
                          <select
                            value={form.role}
                            onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-600/60"
                          >
                            {ROLES.map(r => <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>)}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => addEmployee(account.id)}
                            disabled={saving || !form.name.trim()}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-all"
                          >
                            {saving ? 'Adding…' : '+ Add Employee'}
                          </button>
                          <button
                            onClick={() => { setAddingTo(null); setForm({ name: '', phone: '', role: 'crew_member' }) }}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg px-4 py-2 text-sm transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingTo(account.id)}
                        className="text-sm text-gray-500 hover:text-white transition-colors font-medium"
                      >
                        + Add employee to {account.company_name}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

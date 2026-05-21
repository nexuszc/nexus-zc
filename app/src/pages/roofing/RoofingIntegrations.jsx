import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const INTEGRATIONS = [
  {
    id: 'companycam',
    name: 'CompanyCam',
    description: 'Auto-sync job photos directly to homeowner portals.',
    logo: '📷',
    color: 'blue',
    field: 'access_token',
    fieldLabel: 'API Token',
    fieldPlaceholder: 'Paste your CompanyCam API token',
    fn: 'roofing-integration-companycam',
  },
  {
    id: 'acculynx',
    name: 'AccuLynx',
    description: 'Import jobs and homeowner data from AccuLynx.',
    logo: '🏗️',
    color: 'orange',
    field: 'api_key',
    fieldLabel: 'API Key',
    fieldPlaceholder: 'AccuLynx API key',
    fn: 'roofing-integration-crm',
  },
  {
    id: 'jobnimbus',
    name: 'JobNimbus',
    description: 'Pull contacts and jobs from JobNimbus automatically.',
    logo: '⚡',
    color: 'yellow',
    field: 'api_key',
    fieldLabel: 'API Key',
    fieldPlaceholder: 'JobNimbus API key',
    fn: 'roofing-integration-crm',
  },
  {
    id: 'leap',
    name: 'Leap',
    description: 'Sync estimates and job data from Leap.',
    logo: '🦘',
    color: 'green',
    field: 'api_key',
    fieldLabel: 'API Key',
    fieldPlaceholder: 'Leap API key',
    fn: 'roofing-integration-crm',
  },
  {
    id: 'roofr',
    name: 'Roofr',
    description: 'Import quotes and measurements from Roofr.',
    logo: '🏠',
    color: 'purple',
    field: 'api_key',
    fieldLabel: 'API Key',
    fieldPlaceholder: 'Roofr API key',
    fn: 'roofing-integration-crm',
  },
  {
    id: 'improveit360',
    name: 'Improveit360',
    description: 'Sync leads and jobs from Improveit360.',
    logo: '📊',
    color: 'teal',
    field: 'api_key',
    fieldLabel: 'API Key',
    fieldPlaceholder: 'Improveit360 API key',
    fn: 'roofing-integration-crm',
  },
  {
    id: 'custom',
    name: 'Custom Webhook',
    description: 'Send jobs to Roofing OS from any system via webhook.',
    logo: '🔗',
    color: 'gray',
    field: null,
    fieldLabel: null,
    fieldPlaceholder: null,
    fn: 'roofing-integration-webhook',
    isWebhook: true,
  },
]

const STATUS_STYLE = {
  active:    'text-green-400 bg-green-900/20 border-green-600/30',
  pending:   'text-yellow-400 bg-yellow-900/20 border-yellow-600/30',
  error:     'text-red-400 bg-red-900/20 border-red-600/30',
  inactive:  'text-gray-500 bg-gray-900/20 border-gray-700/30',
}

export default function RoofingIntegrations() {
  const { contractor } = useContractor()
  const contractorId = contractor?.id
  const [statuses, setStatuses] = useState({})
  const [connecting, setConnecting] = useState(null)
  const [syncing, setSyncing] = useState(null)
  const [credentials, setCredentials] = useState({})
  const [messages, setMessages] = useState({})
  const [webhookUrl, setWebhookUrl] = useState('')

  useEffect(() => {
    if (!contractorId) return
    loadStatuses()
    setWebhookUrl(`${SUPABASE_URL}/functions/v1/roofing-integration-webhook?contractor_id=${contractorId}`)
  }, [contractorId])

  async function loadStatuses() {
    const { data } = await supabase
      .from('contractor_integrations')
      .select('integration_type, status, last_sync_at, total_records_synced')
      .eq('contractor_id', contractorId)
    const map = {}
    for (const row of data || []) map[row.integration_type] = row
    setStatuses(map)
  }

  async function connect(integration) {
    const credVal = credentials[integration.id]
    if (integration.field && !credVal?.trim()) {
      setMessages(m => ({ ...m, [integration.id]: `${integration.fieldLabel} is required.` }))
      return
    }
    setConnecting(integration.id)
    setMessages(m => ({ ...m, [integration.id]: '' }))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const body = {
        action: 'connect',
        contractor_id: contractorId,
        crm_type: integration.id,
        [integration.field || 'api_key']: credVal,
      }
      const fn = integration.fn === 'roofing-integration-companycam' ? integration.fn : 'roofing-integration-crm'
      if (integration.fn === 'roofing-integration-companycam') body.access_token = credVal
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.ok) {
        setMessages(m => ({ ...m, [integration.id]: 'Connected successfully.' }))
        setCredentials(c => ({ ...c, [integration.id]: '' }))
        loadStatuses()
      } else {
        setMessages(m => ({ ...m, [integration.id]: data.error || 'Connection failed.' }))
      }
    } catch {
      setMessages(m => ({ ...m, [integration.id]: 'Network error.' }))
    }
    setConnecting(null)
  }

  async function syncNow(integration) {
    setSyncing(integration.id)
    setMessages(m => ({ ...m, [integration.id]: '' }))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const fn = integration.fn === 'roofing-integration-companycam' ? integration.fn : 'roofing-integration-crm'
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'sync', contractor_id: contractorId, crm_type: integration.id })
      })
      const data = await res.json()
      if (data.ok) {
        const msg = data.photos_created !== undefined
          ? `Synced — ${data.photos_created} photos imported.`
          : `Synced — ${data.jobs_created || 0} jobs created, ${data.jobs_updated || 0} updated.`
        setMessages(m => ({ ...m, [integration.id]: msg }))
        loadStatuses()
      } else {
        setMessages(m => ({ ...m, [integration.id]: data.error || 'Sync failed.' }))
      }
    } catch {
      setMessages(m => ({ ...m, [integration.id]: 'Network error.' }))
    }
    setSyncing(null)
  }

  async function disconnect(integration) {
    const { data: { session } } = await supabase.auth.getSession()
    const fn = integration.fn === 'roofing-integration-companycam' ? integration.fn : 'roofing-integration-crm'
    await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'disconnect', contractor_id: contractorId, crm_type: integration.id })
    })
    loadStatuses()
  }

  return (
    <div className="animate-fade-in px-6 lg:px-10 py-8">
      <div className="mb-8">
        <p className="text-[10px] font-bold text-orange-600/60 uppercase tracking-[0.2em] mb-1">Roofing OS · Integrations</p>
        <h1 className="text-[28px] font-black text-white tracking-tight leading-none mb-1">Integrations</h1>
        <p className="text-gray-500 text-sm">Connect your tools. Data flows automatically.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {INTEGRATIONS.map(integration => {
          const status = statuses[integration.id]
          const isActive = status?.status === 'active'
          const isBusy = connecting === integration.id || syncing === integration.id
          const msg = messages[integration.id]

          return (
            <div key={integration.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{integration.logo}</span>
                  <div>
                    <h3 className="text-white font-bold text-sm">{integration.name}</h3>
                    <p className="text-gray-500 text-xs mt-0.5">{integration.description}</p>
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-lg border shrink-0 ${STATUS_STYLE[status?.status || 'inactive']}`}>
                  {status?.status || 'Not connected'}
                </span>
              </div>

              {isActive && (
                <div className="bg-gray-800 rounded-xl p-3 mb-4 text-xs text-gray-400">
                  Last sync: {status.last_sync_at ? new Date(status.last_sync_at).toLocaleString() : 'Never'}
                  {status.total_records_synced > 0 && ` · ${status.total_records_synced} records`}
                </div>
              )}

              {integration.isWebhook ? (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Send POST requests to this URL:</p>
                  <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-xs font-mono text-cyan-400 break-all mb-3">
                    {webhookUrl}
                  </div>
                  <p className="text-xs text-gray-600">Include <code className="text-gray-400">homeowner_name</code>, <code className="text-gray-400">property_address</code>, <code className="text-gray-400">external_id</code> in the JSON body.</p>
                </div>
              ) : !isActive ? (
                <div className="space-y-3">
                  {integration.field && (
                    <input
                      type="password"
                      value={credentials[integration.id] || ''}
                      onChange={e => setCredentials(c => ({ ...c, [integration.id]: e.target.value }))}
                      placeholder={integration.fieldPlaceholder}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-xs placeholder-gray-600 focus:border-orange-500 focus:outline-none"
                    />
                  )}
                  <button
                    onClick={() => connect(integration)}
                    disabled={isBusy}
                    className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
                  >
                    {connecting === integration.id ? 'Connecting…' : `Connect ${integration.name}`}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => syncNow(integration)}
                    disabled={isBusy}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-semibold py-2 rounded-xl transition-colors text-sm"
                  >
                    {syncing === integration.id ? 'Syncing…' : 'Sync Now'}
                  </button>
                  <button
                    onClick={() => disconnect(integration)}
                    className="px-4 py-2 text-gray-500 hover:text-red-400 text-sm font-semibold rounded-xl border border-gray-700 hover:border-red-900/40 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              )}

              {msg && (
                <p className={`text-xs mt-2 ${msg.includes('ailed') || msg.includes('error') || msg.includes('required') ? 'text-red-400' : 'text-green-400'}`}>
                  {msg}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

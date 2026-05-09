import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DOC_ICONS = {
  invoice: '🧾',
  contract: '📄',
  sop: '📋',
  pitch: '🎯',
  case_study: '📈',
  weekly_digest: '📊',
  status_update: '🔄',
  report: '📊',
  proposal: '📝',
  script: '🎙️',
  onepager: '📃',
  ad_copy: '📣',
}

export default function Documents() {
  const [docs, setDocs] = useState([])
  const [clients, setClients] = useState([])
  const [filter, setFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('generated_docs').select('*, clients(name)').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('status', 'active'),
    ]).then(([{ data: d }, { data: c }]) => {
      setDocs(d || [])
      setClients(c || [])
      setLoading(false)
    })
  }, [])

  const filtered = docs.filter(d => {
    if (filter !== 'all' && d.doc_type !== filter) return false
    if (clientFilter !== 'all' && d.client_id !== clientFilter) return false
    return true
  })

  const docTypes = [...new Set(docs.map(d => d.doc_type))]

  if (loading) return <p className="text-gray-400">Loading...</p>

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold text-white mb-6">Documents</h2>

      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={filter} onChange={e => setFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-white text-sm outline-none">
          <option value="all">All types</option>
          {docTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-white text-sm outline-none">
          <option value="all">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-gray-500 text-sm self-center">{filtered.length} docs</span>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {filtered.map(doc => (
          <div key={doc.id}
            onClick={() => setSelected(selected?.id === doc.id ? null : doc)}
            className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-4 cursor-pointer transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span>{DOC_ICONS[doc.doc_type] || '📄'}</span>
                  <p className="text-white font-medium text-sm truncate">{doc.title}</p>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-gray-500">{doc.doc_type.replace(/_/g, ' ')}</span>
                  {doc.clients?.name && <span className="text-xs text-blue-400">· {doc.clients.name}</span>}
                  <span className="text-xs text-gray-600">· {new Date(doc.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <span className="text-gray-600 text-sm shrink-0">{selected?.id === doc.id ? '▲' : '▼'}</span>
            </div>

            {selected?.id === doc.id && (
              <div className="mt-4 pt-4 border-t border-gray-800">
                <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans">{doc.content}</pre>
                <button
                  onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(doc.content) }}
                  className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                  Copy to clipboard
                </button>
              </div>
            )}
          </div>
        ))}
        {!filtered.length && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
            <p className="text-gray-500">No documents yet.</p>
            <p className="text-gray-600 text-sm mt-1">Generate one via Telegram: "generate invoice: Brian | for: VA services | amount: $2800"</p>
          </div>
        )}
      </div>
    </div>
  )
}

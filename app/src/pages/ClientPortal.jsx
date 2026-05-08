import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ClientPortal() {
  const { token } = useParams()
  const [client, setClient] = useState(null)
  const [activity, setActivity] = useState([])
  const [callStats, setCallStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    loadPortal()
  }, [token])

  const loadPortal = async () => {
    const { data: access } = await supabase
      .from('client_portal_access')
      .select('client_id, clients(*)')
      .eq('access_token', token)
      .maybeSingle()

    if (!access) {
      setError('Invalid portal link')
      setLoading(false)
      return
    }

    const clientData = access.clients
    setClient(clientData)

    await supabase.from('client_portal_access')
      .update({ last_accessed: new Date().toISOString() })
      .eq('access_token', token)

    const { data: entries } = await supabase
      .from('entries')
      .select('content, entry_type, created_at')
      .eq('client_id', access.client_id)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(10)

    setActivity(entries || [])

    const { data: calls } = await supabase
      .from('call_logs')
      .select('outcome')
      .eq('client_id', access.client_id)

    const stats = (calls || []).reduce((acc, c) => {
      acc[c.outcome] = (acc[c.outcome] || 0) + 1
      return acc
    }, {})

    setCallStats(stats)
    setLoading(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: '#0a0a0a' }}>
      <p style={{ color: '#9ca3af' }}>Loading...</p>
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center h-screen" style={{ background: '#0a0a0a' }}>
      <p style={{ color: '#ef4444' }}>{error}</p>
    </div>
  )

  const brandColor = client?.brand_color || '#3b82f6'
  const brandName = client?.brand_name || client?.name
  const totalCalls = Object.values(callStats).reduce((a, b) => a + b, 0)

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: 'white', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#111', borderBottom: '1px solid #222', padding: '20px 24px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {client?.brand_logo_url && (
            <img src={client.brand_logo_url} alt={brandName} style={{ height: '32px' }} />
          )}
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: brandColor }}>{brandName}</h1>
        </div>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px' }}>Your Dashboard</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
          {[
            { label: 'Interested', value: callStats.interested || 0, color: '#22c55e' },
            { label: 'Callbacks', value: callStats.callback || 0, color: '#eab308' },
            { label: 'Total Calls', value: totalCalls, color: brandColor },
          ].map(s => (
            <div key={s.label} style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
              <p style={{ fontSize: '32px', fontWeight: '700', color: s.color }}>{s.value}</p>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>{s.label}</p>
            </div>
          ))}
        </div>

        <div style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#9ca3af', marginBottom: '12px' }}>RECENT ACTIVITY</h3>
          {activity.map((a, i) => (
            <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid #1f2937' }}>
              <p style={{ fontSize: '14px', color: 'white' }}>{a.content.slice(0, 150)}</p>
              <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                {new Date(a.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
          {activity.length === 0 && (
            <p style={{ color: '#6b7280', fontSize: '14px' }}>No activity yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}

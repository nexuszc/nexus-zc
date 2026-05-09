import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useContractor } from '../../context/ContractorContext'

const STEPS = ['Company Info', 'Brand', 'Notifications', 'Done']

export default function RoofingOnboarding() {
  const navigate = useNavigate()
  const { contractorClientId, contractor } = useContractor()
  const clientData = contractor?.clients || {}

  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: clientData.name || '',
    phone: clientData.phone || '',
    service_area: clientData.service_area || '',
    contractor_license: clientData.contractor_license || '',
    primary_color: clientData.primary_color || '#1a1a1a',
    company_tagline: clientData.company_tagline || '',
    logo_url: clientData.logo_url || '',
    notification_email: clientData.notification_email || '',
    notify_sms: clientData.notify_sms !== false,
    notify_email: true,
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const complete = async () => {
    setSaving(true)
    await supabase.from('clients').update({
      phone: form.phone,
      service_area: form.service_area,
      contractor_license: form.contractor_license,
      primary_color: form.primary_color,
      company_tagline: form.company_tagline,
      logo_url: form.logo_url,
      notification_email: form.notification_email,
      notify_sms: form.notify_sms,
      notify_email: form.notify_email,
      onboarding_complete: true,
    }).eq('id', contractorClientId)
    setSaving(false)
    navigate('/roofing')
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm outline-none focus:border-blue-500'
  const labelCls = 'block text-xs text-gray-400 mb-1'

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i <= step ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-500'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs hidden sm:block ${i === step ? 'text-white' : 'text-gray-500'}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-blue-600' : 'bg-gray-800'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          {/* STEP 1: Company Info */}
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white">Company Info</h2>
              <p className="text-gray-400 text-sm">Let's set up your Roofing OS account.</p>
              <div>
                <label className={labelCls}>Company Name</label>
                <input value={form.name} disabled className={`${inputCls} opacity-50 cursor-not-allowed`} />
                <p className="text-xs text-gray-600 mt-1">Contact support to change company name</p>
              </div>
              <div>
                <label className={labelCls}>Phone Number</label>
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
                  placeholder="+13035551234" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Service Area</label>
                <input value={form.service_area} onChange={e => set('service_area', e.target.value)}
                  placeholder="e.g. Denver Metro, Front Range" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Contractor License Number</label>
                <input value={form.contractor_license} onChange={e => set('contractor_license', e.target.value)}
                  placeholder="Optional" className={inputCls} />
              </div>
            </div>
          )}

          {/* STEP 2: Brand */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white">Brand Your Portal</h2>
              <p className="text-gray-400 text-sm">Your homeowners will see this when they view their project portal.</p>
              <div>
                <label className={labelCls}>Brand Color</label>
                <div className="flex gap-3 items-center">
                  <input type="color" value={form.primary_color} onChange={e => set('primary_color', e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer border-0 bg-transparent" />
                  <input value={form.primary_color} onChange={e => set('primary_color', e.target.value)}
                    placeholder="#1a1a1a" className={`${inputCls} flex-1`} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Company Tagline</label>
                <input value={form.company_tagline} onChange={e => set('company_tagline', e.target.value)}
                  placeholder="e.g. Denver's Trusted Roofing Experts" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Logo URL</label>
                <input value={form.logo_url} onChange={e => set('logo_url', e.target.value)}
                  placeholder="https://..." className={inputCls} />
                <p className="text-xs text-gray-600 mt-1">Paste a link to your logo image</p>
              </div>

              {/* Portal preview */}
              <div className="mt-4">
                <p className="text-xs text-gray-400 mb-2 font-semibold uppercase">Portal Preview</p>
                <div style={{ background: form.primary_color || '#1a1a1a', borderRadius: '10px 10px 0 0', padding: '16px' }}>
                  {form.logo_url && <img src={form.logo_url} alt="logo" style={{ height: '32px', marginBottom: '6px', objectFit: 'contain' }} />}
                  <p style={{ color: '#fff', fontWeight: '700', fontSize: '16px', margin: 0 }}>{form.name || 'Your Company'}</p>
                  {form.company_tagline && <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '12px', marginTop: '2px' }}>{form.company_tagline}</p>}
                </div>
                <div className="bg-gray-800 rounded-b-lg p-3">
                  <p className="text-gray-400 text-xs">Portal content shown here...</p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Notifications */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white">Notifications</h2>
              <p className="text-gray-400 text-sm">Get notified when homeowners message you or make payments.</p>
              <div>
                <label className={labelCls}>Notification Email</label>
                <input type="email" value={form.notification_email} onChange={e => set('notification_email', e.target.value)}
                  placeholder="you@yourcompany.com" className={inputCls} />
                <p className="text-xs text-gray-600 mt-1">Where you want to receive job alerts</p>
              </div>
              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <div onClick={() => set('notify_sms', !form.notify_sms)}
                    className={`w-10 h-6 rounded-full transition-colors cursor-pointer ${form.notify_sms ? 'bg-blue-600' : 'bg-gray-700'}`}
                    style={{ position: 'relative' }}>
                    <div style={{
                      position: 'absolute', top: '3px', left: form.notify_sms ? '19px' : '3px',
                      width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s'
                    }} />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">SMS Notifications</p>
                    <p className="text-gray-500 text-xs">Text alerts to your phone number</p>
                  </div>
                </label>
              </div>
              {form.notify_sms && !form.phone && (
                <p className="text-yellow-500 text-sm bg-yellow-900/20 rounded-lg p-3">
                  ⚠️ Add a phone number in Step 1 to receive SMS notifications.
                </p>
              )}
              {form.notify_sms && form.phone && (
                <p className="text-green-400 text-sm bg-green-900/20 rounded-lg p-3">
                  ✓ SMS alerts will be sent to {form.phone}
                </p>
              )}
            </div>
          )}

          {/* STEP 4: Done */}
          {step === 3 && (
            <div className="space-y-4 text-center">
              <div className="text-5xl mb-2">🏠</div>
              <h2 className="text-xl font-bold text-white">You're all set!</h2>
              <p className="text-gray-400 text-sm">Your Roofing OS is ready. Create your first job to get started.</p>

              <div className="bg-gray-800 rounded-xl p-4 text-left space-y-2 mt-4">
                <p className="text-xs text-gray-400 font-semibold uppercase">Your Setup</p>
                {form.notification_email && <p className="text-sm text-white">📧 Alerts → {form.notification_email}</p>}
                {form.notify_sms && form.phone && <p className="text-sm text-white">📱 SMS → {form.phone}</p>}
                <p className="text-sm text-white">🎨 Brand color → <span style={{ color: form.primary_color }}>{form.primary_color}</span></p>
                {form.service_area && <p className="text-sm text-white">📍 {form.service_area}</p>}
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-6">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white rounded-lg px-4 py-3 font-medium transition-colors">
                Back
              </button>
            )}
            {step < 3 ? (
              <button onClick={() => setStep(s => s + 1)}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-3 font-medium transition-colors">
                Continue
              </button>
            ) : (
              <button onClick={complete} disabled={saving}
                className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg px-4 py-3 font-medium transition-colors">
                {saving ? 'Saving...' : 'Create My First Job →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

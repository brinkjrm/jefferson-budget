import React, { useEffect, useState } from 'react'

export default function SettingsTab({ settings, onSave }) {
  const [fields, setFields] = useState({ ...settings, borrower: 'Josh Meyer' })
  const [saved, setSaved]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notificationStatus, setNotificationStatus] = useState(null)

  useEffect(() => {
    let active = true
    fetch('/api/notification-status', { headers: { accept: 'application/json' } })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Status unavailable')))
      .then(status => { if (active) setNotificationStatus(status) })
      .catch(() => { if (active) setNotificationStatus({ unavailable: true }) })
    return () => { active = false }
  }, [])

  const f = key => ({
    value: fields[key] || '',
    onChange: e => setFields(p => ({ ...p, [key]: e.target.value })),
    className: 'apple-input w-full',
  })

  async function save() {
    setSaving(true)
    setSaveError('')
    try {
      await onSave({ ...fields, borrower: 'Josh Meyer' })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      setSaveError(error.message || 'Settings could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-lbl font-bold text-xl mb-1">Settings</h2>
      <p className="text-lbl2 text-sm mb-6">Project details, private inbox monitoring, and notification preferences.</p>

      <div className="apple-card p-6 space-y-5">
        {[
          { label: 'Bank Name',          key: 'bank_name',         placeholder: 'e.g. FirstBank' },
          { label: 'Borrower',           key: 'borrower',          placeholder: 'Josh Meyer', disabled: true },
          { label: 'Property Address',   key: 'property_address',  placeholder: '3120 Jefferson St, Boulder CO 80304' },
          { label: 'Builder / GC',       key: 'builder',           placeholder: 'e.g. Marc David Homes' },
          { label: 'Loan Amount',        key: 'loan_amount',       placeholder: 'e.g. 850000' },
          { label: 'Loan Number',        key: 'loan_number',       placeholder: 'From bank (optional)' },
        ].map(({ label, key, placeholder, disabled }) => (
          <div key={key}>
            <label className="text-lbl3 text-xs font-semibold uppercase tracking-widest block mb-1.5">{label}</label>
            <input {...f(key)} placeholder={placeholder}
              disabled={disabled}
              style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}} />
            {disabled && <p className="text-lbl3 text-xs mt-1">Borrower is fixed as Josh Meyer on all draw sheets</p>}
          </div>
        ))}

      </div>

      <div className="apple-card p-6 space-y-5 mt-5">
        <div>
          <div className="text-xs uppercase tracking-widest text-lbl3 mb-1">Project communications</div>
          <h3 className="text-lbl font-semibold text-lg">Daily text briefing</h3>
          <p className="text-lbl2 text-sm mt-1">The private project inbox is checked before a concise briefing is sent each morning.</p>
        </div>

        <div>
          <label className="text-lbl3 text-xs font-semibold uppercase tracking-widest block mb-1.5">Dedicated project email</label>
          <input {...f('project_email')} placeholder="Josh@3120jeffersonst.com" type="email" autoComplete="email" />
          <p className="text-lbl3 text-xs mt-1">Invoices and requests sent here are captured as drafts for review.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <IntegrationStatus label="Project inbox" connected={notificationStatus?.mailbox?.configured} detail={notificationStatus?.mailbox?.configured ? (fields.project_email || 'Connected') : 'Not connected'} loading={!notificationStatus} />
          <IntegrationStatus label="Text delivery" connected={notificationStatus?.sms?.configured} detail={notificationStatus?.sms?.configured ? 'Connected securely' : 'Not connected'} loading={!notificationStatus} />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-apple p-4" style={{ background: '#2c2c2e' }}>
          <div>
            <div className="text-lbl text-sm font-medium">Send the daily briefing</div>
            <div className="text-lbl3 text-xs mt-1 leading-5">
              By enabling, you agree to receive up to one automated project briefing per day at the project mobile number. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase. See our <a className="text-acc" href="/terms">Terms</a> and <a className="text-acc" href="/privacy">Privacy Policy</a>.
            </div>
          </div>
          <button type="button" role="switch" aria-label="Consent to daily text briefings" aria-checked={fields.daily_sms_enabled === 'true'}
            onClick={() => setFields(previous => {
              const enabling = previous.daily_sms_enabled !== 'true'
              return {
                ...previous,
                daily_sms_enabled: enabling ? 'true' : 'false',
                ...(enabling ? { daily_sms_consent_at: new Date().toISOString() } : {}),
              }
            })}
            className="relative rounded-full flex-shrink-0 transition-colors"
            style={{ width: 48, height: 28, background: fields.daily_sms_enabled === 'true' ? '#30d158' : '#48484a' }}>
            <span className="absolute rounded-full bg-white transition-all"
              style={{ width: 22, height: 22, top: 3, left: fields.daily_sms_enabled === 'true' ? 23 : 3 }} />
          </button>
        </div>

        {notificationStatus?.unavailable && (
          <p className="text-xs" style={{ color: '#ff9f0a' }}>Connection status will appear after the notification service is deployed.</p>
        )}
        {notificationStatus && !notificationStatus.unavailable && (!notificationStatus.mailbox?.configured || !notificationStatus.sms?.configured || !notificationStatus.scheduler?.configured) && (
          <p className="text-xs" style={{ color: '#ff9f0a' }}>The feature is installed but still needs its private mailbox and texting credentials connected in Vercel.</p>
        )}

        <div className="pt-1">
          <button onClick={save} disabled={saving}
            className="btn-primary px-6 py-2.5 text-sm"
            style={{ background: saved ? '#30d158' : '#0a84ff', opacity: saving ? 0.65 : 1 }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
          </button>
          {saveError && <p className="text-xs mt-2" style={{ color: '#ff453a' }}>{saveError}</p>}
        </div>
      </div>

      <div className="mt-5 rounded-apple p-4 text-sm text-lbl2"
        style={{ background: 'rgba(10,132,255,0.1)', border: '1px solid rgba(10,132,255,0.2)' }}>
        <strong className="text-acc">Privacy:</strong> The phone number, mailbox password, and texting credentials remain server-side and are never stored in the browser.
      </div>
    </div>
  )
}

function IntegrationStatus({ label, connected, detail, loading }) {
  return (
    <div className="rounded-apple p-3" style={{ background: '#2c2c2e', border: '1px solid rgba(84,84,88,0.38)' }}>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ background: loading ? '#8e8e93' : connected ? '#30d158' : '#ff9f0a' }} />
        <span className="text-lbl text-sm font-medium">{label}</span>
      </div>
      <div className="text-lbl3 text-xs mt-1 truncate">{loading ? 'Checking connection…' : detail}</div>
    </div>
  )
}

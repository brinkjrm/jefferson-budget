import React, { useState } from 'react'

export default function SettingsTab({ settings, onSave }) {
  const [fields, setFields] = useState({ ...settings, borrower: 'Josh Meyer' })
  const [saved, setSaved]   = useState(false)

  const f = key => ({
    value: fields[key] || '',
    onChange: e => setFields(p => ({ ...p, [key]: e.target.value })),
    className: 'apple-input w-full',
  })

  async function save() {
    await onSave({ ...fields, borrower: 'Josh Meyer' })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-xl">
      <h2 className="text-lbl font-bold text-xl mb-1">Settings</h2>
      <p className="text-lbl2 text-sm mb-6">These values pre-fill new draw sheets and PDFs.</p>

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

        <div className="pt-2">
          <button onClick={save}
            className="btn-primary px-6 py-2.5 text-sm"
            style={{ background: saved ? '#30d158' : '#0a84ff' }}>
            {saved ? '✓ Saved' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-apple p-4 text-sm text-lbl2"
        style={{ background: 'rgba(10,132,255,0.1)', border: '1px solid rgba(10,132,255,0.2)' }}>
        <strong className="text-acc">Tip:</strong> Changes here affect new draw sheets only. Open an existing draw sheet to edit its fields directly.
      </div>
    </div>
  )
}

import React, { useState } from 'react'

export default function SettingsTab({ settings, onSave }) {
  const [fields, setFields] = useState({ ...settings })
  const [saved, setSaved] = useState(false)

  function f(key) {
    return {
      value: fields[key] || '',
      onChange: e => setFields(p => ({ ...p, [key]: e.target.value })),
      className: 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:bg-blue-50',
    }
  }

  async function save() {
    await onSave(fields)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-bold text-gray-800 mb-1">Settings</h2>
      <p className="text-sm text-gray-500 mb-6">These values will pre-fill new draw sheets and PDFs.</p>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        {[
          { label: 'Bank Name', key: 'bank_name', placeholder: 'e.g. FirstBank' },
          { label: 'Borrower Name', key: 'borrower', placeholder: 'e.g. Josh & Cortney Meyer' },
          { label: 'Property Address', key: 'property_address', placeholder: 'e.g. 3120 Jefferson St, Boulder CO 80304' },
          { label: 'Builder / GC Name', key: 'builder', placeholder: 'e.g. Marc David Homes' },
          { label: 'Loan Amount', key: 'loan_amount', placeholder: 'e.g. 850000' },
          { label: 'Loan Number', key: 'loan_number', placeholder: 'Optional — from bank' },
        ].map(({ label, key, placeholder }) => (
          <div key={key}>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
            <input {...f(key)} placeholder={placeholder} />
          </div>
        ))}

        <div className="pt-2">
          <button
            onClick={save}
            className={`px-6 py-2 rounded-lg font-medium text-sm transition-colors ${saved ? 'bg-green-600 text-white' : 'bg-blue-700 text-white hover:bg-blue-800'}`}
          >
            {saved ? '✓ Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <strong>Tip:</strong> Changes here only affect <em>new</em> draw sheets. To update an existing draw sheet, open it and edit the fields directly.
      </div>
    </div>
  )
}

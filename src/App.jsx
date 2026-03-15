import React, { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import BudgetTab from './components/BudgetTab.jsx'
import PrepaidTab from './components/PrepaidTab.jsx'
import DrawsTab from './components/DrawsTab.jsx'
import SettingsTab from './components/SettingsTab.jsx'

const TABS = ['Budget', 'Prepaid Items', 'Draw Sheets', 'Settings']

export default function App() {
  const [tab, setTab] = useState('Budget')
  const [settings, setSettings] = useState({
    bank_name: 'FirstBank',
    borrower: 'Josh & Cortney Meyer',
    property_address: '3120 Jefferson St, Boulder CO 80304',
    builder: 'Marc David Homes',
    loan_amount: '',
    loan_number: '',
  })
  const [dbOk, setDbOk] = useState(null)

  useEffect(() => {
    loadSettings()
    checkConnection()
  }, [])

  async function checkConnection() {
    const { error } = await supabase.from('line_items').select('id').limit(1)
    setDbOk(!error)
  }

  async function loadSettings() {
    const { data } = await supabase.from('settings').select('*')
    if (data && data.length) {
      const s = {}
      data.forEach(r => { s[r.key] = r.value })
      setSettings(prev => ({ ...prev, ...s }))
    }
  }

  async function saveSettings(newSettings) {
    setSettings(newSettings)
    const upserts = Object.entries(newSettings).map(([key, value]) => ({ key, value: String(value) }))
    await supabase.from('settings').upsert(upserts, { onConflict: 'key' })
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top bar */}
      <header className="bg-blue-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight">3120 Jefferson St · Budget Manager</h1>
            <p className="text-blue-300 text-xs">Boulder CO 80304</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${dbOk === null ? 'bg-yellow-400' : dbOk ? 'bg-green-400' : 'bg-red-400'}`}></span>
            <span className="text-xs text-blue-200">{dbOk === null ? 'Connecting…' : dbOk ? 'Connected' : 'DB Error — check console'}</span>
          </div>
        </div>
        {/* Tabs */}
        <nav className="max-w-7xl mx-auto px-4 flex gap-1 pb-0">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-medium rounded-t transition-colors ${
                tab === t
                  ? 'bg-gray-100 text-blue-900'
                  : 'text-blue-200 hover:text-white hover:bg-blue-800'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {tab === 'Budget'        && <BudgetTab settings={settings} />}
        {tab === 'Prepaid Items' && <PrepaidTab />}
        {tab === 'Draw Sheets'   && <DrawsTab settings={settings} />}
        {tab === 'Settings'      && <SettingsTab settings={settings} onSave={saveSettings} />}
      </main>
    </div>
  )
}

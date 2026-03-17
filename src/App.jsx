import React, { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import BudgetTab from './components/BudgetTab.jsx'
import PrepaidTab from './components/PrepaidTab.jsx'
import DrawsTab from './components/DrawsTab.jsx'
import SettingsTab from './components/SettingsTab.jsx'
import ScheduleTab from './components/ScheduleTab.jsx'
import BidsTab from './components/BidsTab.jsx'
import SelectionsTab from './components/SelectionsTab.jsx'
import ChatPanel from './components/ChatPanel.jsx'

const TABS = [
  { id: 'Budget',        label: 'Budget'      },
  { id: 'Schedule',      label: 'Schedule'    },
  { id: 'Bids',          label: 'Bids'        },
  { id: 'Selections',    label: 'Selections'  },
  { id: 'Prepaid Items', label: 'Prepaid'     },
  { id: 'Draw Sheets',   label: 'Draw Sheets' },
  { id: 'Settings',      label: 'Settings'    },
]

export default function App() {
  const [tab, setTab]           = useState('Budget')
  const [settings, setSettings] = useState({
    bank_name: 'FirstBank',
    borrower: 'Josh Meyer',
    property_address: '3120 Jefferson St, Boulder CO 80304',
    builder: 'Marc David Homes',
    loan_amount: '',
    loan_number: '',
  })
  const [dbOk, setDbOk] = useState(null)

  useEffect(() => { loadSettings(); checkConnection() }, [])

  async function checkConnection() {
    const { error } = await supabase.from('line_items').select('id').limit(1)
    setDbOk(!error)
  }

  async function loadSettings() {
    const { data } = await supabase.from('settings').select('*')
    if (data?.length) {
      const s = {}
      data.forEach(r => { s[r.key] = r.value })
      setSettings(prev => ({ ...prev, ...s, borrower: 'Josh Meyer' }))
    }
  }

  async function saveSettings(newSettings) {
    const safe = { ...newSettings, borrower: 'Josh Meyer' }
    setSettings(safe)
    const upserts = Object.entries(safe).map(([key, value]) => ({ key, value: String(value) }))
    await supabase.from('settings').upsert(upserts, { onConflict: 'key' })
  }

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>

      {/* ── Top nav ── */}
      <header className="glass sticky top-0 z-50" style={{ borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex items-center justify-between py-3">
            <div>
              <h1 className="text-white font-bold tracking-tight" style={{ fontSize: 17 }}>
                3120 Jefferson St
              </h1>
              <p className="text-lbl2 text-xs tracking-wide">Budget Manager</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full"
                style={{ background: dbOk === null ? '#ffd60a' : dbOk ? '#30d158' : '#ff453a' }} />
              <span className="text-lbl3 text-xs">
                {dbOk === null ? 'Connecting' : dbOk ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>

          <nav className="flex gap-1 pb-2">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 text-sm font-medium rounded-apple transition-all ${
                  tab === t.id ? 'tab-active' : 'text-lbl2 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="max-w-6xl mx-auto px-5 py-6">
        {tab === 'Budget'        && <BudgetTab settings={settings} />}
        {tab === 'Schedule'      && <ScheduleTab />}
        {tab === 'Bids'          && <BidsTab />}
        {tab === 'Selections'    && <SelectionsTab />}
        {tab === 'Prepaid Items' && <PrepaidTab />}
        {tab === 'Draw Sheets'   && <DrawsTab settings={settings} />}
        {tab === 'Settings'      && <SettingsTab settings={settings} onSave={saveSettings} />}
      </main>

      {/* ── Floating chat button (always visible) ── */}
      <ChatPanel />
    </div>
  )
}

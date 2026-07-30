import React, { lazy, Suspense, useState } from 'react'
import { useProject } from './context/ProjectContext.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import ExecutiveDashboard from './components/ExecutiveDashboard.jsx'
import LegalPage from './components/LegalPage.jsx'

const BudgetTab = lazy(() => import('./components/BudgetTab.jsx'))
const PrepaidTab = lazy(() => import('./components/PrepaidTab.jsx'))
const DrawsTab = lazy(() => import('./components/DrawsTab.jsx'))
const SettingsTab = lazy(() => import('./components/SettingsTab.jsx'))
const ScheduleTab = lazy(() => import('./components/ScheduleTab.jsx'))
const BidsTab = lazy(() => import('./components/BidsTab.jsx'))
const SelectionsTab = lazy(() => import('./components/SelectionsTab.jsx'))
const PlansTab = lazy(() => import('./components/PlansTab.jsx'))

const TABS = [
  { id: 'Overview',      label: 'Overview'    },
  { id: 'Budget',        label: 'Budget'      },
  { id: 'Schedule',      label: 'Schedule'    },
  { id: 'Bids',          label: 'Bids'        },
  { id: 'Selections',    label: 'Selections'  },
  { id: 'Plans',         label: 'Plans'       },
  { id: 'Prepaid Items', label: 'Prepaid'     },
  { id: 'Draw Sheets',   label: 'Draw Sheets' },
  { id: 'Settings',      label: 'Settings'    },
]

export default function App() {
  const [tab, setTab] = useState('Overview')
  const { model, connection, setCollection, supabase } = useProject()
  const settings = model.settings
  const legalPage = window.location.pathname.replace(/\/$/, '')

  if (legalPage === '/privacy') return <LegalPage page="privacy" />
  if (legalPage === '/terms') return <LegalPage page="terms" />

  async function saveSettings(newSettings) {
    const safe = { ...newSettings, borrower: 'Josh Meyer' }
    const upserts = Object.entries(safe).map(([key, value]) => ({ key, value: String(value) }))
    const { data, error } = await supabase.from('settings').upsert(upserts, { onConflict: 'key' }).select()
    if (error) throw error
    setCollection('settings', data || upserts)
  }

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>

      {/* ── Top nav ── */}
      <header className="glass sticky top-0 z-50" style={{ borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex items-center justify-between py-3">
            <div>
              <h1 className="text-white font-bold tracking-tight" style={{ fontSize: 17 }}>
                {model.project.address?.split(',')[0] || model.project.name}
              </h1>
              <p className="text-lbl2 text-xs tracking-wide">Construction Manager</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full"
                style={{ background: connection === 'connecting' ? '#ffd60a' : connection === 'live' ? '#30d158' : '#ff9f0a' }} />
              <span className="text-lbl3 text-xs">
                {connection === 'connecting' ? 'Connecting' : connection === 'live' ? 'Live' : 'Limited'}
              </span>
            </div>
          </div>

          <nav className="flex gap-1 pb-2 overflow-x-auto whitespace-nowrap">
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
        <Suspense fallback={<div className="text-center py-24 text-lbl3 text-sm">Opening view…</div>}>
          {tab === 'Overview'      && <ExecutiveDashboard onNavigate={setTab} />}
          {tab === 'Budget'        && <BudgetTab settings={settings} />}
          {tab === 'Schedule'      && <ScheduleTab />}
          {tab === 'Bids'          && <BidsTab />}
          {tab === 'Selections'    && <SelectionsTab />}
          {tab === 'Plans'         && <PlansTab />}
          {tab === 'Prepaid Items' && <PrepaidTab />}
          {tab === 'Draw Sheets'   && <DrawsTab settings={settings} />}
          {tab === 'Settings'      && <SettingsTab settings={settings} onSave={saveSettings} />}
        </Suspense>
      </main>

      <footer className="max-w-6xl mx-auto px-5 pb-8 flex gap-5 text-xs text-lbl3">
        <a className="hover:text-lbl2" href="/privacy">Privacy</a>
        <a className="hover:text-lbl2" href="/terms">Text Messaging Terms</a>
      </footer>

      {/* ── Floating chat button (always visible) ── */}
      <ChatPanel />
    </div>
  )
}

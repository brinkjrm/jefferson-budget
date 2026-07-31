import React, { useEffect, useMemo, useState } from 'react'
import {
  addCalendarDays,
  diffCalendarDays,
  formatShortDate,
  maxDate,
  minDate,
  startOfWeek,
  workdayDuration,
} from '../lib/scheduleDates.js'

const TABS = ['Schedule', 'Selections', 'Plans']
const PHASE_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#32ade6', '#ff6b6b', '#ffd60a', '#5e5ce6']
const STATUS = {
  not_started: { label: 'Not Started', color: '#8e8e93' },
  in_progress: { label: 'In Progress', color: '#0a84ff' },
  complete: { label: 'Complete', color: '#30d158' },
  blocked: { label: 'Blocked', color: '#ff453a' },
  TBD: { label: 'TBD', color: '#8e8e93' },
  CONSIDERING: { label: 'Considering', color: '#ffd60a' },
  SELECTED: { label: 'Selected', color: '#30d158' },
}

function formatSize(bytes) {
  if (!bytes) return ''
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

export default function SharedProjectPage({ token, initialTab = 'Schedule' }) {
  const [tab, setTab] = useState(TABS.includes(initialTab) ? initialTab : 'Schedule')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch(`/api/shared-project?token=${encodeURIComponent(token)}`, { headers: { accept: 'application/json' } })
      .then(response => response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error || 'Link unavailable'))))
      .then(result => { if (active) setData(result) })
      .catch(reason => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  const projectName = data?.project?.address?.split(',')[0] || data?.project?.name || '3120 Jefferson Street'

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <header className="glass sticky top-0 z-50" style={{ borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
        <div className="max-w-7xl mx-auto px-5">
          <div className="flex items-center justify-between gap-4 py-3">
            <div>
              <h1 className="text-white font-bold tracking-tight" style={{ fontSize: 17 }}>{projectName}</h1>
              <p className="text-lbl2 text-xs tracking-wide">Shared project portal · View only</p>
            </div>
            <span className="text-xs rounded-full px-3 py-1.5" style={{ color: '#30d158', background: 'rgba(48,209,88,0.12)' }}>Read only</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto whitespace-nowrap" aria-label="Shared project sections">
            {TABS.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`px-4 py-2 text-sm font-medium transition-all ${tab === item ? 'tab-active' : 'text-lbl2 hover:text-white'}`}
              >
                {item}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-6">
        {loading && <div className="text-center py-24 text-lbl3 text-sm">Opening shared project…</div>}
        {error && (
          <div className="apple-card max-w-lg mx-auto p-7 text-center">
            <div className="text-xl mb-3">🔒</div>
            <h2 className="text-white font-semibold">This shared link is unavailable</h2>
            <p className="text-lbl2 text-sm mt-2">{error}</p>
          </div>
        )}
        {!loading && !error && data && (
          <>
            {tab === 'Schedule' && <SharedSchedule tasks={data.schedule || []} />}
            {tab === 'Selections' && <SharedSelections items={data.selections || []} />}
            {tab === 'Plans' && <SharedPlans plans={data.plans || []} />}
          </>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-5 pb-8 text-xs text-lbl3">
        This link permits viewing only. Financials, bids, invoices, draws, settings, and owner tools are not included.
      </footer>
    </div>
  )
}

function SharedSchedule({ tasks }) {
  const [collapsed, setCollapsed] = useState(new Set())
  const phases = useMemo(
    () => tasks.filter(task => !task.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [tasks],
  )
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])
  const children = tasks.filter(task => task.parent_id)
  const dated = children.filter(task => task.start_date && task.end_date)
  const projectStart = minDate(dated.map(task => task.start_date)) || new Date()
  const projectEnd = maxDate(dated.map(task => task.end_date)) || new Date()
  const timelineStart = startOfWeek(addCalendarDays(projectStart, -7))
  const timelineEnd = startOfWeek(addCalendarDays(projectEnd, 21))
  const weekWidth = 52
  const dayWidth = weekWidth / 7
  const listWidth = 440
  const rowHeight = 46
  const weeks = []
  for (let week = new Date(timelineStart); week <= timelineEnd; week = addCalendarDays(week, 7)) weeks.push(new Date(week))
  const rows = []
  phases.forEach((phase, phaseIndex) => {
    const color = phase.color || PHASE_COLORS[phaseIndex % PHASE_COLORS.length]
    rows.push({ task: phase, phase: true, color })
    if (!collapsed.has(phase.id)) {
      tasks
        .filter(task => task.parent_id === phase.id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .forEach(task => rows.push({ task, phase: false, color }))
    }
  })
  const completed = children.filter(task => task.status === 'complete').length
  const inspections = children.filter(task => task.task_type === 'inspection' || /^INSPECTION\s*-/i.test(task.name || '')).length

  return (
    <section>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Summary label="Planned start" value={formatShortDate(projectStart, { includeYear: true })} />
        <Summary label="Planned finish" value={formatShortDate(projectEnd, { includeYear: true })} />
        <Summary label="Working days" value={workdayDuration(projectStart, projectEnd)} detail="Monday–Friday" />
        <Summary label="Progress" value={`${completed}/${children.length}`} detail={`${inspections} inspection gates`} />
      </div>

      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <h2 className="text-white font-bold text-xl">Construction schedule</h2>
          <p className="text-lbl2 text-sm mt-1">Dates use a Monday–Friday work calendar.</p>
        </div>
        <span className="text-lbl3 text-xs hidden sm:block">Scroll horizontally to view the full timeline</span>
      </div>

      <div className="apple-card overflow-auto" style={{ maxHeight: '72vh' }}>
        <div style={{ minWidth: listWidth + weeks.length * weekWidth }}>
          <div className="sticky top-0 z-20 flex" style={{ height: 54, background: '#1c1c1e', borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
            <div className="sticky left-0 z-30 flex items-end gap-3 px-4 pb-2" style={{ width: listWidth, minWidth: listWidth, background: '#1c1c1e', borderRight: '1px solid rgba(84,84,88,0.35)' }}>
              <span className="text-lbl2 uppercase tracking-wider font-semibold" style={{ flex: 1, fontSize: 10 }}>Activity & predecessor</span>
              <span className="text-lbl2 uppercase tracking-wider font-semibold" style={{ width: 70, fontSize: 10 }}>Start</span>
              <span className="text-lbl2 uppercase tracking-wider font-semibold" style={{ width: 70, fontSize: 10 }}>Finish</span>
            </div>
            <div className="flex">
              {weeks.map((week, index) => (
                <div key={week.toISOString()} className="flex items-end justify-center pb-2 text-lbl2" style={{ width: weekWidth, minWidth: weekWidth, borderRight: '1px solid rgba(84,84,88,0.22)', fontSize: 10 }}>
                  {index % 2 === 0 ? formatShortDate(week) : ''}
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            {rows.map(({ task, phase, color }) => {
              const barLeft = diffCalendarDays(timelineStart, task.start_date) * dayWidth
              const barWidth = Math.max((diffCalendarDays(task.start_date, task.end_date) + 1) * dayWidth, phase ? 8 : 6)
              const predecessorNames = (task.depends_on || []).map(id => taskById.get(id)?.name?.replace(/^INSPECTION\s*-\s*/i, '')).filter(Boolean)
              const status = STATUS[task.status] || STATUS.not_started
              const isInspection = task.task_type === 'inspection' || /^INSPECTION\s*-/i.test(task.name || '')
              return (
                <div key={task.id} className="flex" style={{ height: rowHeight, borderBottom: '1px solid rgba(84,84,88,0.18)' }}>
                  <button
                    type="button"
                    onClick={() => phase && setCollapsed(previous => {
                      const next = new Set(previous)
                      next.has(task.id) ? next.delete(task.id) : next.add(task.id)
                      return next
                    })}
                    className="sticky left-0 z-10 text-left px-4"
                    style={{ width: listWidth, minWidth: listWidth, background: phase ? '#252527' : '#1c1c1e', border: 0, borderRight: '1px solid rgba(84,84,88,0.35)', cursor: phase ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 10 }}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingLeft: phase ? 0 : 18 }}>
                      <div className="truncate" style={{ color: phase ? '#fff' : '#ebebf5', fontSize: phase ? 13 : 12, fontWeight: phase ? 700 : 500 }}>
                        {phase && <span style={{ color, marginRight: 7 }}>{collapsed.has(task.id) ? '▶' : '▼'}</span>}
                        {isInspection && <span style={{ color: '#ff9f0a', marginRight: 5 }}>◆</span>}
                        {(task.name || '').replace(/^INSPECTION\s*-\s*/i, '')}
                      </div>
                      {!phase && (
                        <div className="truncate text-lbl3" style={{ fontSize: 10 }}>
                          {predecessorNames.length ? `After: ${predecessorNames.join(', ')}` : (task.trade || status.label)}
                        </div>
                      )}
                    </div>
                    <span className="text-lbl2" style={{ width: 70, fontSize: 10 }}>{formatShortDate(task.start_date)}</span>
                    <span className="text-lbl2" style={{ width: 70, fontSize: 10 }}>{formatShortDate(task.end_date)}</span>
                  </button>
                  <div className="relative" style={{ width: weeks.length * weekWidth, minWidth: weeks.length * weekWidth }}>
                    {weeks.map(week => <span key={week.toISOString()} className="absolute top-0 bottom-0" style={{ left: diffCalendarDays(timelineStart, week) * dayWidth, borderLeft: '1px solid rgba(84,84,88,0.16)' }} />)}
                    {isInspection && !phase ? (
                      <span title="Inspection gate" className="absolute" style={{ left: barLeft - 5, top: 16, width: 12, height: 12, background: '#ff9f0a', transform: 'rotate(45deg)', borderRadius: 2 }} />
                    ) : (
                      <span
                        title={`${task.name}: ${formatShortDate(task.start_date)} – ${formatShortDate(task.end_date)}`}
                        className="absolute"
                        style={{ left: barLeft, top: phase ? 18 : 14, width: barWidth, height: phase ? 10 : 17, borderRadius: phase ? 3 : 6, background: task.status === 'complete' ? '#30d158' : task.status === 'blocked' ? '#ff453a' : color, opacity: phase ? 0.65 : 0.92 }}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function Summary({ label, value, detail }) {
  return (
    <div className="apple-card p-4">
      <div className="text-lbl3 uppercase tracking-wider font-semibold" style={{ fontSize: 10 }}>{label}</div>
      <div className="text-white font-bold text-lg mt-1">{value}</div>
      {detail && <div className="text-lbl3 text-xs mt-0.5">{detail}</div>}
    </div>
  )
}

function SharedSelections({ items }) {
  const [search, setSearch] = useState('')
  const filtered = items.filter(item => {
    const haystack = [item.category, item.section, item.room, item.item_description, item.brand_model, item.status].join(' ').toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  })
  const categories = [...new Set(filtered.map(item => item.category || 'Other'))]

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h2 className="text-white font-bold text-xl">Project selections</h2>
          <p className="text-lbl2 text-sm mt-1">Product decisions and current status. Pricing is private and is not included.</p>
        </div>
        <input className="apple-input text-sm" style={{ width: 240 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search selections…" />
      </div>

      {categories.map(category => {
        const categoryItems = filtered.filter(item => (item.category || 'Other') === category)
        const sections = [...new Set(categoryItems.map(item => item.section || 'General'))]
        return (
          <div key={category} className="apple-card overflow-hidden mb-4">
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#2c2c2e', borderBottom: '1px solid rgba(84,84,88,0.35)' }}>
              <h3 className="text-white font-semibold text-sm">{category}</h3>
              <span className="text-lbl3 text-xs">{categoryItems.length} items</span>
            </div>
            {sections.map(section => (
              <div key={section}>
                <div className="px-4 py-2 text-lbl3 uppercase tracking-wider font-semibold" style={{ fontSize: 10, background: 'rgba(84,84,88,0.08)', borderBottom: '1px solid rgba(84,84,88,0.18)' }}>{section}</div>
                {categoryItems.filter(item => (item.section || 'General') === section).map(item => {
                  const status = STATUS[item.status] || STATUS.TBD
                  const productUrl = safeExternalUrl(item.product_link)
                  return (
                    <div key={item.id} className="grid gap-2 px-4 py-3 items-center" style={{ gridTemplateColumns: 'minmax(90px,0.8fr) minmax(180px,1.7fr) minmax(140px,1.3fr) 100px', borderBottom: '1px solid rgba(84,84,88,0.15)' }}>
                      <div className="text-lbl2 text-xs truncate">{item.room || '—'}</div>
                      <div style={{ minWidth: 0 }}>
                        {productUrl ? <a href={productUrl} target="_blank" rel="noreferrer" className="text-acc text-sm font-medium hover:underline">{item.item_description || 'Untitled item'} ↗</a> : <div className="text-white text-sm font-medium">{item.item_description || 'Untitled item'}</div>}
                        {item.notes && <div className="text-lbl3 text-xs mt-1 line-clamp-2">{item.notes}</div>}
                      </div>
                      <div className="text-lbl2 text-xs truncate">{item.brand_model || '—'}</div>
                      <div className="text-right">
                        <span className="text-xs font-semibold" style={{ color: status.color }}>{status.label}</span>
                        {item.qty != null && <div className="text-lbl3" style={{ fontSize: 10 }}>Qty {item.qty}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )
      })}
      {!filtered.length && <div className="apple-card p-8 text-center text-lbl3 text-sm">No selections match this search.</div>}
    </section>
  )
}

function SharedPlans({ plans }) {
  const [selected, setSelected] = useState(() => plans.find(plan => plan.name.startsWith('Architectural')) || plans[0] || null)

  useEffect(() => {
    if (!selected && plans.length) setSelected(plans[0])
  }, [plans, selected])

  if (!plans.length) return <div className="apple-card p-8 text-center text-lbl3 text-sm">No plans are currently shared.</div>

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-white font-bold text-xl">Construction plans</h2>
        <p className="text-lbl2 text-sm mt-1">View or download the current project documents.</p>
      </div>
      <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
        <aside className="apple-card overflow-hidden">
          <div className="px-4 py-3 text-xs font-semibold uppercase tracking-widest text-lbl3" style={{ borderBottom: '1px solid rgba(84,84,88,0.35)' }}>{plans.length} documents</div>
          {plans.map(plan => (
            <button key={plan.id} type="button" onClick={() => setSelected(plan)}
              className="w-full text-left px-4 py-3 transition-colors"
              style={{ border: 0, borderBottom: '1px solid rgba(84,84,88,0.22)', background: selected?.id === plan.id ? 'rgba(10,132,255,0.14)' : 'transparent' }}>
              <div className="text-lbl text-sm font-medium">{plan.name}</div>
              <div className="text-lbl3 text-xs mt-1">{formatSize(plan.file_size)}</div>
            </button>
          ))}
        </aside>
        <div>
          {selected && (
            <>
              <div className="flex items-center justify-between gap-4 mb-3">
                <h3 className="text-white font-semibold text-lg">{selected.name}</h3>
                <a className="text-acc text-sm font-medium whitespace-nowrap" href={selected.url} target="_blank" rel="noreferrer">Open or download ↗</a>
              </div>
              <div className="apple-card overflow-hidden">
                <iframe src={selected.url} title={selected.name} style={{ width: '100%', height: '76vh', border: 'none', display: 'block' }} />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}


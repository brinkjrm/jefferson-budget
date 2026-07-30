import React from 'react'
import { formatCurrency } from '../domain/project.js'
import { useProject } from '../context/ProjectContext.jsx'

const ACTION_COLORS = {
  risk: '#ff453a',
  inspection: '#ff9f0a',
  bid: '#0a84ff',
  decision: '#ffd60a',
  budget: '#ff453a',
}

export default function ExecutiveDashboard({ onNavigate }) {
  const { model, metrics, actions, loading } = useProject()

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading project…</div>

  const healthColor = metrics.healthScore >= 85 ? '#30d158' : metrics.healthScore >= 70 ? '#ffd60a' : '#ff453a'
  const nextTasks = [...metrics.schedule.inProgress, ...model.schedule.tasks.filter(task => task.status === 'not_started')]
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
    .slice(0, 5)

  return (
    <div className="space-y-5">
      <section className="apple-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-lbl3 mb-1">Project command center</div>
            <h2 className="text-2xl font-bold text-lbl">{model.project.name}</h2>
            <p className="text-sm text-lbl2 mt-1">{model.project.address}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-lbl3">Project health</div>
              <div className="text-3xl font-bold" style={{ color: healthColor }}>{metrics.healthScore}</div>
            </div>
            <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold"
              style={{ color: healthColor, border: `4px solid ${healthColor}`, background: `${healthColor}18` }}>
              {metrics.healthScore >= 85 ? 'Good' : metrics.healthScore >= 70 ? 'Watch' : 'Risk'}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Schedule" value={`${metrics.schedule.progressPercent}%`} detail={`${metrics.schedule.complete}/${metrics.schedule.total} tasks complete`} color="#0a84ff" onClick={() => onNavigate('Schedule')} />
        <MetricCard label="Budget Forecast" value={formatCurrency(metrics.financials.forecast)} detail={`${metrics.financials.committedPercent}% committed`} color={metrics.financials.variance > 0 ? '#ff453a' : '#30d158'} onClick={() => onNavigate('Budget')} />
        <MetricCard label="Inspection Gates" value={`${metrics.schedule.passedInspections.length}/${metrics.schedule.inspections.length}`} detail={metrics.schedule.readyInspections.length ? `${metrics.schedule.readyInspections.length} ready to schedule` : 'No inspections waiting'} color="#ff9f0a" onClick={() => onNavigate('Schedule')} />
        <MetricCard label="Owner Decisions" value={metrics.procurement.tbdSelections.length} detail="selections still TBD" color={metrics.procurement.tbdSelections.length ? '#ffd60a' : '#30d158'} onClick={() => onNavigate('Selections')} />
      </section>

      <section className="grid lg:grid-cols-5 gap-5">
        <div className="apple-card lg:col-span-3 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#2c2c2e', borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
            <div>
              <h3 className="font-semibold text-lbl">Action Center</h3>
              <p className="text-xs text-lbl3 mt-0.5">Items requiring attention across the project</p>
            </div>
            <span className="text-xs px-2 py-1 rounded-full" style={{ background: actions.length ? 'rgba(255,159,10,0.18)' : 'rgba(48,209,88,0.18)', color: actions.length ? '#ff9f0a' : '#30d158' }}>
              {actions.length || 'Clear'}
            </span>
          </div>
          {actions.length ? actions.slice(0, 8).map(action => (
            <button key={action.id} onClick={() => onNavigate(action.tab)} className="w-full text-left px-4 py-3 flex gap-3 data-row"
              style={{ borderBottom: '1px solid rgba(84,84,88,0.22)' }}>
              <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: ACTION_COLORS[action.type] || '#8e8e93' }} />
              <span className="min-w-0">
                <span className="text-sm font-medium text-lbl block">{action.title}</span>
                <span className="text-xs text-lbl3 block mt-0.5">{action.detail}</span>
              </span>
              <span className="ml-auto text-lbl3">›</span>
            </button>
          )) : (
            <div className="py-14 text-center">
              <div className="text-pos text-2xl mb-2">✓</div>
              <div className="text-lbl text-sm font-medium">No immediate actions</div>
              <div className="text-lbl3 text-xs mt-1">The project has no recorded blockers or ready gates.</div>
            </div>
          )}
        </div>

        <div className="apple-card lg:col-span-2 overflow-hidden">
          <div className="px-4 py-3" style={{ background: '#2c2c2e', borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
            <h3 className="font-semibold text-lbl">Upcoming Work</h3>
            <p className="text-xs text-lbl3 mt-0.5">Current and next scheduled activities</p>
          </div>
          {nextTasks.map(task => (
            <button key={task.id} onClick={() => onNavigate('Schedule')} className="w-full text-left px-4 py-3 data-row"
              style={{ borderBottom: '1px solid rgba(84,84,88,0.22)' }}>
              <div className="flex justify-between gap-3">
                <span className="text-sm font-medium text-lbl truncate">{task.name}</span>
                <span className="text-xs text-lbl3 whitespace-nowrap">{formatDate(task.start_date)}</span>
              </div>
              <div className="text-xs text-lbl3 mt-1">{task.trade || task.task_type || 'Project team'}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-3">
        <SnapshotCard label="Working Budget" value={formatCurrency(metrics.financials.estimated)} sub={`${formatCurrency(metrics.financials.committed)} committed`} />
        <SnapshotCard label="Prepaid to Date" value={formatCurrency(metrics.financials.prepaid)} sub={`${formatCurrency(metrics.financials.drawsTotal)} included in draws`} />
        <SnapshotCard label="Schedule Window" value={`${formatDate(metrics.schedule.start)} – ${formatDate(metrics.schedule.finish)}`} sub={`${metrics.schedule.blocked.length} blocked · ${metrics.schedule.overdue.length} overdue`} />
      </section>
    </div>
  )
}

function MetricCard({ label, value, detail, color, onClick }) {
  return (
    <button onClick={onClick} className="apple-card p-4 text-left transition-transform hover:-translate-y-0.5" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="text-xs uppercase tracking-wider text-lbl2">{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
      <div className="text-xs text-lbl3 mt-1">{detail}</div>
    </button>
  )
}

function SnapshotCard({ label, value, sub }) {
  return (
    <div className="apple-card p-4">
      <div className="text-xs uppercase tracking-wider text-lbl3">{label}</div>
      <div className="text-lg font-semibold text-lbl mt-1">{value}</div>
      <div className="text-xs text-lbl2 mt-1">{sub}</div>
    </div>
  )
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}


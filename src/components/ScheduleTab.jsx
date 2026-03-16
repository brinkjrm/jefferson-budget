import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

const ROW_H  = 40        // px per task row
const HDR_H  = 52        // header height (month row + week row)
const LIST_W = 280       // task list column width

const ZOOM_LEVELS = [24, 32, 48, 64, 96]  // px per week at each zoom level
const ZOOM_DEFAULT = 2                     // index into ZOOM_LEVELS (48px)

const STATUS_MAP = {
  not_started: { label: 'Not Started', color: '#636366' },
  in_progress:  { label: 'In Progress',  color: '#0a84ff' },
  complete:     { label: 'Complete',     color: '#30d158' },
  blocked:      { label: 'Blocked',      color: '#ff453a' },
}

const PHASE_COLORS = ['#0a84ff','#30d158','#ff9f0a','#bf5af2','#32ade6','#ff6b6b','#ffd60a','#5e5ce6']

// ── Date helpers ──────────────────────────────────────────────────────────────
const toStr    = d => d.toISOString().split('T')[0]
const parse    = s => { if (!s) return null; const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d) }
const addDays  = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r }
const diffDays = (a,b) => Math.round((b-a)/86400000)
const weekStart= d => { const r=new Date(d); r.setDate(r.getDate()-r.getDay()); r.setHours(0,0,0,0); return r }
const fmtDate  = s => s ? parse(s).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''

function getMonthGroups(weeks, weekW) {
  const groups = []
  let cur = null
  weeks.forEach((w, i) => {
    const label = w.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    if (label !== cur) { groups.push({ label, start: i, count: 1 }); cur = label }
    else groups[groups.length - 1].count++
  })
  return groups
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ScheduleTab() {
  const [tasks,     setTasks]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [collapsed, setCollapsed] = useState(new Set())
  const [editingId, setEditingId] = useState(null)
  const [editFields,setEditFields]= useState({})
  const [drag,      setDrag]      = useState(null)
  const [zoomIdx,   setZoomIdx]   = useState(ZOOM_DEFAULT)

  const weekW  = ZOOM_LEVELS[zoomIdx]
  const dayW   = weekW / 7
  const dayWRef = useRef(dayW)
  useEffect(() => { dayWRef.current = dayW }, [dayW])

  const tasksRef = useRef(tasks)
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  useEffect(() => { load() }, [])

  // Drag mouse handlers
  useEffect(() => {
    if (!drag) return
    const onMove = e => {
      const days = Math.round((e.clientX - drag.startX) / dayWRef.current)
      if (drag.type === 'resize') {
        const newEnd = toStr(addDays(parse(drag.origEnd), days))
        if (newEnd >= drag.origStart)
          setTasks(prev => prev.map(t => t.id === drag.taskId ? { ...t, end_date: newEnd } : t))
      } else {
        const newStart = toStr(addDays(parse(drag.origStart), days))
        const dur = diffDays(parse(drag.origStart), parse(drag.origEnd))
        const newEnd = toStr(addDays(parse(newStart), dur))
        setTasks(prev => prev.map(t => t.id === drag.taskId ? { ...t, start_date: newStart, end_date: newEnd } : t))
      }
    }
    const onUp = async () => {
      const task = tasksRef.current.find(t => t.id === drag.taskId)
      if (task) await updateTask(drag.taskId, { start_date: task.start_date, end_date: task.end_date })
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',  onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [drag])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('schedule_tasks').select('*').order('sort_order').order('created_at')
    setTasks(data || [])
    setLoading(false)
  }

  async function updateTask(id, patch) {
    patch.updated_at = new Date().toISOString()
    await supabase.from('schedule_tasks').update(patch).eq('id', id)
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }

  async function addPhase() {
    const today = toStr(new Date())
    const end   = toStr(addDays(new Date(), 13))
    const phases = tasks.filter(t => !t.parent_id)
    const maxOrder = phases.reduce((m, t) => Math.max(m, t.sort_order || 0), 0)
    const color = PHASE_COLORS[phases.length % PHASE_COLORS.length]
    const { data } = await supabase.from('schedule_tasks')
      .insert({ name: 'New Phase', start_date: today, end_date: end, status: 'not_started', sort_order: maxOrder + 1, color, depends_on: [] })
      .select().single()
    if (data) { setTasks(prev => [...prev, data]); openEdit(data) }
  }

  async function addTask(parentId) {
    const parent = tasks.find(t => t.id === parentId)
    const today  = parent?.start_date || toStr(new Date())
    const end    = parent?.end_date   || toStr(addDays(parse(today), 6))
    const siblings = tasks.filter(t => t.parent_id === parentId)
    const maxOrder = siblings.reduce((m, t) => Math.max(m, t.sort_order || 0), 0)
    const { data } = await supabase.from('schedule_tasks')
      .insert({ name: 'New Task', parent_id: parentId, start_date: today, end_date: end, status: 'not_started', sort_order: maxOrder + 1, depends_on: [] })
      .select().single()
    if (data) { setTasks(prev => [...prev, data]); openEdit(data) }
  }

  async function deleteTask(id) {
    if (!confirm('Delete this item and its sub-tasks?')) return
    const childIds = tasks.filter(t => t.parent_id === id).map(t => t.id)
    if (childIds.length) await supabase.from('schedule_tasks').delete().in('id', childIds)
    await supabase.from('schedule_tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id && t.parent_id !== id))
    if (editingId === id) setEditingId(null)
  }

  function openEdit(task) {
    setEditingId(task.id)
    setEditFields({ name: task.name, start_date: task.start_date || '', end_date: task.end_date || '', status: task.status || 'not_started', depends_on: task.depends_on || [] })
  }

  async function saveEdit(id) {
    await updateTask(id, { name: editFields.name, start_date: editFields.start_date || null, end_date: editFields.end_date || null, status: editFields.status, depends_on: editFields.depends_on })
    setEditingId(null)
  }

  function startDrag(e, taskId, type) {
    e.preventDefault(); e.stopPropagation()
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    setDrag({ taskId, type, startX: e.clientX, origStart: task.start_date, origEnd: task.end_date })
  }

  // ── Build flat render list ────────────────────────────────────────────────
  const phases = tasks.filter(t => !t.parent_id).sort((a,b) => (a.sort_order||0)-(b.sort_order||0))
  const flatList = []
  phases.forEach((phase, pi) => {
    const phaseColor = phase.color || PHASE_COLORS[pi % PHASE_COLORS.length]
    flatList.push({ task: phase, depth: 0, isPhase: true, phaseColor })
    if (!collapsed.has(phase.id)) {
      tasks.filter(t => t.parent_id === phase.id)
        .sort((a,b) => (a.sort_order||0)-(b.sort_order||0))
        .forEach(child => flatList.push({ task: child, depth: 1, isPhase: false, phaseColor }))
    }
  })

  // ── Timeline range (always extends to at least Feb of next year) ──────────
  const allDates = tasks.flatMap(t => [t.start_date, t.end_date].filter(Boolean).map(parse))
  const minDate  = allDates.length ? new Date(Math.min(...allDates)) : new Date()
  const taskMax  = allDates.length ? new Date(Math.max(...allDates)) : new Date()
  const nextFeb  = new Date(new Date().getFullYear() + 1, 1, 28)  // Feb 28 next year
  const maxDate  = new Date(Math.max(taskMax, nextFeb))
  const tlStart  = weekStart(addDays(minDate, -14))
  const tlEnd    = weekStart(addDays(maxDate,  28))

  const weeks = []
  let w = new Date(tlStart)
  while (w <= tlEnd) { weeks.push(new Date(w)); w = addDays(w, 7) }

  const timelineW = weeks.length * weekW
  const bodyH     = flatList.length * ROW_H

  const barLeft  = s => !s ? 0 : diffDays(tlStart, parse(s)) * dayW
  const barWidth = (s,e) => (!s||!e) ? weekW : Math.max((diffDays(parse(s),parse(e))+1)*dayW, 6)

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading…</div>

  const editingTask = tasks.find(t => t.id === editingId)

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={addPhase} className="btn-primary text-xs px-3 py-1.5">+ Add Phase</button>
        <span className="text-lbl3 text-xs">Click a row to edit · Drag bar to move · Drag right edge to resize</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-lbl3 text-xs mr-1">Zoom</span>
          <button
            onClick={() => setZoomIdx(i => Math.max(0, i - 1))}
            disabled={zoomIdx === 0}
            className="btn-secondary text-xs px-2 py-1"
            title="Zoom out"
          >−</button>
          <span className="text-lbl3 text-xs w-8 text-center">{weekW}px</span>
          <button
            onClick={() => setZoomIdx(i => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
            disabled={zoomIdx === ZOOM_LEVELS.length - 1}
            className="btn-secondary text-xs px-2 py-1"
            title="Zoom in"
          >+</button>
        </div>
      </div>

      {/* Gantt */}
      <div className="apple-card" style={{ overflow: 'auto', maxHeight: '68vh' }}>
        <div style={{ minWidth: LIST_W + timelineW }}>

          {/* ── Header ── */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 20, height: HDR_H, background: '#1c1c1e', borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
            {/* Corner */}
            <div style={{ width: LIST_W, minWidth: LIST_W, position: 'sticky', left: 0, zIndex: 30, background: '#1c1c1e', display: 'flex', alignItems: 'flex-end', padding: '0 16px 10px', borderRight: '1px solid rgba(84,84,88,0.3)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#636366' }}>Task</span>
            </div>
            {/* Month + week headers */}
            <div style={{ position: 'relative', flex: 1 }}>
              {/* Month row */}
              <div style={{ display: 'flex', height: 26 }}>
                {getMonthGroups(weeks, weekW).map(({ label, start, count }) => (
                  <div key={start} style={{ width: count * weekW, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, borderRight: '1px solid rgba(84,84,88,0.25)', fontSize: 11, fontWeight: 600, color: '#ebebf5', overflow: 'hidden' }}>
                    {label}
                  </div>
                ))}
              </div>
              {/* Week row */}
              <div style={{ display: 'flex', height: 26 }}>
                {weeks.map((wk, i) => {
                  const isToday = diffDays(wk, weekStart(new Date())) === 0
                  return (
                    <div key={i} style={{ width: weekW, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(84,84,88,0.2)', fontSize: 10, color: isToday ? '#0a84ff' : '#636366', fontWeight: isToday ? 700 : 400, overflow: 'hidden' }}>
                      {weekW >= 40 ? wk.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : (i % 2 === 0 ? wk.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '')}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── Body ── */}
          <div style={{ display: 'flex' }}>

            {/* Task list column */}
            <div style={{ width: LIST_W, minWidth: LIST_W, position: 'sticky', left: 0, zIndex: 10, background: '#1c1c1e', borderRight: '1px solid rgba(84,84,88,0.3)' }}>
              {flatList.map(({ task, depth, isPhase, phaseColor }) => (
                <div
                  key={task.id}
                  onClick={() => editingId === task.id ? setEditingId(null) : openEdit(task)}
                  style={{ height: ROW_H, display: 'flex', alignItems: 'center', padding: `0 8px 0 ${16 + depth * 20}px`, borderBottom: '1px solid rgba(84,84,88,0.2)', background: editingId === task.id ? 'rgba(10,132,255,0.1)' : 'transparent', cursor: 'pointer', gap: 4 }}
                >
                  {isPhase ? (
                    <button
                      onClick={e => { e.stopPropagation(); setCollapsed(s => { const n=new Set(s); n.has(task.id)?n.delete(task.id):n.add(task.id); return n }) }}
                      style={{ color: '#636366', fontSize: 9, width: 14, flexShrink: 0 }}
                    >
                      {collapsed.has(task.id) ? '▶' : '▼'}
                    </button>
                  ) : (
                    <span style={{ width: 14, flexShrink: 0 }} />
                  )}
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: phaseColor, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: isPhase ? 600 : 400, color: isPhase ? '#fff' : '#ebebf5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.name}
                  </span>
                  <span style={{ color: STATUS_MAP[task.status]?.color || '#636366', fontSize: 9, flexShrink: 0 }}>●</span>
                </div>
              ))}
              {flatList.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: '#636366', fontStyle: 'italic' }}>
                  Add a phase to get started
                </div>
              )}
            </div>

            {/* Timeline column */}
            <div style={{ flex: 1, position: 'relative', height: bodyH || ROW_H * 3 }}>
              {/* Today line */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: diffDays(tlStart, new Date()) * dayW, width: 1, background: 'rgba(255,69,58,0.5)', zIndex: 4, pointerEvents: 'none' }} />

              {/* Week grid lines */}
              {weeks.map((_, i) => (
                <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: i * weekW, width: 1, background: 'rgba(84,84,88,0.18)', pointerEvents: 'none' }} />
              ))}

              {/* Row dividers */}
              {flatList.map((_, i) => (
                <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (i + 1) * ROW_H - 1, height: 1, background: 'rgba(84,84,88,0.2)', pointerEvents: 'none' }} />
              ))}

              {/* Task bars */}
              {flatList.map(({ task, isPhase, phaseColor }, i) => {
                if (!task.start_date || !task.end_date) return null
                const left  = barLeft(task.start_date)
                const width = barWidth(task.start_date, task.end_date)
                const barH  = isPhase ? 30 : 20
                const color = STATUS_MAP[task.status]?.color || phaseColor
                const top   = i * ROW_H + (ROW_H - barH) / 2
                const minLabelWidth = isPhase ? 60 : 50

                return (
                  <div key={task.id}>
                    {/* Bar */}
                    <div
                      onMouseDown={e => startDrag(e, task.id, 'move')}
                      style={{ position: 'absolute', top, left, width, height: barH, background: color, borderRadius: isPhase ? 4 : 5, opacity: 0.9, cursor: drag?.taskId === task.id ? 'grabbing' : 'grab', display: 'flex', alignItems: 'center', overflow: 'hidden', zIndex: 2 }}
                      title={`${task.name}: ${fmtDate(task.start_date)} – ${fmtDate(task.end_date)}`}
                    >
                      {width > minLabelWidth && (
                        <span style={{ fontSize: isPhase ? 12 : 11, fontWeight: isPhase ? 700 : 600, color: '#fff', paddingLeft: 7, overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none', letterSpacing: isPhase ? '0.01em' : 0 }}>
                          {task.name}
                        </span>
                      )}
                      {/* Resize handle */}
                      <div
                        onMouseDown={e => startDrag(e, task.id, 'resize')}
                        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'rgba(255,255,255,0.25)', borderRadius: '0 5px 5px 0' }}
                      />
                    </div>
                    {/* Date label */}
                    {width > 60 && (
                      <div style={{ position: 'absolute', top: top + barH + 2, left, fontSize: 9, color: '#636366', whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none' }}>
                        {fmtDate(task.end_date)}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Dependency arrows */}
              <DependencyArrows tasks={tasks} flatList={flatList} tlStart={tlStart} bodyH={bodyH || ROW_H * 3} timelineW={timelineW} dayW={dayW} />
            </div>
          </div>

        </div>
      </div>

      {/* Edit modal */}
      {editingTask && (
        <EditModal
          task={editingTask}
          fields={editFields}
          setFields={setEditFields}
          allTasks={tasks.filter(t => t.id !== editingId)}
          isPhase={!editingTask.parent_id}
          onSave={() => saveEdit(editingId)}
          onCancel={() => setEditingId(null)}
          onDelete={() => deleteTask(editingId)}
          onAddTask={() => addTask(editingId)}
        />
      )}
    </div>
  )
}

// ── Dependency arrows ─────────────────────────────────────────────────────────
function DependencyArrows({ tasks, flatList, tlStart, bodyH, timelineW, dayW }) {
  const arrows = []
  flatList.forEach(({ task }, toIdx) => {
    ;(task.depends_on || []).forEach(depId => {
      const fromIdx = flatList.findIndex(r => r.task.id === depId)
      if (fromIdx === -1) return
      const fromTask = flatList[fromIdx].task
      if (!fromTask.end_date || !task.start_date) return
      const x1 = diffDays(tlStart, parse(fromTask.end_date)) * dayW + dayW
      const y1 = fromIdx * ROW_H + ROW_H / 2
      const x2 = diffDays(tlStart, parse(task.start_date)) * dayW
      const y2 = toIdx  * ROW_H + ROW_H / 2
      arrows.push({ x1, y1, x2, y2, key: `${depId}-${task.id}` })
    })
  })
  if (!arrows.length) return null

  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: timelineW, height: bodyH, pointerEvents: 'none', zIndex: 3 }}>
      <defs>
        <marker id="dep-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,159,10,0.85)" />
        </marker>
      </defs>
      {arrows.map(({ x1, y1, x2, y2, key }) => {
        const elbowX = Math.max(x1 + 16, x2 - 12)
        const d = x2 > x1 + 10
          ? `M${x1},${y1} L${elbowX},${y1} L${elbowX},${y2} L${x2},${y2}`
          : `M${x1},${y1} L${x1+14},${y1} L${x1+14},${(y1+y2)/2} L${x2-14},${(y1+y2)/2} L${x2-14},${y2} L${x2},${y2}`
        return <path key={key} d={d} fill="none" stroke="rgba(255,159,10,0.7)" strokeWidth="1.5" markerEnd="url(#dep-arrow)" />
      })}
    </svg>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditModal({ task, fields, setFields, allTasks, isPhase, onSave, onCancel, onDelete, onAddTask }) {
  const set = key => e => setFields(p => ({ ...p, [key]: e.target.value }))
  const toggleDep = (id, checked) => setFields(p => ({
    ...p,
    depends_on: checked ? [...(p.depends_on||[]), id] : (p.depends_on||[]).filter(x => x !== id)
  }))

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        style={{ width: '100%', maxWidth: 900, background: '#1c1c1e', border: '1px solid rgba(84,84,88,0.5)', borderBottom: 'none', borderRadius: '16px 16px 0 0', padding: 20, boxShadow: '0 -8px 40px rgba(0,0,0,0.6)', pointerEvents: 'all' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#636366' }}>
            {isPhase ? 'Edit Phase' : 'Edit Task'}
          </span>
          <div style={{ flex: 1 }} />
          {isPhase && (
            <button onClick={onAddTask} style={{ fontSize: 12, fontWeight: 600, color: '#0a84ff' }}>+ Add Task</button>
          )}
          <button onClick={onDelete} style={{ fontSize: 12, color: '#ff453a' }} title="Delete">🗑 Delete</button>
          <button onClick={onCancel} className="btn-secondary text-xs px-2 py-1.5">✕ Close</button>
          <button onClick={onSave} className="btn-primary text-xs px-3 py-1.5">Save</button>
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <input
            value={fields.name}
            onChange={set('name')}
            className="apple-input text-sm"
            style={{ flex: '1 1 200px', minWidth: 160 }}
            placeholder="Name"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 11, color: '#636366' }}>Start</label>
            <input type="date" value={fields.start_date} onChange={set('start_date')} className="apple-input text-xs" style={{ width: 130 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 11, color: '#636366' }}>End</label>
            <input type="date" value={fields.end_date} onChange={set('end_date')} className="apple-input text-xs" style={{ width: 130 }} />
          </div>
          <select value={fields.status} onChange={set('status')} className="apple-input text-xs" style={{ width: 130 }}>
            {Object.entries(STATUS_MAP).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {/* Dependencies */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#636366', marginBottom: 8 }}>
            Depends on
          </div>
          {allTasks.length === 0 ? (
            <span style={{ fontSize: 12, color: '#636366', fontStyle: 'italic' }}>No other tasks yet</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {allTasks.map(t => {
                const checked = (fields.depends_on || []).includes(t.id)
                return (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: checked ? '#0a84ff' : '#ebebf5', background: checked ? 'rgba(10,132,255,0.15)' : 'rgba(84,84,88,0.2)', borderRadius: 6, padding: '4px 8px' }}>
                    <input type="checkbox" checked={checked} onChange={e => toggleDep(t.id, e.target.checked)} style={{ accentColor: '#0a84ff' }} />
                    {t.name}
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

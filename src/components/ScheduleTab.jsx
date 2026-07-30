import React, { useEffect, useRef, useState } from 'react'
import { useProjectCollection } from '../context/ProjectContext.jsx'
import { buildJeffersonSchedule, getJeffersonTaskMetadata } from '../data/jeffersonSchedule.js'
import {
  addDependencyLink,
  addCalendarDays,
  addWorkdays,
  applyTaskChange,
  changedScheduleRows,
  diffCalendarDays,
  dependencyLinkError,
  earliestDependencyStart,
  enforceDependencies,
  formatShortDate,
  hasDependencyCycle,
  maxDate,
  minDate,
  normalizeWorkday,
  parseDate,
  rollupPhaseDates,
  shiftWorkdayRange,
  startOfWeek,
  toDateString,
  workdayDuration,
} from '../lib/scheduleDates.js'
import { replaceScheduleWithBlueprint } from '../lib/scheduleRepository.js'
import { supabase } from '../lib/supabase.js'

const ROW_H = 48
const HDR_H = 58
const LIST_W = 420
const ZOOM_LEVELS = [28, 36, 48, 64, 96]
const ZOOM_DEFAULT = 2

const STATUS_MAP = {
  not_started: { label: 'Not Started', color: '#8E8E93' },
  in_progress: { label: 'In Progress', color: '#0a84ff' },
  complete: { label: 'Complete', color: '#30d158' },
  blocked: { label: 'Blocked', color: '#ff453a' },
}

const TYPE_MAP = {
  inspection: { label: 'Inspection', color: '#ff9f0a' },
  milestone: { label: 'Milestone', color: '#30d158' },
  procurement: { label: 'Procurement', color: '#bf5af2' },
  wait: { label: 'Cure / Wait', color: '#8e8e93' },
  allowance: { label: 'Allowance', color: '#ffd60a' },
}

const PHASE_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#32ade6', '#ff6b6b', '#ffd60a', '#5e5ce6']

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function getMonthGroups(weeks) {
  const groups = []
  let current = null
  weeks.forEach((week, index) => {
    const label = week.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    if (label !== current) {
      groups.push({ label, start: index, count: 1 })
      current = label
    } else {
      groups[groups.length - 1].count++
    }
  })
  return groups
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

export default function ScheduleTab() {
  const [tasks, setTasks, loading, refreshTasks] = useProjectCollection('scheduleTasks')
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [collapsed, setCollapsed] = useState(new Set())
  const [editingId, setEditingId] = useState(null)
  const [editFields, setEditFields] = useState({})
  const [drag, setDrag] = useState(null)
  const [linkDrag, setLinkDrag] = useState(null)
  const [selectedDependency, setSelectedDependency] = useState(null)
  const [reorder, setReorder] = useState(null)
  const [hoveredId, setHoveredId] = useState(null)
  const [zoomIndex, setZoomIndex] = useState(ZOOM_DEFAULT)
  const [notice, setNotice] = useState(null)

  const weekWidth = ZOOM_LEVELS[zoomIndex]
  const dayWidth = weekWidth / 7
  const dayWidthRef = useRef(dayWidth)
  const tasksRef = useRef(tasks)
  const flatListRef = useRef([])
  const linkDragRef = useRef(null)
  const timelineBodyRef = useRef(null)
  const ganttScrollRef = useRef(null)

  useEffect(() => { dayWidthRef.current = dayWidth }, [dayWidth])
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { linkDragRef.current = linkDrag }, [linkDrag])
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  async function load() {
    const result = await refreshTasks()
    const { error } = result.scheduleTasks
    if (error) {
      setNotice({ type: 'error', text: `Could not load schedule: ${error.message}` })
    }
  }

  async function persistTasks(candidateTasks, changedIds, successText = 'Schedule saved', baselineTasks = tasksRef.current) {
    if (hasDependencyCycle(candidateTasks)) {
      setNotice({ type: 'error', text: 'Dependency cycle detected. Remove the circular predecessor before saving.' })
      await load()
      return false
    }

    const enforced = enforceDependencies(candidateTasks, changedIds)
    const rolled = rollupPhaseDates(enforced.tasks)
    const changed = changedScheduleRows(baselineTasks, rolled)
    if (!changed.length) {
      tasksRef.current = rolled
      setTasks(rolled)
      return true
    }

    const payload = changed.map(task => ({
      id: task.id,
      name: task.name,
      parent_id: task.parent_id,
      start_date: task.start_date,
      end_date: task.end_date,
      status: task.status || 'not_started',
      sort_order: task.sort_order || 0,
      color: task.color || null,
      depends_on: task.depends_on || [],
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('schedule_tasks').upsert(payload)
    if (error) {
      setNotice({ type: 'error', text: `Save failed: ${error.message}` })
      await load()
      return false
    }
    tasksRef.current = rolled
    setTasks(rolled)
    setNotice({ type: 'success', text: successText })
    return true
  }

  async function updateTask(id, patch, successText) {
    const candidate = tasksRef.current.map(task => task.id === id ? { ...task, ...patch } : task)
    return persistTasks(candidate, [id], successText)
  }

  async function createDependency(predecessorId, successorId) {
    const result = addDependencyLink(tasksRef.current, predecessorId, successorId)
    if (result.error) {
      setNotice({ type: 'error', text: result.error })
      return false
    }
    const predecessor = tasksRef.current.find(task => task.id === predecessorId)
    const successor = tasksRef.current.find(task => task.id === successorId)
    const saved = await persistTasks(result.tasks, [successorId], `${successor.name.replace(/^INSPECTION - /, '')} now starts after ${predecessor.name.replace(/^INSPECTION - /, '')}`)
    if (saved) setSelectedDependency({ fromId: predecessorId, toId: successorId })
    return saved
  }

  async function removeDependency(predecessorId, successorId) {
    const successor = tasksRef.current.find(task => task.id === successorId)
    if (!successor) return false
    const candidate = tasksRef.current.map(task => task.id === successorId
      ? { ...task, depends_on: (task.depends_on || []).filter(id => id !== predecessorId) }
      : task)
    const saved = await persistTasks(candidate, [successorId], 'Dependency removed')
    if (saved) setSelectedDependency(null)
    return saved
  }

  useEffect(() => {
    if (!drag) return undefined
    const onMove = event => {
      const calendarDelta = Math.round((event.clientX - drag.startX) / dayWidthRef.current)
      let range
      if (drag.type === 'resize') {
        const rawEnd = addCalendarDays(drag.originalEnd, calendarDelta)
        const end = normalizeWorkday(rawEnd, calendarDelta < 0 ? -1 : 1)
        if (end < parseDate(drag.originalStart)) return
        range = { start_date: drag.originalStart, end_date: toDateString(end) }
      } else {
        range = shiftWorkdayRange(drag.originalStart, drag.originalEnd, calendarDelta)
      }
      const next = applyTaskChange(drag.baselineTasks, drag.taskId, range)
      tasksRef.current = next
      setTasks(next)
    }
    const onUp = async () => {
      await persistTasks(tasksRef.current, [drag.taskId], 'Task dates and downstream dependencies updated', drag.baselineTasks)
      setDrag(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag])

  useEffect(() => {
    if (!linkDrag?.sourceId) return undefined
    const onMove = event => {
      const body = timelineBodyRef.current
      if (!body) return
      const scroller = ganttScrollRef.current
      if (scroller) {
        const scrollRect = scroller.getBoundingClientRect()
        const edge = 46
        if (event.clientY > scrollRect.bottom - edge) scroller.scrollTop += 18
        else if (event.clientY < scrollRect.top + HDR_H + edge) scroller.scrollTop -= 18
        if (event.clientX > scrollRect.right - edge) scroller.scrollLeft += 18
        else if (event.clientX < scrollRect.left + LIST_W + edge) scroller.scrollLeft -= 18
      }
      const rect = body.getBoundingClientRect()
      const rowIndex = Math.floor((event.clientY - rect.top) / ROW_H)
      const row = flatListRef.current[rowIndex]
      const targetId = row && !row.isPhase ? row.task.id : null
      const error = targetId ? dependencyLinkError(tasksRef.current, linkDrag.sourceId, targetId) : 'Drop on a task row.'
      const next = {
        ...linkDragRef.current,
        x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
        y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
        targetId,
        valid: Boolean(targetId && !error),
        error,
      }
      linkDragRef.current = next
      setLinkDrag(next)
    }
    const onUp = async () => {
      const current = linkDragRef.current
      linkDragRef.current = null
      setLinkDrag(null)
      setHoveredId(null)
      if (current?.valid) {
        await createDependency(current.sourceId, current.targetId)
      } else if (current?.targetId && current?.error) {
        setNotice({ type: 'error', text: current.error })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [linkDrag?.sourceId])

  useEffect(() => {
    if (!reorder) return undefined
    const onMove = event => {
      const delta = Math.round((event.clientY - reorder.startY) / ROW_H)
      const targetFlatIndex = Math.max(0, Math.min(flatListRef.current.length - 1, reorder.startFlatIndex + delta))
      setReorder(value => ({ ...value, targetFlatIndex }))
    }
    const onUp = async () => {
      await finishReorder(reorder)
      setReorder(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [reorder])

  async function finishReorder(value) {
    const flat = flatListRef.current
    if (!flat.length || value.startFlatIndex === value.targetFlatIndex) return
    const target = flat[value.targetFlatIndex]
    if (!target) return
    let candidate = tasksRef.current.map(task => ({ ...task }))
    const changedIds = []

    if (value.isPhase) {
      const phases = candidate.filter(task => !task.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      const targetPhaseId = target.isPhase ? target.task.id : target.task.parent_id
      const fromIndex = phases.findIndex(phase => phase.id === value.taskId)
      const toIndex = phases.findIndex(phase => phase.id === targetPhaseId)
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return
      const [removed] = phases.splice(fromIndex, 1)
      phases.splice(toIndex, 0, removed)
      const orders = new Map(phases.map((phase, index) => [phase.id, index + 1]))
      candidate = candidate.map(task => orders.has(task.id) ? { ...task, sort_order: orders.get(task.id) } : task)
      changedIds.push(...phases.map(phase => phase.id))
    } else {
      const newParentId = target.isPhase ? target.task.id : target.task.parent_id
      if (!newParentId) return
      const siblings = candidate
        .filter(task => task.parent_id === newParentId && task.id !== value.taskId)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      const targetIndex = target.isPhase ? siblings.length : Math.max(0, siblings.findIndex(task => task.id === target.task.id))
      const moved = candidate.find(task => task.id === value.taskId)
      siblings.splice(targetIndex < 0 ? siblings.length : targetIndex, 0, { ...moved, parent_id: newParentId })
      const updates = new Map(siblings.map((task, index) => [task.id, { parent_id: newParentId, sort_order: index + 1 }]))
      candidate = candidate.map(task => updates.has(task.id) ? { ...task, ...updates.get(task.id) } : task)
      changedIds.push(...siblings.map(task => task.id))
    }
    await persistTasks(candidate, changedIds, 'Schedule order updated')
  }

  async function applyPermitSchedule() {
    const message = tasksRef.current.length
      ? 'Replace the current schedule with the plan-validated Jefferson permit schedule? Existing schedule rows will be replaced.'
      : 'Load the plan-validated Jefferson permit schedule?'
    if (!window.confirm(message)) return
    setLoadingTemplate(true)
    try {
      const blueprint = buildJeffersonSchedule()
      const rows = await replaceScheduleWithBlueprint(supabase, blueprint, tasksRef.current)
      tasksRef.current = rows
      setTasks(rows)
      setCollapsed(new Set())
      setEditingId(null)
      setNotice({ type: 'success', text: `Permit schedule loaded: ${blueprint.tasks.length} tasks, ${blueprint.projectStart} to ${blueprint.projectEnd}` })
    } catch (error) {
      setNotice({ type: 'error', text: `Could not load permit schedule: ${error.message}` })
      await load()
    } finally {
      setLoadingTemplate(false)
    }
  }

  async function addPhase() {
    const start = toDateString(normalizeWorkday(new Date()))
    const end = toDateString(addWorkdays(start, 9))
    const phases = tasksRef.current.filter(task => !task.parent_id)
    const color = PHASE_COLORS[phases.length % PHASE_COLORS.length]
    const { data, error } = await supabase.from('schedule_tasks').insert({
      name: 'New Phase', start_date: start, end_date: end, status: 'not_started',
      sort_order: phases.reduce((max, task) => Math.max(max, task.sort_order || 0), 0) + 1,
      color, depends_on: [],
    }).select().single()
    if (error) return setNotice({ type: 'error', text: `Could not add phase: ${error.message}` })
    const next = [...tasksRef.current, data]
    tasksRef.current = next
    setTasks(next)
    openEdit(data)
  }

  async function addTask(parentId) {
    const parent = tasksRef.current.find(task => task.id === parentId)
    const start = toDateString(normalizeWorkday(parent?.start_date || new Date()))
    const siblings = tasksRef.current.filter(task => task.parent_id === parentId)
    const { data, error } = await supabase.from('schedule_tasks').insert({
      name: 'New Task', parent_id: parentId, start_date: start, end_date: toDateString(addWorkdays(start, 4)),
      status: 'not_started', sort_order: siblings.reduce((max, task) => Math.max(max, task.sort_order || 0), 0) + 1,
      depends_on: [],
    }).select().single()
    if (error) return setNotice({ type: 'error', text: `Could not add task: ${error.message}` })
    const next = rollupPhaseDates([...tasksRef.current, data])
    tasksRef.current = next
    setTasks(next)
    openEdit(data)
  }

  async function deleteTask(id) {
    if (!window.confirm('Delete this item and its sub-tasks?')) return
    const deletedIds = new Set([id, ...tasksRef.current.filter(task => task.parent_id === id).map(task => task.id)])
    const remaining = tasksRef.current
      .filter(task => !deletedIds.has(task.id))
      .map(task => ({ ...task, depends_on: (task.depends_on || []).filter(depId => !deletedIds.has(depId)) }))
    const dependencyChanges = remaining.filter(task => {
      const original = tasksRef.current.find(row => row.id === task.id)
      return JSON.stringify(task.depends_on) !== JSON.stringify(original.depends_on || [])
    })
    if (dependencyChanges.length) {
      const { error } = await supabase.from('schedule_tasks').upsert(dependencyChanges)
      if (error) return setNotice({ type: 'error', text: `Could not update dependencies: ${error.message}` })
    }
    const childIds = [...deletedIds].filter(childId => childId !== id)
    if (childIds.length) {
      const { error } = await supabase.from('schedule_tasks').delete().in('id', childIds)
      if (error) return setNotice({ type: 'error', text: `Could not delete sub-tasks: ${error.message}` })
    }
    const { error } = await supabase.from('schedule_tasks').delete().eq('id', id)
    if (error) return setNotice({ type: 'error', text: `Could not delete item: ${error.message}` })
    const next = rollupPhaseDates(remaining)
    tasksRef.current = next
    setTasks(next)
    setEditingId(null)
    setNotice({ type: 'success', text: 'Schedule item deleted' })
  }

  function openEdit(task) {
    setEditingId(task.id)
    setEditFields({
      name: task.name,
      start_date: task.start_date || '',
      end_date: task.end_date || '',
      status: task.status || 'not_started',
      depends_on: task.depends_on || [],
    })
  }

  async function saveEdit(id) {
    const item = tasksRef.current.find(task => task.id === id)
    const isPhase = !item?.parent_id
    const start = isPhase ? item.start_date : toDateString(normalizeWorkday(editFields.start_date))
    const endCandidate = isPhase ? item.end_date : normalizeWorkday(editFields.end_date, -1)
    const end = isPhase ? item.end_date : toDateString(endCandidate < parseDate(start) ? parseDate(start) : endCandidate)
    const saved = await updateTask(id, {
      name: editFields.name.trim() || item.name,
      start_date: start,
      end_date: end,
      status: editFields.status,
      depends_on: isPhase ? [] : editFields.depends_on,
    }, 'Schedule item saved')
    if (saved) setEditingId(null)
  }

  function startBarDrag(event, task, type) {
    if (!task.parent_id) return
    event.preventDefault()
    event.stopPropagation()
    setDrag({
      taskId: task.id,
      type,
      startX: event.clientX,
      originalStart: task.start_date,
      originalEnd: task.end_date,
      baselineTasks: tasksRef.current.map(item => ({ ...item, depends_on: [...(item.depends_on || [])] })),
    })
  }

  function startLinkDrag(event, task) {
    if (!task.parent_id) return
    event.preventDefault()
    event.stopPropagation()
    const sourceIndex = flatListRef.current.findIndex(row => row.task.id === task.id)
    const initial = {
      sourceId: task.id,
      sourceX: diffCalendarDays(timelineStart, task.end_date) * dayWidth + dayWidth,
      sourceY: sourceIndex * ROW_H + ROW_H / 2,
      x: diffCalendarDays(timelineStart, task.end_date) * dayWidth + dayWidth,
      y: sourceIndex * ROW_H + ROW_H / 2,
      targetId: null,
      valid: false,
      error: 'Drop on a task row.',
    }
    linkDragRef.current = initial
    setLinkDrag(initial)
    setSelectedDependency(null)
    setHoveredId(task.id)
  }

  function startReorder(event, task, flatIndex) {
    event.preventDefault()
    event.stopPropagation()
    setReorder({
      taskId: task.id,
      isPhase: !task.parent_id,
      parentId: task.parent_id,
      startFlatIndex: flatIndex,
      targetFlatIndex: flatIndex,
      startY: event.clientY,
    })
  }

  const phases = tasks.filter(task => !task.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const flatList = []
  phases.forEach((phase, phaseIndex) => {
    const phaseColor = phase.color || PHASE_COLORS[phaseIndex % PHASE_COLORS.length]
    flatList.push({ task: phase, depth: 0, isPhase: true, phaseColor })
    if (!collapsed.has(phase.id)) {
      tasks.filter(task => task.parent_id === phase.id)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .forEach(child => flatList.push({ task: child, depth: 1, isPhase: false, phaseColor }))
    }
  })
  flatListRef.current = flatList

  const childTasks = tasks.filter(task => task.parent_id)
  const datedTasks = childTasks.filter(task => task.start_date && task.end_date)
  const projectStart = minDate(datedTasks.map(task => task.start_date)) || new Date()
  const projectEnd = maxDate(datedTasks.map(task => task.end_date)) || new Date()
  const timelineStart = startOfWeek(addCalendarDays(projectStart, -7))
  const timelineEnd = startOfWeek(addCalendarDays(projectEnd, 21))
  const weeks = []
  for (let week = new Date(timelineStart); week <= timelineEnd; week = addCalendarDays(week, 7)) weeks.push(new Date(week))
  const timelineWidth = weeks.length * weekWidth
  const bodyHeight = Math.max(flatList.length * ROW_H, ROW_H * 3)
  const barLeft = value => diffCalendarDays(timelineStart, value) * dayWidth
  const barWidth = (start, end) => Math.max((diffCalendarDays(start, end) + 1) * dayWidth, 6)
  const inspections = childTasks.filter(task => getJeffersonTaskMetadata(task.name).type === 'inspection').length
  const completed = childTasks.filter(task => task.status === 'complete').length
  const editingTask = tasks.find(task => task.id === editingId)
  const dependencyName = id => (tasks.find(task => task.id === id)?.name || '').replace(/^INSPECTION - /, '')
  const selectedPredecessor = selectedDependency && tasks.find(task => task.id === selectedDependency.fromId)
  const selectedSuccessor = selectedDependency && tasks.find(task => task.id === selectedDependency.toId)

  function exportCsv() {
    const header = ['Phase', 'Task', 'Trade', 'Type', 'Start', 'Finish', 'Workdays', 'Predecessors', 'Plan references', 'Notes']
    const rows = phases.flatMap(phase => tasks
      .filter(task => task.parent_id === phase.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map(item => {
        const metadata = getJeffersonTaskMetadata(item.name)
        return [
          phase.name, item.name.replace(/^INSPECTION - /, ''), metadata.trade,
          TYPE_MAP[metadata.type]?.label || 'Work', item.start_date, item.end_date,
          workdayDuration(item.start_date, item.end_date),
          (item.depends_on || []).map(dependencyName).join('; '), metadata.references, metadata.notes,
        ]
      }))
    const csv = [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = '3120-jefferson-construction-schedule.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="text-center py-24 text-lbl3 text-sm">Loading schedule...</div>

  return (
    <div>
      <div className="schedule-screen">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <SummaryCard label="Planned Start" value={formatShortDate(projectStart, { includeYear: true })} />
          <SummaryCard label="Substantial Completion" value={formatShortDate(projectEnd, { includeYear: true })} />
          <SummaryCard label="Working Days" value={workdayDuration(projectStart, projectEnd)} detail="Monday-Friday" />
          <SummaryCard label="Inspection Gates" value={inspections} detail={`${completed}/${childTasks.length} tasks complete`} />
        </div>

        {notice && (
          <div className="mb-4 rounded-apple px-4 py-3 text-sm" style={{
            color: notice.type === 'error' ? '#ff9f0a' : '#30d158',
            background: notice.type === 'error' ? 'rgba(255,159,10,0.12)' : 'rgba(48,209,88,0.10)',
            border: `1px solid ${notice.type === 'error' ? 'rgba(255,159,10,0.3)' : 'rgba(48,209,88,0.25)'}`,
          }}>{notice.text}</div>
        )}

        <div className="flex items-center gap-2 mb-4 flex-wrap no-print">
          <button onClick={addPhase} className="btn-primary text-xs px-3 py-2">+ Add Phase</button>
          <button onClick={applyPermitSchedule} disabled={loadingTemplate} className="btn-secondary text-xs px-3 py-2">
            {loadingTemplate ? 'Loading...' : tasks.length ? 'Restore Permit Schedule' : 'Load Permit Schedule'}
          </button>
          <button onClick={exportCsv} className="btn-secondary text-xs px-3 py-2">Export CSV</button>
          <button onClick={() => window.print()} className="btn-secondary text-xs px-3 py-2">Print / Save PDF</button>
          <span className="text-lbl3 text-xs hidden xl:inline">Monday-Friday calendar · successors move automatically.</span>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-lbl3 text-xs mr-1">Zoom</span>
            <button onClick={() => setZoomIndex(index => Math.max(0, index - 1))} disabled={zoomIndex === 0} className="btn-secondary text-xs px-2 py-1">-</button>
            <span className="text-lbl3 text-xs w-8 text-center">{weekWidth}px</span>
            <button onClick={() => setZoomIndex(index => Math.min(ZOOM_LEVELS.length - 1, index + 1))} disabled={zoomIndex === ZOOM_LEVELS.length - 1} className="btn-secondary text-xs px-2 py-1">+</button>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-3 text-xs text-lbl3">
          <Legend color="#ff9f0a" label="Inspection gate" diamond />
          <Legend color="#bf5af2" label="Procurement" />
          <Legend color="#30d158" label="Complete" />
          <Legend color="#ff453a" label="Blocked" />
          <DependencyLegend />
        </div>

        <div className="no-print flex items-center gap-3 mb-3 rounded-lg px-3 py-2 text-xs flex-wrap" style={{ background: 'rgba(10,132,255,0.07)', border: '1px solid rgba(10,132,255,0.16)' }}>
          <span style={{ color: '#0a84ff', fontWeight: 700 }}>Quick edit</span>
          <span className="text-lbl3">Drag a bar to move it</span>
          <span className="text-lbl3">·</span>
          <span className="text-lbl3">Drag its right edge to change duration</span>
          <span className="text-lbl3">·</span>
          <span className="text-lbl3">Drag the gold dot to another task to link them</span>
        </div>

        {selectedPredecessor && selectedSuccessor && (
          <div className="no-print flex items-center gap-2 mb-3 rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(255,179,64,0.10)', border: '1px solid rgba(255,179,64,0.24)' }}>
            <span style={{ color: '#ffb340', fontWeight: 700 }}>Selected dependency</span>
            <span className="text-white truncate">{selectedPredecessor.name.replace(/^INSPECTION - /, '')} → {selectedSuccessor.name.replace(/^INSPECTION - /, '')}</span>
            <div className="flex-1" />
            <button onClick={() => removeDependency(selectedDependency.fromId, selectedDependency.toId)} className="text-neg font-semibold flex-shrink-0">Remove link</button>
            <button onClick={() => setSelectedDependency(null)} className="text-lbl3 text-base leading-none flex-shrink-0" title="Close">×</button>
          </div>
        )}

        <div ref={ganttScrollRef} className="apple-card schedule-gantt" style={{ overflow: 'auto', maxHeight: '70vh' }}>
          <div style={{ minWidth: LIST_W + timelineWidth }}>
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 20, height: HDR_H, background: '#1c1c1e', borderBottom: '1px solid rgba(84,84,88,0.4)' }}>
              <div style={{ width: LIST_W, minWidth: LIST_W, position: 'sticky', left: 0, zIndex: 30, background: '#1c1c1e', display: 'flex', alignItems: 'flex-end', padding: '0 16px 10px', borderRight: '1px solid rgba(84,84,88,0.3)' }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#8e8e93' }}>Phases, tasks & responsible trade</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', height: 29 }}>
                  {getMonthGroups(weeks).map(({ label, start, count }) => (
                    <div key={start} style={{ width: count * weekWidth, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, borderRight: '1px solid rgba(84,84,88,0.25)', fontSize: 11, fontWeight: 600, color: '#ebebf5', overflow: 'hidden' }}>{label}</div>
                  ))}
                </div>
                <div style={{ display: 'flex', height: 29 }}>
                  {weeks.map((week, index) => {
                    const isCurrentWeek = diffCalendarDays(week, startOfWeek(new Date())) === 0
                    return (
                      <div key={index} style={{ width: weekWidth, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(84,84,88,0.2)', fontSize: 10, color: isCurrentWeek ? '#0a84ff' : '#8e8e93', fontWeight: isCurrentWeek ? 700 : 400, overflow: 'hidden' }}>
                        {weekWidth >= 40 || index % 2 === 0 ? formatShortDate(week) : ''}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex' }}>
              <div style={{ width: LIST_W, minWidth: LIST_W, position: 'sticky', left: 0, zIndex: 10, background: '#1c1c1e', borderRight: '1px solid rgba(84,84,88,0.3)' }}>
                {flatList.map(({ task, depth, isPhase, phaseColor }, flatIndex) => {
                  const metadata = getJeffersonTaskMetadata(task.name)
                  const predecessors = (task.depends_on || []).map(dependencyName).filter(Boolean)
                  const isDragging = reorder?.taskId === task.id
                  const isNestTarget = reorder && !reorder.isPhase && isPhase && reorder.targetFlatIndex === flatIndex && reorder.taskId !== task.id
                  const isReorderTarget = reorder && reorder.targetFlatIndex === flatIndex && reorder.taskId !== task.id && !isNestTarget
                  return (
                    <div key={task.id} onMouseEnter={() => setHoveredId(task.id)} onMouseLeave={() => setHoveredId(null)} style={{
                      height: ROW_H, display: 'flex', alignItems: 'center', padding: `0 6px 0 ${8 + depth * 20}px`,
                      borderBottom: isNestTarget ? '2px solid #0a84ff' : '1px solid rgba(84,84,88,0.2)',
                      borderTop: isReorderTarget ? '2px solid #0a84ff' : undefined,
                      background: isNestTarget ? 'rgba(10,132,255,0.12)' : editingId === task.id ? 'rgba(10,132,255,0.1)' : isDragging ? 'rgba(10,132,255,0.06)' : isPhase ? hexToRgba(phaseColor, 0.08) : 'transparent',
                      cursor: 'pointer', gap: 4, opacity: isDragging ? 0.5 : 1,
                    }}>
                      <span onMouseDown={event => startReorder(event, task, flatIndex)} style={{ color: '#636366', fontSize: 12, cursor: 'grab', flexShrink: 0, paddingRight: 2, userSelect: 'none' }} title="Drag to reorder">::</span>
                      {isPhase ? (
                        <button onClick={event => { event.stopPropagation(); setCollapsed(value => { const next = new Set(value); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next }) }} style={{ color: '#8e8e93', fontSize: 9, width: 12, flexShrink: 0 }}>
                          {collapsed.has(task.id) ? '▶' : '▼'}
                        </button>
                      ) : <span style={{ width: 12, flexShrink: 0 }} />}
                      <span style={{ width: 7, height: 7, borderRadius: metadata.type === 'inspection' ? 1 : '50%', transform: metadata.type === 'inspection' ? 'rotate(45deg)' : undefined, background: metadata.type === 'inspection' ? '#ff9f0a' : phaseColor, flexShrink: 0 }} />
                      <div onClick={() => editingId === task.id ? setEditingId(null) : openEdit(task)} style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: isPhase ? 700 : 500, color: isPhase ? '#fff' : '#ebebf5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name.replace(/^INSPECTION - /, '')}</div>
                        {!isPhase && <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 10, color: metadata.type === 'inspection' ? '#ff9f0a' : '#8e8e93', flexShrink: 0 }}>{metadata.trade || 'Unassigned'} · {workdayDuration(task.start_date, task.end_date)}d</span>
                          <span title={predecessors.length ? `Starts after: ${predecessors.join(', ')}` : 'No predecessor'} style={{ fontSize: 10, color: predecessors.length ? '#ffb340' : '#636366', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {predecessors.length ? `↳ After ${predecessors.join(', ')}` : 'No predecessor'}
                          </span>
                        </div>}
                      </div>
                      <span style={{ color: STATUS_MAP[task.status]?.color || '#8E8E93', fontSize: 9, flexShrink: 0 }}>●</span>
                      {isPhase && <button onClick={event => { event.stopPropagation(); addTask(task.id) }} style={{ fontSize: 14, fontWeight: 700, color: '#0a84ff', flexShrink: 0, opacity: hoveredId === task.id ? 1 : 0, width: 18 }} title="Add task">+</button>}
                      <button onClick={event => { event.stopPropagation(); deleteTask(task.id) }} style={{ color: '#ff453a', fontSize: 14, width: 18, flexShrink: 0, opacity: hoveredId === task.id ? 1 : 0 }} title="Delete">×</button>
                    </div>
                  )
                })}
              </div>

              <div ref={timelineBodyRef} style={{ flex: 1, position: 'relative', height: bodyHeight }}>
                {weeks.map((_, index) => (
                  <React.Fragment key={index}>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: index * weekWidth, width: 1, background: 'rgba(84,84,88,0.2)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: index * weekWidth + dayWidth * 5, width: dayWidth * 2, background: 'rgba(142,142,147,0.07)', pointerEvents: 'none' }} />
                  </React.Fragment>
                ))}
                {new Date() >= timelineStart && new Date() <= timelineEnd && <div style={{ position: 'absolute', top: 0, bottom: 0, left: diffCalendarDays(timelineStart, new Date()) * dayWidth, width: 1, background: 'rgba(255,69,58,0.7)', zIndex: 4, pointerEvents: 'none' }} />}
                {flatList.map((_, index) => <div key={index} style={{ position: 'absolute', left: 0, right: 0, top: (index + 1) * ROW_H - 1, height: 1, background: 'rgba(84,84,88,0.2)', pointerEvents: 'none' }} />)}
                {linkDrag?.targetId && (() => {
                  const targetIndex = flatList.findIndex(row => row.task.id === linkDrag.targetId)
                  if (targetIndex < 0) return null
                  return <div style={{ position: 'absolute', left: 0, right: 0, top: targetIndex * ROW_H, height: ROW_H, background: linkDrag.valid ? 'rgba(48,209,88,0.10)' : 'rgba(255,69,58,0.10)', border: `1px solid ${linkDrag.valid ? 'rgba(48,209,88,0.45)' : 'rgba(255,69,58,0.45)'}`, zIndex: 1, pointerEvents: 'none' }} />
                })()}

                {flatList.map(({ task, isPhase, phaseColor }, index) => {
                  if (!task.start_date || !task.end_date) return null
                  const metadata = getJeffersonTaskMetadata(task.name)
                  const isInspection = metadata.type === 'inspection' || metadata.type === 'milestone'
                  const left = barLeft(task.start_date)
                  const width = barWidth(task.start_date, task.end_date)
                  const barHeight = isPhase ? 30 : 20
                  const baseColor = task.status && task.status !== 'not_started' ? STATUS_MAP[task.status]?.color || phaseColor : metadata.type === 'procurement' ? '#bf5af2' : metadata.type === 'inspection' ? '#ff9f0a' : phaseColor
                  const top = index * ROW_H + (ROW_H - barHeight) / 2
                  const showLinkHandles = !isPhase && (hoveredId === task.id || Boolean(linkDrag))
                  const isLinkTarget = linkDrag?.targetId === task.id
                  if (isInspection && !isPhase) {
                    return <div key={task.id} data-gantt-task-id={task.id} onMouseEnter={() => setHoveredId(task.id)} onMouseLeave={() => !linkDrag && setHoveredId(null)} style={{ position: 'absolute', top: top + 3, left: left - 1, width: 14, height: 14, zIndex: 5 }}>
                      <div onMouseDown={event => startBarDrag(event, task, 'move')} title={`${task.name}: ${formatShortDate(task.start_date)}`} style={{ position: 'absolute', inset: 0, background: baseColor, border: '2px solid #1c1c1e', transform: 'rotate(45deg)', borderRadius: 2, cursor: 'grab' }} />
                      {showLinkHandles && <span style={{ position: 'absolute', left: -11, top: 3, width: 8, height: 8, borderRadius: '50%', background: isLinkTarget ? (linkDrag.valid ? '#30d158' : '#ff453a') : '#ffb340', border: '2px solid #1c1c1e', pointerEvents: 'none' }} />}
                      <button type="button" aria-label={`Create dependency after ${task.name}`} title="Drag to the task that should happen next" onMouseDown={event => startLinkDrag(event, task)} style={{ position: 'absolute', right: -13, top: 1, width: 12, height: 12, borderRadius: '50%', background: '#ffb340', border: '2px solid #1c1c1e', cursor: 'crosshair', zIndex: 9, opacity: hoveredId === task.id || linkDrag?.sourceId === task.id ? 1 : 0.28, transition: 'opacity 120ms ease' }} />
                    </div>
                  }
                  return (
                    <div key={task.id}>
                      <div data-gantt-task-id={task.id} onMouseEnter={() => setHoveredId(task.id)} onMouseLeave={() => !linkDrag && setHoveredId(null)} onMouseDown={event => startBarDrag(event, task, 'move')} title={`${task.name}: ${formatShortDate(task.start_date)} - ${formatShortDate(task.end_date)} (${workdayDuration(task.start_date, task.end_date)} workdays)`} style={{
                        position: 'absolute', top, left, width, height: barHeight,
                        background: isPhase ? baseColor : hexToRgba(baseColor, metadata.type === 'procurement' ? 0.42 : 0.3),
                        border: isPhase ? 'none' : `1.5px solid ${baseColor}`, borderRadius: isPhase ? 4 : 5,
                        opacity: isPhase ? 0.95 : 1, cursor: isPhase ? 'default' : drag?.taskId === task.id ? 'grabbing' : 'grab',
                        display: 'flex', alignItems: 'center', overflow: 'visible', zIndex: 2,
                      }}>
                        {width > (isPhase ? 72 : 64) && <span style={{ width: '100%', fontSize: isPhase ? 12 : 10, fontWeight: isPhase ? 700 : 600, color: isPhase ? '#fff' : baseColor, padding: '0 9px 0 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none' }}>{task.name.replace(/^INSPECTION - /, '')}</span>}
                        {!isPhase && <div title="Drag to change duration" onMouseDown={event => startBarDrag(event, task, 'resize')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', background: 'rgba(0,0,0,0.18)', borderRadius: '0 5px 5px 0', zIndex: 6 }} />}
                        {showLinkHandles && !isPhase && <span style={{ position: 'absolute', left: -10, top: '50%', width: 9, height: 9, marginTop: -4.5, borderRadius: '50%', background: isLinkTarget ? (linkDrag.valid ? '#30d158' : '#ff453a') : '#ffb340', border: '2px solid #1c1c1e', pointerEvents: 'none', zIndex: 8 }} />}
                        {!isPhase && <button type="button" aria-label={`Create dependency after ${task.name}`} title="Drag to the task that should happen next" onMouseDown={event => startLinkDrag(event, task)} style={{ position: 'absolute', right: -13, top: '50%', width: 12, height: 12, marginTop: -6, borderRadius: '50%', background: '#ffb340', border: '2px solid #1c1c1e', cursor: 'crosshair', zIndex: 9, opacity: hoveredId === task.id || linkDrag?.sourceId === task.id ? 1 : 0.28, transition: 'opacity 120ms ease' }} />}
                        {drag?.taskId === task.id && <span style={{ position: 'absolute', left: '50%', top: -27, transform: 'translateX(-50%)', padding: '3px 7px', borderRadius: 6, background: '#2c2c2e', border: '1px solid rgba(255,255,255,0.16)', color: '#fff', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10 }}>{formatShortDate(task.start_date)} → {formatShortDate(task.end_date)}</span>}
                      </div>
                    </div>
                  )
                })}
                <DependencyArrows flatList={flatList} timelineStart={timelineStart} bodyHeight={bodyHeight} timelineWidth={timelineWidth} dayWidth={dayWidth} activeTaskId={editingId || hoveredId || drag?.taskId || linkDrag?.sourceId} selectedDependency={selectedDependency} onSelect={setSelectedDependency} />
                {linkDrag && <DependencyDraft linkDrag={linkDrag} />}
              </div>
            </div>
          </div>
        </div>
      </div>

      <PrintableSchedule phases={phases} tasks={tasks} projectStart={projectStart} projectEnd={projectEnd} />

      {editingTask && (
        <EditModal task={editingTask} fields={editFields} setFields={setEditFields} tasks={tasks} isPhase={!editingTask.parent_id} onSave={() => saveEdit(editingId)} onCancel={() => setEditingId(null)} onDelete={() => deleteTask(editingId)} onAddTask={() => addTask(editingId)} />
      )}
    </div>
  )
}

function SummaryCard({ label, value, detail }) {
  return <div className="apple-card px-4 py-3"><div className="text-lbl3 uppercase tracking-wider" style={{ fontSize: 10, fontWeight: 700 }}>{label}</div><div className="text-white font-semibold mt-1" style={{ fontSize: 17 }}>{value}</div>{detail && <div className="text-lbl3 mt-0.5" style={{ fontSize: 10 }}>{detail}</div>}</div>
}

function Legend({ color, label, diamond }) {
  return <span className="flex items-center gap-1.5"><span style={{ width: 8, height: 8, background: color, borderRadius: diamond ? 1 : 4, transform: diamond ? 'rotate(45deg)' : undefined }} />{label}</span>
}

function DependencyLegend() {
  return <span className="flex items-center gap-1.5"><span style={{ color: '#ffb340', fontWeight: 700, letterSpacing: -1 }}>—›</span>Predecessor → successor</span>
}

function DependencyArrows({ flatList, timelineStart, bodyHeight, timelineWidth, dayWidth, activeTaskId, selectedDependency, onSelect }) {
  const arrows = []
  flatList.forEach(({ task }, toIndex) => {
    ;(task.depends_on || []).forEach(dependencyId => {
      const fromIndex = flatList.findIndex(row => row.task.id === dependencyId)
      if (fromIndex === -1) return
      const fromTask = flatList[fromIndex].task
      if (!fromTask.end_date || !task.start_date) return
      arrows.push({
        x1: diffCalendarDays(timelineStart, fromTask.end_date) * dayWidth + dayWidth,
        y1: fromIndex * ROW_H + ROW_H / 2,
        x2: diffCalendarDays(timelineStart, task.start_date) * dayWidth,
        y2: toIndex * ROW_H + ROW_H / 2,
        fromId: dependencyId,
        toId: task.id,
        label: `${fromTask.name.replace(/^INSPECTION - /, '')} → ${task.name.replace(/^INSPECTION - /, '')}`,
        key: `${dependencyId}-${task.id}`,
      })
    })
  })
  if (!arrows.length) return null
  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: timelineWidth, height: bodyHeight, pointerEvents: 'none', zIndex: 1 }}>
      <defs>
        <marker id="dependency-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L0,7 L7,3.5 z" fill="#ffb340" /></marker>
        <marker id="dependency-arrow-muted" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="rgba(255,179,64,0.5)" /></marker>
      </defs>
      {arrows.map(({ x1, y1, x2, y2, fromId, toId, label, key }) => {
        const selected = selectedDependency?.fromId === fromId && selectedDependency?.toId === toId
        const active = selected || Boolean(activeTaskId && (activeTaskId === fromId || activeTaskId === toId))
        const opacity = active ? 1 : activeTaskId ? 0.1 : 0.3
        const elbowX = Math.max(x1 + 12, x2 - 10)
        const path = x2 > x1 + 8
          ? `M${x1},${y1} L${elbowX},${y1} L${elbowX},${y2} L${x2},${y2}`
          : `M${x1},${y1} L${x1 + 12},${y1} L${x1 + 12},${(y1 + y2) / 2} L${x2 - 12},${(y1 + y2) / 2} L${x2 - 12},${y2} L${x2},${y2}`
        return <g key={key} opacity={opacity}>
          <title>{label}</title>
          <circle cx={x1} cy={y1} r={active ? 2.5 : 2} fill={active ? '#ffb340' : 'rgba(255,179,64,0.5)'} />
          <path d={path} fill="none" stroke="transparent" strokeWidth="14" pointerEvents="stroke" style={{ cursor: 'pointer' }} onClick={() => onSelect({ fromId, toId })} />
          <path d={path} fill="none" stroke={active ? '#ffb340' : 'rgba(255,179,64,0.5)'} strokeWidth={selected ? 2.6 : active ? 1.8 : 1.1} markerEnd={active ? 'url(#dependency-arrow)' : 'url(#dependency-arrow-muted)'} pointerEvents="none" />
        </g>
      })}
    </svg>
  )
}

function DependencyDraft({ linkDrag }) {
  const color = linkDrag.valid ? '#30d158' : linkDrag.targetId ? '#ff453a' : '#ffb340'
  const elbowX = Math.max(linkDrag.sourceX + 16, linkDrag.x - 18)
  const path = `M${linkDrag.sourceX},${linkDrag.sourceY} L${elbowX},${linkDrag.sourceY} L${elbowX},${linkDrag.y} L${linkDrag.x},${linkDrag.y}`
  return <>
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 12 }}>
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeDasharray="5 4" />
      <circle cx={linkDrag.x} cy={linkDrag.y} r="5" fill={color} stroke="#1c1c1e" strokeWidth="2" />
    </svg>
    <div style={{ position: 'absolute', left: linkDrag.x + 10, top: Math.max(4, linkDrag.y - 28), padding: '4px 7px', borderRadius: 6, background: '#2c2c2e', border: `1px solid ${color}`, color, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 13 }}>
      {linkDrag.valid ? 'Release to create dependency' : linkDrag.error}
    </div>
  </>
}

function EditModal({ task, fields, setFields, tasks, isPhase, onSave, onCancel, onDelete, onAddTask }) {
  const [dependencyFilter, setDependencyFilter] = useState('')
  const set = key => event => setFields(previous => ({ ...previous, [key]: event.target.value }))
  const toggleDependency = (id, checked) => setFields(previous => ({
    ...previous,
    depends_on: checked ? [...new Set([...(previous.depends_on || []), id])] : (previous.depends_on || []).filter(value => value !== id),
  }))
  const filter = dependencyFilter.trim().toLowerCase()
  const phaseById = new Map(tasks.filter(item => !item.parent_id).map(item => [item.id, item]))
  const selected = (fields.depends_on || []).map(id => tasks.find(item => item.id === id)).filter(Boolean)
  const earliestStart = earliestDependencyStart(tasks, fields.depends_on)
  const candidates = tasks
    .filter(item => item.parent_id && item.id !== task.id && !(fields.depends_on || []).includes(item.id))
    .map(item => {
      const candidateTasks = tasks.map(row => row.id === task.id ? { ...row, depends_on: [...(fields.depends_on || []), item.id] } : row)
      return { ...item, createsCycle: hasDependencyCycle(candidateTasks), phase: phaseById.get(item.parent_id) }
    })
    .sort((a, b) => (a.phase?.sort_order || 0) - (b.phase?.sort_order || 0) || (a.sort_order || 0) - (b.sort_order || 0))
    .filter(item => !filter || `${item.phase?.name || ''} ${item.name}`.toLowerCase().includes(filter))

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ width: '100%', maxWidth: 940, background: '#1c1c1e', border: '1px solid rgba(84,84,88,0.5)', borderBottom: 'none', borderRadius: '16px 16px 0 0', padding: 20, boxShadow: '0 -8px 40px rgba(0,0,0,0.6)', pointerEvents: 'all' }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lbl3 uppercase tracking-wider font-semibold" style={{ fontSize: 11 }}>{isPhase ? 'Edit phase' : 'Edit task'}</span>
          <div className="flex-1" />
          {isPhase && <button onClick={onAddTask} className="text-xs text-acc font-semibold">+ Add Task</button>}
          <button onClick={onDelete} className="text-xs text-neg">Delete</button>
          <button onClick={onCancel} className="btn-secondary text-xs px-3 py-1.5">Close</button>
          <button onClick={onSave} className="btn-primary text-xs px-3 py-1.5">Save</button>
        </div>
        <div className="flex gap-3 flex-wrap items-center mb-4">
          <input value={fields.name} onChange={set('name')} className="apple-input text-sm" style={{ flex: '1 1 260px' }} placeholder="Name" />
          <label className="flex items-center gap-2 text-lbl3 text-xs">Start<input type="date" value={fields.start_date} onChange={set('start_date')} disabled={isPhase} className="apple-input text-xs" style={{ width: 140, opacity: isPhase ? 0.55 : 1 }} /></label>
          <label className="flex items-center gap-2 text-lbl3 text-xs">Finish<input type="date" value={fields.end_date} onChange={set('end_date')} disabled={isPhase} className="apple-input text-xs" style={{ width: 140, opacity: isPhase ? 0.55 : 1 }} /></label>
          <select value={fields.status} onChange={set('status')} className="apple-input text-xs" style={{ width: 135 }}>{Object.entries(STATUS_MAP).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>
        </div>
        {isPhase ? <p className="text-lbl3 text-xs">Phase dates roll up automatically from child tasks.</p> : (
          <div>
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <div className="text-white font-semibold" style={{ fontSize: 13 }}>This task starts after</div>
                <p className="text-lbl3 mt-0.5" style={{ fontSize: 10 }}>Finish-to-start rule: the task begins on the next working day after every selected predecessor is complete.</p>
              </div>
              {earliestStart && <div className="text-right flex-shrink-0"><div className="text-lbl3 uppercase tracking-wider" style={{ fontSize: 9 }}>Earliest start</div><div style={{ color: '#ffb340', fontSize: 12, fontWeight: 700 }}>{formatShortDate(earliestStart, { includeYear: true })}</div></div>}
            </div>
            <div className="flex flex-wrap gap-2 mb-3 min-h-7">
              {selected.map(item => <button key={item.id} type="button" onClick={() => toggleDependency(item.id, false)} title="Remove predecessor" className="flex items-center gap-1.5 text-xs rounded-md px-2 py-1" style={{ color: '#ffb340', background: 'rgba(255,179,64,0.12)', border: '1px solid rgba(255,179,64,0.28)' }}>
                <span>↳ {item.name.replace(/^INSPECTION - /, '')}</span><span style={{ color: '#8e8e93' }}>{formatShortDate(item.end_date)}</span><span aria-hidden="true">×</span>
              </button>)}
              {!selected.length && <span className="text-lbl3 text-xs italic">No predecessor — this task may start independently.</span>}
            </div>
            <div className="text-lbl3 uppercase tracking-wider font-semibold mb-1.5" style={{ fontSize: 10 }}>Add a predecessor</div>
            <input value={dependencyFilter} onChange={event => setDependencyFilter(event.target.value)} className="apple-input text-xs w-full mb-2" placeholder="Search by phase or task..." />
            <div className="max-h-40 overflow-y-auto rounded-lg" style={{ border: '1px solid rgba(84,84,88,0.35)' }}>
              {candidates.map(item => (
                <button key={item.id} type="button" disabled={item.createsCycle} onClick={() => toggleDependency(item.id, true)} className="w-full flex items-center gap-3 px-3 py-2 text-left" style={{ borderBottom: '1px solid rgba(84,84,88,0.22)', opacity: item.createsCycle ? 0.38 : 1, cursor: item.createsCycle ? 'not-allowed' : 'pointer' }} title={item.createsCycle ? 'Unavailable because it would create a circular dependency' : 'Add as predecessor'}>
                  <span style={{ color: '#0a84ff', fontSize: 15, fontWeight: 700 }}>+</span>
                  <span style={{ flex: 1, minWidth: 0 }}><span className="block text-lbl3 uppercase tracking-wider" style={{ fontSize: 9 }}>{item.phase?.name || 'Unassigned phase'}</span><span className="block text-white truncate" style={{ fontSize: 12 }}>{item.name.replace(/^INSPECTION - /, '')}</span></span>
                  <span className="text-lbl3 flex-shrink-0" style={{ fontSize: 10 }}>Finishes {formatShortDate(item.end_date)}</span>
                </button>
              ))}
              {!candidates.length && <div className="text-lbl3 text-xs italic px-3 py-3">No matching tasks</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PrintableSchedule({ phases, tasks, projectStart, projectEnd }) {
  const nameFor = id => tasks.find(task => task.id === id)?.name.replace(/^INSPECTION - /, '') || ''
  return (
    <div className="schedule-print">
      <div className="print-header">
        <div><h1>3120 Jefferson Street</h1><p>Construction Schedule - Subcontractor Issue</p></div>
        <div className="print-dates"><strong>{formatShortDate(projectStart, { includeYear: true })} - {formatShortDate(projectEnd, { includeYear: true })}</strong><span>Monday-Friday work calendar</span></div>
      </div>
      <p className="print-note">Dates are planning targets and depend on predecessor completion, inspection availability, weather, field conditions, and approved submittals. Inspection rows are hold points; successor work may not proceed until the gate passes.</p>
      {phases.map(phase => (
        <section key={phase.id}>
          <h2 style={{ borderLeftColor: phase.color || '#0a84ff' }}>{phase.name}</h2>
          <table><thead><tr><th>Activity</th><th>Trade</th><th>Start</th><th>Finish</th><th>Days</th><th>Predecessor(s)</th><th>Plan Ref.</th></tr></thead>
            <tbody>{tasks.filter(task => task.parent_id === phase.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(item => {
              const metadata = getJeffersonTaskMetadata(item.name)
              return <tr key={item.id} className={metadata.type === 'inspection' ? 'inspection-row' : ''}><td>{item.name.replace(/^INSPECTION - /, '')}{metadata.type === 'inspection' && <strong className="inspection-label"> HOLD POINT</strong>}</td><td>{metadata.trade || 'Unassigned'}</td><td>{formatShortDate(item.start_date, { includeYear: true })}</td><td>{formatShortDate(item.end_date, { includeYear: true })}</td><td>{workdayDuration(item.start_date, item.end_date)}</td><td>{(item.depends_on || []).map(nameFor).join('; ') || '-'}</td><td>{metadata.references || '-'}</td></tr>
            })}</tbody>
          </table>
        </section>
      ))}
      <div className="print-footer">3120 Jefferson Street · Plan-validated baseline · Generated {new Date().toLocaleDateString('en-US')}</div>
    </div>
  )
}

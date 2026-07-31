const DAY_MS = 86400000

export function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function toDateString(value) {
  const date = parseDate(value)
  if (!date) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addCalendarDays(value, days) {
  const date = parseDate(value)
  date.setDate(date.getDate() + days)
  return date
}

export function diffCalendarDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS)
}

export function isWorkday(value) {
  const day = parseDate(value).getDay()
  return day !== 0 && day !== 6
}

export function normalizeWorkday(value, direction = 1) {
  const date = parseDate(value)
  while (!isWorkday(date)) date.setDate(date.getDate() + (direction < 0 ? -1 : 1))
  return date
}

// Count workdays forward (or backward). A zero offset returns the same workday.
export function addWorkdays(value, count) {
  const direction = count < 0 ? -1 : 1
  const date = normalizeWorkday(value, direction)
  let remaining = Math.abs(count)
  while (remaining > 0) {
    date.setDate(date.getDate() + direction)
    if (isWorkday(date)) remaining--
  }
  return date
}

export function nextWorkday(value) {
  return addWorkdays(value, 1)
}

export function workdayDuration(start, end) {
  if (!start || !end || parseDate(end) < parseDate(start)) return 0
  let cursor = parseDate(start)
  const finish = parseDate(end)
  let count = 0
  while (cursor <= finish) {
    if (isWorkday(cursor)) count++
    cursor = addCalendarDays(cursor, 1)
  }
  return count
}

export function startOfWeek(value) {
  const date = parseDate(value)
  const day = date.getDay()
  const delta = day === 0 ? -6 : 1 - day
  return addCalendarDays(date, delta)
}

export function maxDate(values) {
  const dates = values.filter(Boolean).map(parseDate)
  return dates.length ? new Date(Math.max(...dates)) : null
}

export function minDate(values) {
  const dates = values.filter(Boolean).map(parseDate)
  return dates.length ? new Date(Math.min(...dates)) : null
}

export function formatShortDate(value, options = {}) {
  if (!value) return ''
  return parseDate(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(options.includeYear ? { year: 'numeric' } : {}),
  })
}

export function shiftWorkdayRange(start, end, calendarDelta) {
  const duration = Math.max(1, workdayDuration(start, end))
  const rawStart = addCalendarDays(start, calendarDelta)
  const direction = calendarDelta < 0 ? -1 : 1
  const shiftedStart = normalizeWorkday(rawStart, direction)
  return {
    start_date: toDateString(shiftedStart),
    end_date: toDateString(addWorkdays(shiftedStart, duration - 1)),
  }
}

export function shiftRangeByWorkdays(start, end, workdayDelta) {
  const duration = Math.max(1, workdayDuration(start, end))
  const shiftedStart = addWorkdays(start, workdayDelta)
  return {
    start_date: toDateString(shiftedStart),
    end_date: toDateString(addWorkdays(shiftedStart, duration - 1)),
  }
}

export function workdayDelta(from, to) {
  const start = normalizeWorkday(from, 1)
  const finish = normalizeWorkday(to, 1)
  if (start.getTime() === finish.getTime()) return 0
  const direction = start < finish ? 1 : -1
  let cursor = start
  let count = 0
  while ((direction > 0 && cursor < finish) || (direction < 0 && cursor > finish)) {
    cursor = addWorkdays(cursor, direction)
    count += direction
  }
  return count
}

export const DEPENDENCY_TYPES = {
  FS: { label: 'Finish to start', shortLabel: 'FS', description: 'The next task starts after this task finishes.' },
  SS: { label: 'Start to start', shortLabel: 'SS', description: 'The next task starts after this task starts.' },
  FF: { label: 'Finish to finish', shortLabel: 'FF', description: 'The next task finishes after this task finishes.' },
  SF: { label: 'Start to finish', shortLabel: 'SF', description: 'The next task finishes after this task starts.' },
}

export function dependencySetting(task, predecessorId) {
  const setting = task?.dependency_settings?.[predecessorId] || {}
  const type = DEPENDENCY_TYPES[setting.type] ? setting.type : 'FS'
  const lag = Number.isFinite(Number(setting.lag)) ? Math.trunc(Number(setting.lag)) : 0
  return { type, lag }
}

export function dependencySettingsFor(task, predecessorIds = task?.depends_on || []) {
  return Object.fromEntries(predecessorIds.map(id => [id, dependencySetting(task, id)]))
}

function dependencyConstraintStart(predecessor, successor) {
  if (!predecessor || !successor) return null
  const { type, lag } = dependencySetting(successor, predecessor.id)
  const duration = Math.max(1, workdayDuration(successor.start_date, successor.end_date))
  if (type === 'SS') return addWorkdays(predecessor.start_date, lag)
  if (type === 'FF') return addWorkdays(addWorkdays(predecessor.end_date, lag), -(duration - 1))
  if (type === 'SF') return addWorkdays(addWorkdays(predecessor.start_date, lag), -(duration - 1))
  return addWorkdays(predecessor.end_date, lag + 1)
}

export function dependencyIsViolated(tasks, predecessorId, successorId) {
  const predecessor = tasks.find(task => task.id === predecessorId)
  const successor = tasks.find(task => task.id === successorId)
  const minimumStart = dependencyConstraintStart(predecessor, successor)
  return Boolean(minimumStart && (!successor?.start_date || parseDate(successor.start_date) < minimumStart))
}

export function earliestDependencyStart(tasks, dependencyIds = [], successor = null) {
  const byId = new Map(tasks.map(task => [task.id, task]))
  if (successor) {
    return maxDate(dependencyIds.map(id => dependencyConstraintStart(byId.get(id), successor)))
  }
  const latestFinish = maxDate(dependencyIds.map(id => byId.get(id)?.end_date))
  return latestFinish ? nextWorkday(latestFinish) : null
}

export function enforceDependencies(tasks, changedIds = [], baselineTasks = null) {
  const byId = new Map(tasks.map(task => [task.id, { ...task }]))
  const baseline = baselineTasks ? new Map(baselineTasks.map(task => [task.id, task])) : null
  const baselineConstraint = new Map()
  if (baseline) {
    const baselineValues = [...baseline.values()]
    for (const task of baselineValues.filter(item => item.parent_id)) {
      baselineConstraint.set(task.id, earliestDependencyStart(baselineValues, task.depends_on, task))
    }
  }
  const queue = [...changedIds]
  const queued = new Set(queue)
  const directlyChanged = new Set(changedIds)
  const changed = new Set(changedIds)

  for (const id of changedIds) {
    const task = byId.get(id)
    if (!task?.parent_id) continue
    const earliestStart = earliestDependencyStart([...byId.values()], task.depends_on, task)
    if (!earliestStart) continue
    if (!task.start_date || parseDate(task.start_date) < earliestStart) {
      const duration = Math.max(1, workdayDuration(task.start_date, task.end_date))
      task.start_date = toDateString(earliestStart)
      task.end_date = toDateString(addWorkdays(earliestStart, duration - 1))
    }
  }

  while (queue.length) {
    const predecessorId = queue.shift()
    queued.delete(predecessorId)
    for (const task of byId.values()) {
      if (!task.parent_id || !(task.depends_on || []).includes(predecessorId)) continue
      const earliestStart = earliestDependencyStart([...byId.values()], task.depends_on, task)
      if (!earliestStart) continue
      const priorStart = task.start_date
      const priorEnd = task.end_date
      const originalConstraint = baselineConstraint.get(task.id)
      const baselineTask = baseline?.get(task.id)
      const constraintMovedLater = originalConstraint && earliestStart > originalConstraint
      if (constraintMovedLater && baselineTask && !directlyChanged.has(task.id)) {
        const shifted = shiftRangeByWorkdays(baselineTask.start_date, baselineTask.end_date, workdayDelta(originalConstraint, earliestStart))
        task.start_date = shifted.start_date
        task.end_date = shifted.end_date
      }
      if (!task.start_date || parseDate(task.start_date) < earliestStart) {
        const duration = Math.max(1, workdayDuration(task.start_date, task.end_date))
        task.start_date = toDateString(earliestStart)
        task.end_date = toDateString(addWorkdays(earliestStart, duration - 1))
      }
      const taskMoved = task.start_date !== priorStart || task.end_date !== priorEnd
      if (taskMoved) {
        changed.add(task.id)
        if (!queued.has(task.id)) {
          queue.push(task.id)
          queued.add(task.id)
        }
      }
    }
  }

  return { tasks: [...byId.values()], changedIds: [...changed] }
}

export function hasDependencyCycle(tasks) {
  const taskIds = new Set(tasks.filter(task => task.parent_id).map(task => task.id))
  const visiting = new Set()
  const visited = new Set()
  const byId = new Map(tasks.map(task => [task.id, task]))

  function visit(id) {
    if (visiting.has(id)) return true
    if (visited.has(id) || !taskIds.has(id)) return false
    visiting.add(id)
    for (const dependencyId of byId.get(id)?.depends_on || []) {
      if (visit(dependencyId)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  return [...taskIds].some(visit)
}

export function dependencyLinkError(tasks, predecessorId, successorId) {
  if (!predecessorId || !successorId) return 'Choose two tasks to link.'
  if (predecessorId === successorId) return 'A task cannot depend on itself.'
  const predecessor = tasks.find(task => task.id === predecessorId && task.parent_id)
  const successor = tasks.find(task => task.id === successorId && task.parent_id)
  if (!predecessor || !successor) return 'Only schedule tasks can be linked.'
  if ((successor.depends_on || []).includes(predecessorId)) return 'These tasks are already linked.'
  const candidate = tasks.map(task => task.id === successorId
    ? { ...task, depends_on: [...(task.depends_on || []), predecessorId] }
    : task)
  return hasDependencyCycle(candidate) ? 'That link would create a circular dependency.' : null
}

export function addDependencyLink(tasks, predecessorId, successorId, setting = {}) {
  const error = dependencyLinkError(tasks, predecessorId, successorId)
  if (error) return { tasks, error }
  const normalized = {
    type: DEPENDENCY_TYPES[setting.type] ? setting.type : 'FS',
    lag: Number.isFinite(Number(setting.lag)) ? Math.trunc(Number(setting.lag)) : 0,
  }
  return {
    tasks: tasks.map(task => task.id === successorId
      ? {
        ...task,
        depends_on: [...(task.depends_on || []), predecessorId],
        dependency_settings: { ...(task.dependency_settings || {}), [predecessorId]: normalized },
      }
      : { ...task }),
    error: null,
  }
}

export function updateDependencyLink(tasks, predecessorId, successorId, patch = {}) {
  const successor = tasks.find(task => task.id === successorId)
  if (!successor || !(successor.depends_on || []).includes(predecessorId)) {
    return { tasks, error: 'That dependency no longer exists.' }
  }
  const current = dependencySetting(successor, predecessorId)
  const setting = {
    type: DEPENDENCY_TYPES[patch.type] ? patch.type : current.type,
    lag: patch.lag === undefined ? current.lag : Math.trunc(Number(patch.lag) || 0),
  }
  return {
    tasks: tasks.map(task => task.id === successorId
      ? { ...task, dependency_settings: { ...(task.dependency_settings || {}), [predecessorId]: setting } }
      : { ...task }),
    error: null,
  }
}

export function removeDependencyLink(tasks, predecessorId, successorId) {
  const successor = tasks.find(task => task.id === successorId)
  if (!successor || !(successor.depends_on || []).includes(predecessorId)) {
    return { tasks, error: 'That dependency no longer exists.' }
  }
  return {
    tasks: tasks.map(task => {
      if (task.id !== successorId) return { ...task }
      const dependencySettings = { ...(task.dependency_settings || {}) }
      delete dependencySettings[predecessorId]
      return {
        ...task,
        depends_on: (task.depends_on || []).filter(id => id !== predecessorId),
        dependency_settings: dependencySettings,
      }
    }),
    error: null,
  }
}

export function reverseDependencyLink(tasks, predecessorId, successorId) {
  const removed = removeDependencyLink(tasks, predecessorId, successorId)
  if (removed.error) return removed
  const reversed = addDependencyLink(removed.tasks, successorId, predecessorId)
  if (reversed.error) return { tasks, error: reversed.error }
  return reversed
}

export function rollupPhaseDates(tasks) {
  const rolled = tasks.map(task => ({ ...task }))
  for (const phase of rolled.filter(task => !task.parent_id)) {
    const children = rolled.filter(task => task.parent_id === phase.id && task.start_date && task.end_date)
    if (!children.length) continue
    phase.start_date = toDateString(minDate(children.map(task => task.start_date)))
    phase.end_date = toDateString(maxDate(children.map(task => task.end_date)))
  }
  return rolled
}

export function sortPhaseTasksChronologically(tasks) {
  const ordered = tasks.map(task => ({ ...task }))
  for (const phase of ordered.filter(task => !task.parent_id)) {
    const children = ordered
      .filter(task => task.parent_id === phase.id)
      .sort((a, b) => {
        const startComparison = String(a.start_date || '9999-12-31').localeCompare(String(b.start_date || '9999-12-31'))
        if (startComparison) return startComparison
        const endComparison = String(a.end_date || '9999-12-31').localeCompare(String(b.end_date || '9999-12-31'))
        if (endComparison) return endComparison
        const orderComparison = (a.sort_order || 0) - (b.sort_order || 0)
        if (orderComparison) return orderComparison
        return String(a.name || a.id).localeCompare(String(b.name || b.id))
      })
    children.forEach((task, index) => { task.sort_order = index + 1 })
  }
  return ordered
}

export function applyTaskChange(tasks, taskId, patch) {
  const candidate = tasks.map(task => task.id === taskId ? { ...task, ...patch } : { ...task })
  return rollupPhaseDates(enforceDependencies(candidate, [taskId], tasks).tasks)
}

export function sameScheduleTask(a, b) {
  const fields = ['name', 'parent_id', 'start_date', 'end_date', 'status', 'sort_order', 'color', 'needs_contractor_discussion']
  return fields.every(field => a?.[field] === b?.[field])
    && JSON.stringify(a?.depends_on || []) === JSON.stringify(b?.depends_on || [])
    && JSON.stringify(dependencySettingsFor(a)) === JSON.stringify(dependencySettingsFor(b))
}

export function changedScheduleRows(beforeTasks, afterTasks) {
  const before = new Map(beforeTasks.map(task => [task.id, task]))
  return afterTasks.filter(task => !sameScheduleTask(task, before.get(task.id)))
}

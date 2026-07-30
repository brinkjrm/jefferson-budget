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

export function earliestDependencyStart(tasks, dependencyIds = []) {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const latestFinish = maxDate(dependencyIds.map(id => byId.get(id)?.end_date))
  return latestFinish ? nextWorkday(latestFinish) : null
}

export function enforceDependencies(tasks, changedIds = []) {
  const byId = new Map(tasks.map(task => [task.id, { ...task }]))
  const queue = [...changedIds]
  const changed = new Set(changedIds)

  for (const id of changedIds) {
    const task = byId.get(id)
    if (!task?.parent_id) continue
    const earliestStart = earliestDependencyStart([...byId.values()], task.depends_on)
    if (!earliestStart) continue
    if (!task.start_date || parseDate(task.start_date) < earliestStart) {
      const duration = Math.max(1, workdayDuration(task.start_date, task.end_date))
      task.start_date = toDateString(earliestStart)
      task.end_date = toDateString(addWorkdays(earliestStart, duration - 1))
    }
  }

  while (queue.length) {
    const predecessorId = queue.shift()
    for (const task of byId.values()) {
      if (!task.parent_id || !(task.depends_on || []).includes(predecessorId)) continue
      const earliestStart = earliestDependencyStart([...byId.values()], task.depends_on)
      if (!earliestStart) continue
      if (!task.start_date || parseDate(task.start_date) < earliestStart) {
        const duration = Math.max(1, workdayDuration(task.start_date, task.end_date))
        task.start_date = toDateString(earliestStart)
        task.end_date = toDateString(addWorkdays(earliestStart, duration - 1))
        if (!changed.has(task.id)) {
          changed.add(task.id)
          queue.push(task.id)
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

export function applyTaskChange(tasks, taskId, patch) {
  const candidate = tasks.map(task => task.id === taskId ? { ...task, ...patch } : { ...task })
  return rollupPhaseDates(enforceDependencies(candidate, [taskId]).tasks)
}

export function sameScheduleTask(a, b) {
  const fields = ['name', 'parent_id', 'start_date', 'end_date', 'status', 'sort_order', 'color']
  return fields.every(field => a?.[field] === b?.[field])
    && JSON.stringify(a?.depends_on || []) === JSON.stringify(b?.depends_on || [])
}

export function changedScheduleRows(beforeTasks, afterTasks) {
  const before = new Map(beforeTasks.map(task => [task.id, task]))
  return afterTasks.filter(task => !sameScheduleTask(task, before.get(task.id)))
}

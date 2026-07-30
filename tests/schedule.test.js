import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJeffersonSchedule } from '../src/data/jeffersonSchedule.js'
import {
  addDependencyLink,
  addWorkdays,
  applyTaskChange,
  changedScheduleRows,
  earliestDependencyStart,
  enforceDependencies,
  hasDependencyCycle,
  isWorkday,
  toDateString,
  workdayDuration,
} from '../src/lib/scheduleDates.js'

test('working-day math skips Saturday and Sunday', () => {
  assert.equal(toDateString(addWorkdays('2026-08-21', 1)), '2026-08-24')
  assert.equal(toDateString(addWorkdays('2026-08-24', 14)), '2026-09-11')
  assert.equal(workdayDuration('2026-08-24', '2026-09-11'), 15)
})

test('permit schedule uses weekdays and valid finish-to-start dependencies', () => {
  const schedule = buildJeffersonSchedule()
  assert.equal(schedule.phases.length, 13)
  assert.equal(schedule.tasks.length, 115)
  assert.equal(schedule.tasks.filter(item => item.type === 'inspection').length, 21)
  assert.equal(schedule.projectStart, '2026-08-03')
  assert.equal(schedule.projectEnd, '2027-06-02')

  const byKey = new Map(schedule.tasks.map(item => [item.key, item]))
  for (const item of schedule.tasks) {
    assert.ok(isWorkday(item.start_date), `${item.key} starts on a weekend`)
    assert.ok(isWorkday(item.end_date), `${item.key} ends on a weekend`)
    assert.equal(workdayDuration(item.start_date, item.end_date), item.duration, `${item.key} duration differs`)
    for (const dependencyKey of item.dependsOn) {
      const dependency = byKey.get(dependencyKey)
      assert.ok(dependency, `${item.key} dependency ${dependencyKey} is missing`)
      assert.ok(new Date(item.start_date) > new Date(dependency.end_date), `${item.key} overlaps ${dependencyKey}`)
    }
  }
})

test('moving work later pushes successors without moving unrelated tasks', () => {
  const tasks = [
    { id: 'a', parent_id: 'phase', start_date: '2026-08-03', end_date: '2026-08-05', depends_on: [] },
    { id: 'b', parent_id: 'phase', start_date: '2026-08-06', end_date: '2026-08-07', depends_on: ['a'] },
    { id: 'c', parent_id: 'phase', start_date: '2026-08-03', end_date: '2026-08-04', depends_on: [] },
  ]
  tasks[0].start_date = '2026-08-10'
  tasks[0].end_date = '2026-08-12'
  const result = enforceDependencies(tasks, ['a']).tasks
  assert.deepEqual(result.find(item => item.id === 'b'), {
    id: 'b', parent_id: 'phase', start_date: '2026-08-13', end_date: '2026-08-14', depends_on: ['a'],
  })
  assert.equal(result.find(item => item.id === 'c').start_date, '2026-08-03')
})

test('a successor cannot be dated before its selected predecessor finishes', () => {
  const tasks = [
    { id: 'a', parent_id: 'phase', start_date: '2026-08-03', end_date: '2026-08-07', depends_on: [] },
    { id: 'b', parent_id: 'phase', start_date: '2026-08-10', end_date: '2026-08-12', depends_on: ['a'] },
  ]
  const result = applyTaskChange(tasks, 'b', { start_date: '2026-08-05', end_date: '2026-08-07' })
  assert.equal(result.find(item => item.id === 'b').start_date, '2026-08-10')
  assert.equal(result.find(item => item.id === 'b').end_date, '2026-08-12')
  assert.equal(toDateString(earliestDependencyStart(tasks, ['a'])), '2026-08-10')
})

test('drag previews are compared with the pre-drag baseline before saving', () => {
  const baseline = [
    { id: 'phase', parent_id: null, name: 'Phase', start_date: '2026-08-03', end_date: '2026-08-07', depends_on: [] },
    { id: 'a', parent_id: 'phase', name: 'A', start_date: '2026-08-03', end_date: '2026-08-05', depends_on: [] },
    { id: 'b', parent_id: 'phase', name: 'B', start_date: '2026-08-06', end_date: '2026-08-07', depends_on: ['a'] },
  ]
  const preview = applyTaskChange(baseline, 'a', { start_date: '2026-08-10', end_date: '2026-08-12' })
  assert.deepEqual(changedScheduleRows(baseline, preview).map(item => item.id).sort(), ['a', 'b', 'phase'])
  assert.equal(preview.find(item => item.id === 'b').start_date, '2026-08-13')
})

test('dependency cycles are rejected', () => {
  assert.equal(hasDependencyCycle([
    { id: 'a', parent_id: 'phase', depends_on: ['b'] },
    { id: 'b', parent_id: 'phase', depends_on: ['a'] },
  ]), true)
  assert.equal(hasDependencyCycle([
    { id: 'a', parent_id: 'phase', depends_on: [] },
    { id: 'b', parent_id: 'phase', depends_on: ['a'] },
  ]), false)
})

test('drag-created dependencies reject duplicates and circular links', () => {
  const tasks = [
    { id: 'a', parent_id: 'phase', depends_on: [] },
    { id: 'b', parent_id: 'phase', depends_on: ['a'] },
    { id: 'c', parent_id: 'phase', depends_on: ['b'] },
  ]
  assert.match(addDependencyLink(tasks, 'a', 'b').error, /already linked/i)
  assert.match(addDependencyLink(tasks, 'c', 'a').error, /circular/i)
  const result = addDependencyLink(tasks, 'a', 'c')
  assert.equal(result.error, null)
  assert.deepEqual(result.tasks.find(task => task.id === 'c').depends_on, ['b', 'a'])
})

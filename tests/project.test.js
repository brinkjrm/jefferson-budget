import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildActionItems,
  calculateProjectMetrics,
  createProjectModel,
  settingsFromRows,
} from '../src/domain/project.js'

test('settings rows become a single project configuration', () => {
  assert.deepEqual(settingsFromRows([
    { key: 'builder', value: 'Builder Co' },
    { key: 'loan_number', value: '123' },
  ]), { builder: 'Builder Co', loan_number: '123' })
})

test('legacy collections are composed into a project-centric model', () => {
  const model = createProjectModel({
    settings: [{ key: 'project_name', value: 'Test Project' }],
    lineItems: [{ id: 'budget-1' }],
    scheduleTasks: [
      { id: 'phase-1', parent_id: null },
      { id: 'task-1', parent_id: 'phase-1', plan_references: 'S0.0' },
    ],
  })

  assert.equal(model.project.name, 'Test Project')
  assert.equal(model.financials.budgetItems.length, 1)
  assert.equal(model.schedule.phases.length, 1)
  assert.equal(model.schedule.tasks.length, 1)
  assert.equal(model.schedule.tasks[0].references, 'S0.0')
})

test('project metrics aggregate budget, schedule, inspections, and decisions', () => {
  const model = createProjectModel({
    lineItems: [
      { code: 'C001', estimated_cost: 100, actual_cost: 120, status: 'locked' },
      { code: 'C000', name: 'Contingency', estimated_cost: 20, status: 'pending' },
    ],
    prepaidItems: [{ amount: 15 }],
    drawSheets: [{ this_draw_amount: 25 }],
    scheduleTasks: [
      { id: 'phase', parent_id: null },
      { id: 'work', parent_id: 'phase', status: 'complete', start_date: '2026-01-01', end_date: '2026-01-02', needs_contractor_discussion: true, trade: 'GC' },
      { id: 'inspection', parent_id: 'phase', task_type: 'inspection', status: 'not_started', depends_on: ['work'], start_date: '2026-01-05', end_date: '2026-01-05' },
    ],
    bids: [{ status: 'pending' }],
    selections: [{ status: 'TBD' }, { status: 'SELECTED' }],
  })
  const metrics = calculateProjectMetrics(model, new Date(2025, 11, 31))

  assert.equal(metrics.financials.estimated, 120)
  assert.equal(metrics.financials.forecast, 140)
  assert.equal(metrics.financials.prepaid, 15)
  assert.equal(metrics.financials.drawsTotal, 25)
  assert.equal(metrics.schedule.progressPercent, 50)
  assert.equal(metrics.schedule.readyInspections.length, 1)
  assert.equal(metrics.schedule.contractorDiscussions.length, 1)
  assert.equal(metrics.procurement.pendingBids.length, 1)
  assert.equal(metrics.procurement.tbdSelections.length, 1)

  const actions = buildActionItems(model, metrics)
  assert.ok(actions.some(action => action.type === 'inspection'))
  assert.ok(actions.some(action => action.type === 'bid'))
  assert.ok(actions.some(action => action.type === 'decision'))
  assert.ok(actions.some(action => action.type === 'budget'))
  assert.ok(actions.some(action => action.type === 'discussion'))
})

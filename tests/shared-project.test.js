import test from 'node:test'
import assert from 'node:assert/strict'
import { publicScheduleTask, publicSelection } from '../server/sharedProject.js'

test('shared schedule returns operational fields without private notes or project data', () => {
  const shared = publicScheduleTask({
    id: 'task-1',
    project_id: 'private-project',
    name: 'Framing',
    parent_id: 'phase-1',
    start_date: '2026-08-03',
    end_date: '2026-08-14',
    status: 'not_started',
    sort_order: 1,
    depends_on: ['task-0'],
    dependency_settings: { 'task-0': { type: 'FS', lag: 0 } },
    trade: 'Framing',
    notes: 'Owner-only negotiation detail',
    internal_cost: 25000,
  })

  assert.equal(shared.name, 'Framing')
  assert.deepEqual(shared.depends_on, ['task-0'])
  assert.equal(shared.trade, 'Framing')
  assert.equal('project_id' in shared, false)
  assert.equal('notes' in shared, false)
  assert.equal('internal_cost' in shared, false)
})

test('shared selections omit all pricing and project ownership fields', () => {
  const shared = publicSelection({
    id: 'selection-1',
    project_id: 'private-project',
    category: 'Plumbing',
    section: 'Fixtures',
    room: 'Kitchen',
    item_description: 'Kitchen faucet',
    qty: 1,
    product_link: 'https://example.com/faucet',
    brand_model: 'Example 1000',
    status: 'SELECTED',
    notes: 'Approved finish: brushed nickel',
    sort_order: 1,
    unit_price: 950,
    vendor_cost: 700,
  })

  assert.equal(shared.item_description, 'Kitchen faucet')
  assert.equal(shared.status, 'SELECTED')
  assert.equal('project_id' in shared, false)
  assert.equal('unit_price' in shared, false)
  assert.equal('vendor_cost' in shared, false)
})

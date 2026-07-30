import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt } from '../api/chat.js'

test('AI prompt consumes the unified project model', () => {
  const prompt = buildSystemPrompt({
    model: {
      settings: { builder: 'Test Builder' },
      financials: {
        budgetItems: [{ code: 'C001', name: 'Windows', estimated_cost: 100, status: 'pending' }],
        prepaidItems: [],
        drawSheets: [],
      },
      schedule: {
        tasks: [
          { name: 'Framing', status: 'complete' },
          { name: 'Framing inspection', status: 'not_started', task_type: 'inspection' },
        ],
      },
      procurement: {
        bids: [{ status: 'pending' }],
        selections: [{ status: 'TBD' }],
      },
      documents: { plans: [{ name: 'Architectural' }] },
    },
    metrics: {
      healthScore: 91,
      schedule: { progressPercent: 50, finish: '2027-06-02' },
    },
    actions: [{ title: 'Schedule framing inspection', detail: 'Gate is ready.' }],
  })

  assert.match(prompt, /Project Health: 91/)
  assert.match(prompt, /Tasks: 2/)
  assert.match(prompt, /Inspection Gates: 1/)
  assert.match(prompt, /Schedule framing inspection/)
  assert.match(prompt, /Pending Bids: 1/)
  assert.match(prompt, /TBD Selections: 1/)
  assert.match(prompt, /Plan Documents: 1/)
})


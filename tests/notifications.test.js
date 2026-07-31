import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDailySmsSummary, classifyProjectEmailHeuristically } from '../src/domain/notifications.js'

test('email fallback identifies invoices and action language', () => {
  const result = classifyProjectEmailHeuristically({
    subject: 'Invoice 104 - payment due Friday',
    body: 'Please review the attached invoice for $12,450.00.',
    attachments: [{ filename: 'invoice-104.pdf' }],
  })

  assert.equal(result.category, 'invoice')
  assert.equal(result.urgency, 'important')
  assert.equal(result.requiresAction, true)
  assert.equal(result.invoice.amount, 12450)
})

test('daily SMS highlights critical actions, invoices, and schedule gates', () => {
  const summary = buildDailySmsSummary({
    projectName: 'Jefferson',
    date: new Date('2026-07-30T14:00:00Z'),
    newEmails: [{ id: 'email-1' }, { id: 'email-2' }],
    actionItems: [
      { title: 'Approve window deposit today', status: 'open', priority: 1 },
      { title: 'Confirm electrician start', status: 'open', priority: 2 },
    ],
    invoices: [{ amount: 12450 }, { amount: 3500 }],
    scheduleTasks: [
      { id: 'work', parent_id: 'phase', status: 'complete' },
      { id: 'inspection', parent_id: 'phase', task_type: 'inspection', status: 'not_started', depends_on: ['work'] },
      { id: 'late', parent_id: 'phase', status: 'not_started', end_date: '2026-07-20' },
    ],
    dashboardUrl: 'https://jefferson-budget.vercel.app/',
  })

  assert.match(summary, /URGENT: Approve window deposit today/)
  assert.match(summary, /^Jefferson Construction Manager:/)
  assert.match(summary, /Inbox: 2 new · 2 open actions/)
  assert.match(summary, /Invoices: 2 new · \$15,950/)
  assert.match(summary, /1 inspection ready · 1 overdue/)
  assert.match(summary, /https:\/\/jefferson-budget\.vercel\.app/)
  assert.match(summary, /Reply STOP to opt out, HELP for help\. Msg & data rates may apply\.$/)
})

test('daily SMS reports an all-clear day', () => {
  const summary = buildDailySmsSummary({
    projectName: 'Jefferson',
    date: new Date('2026-07-30T14:00:00Z'),
  })

  assert.match(summary, /No urgent project actions today/)
  assert.match(summary, /^Jefferson Construction Manager:/)
  assert.match(summary, /Reply STOP to opt out, HELP for help\. Msg & data rates may apply\.$/)
})

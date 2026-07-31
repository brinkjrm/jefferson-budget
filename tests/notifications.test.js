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

test('email fallback extracts a forwarded contractor bid and contact details', () => {
  const result = classifyProjectEmailHeuristically({
    subject: 'Fwd: Electrical proposal for Jefferson',
    from: 'Josh Meyer <Josh@3120JeffersonSt.com>',
    body: `From: Taylor Smith <taylor@example-electric.com>
Example Electric LLC
(303) 555-0198

Proposal total: $24,750.00`,
    attachments: [{ filename: 'Jefferson-electrical-proposal.pdf' }],
  })

  assert.equal(result.category, 'bid')
  assert.equal(result.requiresAction, true)
  assert.equal(result.contact.name, 'Taylor Smith')
  assert.equal(result.contact.company, 'Example Electric LLC')
  assert.equal(result.contact.email, 'taylor@example-electric.com')
  assert.equal(result.contact.phone, '(303) 555-0198')
  assert.equal(result.contact.trade, 'Electrical')
  assert.equal(result.bid.totalAmount, 24750)
})

test('forwarded bid chooses the vendor represented by the attachment', () => {
  const result = classifyProjectEmailHeuristically({
    subject: 'Fwd: Fee Proposal Request for 3120 Jefferson',
    from: '"Josh Meyer" <meyerjr1@mac.com>',
    body: `> Begin forwarded message:
> From: Zeke Freeman <zfreeman@root-ad.com>
> From: Rob Harris <rharris@gillianslc.com>
> See attached proposal.
> Main: 303-972-6640`,
    attachments: [{ filename: '3120-Jefferson-St-Land-Surveying-Proposal.pdf' }],
  })

  assert.equal(result.contact.email, 'rharris@gillianslc.com')
  assert.equal(result.contact.company, 'Gillians Land Consultants')
  assert.equal(result.contact.phone, '303-972-6640')
  assert.equal(result.contact.trade, 'Surveying')
})

test('roof and gutter proposals retain the combined trade', () => {
  const result = classifyProjectEmailHeuristically({
    subject: 'GreenPoint roof and gutter quote',
    body: 'From: Scott <scott@greenpointroofing.com>',
    attachments: [{ filename: 'Roof-and-Gutter-Quote.pdf' }],
  })

  assert.equal(result.contact.trade, 'Roofing & Gutters')
  assert.equal(result.bid.trade, 'Roofing & Gutters')
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

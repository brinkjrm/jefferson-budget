import test from 'node:test'
import assert from 'node:assert/strict'
import { buildScheduleNoteSms } from '../src/domain/notifications.js'
import { publicScheduleNote, validateScheduleNoteInput } from '../server/scheduleNotes.js'

test('shared schedule note input is normalized and bounded', () => {
  const note = validateScheduleNoteInput({
    taskId: 'b664dc5f-9ee4-4d06-9ccc-98c96c73fc7e',
    authorName: '  Jane   Smith ',
    body: 'Confirming crew arrival.\r\nPlease call first.',
  })

  assert.deepEqual(note, {
    taskId: 'b664dc5f-9ee4-4d06-9ccc-98c96c73fc7e',
    authorName: 'Jane Smith',
    body: 'Confirming crew arrival.\nPlease call first.',
  })
  assert.throws(() => validateScheduleNoteInput({ ...note, authorName: 'J' }), /between 2 and 80/)
  assert.throws(() => validateScheduleNoteInput({ ...note, body: 'x'.repeat(1001) }), /1,000/)
  assert.throws(() => validateScheduleNoteInput({ ...note, taskId: 'not-a-task' }), /valid schedule task/)
})

test('public schedule notes never expose SMS delivery metadata', () => {
  const note = publicScheduleNote({
    id: 'note-1',
    task_id: 'task-1',
    author_name: 'Jane Smith',
    body: 'Crew arrives at 8.',
    created_at: '2026-07-30T18:00:00Z',
    message_sid: 'SM-secret',
    notification_error: 'private provider detail',
  })

  assert.deepEqual(note, {
    id: 'note-1',
    task_id: 'task-1',
    author_name: 'Jane Smith',
    body: 'Crew arrives at 8.',
    created_at: '2026-07-30T18:00:00Z',
  })
})

test('schedule note SMS identifies the task, author, and note', () => {
  const message = buildScheduleNoteSms({
    taskName: 'Asbestos abatement and clearance',
    authorName: 'Jane Smith',
    body: 'Clearance report will be available by 3 PM.',
    dashboardUrl: 'https://jefferson-budget.vercel.app/',
  })

  assert.match(message, /^Jefferson Construction Manager: New schedule note/)
  assert.match(message, /Task: Asbestos abatement and clearance/)
  assert.match(message, /From: Jane Smith/)
  assert.match(message, /Clearance report will be available by 3 PM\./)
  assert.match(message, /Reply STOP to opt out, HELP for help\. Msg & data rates may apply\.$/)
})

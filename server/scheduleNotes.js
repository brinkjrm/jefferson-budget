const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateScheduleNoteInput(value = {}) {
  const taskId = String(value.taskId || '').trim()
  const authorName = String(value.authorName || '').replace(/\s+/g, ' ').trim()
  const body = String(value.body || '').replace(/\r\n?/g, '\n').trim()

  if (!UUID_PATTERN.test(taskId)) throw new Error('A valid schedule task is required')
  if (authorName.length < 2 || authorName.length > 80) throw new Error('Your name must be between 2 and 80 characters')
  if (body.length < 1 || body.length > 1000) throw new Error('The note must be between 1 and 1,000 characters')
  return { taskId, authorName, body }
}

export function publicScheduleNote(row) {
  return {
    id: row.id,
    task_id: row.task_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at,
  }
}


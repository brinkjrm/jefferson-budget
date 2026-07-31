import { buildScheduleNoteSms } from '../src/domain/notifications.js'
import { maskedPhoneNumber, sendTwilioSms } from '../server/dailyBrief.js'
import {
  hasProjectShareAccess,
  projectServiceClient,
} from '../server/projectPlans.js'
import {
  publicScheduleNote,
  validateScheduleNoteInput,
} from '../server/scheduleNotes.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!hasProjectShareAccess(req.query.token)) return res.status(404).json({ error: 'Shared project link is invalid' })

  let input
  try {
    input = validateScheduleNoteInput(req.body)
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }

  try {
    const client = projectServiceClient()
    const taskResult = await client.from('schedule_tasks')
      .select('id,name,project_id')
      .eq('id', input.taskId)
      .not('parent_id', 'is', null)
      .single()
    if (taskResult.error) return res.status(404).json({ error: 'Schedule task not found' })

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const duplicate = await client.from('schedule_task_notes')
      .select('*')
      .eq('task_id', input.taskId)
      .eq('author_name', input.authorName)
      .eq('body', input.body)
      .gte('created_at', twoMinutesAgo)
      .limit(1)
      .maybeSingle()
    if (duplicate.error) throw duplicate.error
    if (duplicate.data) {
      res.setHeader('Cache-Control', 'private, no-store')
      return res.status(200).json({
        note: publicScheduleNote(duplicate.data),
        duplicate: true,
        notification: { sent: duplicate.data.notification_status === 'sent' },
      })
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const recent = await client.from('schedule_task_notes')
      .select('id', { count: 'exact', head: true })
      .eq('author_name', input.authorName)
      .gte('created_at', tenMinutesAgo)
    if (recent.error) throw recent.error
    if ((recent.count || 0) >= 5) return res.status(429).json({ error: 'Please wait a few minutes before adding another note' })

    const inserted = await client.from('schedule_task_notes').insert({
      project_id: taskResult.data.project_id,
      task_id: input.taskId,
      author_name: input.authorName,
      body: input.body,
      notification_status: 'pending',
    }).select('*').single()
    if (inserted.error) throw inserted.error

    let sent = null
    let notificationError = ''
    try {
      sent = await sendTwilioSms(buildScheduleNoteSms({
        taskName: taskResult.data.name.replace(/^INSPECTION\s*-\s*/i, ''),
        authorName: input.authorName,
        body: input.body,
        dashboardUrl: process.env.PUBLIC_APP_URL || 'https://jefferson-budget.vercel.app',
      }))
    } catch (error) {
      notificationError = error.message
    }

    const notificationStatus = sent ? 'sent' : 'failed'
    const updated = await client.from('schedule_task_notes').update({
      message_sid: sent?.sid || null,
      notification_status: notificationStatus,
      notification_error: notificationError || null,
      notified_at: sent ? new Date().toISOString() : null,
    }).eq('id', inserted.data.id).select('*').single()
    if (updated.error) throw updated.error

    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(201).json({
      note: publicScheduleNote(updated.data),
      notification: {
        sent: Boolean(sent),
        recipient: sent ? maskedPhoneNumber() : '',
      },
    })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}


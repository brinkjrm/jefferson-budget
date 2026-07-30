import { createClient } from '@supabase/supabase-js'
import { syncProjectInbox } from '../server/projectEmail.js'
import { loadDailyBriefData, maskedPhoneNumber, renderDailyBrief, sendTwilioSms, summaryDate } from '../server/dailyBrief.js'

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET is not configured' })
  if (req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.SUPABASE_URL || 'https://qxffadumpshyaseayndy.supabase.co'
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY is not configured' })
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const settingsResult = await supabase.from('settings').select('key,value')
  if (settingsResult.error) return res.status(500).json({ error: settingsResult.error.message })
  const settings = Object.fromEntries((settingsResult.data || []).map(row => [row.key, row.value]))
  if (settings.daily_sms_enabled !== 'true') return res.json({ skipped: true, reason: 'Daily SMS consent is not enabled' })

  let inboxSync = { imported: [], count: 0, errors: [] }
  let inboxSyncError = ''
  try {
    inboxSync = await syncProjectInbox({ supabase })
  } catch (error) {
    inboxSyncError = error.message
  }

  try {
    const now = new Date()
    const data = await loadDailyBriefData(supabase, { now })
    const date = summaryDate(now, data.timezone)
    const existing = await supabase.from('notification_deliveries')
      .select('id,message_sid,delivery_status')
      .eq('project_id', data.project.id)
      .eq('channel', 'sms')
      .eq('summary_date', date)
      .maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) return res.json({ skipped: true, reason: 'Daily summary already sent', delivery: existing.data })

    const body = renderDailyBrief(data, { now, inboxSyncError })
    const sent = await sendTwilioSms(body)
    const delivery = await supabase.from('notification_deliveries').insert({
      project_id: data.project.id,
      channel: 'sms',
      summary_date: date,
      recipient_masked: maskedPhoneNumber(),
      message_sid: sent.sid || null,
      delivery_status: sent.status || 'queued',
      body,
      sent_at: new Date().toISOString(),
      metadata: {
        imported_email_count: inboxSync.count,
        inbox_errors: inboxSync.errors,
        inbox_sync_error: inboxSyncError || null,
      },
    }).select('id,message_sid,delivery_status,sent_at').single()
    if (delivery.error) throw delivery.error

    return res.json({
      sent: true,
      delivery: delivery.data,
      inbox: { imported: inboxSync.count, errors: inboxSync.errors.length, syncError: inboxSyncError || null },
    })
  } catch (error) {
    return res.status(500).json({ error: error.message, inboxSyncError: inboxSyncError || null })
  }
}

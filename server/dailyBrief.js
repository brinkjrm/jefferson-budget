import { buildDailySmsSummary } from '../src/domain/notifications.js'

export async function loadDailyBriefData(supabase, { now = new Date(), timezone = 'America/Denver' } = {}) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const [projectResult, emailsResult, actionsResult, invoicesResult, scheduleResult, settingsResult] = await Promise.all([
    supabase.from('projects').select('id,name').eq('status', 'active').order('created_at').limit(1).single(),
    supabase.from('project_emails').select('id,summary,category,urgency,created_at').gte('created_at', since).order('created_at', { ascending: false }),
    supabase.from('project_action_items').select('id,title,detail,priority,status,due_date,created_at').eq('status', 'open').order('priority').order('created_at'),
    supabase.from('project_invoices').select('id,vendor,invoice_number,amount,due_date,status,created_at').gte('created_at', since).order('created_at', { ascending: false }),
    supabase.from('schedule_tasks').select('id,parent_id,name,status,start_date,end_date,task_type,depends_on'),
    supabase.from('settings').select('key,value'),
  ])
  for (const result of [projectResult, emailsResult, actionsResult, invoicesResult, scheduleResult, settingsResult]) {
    if (result.error) throw result.error
  }
  const settings = Object.fromEntries((settingsResult.data || []).map(row => [row.key, row.value]))
  return {
    project: projectResult.data,
    settings,
    timezone: settings.sms_timezone || timezone,
    newEmails: emailsResult.data || [],
    actionItems: actionsResult.data || [],
    invoices: invoicesResult.data || [],
    scheduleTasks: scheduleResult.data || [],
  }
}

export function summaryDate(date = new Date(), timezone = 'America/Denver') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export function renderDailyBrief(data, options = {}) {
  return buildDailySmsSummary({
    projectName: data.project?.name || 'Jefferson',
    date: options.now || new Date(),
    timezone: data.timezone,
    newEmails: data.newEmails,
    actionItems: data.actionItems,
    invoices: data.invoices,
    scheduleTasks: data.scheduleTasks,
    dashboardUrl: process.env.PUBLIC_APP_URL || 'https://jefferson-budget.vercel.app',
    inboxSyncError: options.inboxSyncError || '',
  })
}

export async function sendTwilioSms(body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const to = process.env.PROJECT_SMS_TO
  const from = process.env.TWILIO_FROM_NUMBER
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  const missing = [
    !accountSid && 'TWILIO_ACCOUNT_SID',
    !authToken && 'TWILIO_AUTH_TOKEN',
    !to && 'PROJECT_SMS_TO',
    !from && !messagingServiceSid && 'TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID',
  ].filter(Boolean)
  if (missing.length) throw new Error(`SMS configuration missing: ${missing.join(', ')}`)

  const payload = new URLSearchParams({ To: to, Body: body })
  if (messagingServiceSid) payload.set('MessagingServiceSid', messagingServiceSid)
  else payload.set('From', from)
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || `Twilio returned ${response.status}`)
  return result
}

export function maskedPhoneNumber(value = process.env.PROJECT_SMS_TO || '') {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : ''
}

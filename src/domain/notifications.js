const CATEGORY_KEYWORDS = {
  invoice: ['invoice', 'payment request', 'amount due', 'balance due'],
  change_order: ['change order', 'change directive', 'additional cost'],
  inspection: ['inspection', 'inspector', 'correction notice', 'reinspection'],
  schedule: ['schedule', 'delivery', 'delay', 'start date', 'completion date'],
  decision: ['approve', 'approval', 'selection', 'confirm', 'decision'],
  rfi: ['rfi', 'request for information', 'clarification'],
  submittal: ['submittal', 'shop drawing', 'product data'],
}

const CRITICAL_TERMS = ['urgent', 'immediately', 'stop work', 'failed inspection', 'past due', 'overdue', 'critical path']
const IMPORTANT_TERMS = ['due', 'approve', 'approval', 'confirm', 'required', 'delay', 'invoice', 'inspection', 'change order']
const ACTION_TERMS = ['please', 'need', 'required', 'approve', 'confirm', 'review', 'sign', 'pay', 'schedule', 'respond']

export function classifyProjectEmailHeuristically({ subject = '', body = '', attachments = [] } = {}) {
  const text = `${subject}\n${body}\n${attachments.map(item => item.filename || '').join(' ')}`.toLowerCase()
  const category = Object.entries(CATEGORY_KEYWORDS).find(([, terms]) => terms.some(term => text.includes(term)))?.[0] || 'general'
  const urgency = CRITICAL_TERMS.some(term => text.includes(term))
    ? 'critical'
    : IMPORTANT_TERMS.some(term => text.includes(term)) ? 'important' : 'routine'
  const requiresAction = category === 'invoice' || category === 'change_order' || ACTION_TERMS.some(term => text.includes(term))
  const amountMatch = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/)

  return {
    category,
    summary: subject || 'Project email received',
    urgency,
    requiresAction,
    actionTitle: requiresAction ? (subject || 'Review project email') : null,
    actionDetail: null,
    dueDate: null,
    confidence: 0.45,
    invoice: category === 'invoice'
      ? { vendor: null, invoiceNumber: null, amount: amountMatch ? Number(amountMatch[1].replaceAll(',', '')) : null, dueDate: null }
      : null,
  }
}

export function buildDailySmsSummary({
  projectName = 'Jefferson',
  date = new Date(),
  timezone = 'America/Denver',
  newEmails = [],
  actionItems = [],
  invoices = [],
  scheduleTasks = [],
  dashboardUrl = '',
  inboxSyncError = '',
} = {}) {
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric' }).format(date)
  const openActions = actionItems.filter(item => item.status !== 'complete' && item.status !== 'dismissed')
  const criticalActions = openActions.filter(item => Number(item.priority) === 1 || item.urgency === 'critical')
  const newInvoiceTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
  const todayString = localDateString(date, timezone)
  const taskById = new Map(scheduleTasks.map(task => [task.id, task]))
  const overdue = scheduleTasks.filter(task => task.parent_id && task.status !== 'complete' && task.end_date && task.end_date < todayString)
  const readyInspections = scheduleTasks.filter(task => {
    if (!task.parent_id || task.task_type !== 'inspection' || task.status === 'complete') return false
    const predecessors = task.depends_on || []
    return predecessors.length > 0 && predecessors.every(id => taskById.get(id)?.status === 'complete')
  })

  const lines = [`Jefferson Construction Manager: ${projectName} brief · ${dateLabel}`]
  if (criticalActions.length) lines.push(`URGENT: ${compact(criticalActions[0].title, 90)}${criticalActions.length > 1 ? ` (+${criticalActions.length - 1})` : ''}`)
  lines.push(`Inbox: ${newEmails.length} new · ${openActions.length} open action${openActions.length === 1 ? '' : 's'}`)
  if (invoices.length) lines.push(`Invoices: ${invoices.length} new · ${formatMoney(newInvoiceTotal)}`)
  if (readyInspections.length || overdue.length) lines.push(`Schedule: ${readyInspections.length} inspection${readyInspections.length === 1 ? '' : 's'} ready · ${overdue.length} overdue`)
  const nextAction = openActions.find(item => !criticalActions.includes(item))
  if (nextAction) lines.push(`Next: ${compact(nextAction.title, 100)}`)
  if (inboxSyncError) lines.push('Alert: project inbox could not be checked; open the app settings.')
  if (!criticalActions.length && !openActions.length && !invoices.length && !readyInspections.length && !overdue.length && !inboxSyncError) {
    lines.push('No urgent project actions today.')
  }
  if (dashboardUrl) lines.push(dashboardUrl.replace(/\/$/, ''))
  const complianceFooter = 'Reply STOP to opt out, HELP for help. Msg & data rates may apply.'
  const content = compact(lines.join('\n'), 1200 - complianceFooter.length - 1)
  return `${content}\n${complianceFooter}`
}

function localDateString(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function compact(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

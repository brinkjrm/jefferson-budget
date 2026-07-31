const CATEGORY_KEYWORDS = {
  invoice: ['invoice', 'payment request', 'amount due', 'balance due'],
  bid: ['bid', 'quote', 'estimate', 'proposal', 'scope of work'],
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
const PROJECT_EMAIL = 'josh@3120jeffersonst.com'
const TRADE_KEYWORDS = [
  ['Surveying', ['land surveying', 'land survey', 'surveyor', 'surveying']],
  ['Architecture / Design', ['architecture', 'architectural', 'architect']],
  ['Structural Engineering', ['structural engineering', 'structural engineer']],
  ['Geotechnical', ['geotechnical', 'soils engineer', 'soil report']],
  ['General Contractor', ['general contractor', 'construction management']],
  ['Masonry', ['masonry', 'mason']],
  ['Windows & Doors', ['window', 'windows', 'exterior door']],
  ['Electrical', ['electric', 'electrical']],
  ['Plumbing', ['plumb', 'plumbing']],
  ['HVAC', ['hvac', 'heating and cooling', 'heat pump']],
  ['Insulation', ['insulation', 'spray foam']],
  ['Drywall', ['drywall', 'gypsum']],
  ['Flooring', ['flooring', 'hardwood']],
  ['Painting', ['painting', 'painter']],
  ['Tile', ['tile', 'tilework']],
  ['Cabinets', ['cabinet', 'millwork']],
  ['Concrete', ['concrete', 'foundation']],
  ['Excavation', ['excavat', 'earthwork']],
  ['Landscaping', ['landscap', 'irrigation']],
  ['Demolition', ['demolition', 'abatement']],
  ['Roofing', ['roofing', 'roofer']],
  ['Framing', ['framing', 'framer']],
  ['Lumber Supplier', ['lumber package', 'lumber estimate', 'lumber supplier']],
  ['Siding', ['siding', 'cladding']],
  ['Gutters', ['gutter', 'downspout']],
]

export function classifyProjectEmailHeuristically({ subject = '', from = '', body = '', attachments = [] } = {}) {
  const attachmentText = attachments.map(item => item.filename || '').join(' ')
  const sourceText = `${subject}\n${from}\n${body}\n${attachmentText}`
  const text = sourceText.toLowerCase()
  const category = Object.entries(CATEGORY_KEYWORDS).find(([, terms]) => terms.some(term => text.includes(term)))?.[0] || 'general'
  const urgency = CRITICAL_TERMS.some(term => text.includes(term))
    ? 'critical'
    : IMPORTANT_TERMS.some(term => text.includes(term)) ? 'important' : 'routine'
  const requiresAction = category === 'bid' || category === 'invoice' || category === 'change_order' || ACTION_TERMS.some(term => text.includes(term))
  const amountMatch = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/)
  const trade = inferTrade(subject.toLowerCase()) || inferTrade(attachmentText.toLowerCase()) || inferTrade(text)
  const contact = extractProjectContact({ subject, from, body, attachments, trade })
  const bidAmount = findBidTotal(sourceText)

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
    contact: category === 'bid' ? { ...contact, trade: contact.trade || trade } : null,
    bid: category === 'bid' ? {
      trade,
      description: subject || 'Contractor bid',
      totalAmount: bidAmount,
      lineItems: [],
      notes: null,
    } : null,
  }
}

export function extractProjectContact({ subject = '', from = '', body = '', attachments = [], trade = null } = {}) {
  const source = String(body)
  const candidates = forwardedSenderCandidates(source)
  const direct = senderCandidate(from, 0)
  if (direct) candidates.push(direct)
  const allEmails = String(`${body}\n${from}`).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  allEmails.forEach((email, index) => candidates.push({ name: '', email, index: candidates.length + index }))
  const attachmentText = attachments.map(item => item.filename || '').join(' ')
  const selected = selectContactCandidate(candidates, `${subject} ${attachmentText}`)
  const email = selected?.email || ''
  const displayName = selected?.name || ''
  const phone = phoneNearEmail(body, email)
  const companyLine = String(body).split(/\r?\n/).map(line => line.replace(/^\s*>+\s*/, '').trim()).find(line =>
    line.length > 2
    && line.length < 90
    && /\b(?:llc|inc\.?|corp\.?|company|construction|builders?|roofing|land consultants|carpentry|lumber|masonry|design)\b/i.test(line)
    && !line.includes('@'),
  )
  const company = knownCompanyForEmail(email) || companyLine?.replace(/^(?:company|business):\s*/i, '').trim() || null
  const name = displayName || company || (email ? email.split('@')[0].replace(/[._-]+/g, ' ') : null)
  return { name: name || null, company, email: email || null, phone, trade }
}

function forwardedSenderCandidates(body) {
  const parts = String(body).split(/\bfrom:\s*/i).slice(1)
  return parts.map((part, index) => {
    const header = part.slice(0, 240)
    const email = header.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || ''
    const beforeEmail = email ? header.slice(0, header.toLowerCase().indexOf(email.toLowerCase())) : header
    const name = beforeEmail.replace(/[<>"\n\r]/g, ' ').replace(/^\s*>+\s*/, '').replace(/\s+/g, ' ').trim()
    return email ? { name: /^[\w.+-]+@/i.test(name) ? '' : name, email, index } : null
  }).filter(Boolean)
}

function senderCandidate(value, index) {
  const email = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  if (!email) return null
  const name = String(value).slice(0, String(value).toLowerCase().indexOf(email.toLowerCase())).replace(/[<>"\n\r]/g, ' ').trim()
  return { name, email, index }
}

function selectContactCandidate(candidates, hintText = '') {
  const normalizedHints = hintText.toLowerCase()
  const unique = new Map()
  candidates.forEach(candidate => {
    const email = candidate.email.toLowerCase().replace(/^mailto:/, '')
    if ([PROJECT_EMAIL, 'meyerjr1@mac.com'].includes(email)) return
    if (!unique.has(email)) unique.set(email, { ...candidate, email })
  })
  const scored = [...unique.values()].map(candidate => {
    const email = candidate.email
    const domain = email.split('@')[1] || ''
    let score = candidate.index * 0.05
    if (normalizedHints.includes('land-survey') || normalizedHints.includes('land survey')) score += domain.includes('gillianslc') ? 80 : 0
    if (normalizedHints.includes('root-architecture') || normalizedHints.includes('root architecture')) score += domain.includes('root-ad') ? 80 : 0
    if (normalizedHints.includes('greenpoint')) score += domain.includes('greenpointroofing') ? 80 : 0
    if (normalizedHints.includes('lumber')) score += domain.includes('countylinelumber') ? 80 : 0
    if (normalizedHints.includes('insulation')) score += domain.includes('installed.net') ? 50 : 0
    if (normalizedHints.includes('framing')) score += /construction|carpentry/.test(email) ? 45 : 0
    if (normalizedHints.includes('masonry')) score += email.includes('masonry') ? 80 : 0
    if (domain.includes('root-ad')) score -= 15
    if (/service|support|desk|noreply/.test(email)) score -= 30
    return { ...candidate, score }
  })
  return scored.sort((a, b) => b.score - a.score)[0] || null
}

function knownCompanyForEmail(email = '') {
  const value = email.toLowerCase()
  if (value.includes('greenpointroofing')) return 'GreenPoint Roofing'
  if (value.includes('countylinelumber')) return 'County Line Lumber'
  if (value.includes('gillianslc')) return 'Gillians Land Consultants'
  if (value.includes('apex-engineers')) return 'Apex Engineers'
  if (value.includes('root-ad')) return 'ROOT Architecture and Development'
  if (value.includes('fippscarpentry')) return 'Fipps Carpentry'
  if (value.includes('constructionnextgen')) return 'NextGen Construction'
  if (value.includes('carrizalez') && value.includes('masonry')) return 'Carrizalez Masonry'
  return null
}

function phoneNearEmail(body, email) {
  const value = String(body)
  const emailIndex = email ? value.toLowerCase().indexOf(email.toLowerCase()) : -1
  const nearby = emailIndex >= 0 ? value.slice(Math.max(0, emailIndex - 300), emailIndex + 1200) : value
  return nearby.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/)?.[0]?.trim() || null
}

function inferTrade(text = '') {
  if (text.includes('roof') && text.includes('gutter')) return 'Roofing & Gutters'
  return TRADE_KEYWORDS.find(([, terms]) => terms.some(term => text.includes(term)))?.[0] || null
}

function findBidTotal(value = '') {
  const preferred = [...String(value).matchAll(/(?:grand\s+total|proposal\s+total|estimate\s+total|bid\s+total|total)\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/gi)]
  if (preferred.length) return Number(preferred.at(-1)[1].replaceAll(',', ''))
  const amounts = [...String(value).matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)]
    .map(match => Number(match[1].replaceAll(',', '')))
    .filter(Number.isFinite)
  return amounts.length ? Math.max(...amounts) : null
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

export function buildScheduleNoteSms({
  taskName,
  authorName,
  body,
  dashboardUrl = '',
} = {}) {
  const lines = [
    'Jefferson Construction Manager: New schedule note',
    `Task: ${compact(taskName || 'Unknown task', 120)}`,
    `From: ${compact(authorName || 'Shared user', 80)}`,
    compact(body, 600),
  ]
  if (dashboardUrl) lines.push(dashboardUrl.replace(/\/$/, ''))
  const complianceFooter = 'Reply STOP to opt out, HELP for help. Msg & data rates may apply.'
  const content = compact(lines.filter(Boolean).join('\n'), 1200 - complianceFooter.length - 1)
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

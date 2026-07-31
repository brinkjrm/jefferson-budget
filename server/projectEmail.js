import { createHash } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { classifyProjectEmailHeuristically } from '../src/domain/notifications.js'

const CATEGORIES = new Set(['bid', 'invoice', 'change_order', 'inspection', 'schedule', 'decision', 'rfi', 'submittal', 'general'])
const URGENCIES = new Set(['critical', 'important', 'routine'])

export async function syncProjectInbox({ supabase, lookbackDays = 3, maxMessages = 75 }) {
  const mailbox = mailboxConfiguration()
  if (!mailbox.address || !mailbox.username || !mailbox.password) {
    throw new Error('Project mailbox credentials are not configured')
  }

  const project = await activeProject(supabase)
  const client = new ImapFlow({
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.secure,
    auth: { user: mailbox.username, pass: mailbox.password },
    logger: false,
  })
  const imported = []
  const errors = []
  let skippedUnrelated = 0
  let contractorsSaved = 0
  let bidsSaved = 0

  try {
    await client.connect()
    await client.mailboxOpen('INBOX')
    const since = new Date()
    since.setDate(since.getDate() - Math.max(1, lookbackDays))
    const uidResult = await client.search({ since }, { uid: true })
    const uids = Array.from(uidResult || []).slice(-maxMessages)

    for await (const message of client.fetch(uids, { source: true }, { uid: true })) {
      try {
        const parsed = await simpleParser(message.source)
        if (!messageTargetsAddress(parsed, mailbox.address)) {
          skippedUnrelated += 1
          continue
        }
        const body = plainTextBody(parsed)
        const messageId = parsed.messageId || fallbackMessageId(parsed, body)
        const attachmentMetadata = (parsed.attachments || []).map(attachment => ({
          filename: attachment.filename || 'attachment',
          mimeType: attachment.contentType || 'application/octet-stream',
          size: attachment.size || attachment.content?.length || 0,
        }))
        const classification = await classifyProjectEmail({
          subject: parsed.subject || '',
          from: parsed.from?.text || '',
          body,
          attachments: parsed.attachments || [],
        })
        const existing = await supabase.from('project_emails').select('*').eq('message_id', messageId).maybeSingle()
        if (existing.error) throw existing.error
        if (existing.data) {
          const emailUpdate = await supabase.from('project_emails').update({
            summary: classification.summary,
            category: classification.category,
            urgency: classification.urgency,
            requires_action: classification.requiresAction,
            confidence: classification.confidence,
            classification,
            updated_at: new Date().toISOString(),
          }).eq('id', existing.data.id).select().single()
          if (emailUpdate.error) throw emailUpdate.error
          if (classification.category === 'bid') {
            const contractor = await saveContractorFromEmail(supabase, classification.contact)
            if (contractor) contractorsSaved += 1
            const bidResult = await saveBidFromEmail(supabase, {
              projectId: project.id,
              contractorId: contractor?.id || null,
              email: emailUpdate.data,
              messageId,
              classification,
              attachments: existing.data.attachments || attachmentMetadata,
            })
            if (bidResult.error) errors.push(`Bid: ${bidResult.error.message}`)
            else if (bidResult.data) bidsSaved += 1
          }
          continue
        }

        const emailInsert = await supabase.from('project_emails').insert({
          project_id: project.id,
          message_id: messageId,
          email_from: parsed.from?.text || null,
          email_to: parsed.to?.text || mailbox.address,
          subject: parsed.subject || '(No subject)',
          received_at: parsed.date?.toISOString() || new Date().toISOString(),
          body_excerpt: body.slice(0, 4000),
          summary: classification.summary,
          category: classification.category,
          urgency: classification.urgency,
          requires_action: classification.requiresAction,
          confidence: classification.confidence,
          attachments: attachmentMetadata,
          classification,
        }).select().single()
        if (emailInsert.error) throw emailInsert.error

        const storedAttachments = await storeAttachments(supabase, project.id, emailInsert.data.id, parsed.attachments || [])
        if (storedAttachments.length) {
          const update = await supabase.from('project_emails').update({ attachments: storedAttachments }).eq('id', emailInsert.data.id)
          if (update.error) errors.push(`Attachment metadata: ${update.error.message}`)
        }

        if (classification.requiresAction) {
          const actionInsert = await supabase.from('project_action_items').insert({
            project_id: project.id,
            source_email_id: emailInsert.data.id,
            title: classification.actionTitle || classification.summary,
            detail: classification.actionDetail || `Review email from ${parsed.from?.text || 'project contact'}.`,
            action_type: classification.category,
            priority: classification.urgency === 'critical' ? 1 : classification.urgency === 'important' ? 2 : 3,
            due_date: classification.dueDate || null,
            status: 'open',
            confidence: classification.confidence,
          })
          if (actionInsert.error) errors.push(`Action item: ${actionInsert.error.message}`)
        }

        if (classification.category === 'invoice') {
          const invoice = classification.invoice || {}
          const invoiceAttachment = storedAttachments.find(item => item.mimeType === 'application/pdf') || storedAttachments[0] || null
          const invoiceInsert = await supabase.from('project_invoices').insert({
            project_id: project.id,
            source_email_id: emailInsert.data.id,
            vendor: invoice.vendor || senderLabel(parsed.from?.text),
            invoice_number: invoice.invoiceNumber || null,
            amount: invoice.amount || null,
            due_date: invoice.dueDate || classification.dueDate || null,
            status: 'draft',
            attachment: invoiceAttachment,
            confidence: classification.confidence,
          })
          if (invoiceInsert.error) errors.push(`Invoice: ${invoiceInsert.error.message}`)
        }

        if (classification.category === 'bid') {
          const contractor = await saveContractorFromEmail(supabase, classification.contact)
          if (contractor) contractorsSaved += 1
          const bidResult = await saveBidFromEmail(supabase, {
            projectId: project.id,
            contractorId: contractor?.id || null,
            email: emailInsert.data,
            messageId,
            classification,
            attachments: storedAttachments,
          })
          if (bidResult.error) errors.push(`Bid: ${bidResult.error.message}`)
          else if (bidResult.data) bidsSaved += 1
        }

        imported.push(emailInsert.data)
      } catch (error) {
        errors.push(error.message)
      }
    }
    await removeMisidentifiedOwnerContractor(supabase)
  } finally {
    try { await client.logout() } catch {}
  }

  return { imported, count: imported.length, errors, skippedUnrelated, contractorsSaved, bidsSaved }
}

export function mailboxConfiguration() {
  const address = process.env.PROJECT_EMAIL_ADDRESS || ''
  return {
    address,
    username: process.env.PROJECT_EMAIL_USERNAME || address,
    password: process.env.PROJECT_EMAIL_APP_PASSWORD || '',
    host: process.env.PROJECT_EMAIL_IMAP_HOST || 'imap.mail.me.com',
    port: Number(process.env.PROJECT_EMAIL_IMAP_PORT || 993),
    secure: process.env.PROJECT_EMAIL_IMAP_SECURE !== 'false',
  }
}

export function messageTargetsAddress(parsed, address) {
  const target = String(address || '').trim().toLowerCase()
  if (!target) return false
  const headers = parsed?.headers
  const recipientData = [
    parsed?.to,
    parsed?.cc,
    parsed?.bcc,
    headers?.get?.('delivered-to'),
    headers?.get?.('x-original-to'),
    headers?.get?.('envelope-to'),
  ]
  return JSON.stringify(recipientData).toLowerCase().includes(target)
}

async function classifyProjectEmail({ subject, from, body, attachments }) {
  const fallback = classifyProjectEmailHeuristically({ subject, from, body, attachments })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fallback

  const prompt = `Classify one email sent to a residential construction project inbox. Return valid JSON only with this exact shape:
{
  "category": "bid|invoice|change_order|inspection|schedule|decision|rfi|submittal|general",
  "summary": "one factual sentence under 140 characters",
  "urgency": "critical|important|routine",
  "requiresAction": true,
  "actionTitle": "short imperative title or null",
  "actionDetail": "what Josh needs to do and why, or null",
  "dueDate": "YYYY-MM-DD or null",
  "confidence": 0.0,
  "invoice": { "vendor": "name or null", "invoiceNumber": "number or null", "amount": 123.45, "dueDate": "YYYY-MM-DD or null" },
  "contact": { "name": "person or null", "company": "company or null", "email": "email or null", "phone": "phone or null", "trade": "trade or null" },
  "bid": { "trade": "trade or null", "description": "scope summary or null", "totalAmount": 123.45, "lineItems": [{ "description": "item", "amount": 12.34 }], "notes": "terms or null" }
}
Use critical only for a hard deadline within 48 hours, stop-work risk, failed inspection, past-due payment, or immediate critical-path impact. Do not invent dates or amounts. Set invoice to null for non-invoices.`
  const content = [{
    type: 'text',
    text: `From: ${from || 'unknown'}\nSubject: ${subject || '(none)'}\nAttachments: ${attachments.map(item => item.filename || 'attachment').join(', ') || 'none'}\n\n${body.slice(0, 12000)}`,
  }]
  const pdf = attachments.find(item => item.contentType === 'application/pdf' && item.content?.length <= 8_000_000)
  if (pdf) content.push({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: pdf.content.toString('base64') },
  })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
        max_tokens: 1200,
        system: prompt,
        messages: [{ role: 'user', content }],
      }),
    })
    if (!response.ok) throw new Error(`Email classification failed: ${response.status}`)
    const data = await response.json()
    const text = data.content?.find(item => item.type === 'text')?.text || '{}'
    const parsed = parseJsonObject(text)
    return normalizeClassification(parsed, fallback)
  } catch {
    return fallback
  }
}

async function storeAttachments(supabase, projectId, emailId, attachments) {
  const stored = []
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.content?.length) continue
    const filename = safeFilename(attachment.filename || `attachment-${index + 1}`)
    const path = `${projectId}/${emailId}/${index + 1}-${filename}`
    const result = await supabase.storage.from('project-email-attachments').upload(path, attachment.content, {
      contentType: attachment.contentType || 'application/octet-stream',
      upsert: false,
    })
    if (!result.error) stored.push({
      filename,
      mimeType: attachment.contentType || 'application/octet-stream',
      size: attachment.size || attachment.content.length,
      path,
    })
  }
  return stored
}

async function activeProject(supabase) {
  const result = await supabase.from('projects').select('id,name').eq('status', 'active').order('created_at').limit(1).single()
  if (result.error) throw result.error
  return result.data
}

function normalizeClassification(value, fallback) {
  const invoice = value.invoice && typeof value.invoice === 'object' ? {
    vendor: textOrNull(value.invoice.vendor),
    invoiceNumber: textOrNull(value.invoice.invoiceNumber),
    amount: finiteNumberOrNull(value.invoice.amount),
    dueDate: isoDateOrNull(value.invoice.dueDate),
  } : null
  const category = fallback.category === 'bid' && value.category === 'general'
    ? 'bid'
    : CATEGORIES.has(value.category) ? value.category : fallback.category
  const contact = value.contact && typeof value.contact === 'object' ? {
    name: textOrNull(value.contact.name) || fallback.contact?.name || null,
    company: textOrNull(value.contact.company) || fallback.contact?.company || null,
    email: textOrNull(value.contact.email)?.toLowerCase() || fallback.contact?.email || null,
    phone: textOrNull(value.contact.phone) || fallback.contact?.phone || null,
    trade: textOrNull(value.contact.trade) || fallback.contact?.trade || null,
  } : fallback.contact
  const bid = value.bid && typeof value.bid === 'object' ? {
    trade: textOrNull(value.bid.trade) || fallback.bid?.trade || null,
    description: textOrNull(value.bid.description) || fallback.bid?.description || null,
    totalAmount: finiteNumberOrNull(value.bid.totalAmount) ?? fallback.bid?.totalAmount ?? null,
    lineItems: Array.isArray(value.bid.lineItems) ? value.bid.lineItems.slice(0, 100) : [],
    notes: textOrNull(value.bid.notes) || fallback.bid?.notes || null,
  } : fallback.bid
  return {
    category,
    summary: textOrNull(value.summary) || fallback.summary,
    urgency: URGENCIES.has(value.urgency) ? value.urgency : fallback.urgency,
    requiresAction: Boolean(value.requiresAction || category === 'invoice' || category === 'bid'),
    actionTitle: textOrNull(value.actionTitle),
    actionDetail: textOrNull(value.actionDetail),
    dueDate: isoDateOrNull(value.dueDate),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || fallback.confidence)),
    invoice,
    contact: category === 'bid' ? contact : null,
    bid: category === 'bid' ? bid : null,
  }
}

async function saveContractorFromEmail(supabase, contact) {
  if (!contact || ![contact.name, contact.company, contact.email, contact.phone].some(Boolean)) return null
  let existing = null
  if (contact.email) {
    const match = await supabase.from('contractors').select('*').ilike('email', contact.email).limit(1).maybeSingle()
    if (match.error) throw match.error
    existing = match.data
  }
  if (!existing && contact.company) {
    const match = await supabase.from('contractors').select('*').ilike('company', contact.company).limit(1).maybeSingle()
    if (match.error) throw match.error
    existing = match.data
  }
  const values = Object.fromEntries(Object.entries({
    name: contact.name || contact.company || contact.email,
    company: contact.company,
    email: contact.email,
    phone: contact.phone,
    trade: contact.trade,
  }).filter(([, value]) => value))
  if (existing) {
    const updated = await supabase.from('contractors').update(values).eq('id', existing.id).select().single()
    if (updated.error) throw updated.error
    return updated.data
  }
  const inserted = await supabase.from('contractors').insert(values).select().single()
  if (inserted.error) throw inserted.error
  return inserted.data
}

async function saveBidFromEmail(supabase, { projectId, contractorId, email, messageId, classification, attachments }) {
  const existing = await supabase.from('bids').select('id').eq('email_message_id', messageId).maybeSingle()
  if (existing.error) return { data: null, error: existing.error }
  const bid = classification.bid || {}
  const attachmentNames = attachments.map(item => item.filename).filter(Boolean)
  const values = {
    project_id: projectId,
    contractor_id: contractorId,
    trade: bid.trade || classification.contact?.trade || null,
    description: bid.description || email.subject,
    total_amount: bid.totalAmount,
    line_items: bid.lineItems || [],
    source: 'email',
    status: 'pending',
    email_subject: email.subject,
    email_from: email.email_from,
    email_date: email.received_at,
    email_message_id: messageId,
    notes: [bid.notes, attachmentNames.length ? `Private project-inbox attachments: ${attachmentNames.join(', ')}` : null].filter(Boolean).join('\n') || null,
  }
  if (existing.data) return supabase.from('bids').update(values).eq('id', existing.data.id).select().single()
  return supabase.from('bids').insert(values).select().single()
}

async function removeMisidentifiedOwnerContractor(supabase) {
  const result = await supabase.from('contractors')
    .select('id')
    .ilike('email', 'meyerjr1@mac.com')
    .ilike('name', 'Josh Meyer')
  if (result.error) return
  for (const contractor of result.data || []) {
    const bids = await supabase.from('bids').select('id', { count: 'exact', head: true }).eq('contractor_id', contractor.id)
    if (!bids.error && bids.count === 0) await supabase.from('contractors').delete().eq('id', contractor.id)
  }
}

function parseJsonObject(value) {
  try { return JSON.parse(value) } catch {}
  const match = value.match(/\{[\s\S]*\}/)
  return match ? JSON.parse(match[0]) : {}
}

function plainTextBody(parsed) {
  if (parsed.text) return parsed.text
  return String(parsed.html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function fallbackMessageId(parsed, body) {
  return `generated-${createHash('sha256').update(`${parsed.from?.text || ''}|${parsed.subject || ''}|${parsed.date?.toISOString() || ''}|${body.slice(0, 500)}`).digest('hex')}`
}

function senderLabel(value = '') {
  return value.replace(/<[^>]+>/g, '').replaceAll('"', '').trim() || null
}

function safeFilename(value) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'attachment'
}

function textOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

function finiteNumberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function isoDateOrNull(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null
}

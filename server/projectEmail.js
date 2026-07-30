import { createHash } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { classifyProjectEmailHeuristically } from '../src/domain/notifications.js'

const CATEGORIES = new Set(['invoice', 'change_order', 'inspection', 'schedule', 'decision', 'rfi', 'submittal', 'general'])
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
        const body = plainTextBody(parsed)
        const messageId = parsed.messageId || fallbackMessageId(parsed, body)
        const existing = await supabase.from('project_emails').select('id').eq('message_id', messageId).maybeSingle()
        if (existing.error) throw existing.error
        if (existing.data) continue

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

        imported.push(emailInsert.data)
      } catch (error) {
        errors.push(error.message)
      }
    }
  } finally {
    try { await client.logout() } catch {}
  }

  return { imported, count: imported.length, errors }
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

async function classifyProjectEmail({ subject, from, body, attachments }) {
  const fallback = classifyProjectEmailHeuristically({ subject, body, attachments })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fallback

  const prompt = `Classify one email sent to a residential construction project inbox. Return valid JSON only with this exact shape:
{
  "category": "invoice|change_order|inspection|schedule|decision|rfi|submittal|general",
  "summary": "one factual sentence under 140 characters",
  "urgency": "critical|important|routine",
  "requiresAction": true,
  "actionTitle": "short imperative title or null",
  "actionDetail": "what Josh needs to do and why, or null",
  "dueDate": "YYYY-MM-DD or null",
  "confidence": 0.0,
  "invoice": { "vendor": "name or null", "invoiceNumber": "number or null", "amount": 123.45, "dueDate": "YYYY-MM-DD or null" }
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
  const category = CATEGORIES.has(value.category) ? value.category : fallback.category
  return {
    category,
    summary: textOrNull(value.summary) || fallback.summary,
    urgency: URGENCIES.has(value.urgency) ? value.urgency : fallback.urgency,
    requiresAction: Boolean(value.requiresAction || category === 'invoice'),
    actionTitle: textOrNull(value.actionTitle),
    actionDetail: textOrNull(value.actionDetail),
    dueDate: isoDateOrNull(value.dueDate),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || fallback.confidence)),
    invoice,
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

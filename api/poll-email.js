// Vercel serverless function — /api/poll-email
// Polls iCloud IMAP for contractor bid emails, extracts structured data via Claude,
// and saves new bids to Supabase. Deduplicates by email Message-ID.
//
// Required env vars:
//   ICLOUD_EMAIL         — your iCloud email address
//   ICLOUD_APP_PASSWORD  — App-Specific Password from appleid.apple.com
//   ANTHROPIC_API_KEY    — for bid extraction
//   SUPABASE_URL         — Supabase project URL
//   SUPABASE_SERVICE_KEY — Supabase service role key (for server-side inserts)

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@supabase/supabase-js'

const BID_KEYWORDS = ['bid', 'quote', 'estimate', 'proposal', 'price', 'pricing']

function hasBidKeyword(subject = '', body = '') {
  const text = (subject + ' ' + body).toLowerCase()
  return BID_KEYWORDS.some(kw => text.includes(kw))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const email    = process.env.ICLOUD_EMAIL
  const password = process.env.ICLOUD_APP_PASSWORD
  const apiKey   = process.env.ANTHROPIC_API_KEY
  const sbUrl    = process.env.SUPABASE_URL    || process.env.VITE_SUPABASE_URL
  const sbKey    = process.env.SUPABASE_SERVICE_KEY

  if (!email || !password) return res.status(500).json({ error: 'ICLOUD_EMAIL / ICLOUD_APP_PASSWORD not configured' })
  if (!sbUrl || !sbKey)    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' })

  const supabase = createClient(sbUrl, sbKey)
  const newBids  = []
  const errors   = []

  const client = new ImapFlow({
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
  })

  try {
    await client.connect()
    await client.mailboxOpen('INBOX')

    // Fetch last 100 unseen messages to check for bids
    const messages = []
    for await (const msg of client.fetch('1:*', { envelope: true, source: true }, { uid: false })) {
      messages.push(msg)
      if (messages.length >= 100) break
    }

    for (const msg of messages) {
      try {
        const parsed = await simpleParser(msg.source)
        const subject  = parsed.subject || ''
        const fromAddr = parsed.from?.text || ''
        const bodyText = parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || ''
        const msgId    = parsed.messageId || null
        const date     = parsed.date ? parsed.date.toISOString() : null

        if (!hasBidKeyword(subject, bodyText)) continue

        // Dedup check
        if (msgId) {
          const { data: existing } = await supabase
            .from('bids').select('id').eq('email_message_id', msgId).maybeSingle()
          if (existing) continue
        }

        // Find PDF attachment if any
        let extractedBid = null
        const pdfAttachment = parsed.attachments?.find(a => a.contentType === 'application/pdf')

        if (pdfAttachment && apiKey) {
          const base64 = pdfAttachment.content.toString('base64')
          const extractRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/extract-bid`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pdf: base64 }),
          })
          if (extractRes.ok) {
            const { bid } = await extractRes.json()
            extractedBid = bid
          }
        } else if (apiKey) {
          const extractRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/extract-bid`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ emailBody: bodyText.slice(0, 8000), emailFrom: fromAddr, emailSubject: subject }),
          })
          if (extractRes.ok) {
            const { bid } = await extractRes.json()
            extractedBid = bid
          }
        }

        // Upsert contractor
        let contractorId = null
        if (extractedBid?.contractorName) {
          const contractorData = {
            name:    extractedBid.contractorName,
            company: extractedBid.company  || null,
            email:   extractedBid.email    || fromAddr.match(/<(.+)>/)?.[1] || fromAddr,
            phone:   extractedBid.phone    || null,
            trade:   extractedBid.trade    || null,
          }
          // Try to match existing contractor by email
          const matchEmail = contractorData.email
          if (matchEmail) {
            const { data: existing } = await supabase
              .from('contractors').select('id').eq('email', matchEmail).maybeSingle()
            if (existing) {
              contractorId = existing.id
            } else {
              const { data: newC } = await supabase.from('contractors').insert(contractorData).select('id').single()
              if (newC) contractorId = newC.id
            }
          } else {
            const { data: newC } = await supabase.from('contractors').insert(contractorData).select('id').single()
            if (newC) contractorId = newC.id
          }
        }

        // Insert bid
        const bidRecord = {
          contractor_id:    contractorId,
          trade:            extractedBid?.trade        || null,
          description:      subject,
          total_amount:     extractedBid?.totalAmount   || null,
          line_items:       extractedBid?.lineItems     || [],
          source:           'email',
          email_subject:    subject,
          email_from:       fromAddr,
          email_date:       date,
          email_message_id: msgId,
          status:           'pending',
          notes:            extractedBid?.notes || null,
        }

        const { data: savedBid } = await supabase.from('bids').insert(bidRecord).select().single()
        if (savedBid) newBids.push(savedBid)

      } catch (msgErr) {
        errors.push(msgErr.message)
      }
    }

    await client.logout()
  } catch (err) {
    try { await client.logout() } catch {}
    return res.status(500).json({ error: err.message })
  }

  res.json({ newBids, count: newBids.length, errors })
}

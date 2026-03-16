// Vercel serverless function — /api/poll-email
// Polls iCloud IMAP for contractor bid emails using server-side keyword search,
// extracts structured data via Claude, and saves new bids to Supabase.
//
// Required env vars:
//   ICLOUD_EMAIL         — your iCloud email address
//   ICLOUD_APP_PASSWORD  — App-Specific Password from appleid.apple.com
//   ANTHROPIC_API_KEY    — for bid extraction
//   SUPABASE_SERVICE_KEY — Supabase service role key

// Vercel: allow up to 300s on Pro, 60s on Hobby
export const config = { maxDuration: 300 }

import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const email    = process.env.ICLOUD_EMAIL
  const password = process.env.ICLOUD_APP_PASSWORD
  const apiKey   = process.env.ANTHROPIC_API_KEY
  const sbUrl    = 'https://qxffadumpshyaseayndy.supabase.co'
  const sbKey    = process.env.SUPABASE_SERVICE_KEY

  if (!email || !password) return res.status(500).json({ error: 'ICLOUD_EMAIL / ICLOUD_APP_PASSWORD not configured' })
  if (!sbKey)              return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' })

  const supabase     = createClient(sbUrl, sbKey)
  const newBids      = []
  const errors       = []
  const lookbackDays = parseInt(req.body?.lookbackDays) || 90
  const since        = new Date()
  since.setDate(since.getDate() - lookbackDays)

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

    // Server-side IMAP search: only emails since date AND matching any bid keyword in subject
    // This runs on Apple's mail server — only matching emails are downloaded
    const keywordSearches = ['bid', 'quote', 'estimate', 'proposal'].map(kw => ({ subject: kw }))
    const orSearch = keywordSearches.reduce((acc, cur) =>
      acc ? { or: [acc, cur] } : cur
    )

    const uidResult = await client.search({ and: [{ since }, orSearch] }, { uid: true })
    const uids = Array.from(uidResult || [])

    if (uids.length === 0) {
      await client.logout()
      return res.json({ newBids: [], count: 0, errors, searched: 0 })
    }

    // Cap at 50 most recent emails per run to stay within timeout
    const uidSlice = uids.slice(-50)

    const messages = []
    for await (const msg of client.fetch(uidSlice, { envelope: true, source: true }, { uid: true })) {
      messages.push(msg)
    }

    for (const msg of messages) {
      try {
        const parsed   = await simpleParser(msg.source)
        const subject  = parsed.subject || ''
        const fromAddr = parsed.from?.text || ''
        const bodyText = parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || ''
        const msgId    = parsed.messageId || null
        const date     = parsed.date ? parsed.date.toISOString() : null

        // Dedup: skip if already imported
        if (msgId) {
          const { data: existing } = await supabase
            .from('bids').select('id').eq('email_message_id', msgId).maybeSingle()
          if (existing) continue
        }

        // Extract bid data via Claude
        let extractedBid = null
        const pdfAttachment = parsed.attachments?.find(a => a.contentType === 'application/pdf')
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

        if (pdfAttachment && apiKey) {
          const base64 = pdfAttachment.content.toString('base64')
          const r = await fetch(`${baseUrl}/api/extract-bid`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pdf: base64 }),
          })
          if (r.ok) extractedBid = (await r.json()).bid
        } else if (apiKey) {
          const r = await fetch(`${baseUrl}/api/extract-bid`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ emailBody: bodyText.slice(0, 8000), emailFrom: fromAddr, emailSubject: subject }),
          })
          if (r.ok) extractedBid = (await r.json()).bid
        }

        // Upsert contractor
        let contractorId = null
        if (extractedBid?.contractorName) {
          const contractorData = {
            name:    extractedBid.contractorName,
            company: extractedBid.company || null,
            email:   extractedBid.email   || fromAddr.match(/<(.+)>/)?.[1] || fromAddr,
            phone:   extractedBid.phone   || null,
            trade:   extractedBid.trade   || null,
          }
          const matchEmail = contractorData.email
          if (matchEmail) {
            const { data: existing } = await supabase.from('contractors').select('id').eq('email', matchEmail).maybeSingle()
            if (existing) contractorId = existing.id
            else { const { data: c } = await supabase.from('contractors').insert(contractorData).select('id').single(); if (c) contractorId = c.id }
          } else {
            const { data: c } = await supabase.from('contractors').insert(contractorData).select('id').single()
            if (c) contractorId = c.id
          }
        }

        // Insert bid
        const { data: savedBid } = await supabase.from('bids').insert({
          contractor_id:    contractorId,
          trade:            extractedBid?.trade       || null,
          description:      subject,
          total_amount:     extractedBid?.totalAmount  || null,
          line_items:       extractedBid?.lineItems    || [],
          source:           'email',
          email_subject:    subject,
          email_from:       fromAddr,
          email_date:       date,
          email_message_id: msgId,
          status:           'pending',
          notes:            extractedBid?.notes || null,
        }).select().single()
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

  res.json({ newBids, count: newBids.length, errors, searched: newBids.length + errors.length })
}

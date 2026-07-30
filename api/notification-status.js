import { mailboxConfiguration } from '../server/projectEmail.js'

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const mailbox = mailboxConfiguration()
  const smsConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID
    && process.env.TWILIO_AUTH_TOKEN
    && process.env.PROJECT_SMS_TO
    && (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID),
  )
  res.setHeader('Cache-Control', 'no-store')
  return res.json({
    mailbox: {
      configured: Boolean(mailbox.address && mailbox.password),
    },
    sms: {
      configured: smsConfigured,
      deliveryWindow: '7–8 AM Mountain Time',
    },
    scheduler: { configured: Boolean(process.env.CRON_SECRET) },
  })
}

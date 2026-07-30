import { createClient } from '@supabase/supabase-js'
import { syncProjectInbox } from '../server/projectEmail.js'

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET is not configured' })
  if (req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.SUPABASE_URL || 'https://qxffadumpshyaseayndy.supabase.co'
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY is not configured' })

  try {
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const result = await syncProjectInbox({ supabase })
    return res.json({
      connected: true,
      imported: result.count,
      processingErrors: result.errors,
    })
  } catch (error) {
    return res.status(500).json({ connected: false, error: error.message })
  }
}

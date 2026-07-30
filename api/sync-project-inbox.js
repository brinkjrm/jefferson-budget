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
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const recentResult = await supabase.from('project_emails')
      .select('id,email_to,attachments,created_at')
      .gte('created_at', cutoff)
    if (recentResult.error) throw recentResult.error
    const projectAddress = String(process.env.PROJECT_EMAIL_ADDRESS || '').toLowerCase()
    const unrelated = (recentResult.data || []).filter(row =>
      !String(row.email_to || '').toLowerCase().includes(projectAddress),
    )

    let removedUnrelated = 0
    let removedAttachments = 0
    const cleanupRequested = req.body?.cleanupUnrelated === true
    if (cleanupRequested) {
      const expected = Number(req.body?.expectedUnrelated)
      if (!Number.isInteger(expected) || expected !== unrelated.length) {
        return res.status(409).json({
          error: 'Cleanup count changed; no records were deleted',
          expected,
          actual: unrelated.length,
        })
      }

      if (unrelated.length) {
        const deleteResult = await supabase.from('project_emails')
          .delete()
          .in('id', unrelated.map(row => row.id))
          .select('id')
        if (deleteResult.error) throw deleteResult.error
        removedUnrelated = deleteResult.data?.length || 0

        const attachmentPaths = unrelated.flatMap(row =>
          Array.isArray(row.attachments) ? row.attachments.map(item => item?.path).filter(Boolean) : [],
        )
        if (attachmentPaths.length) {
          const storageResult = await supabase.storage.from('project-email-attachments').remove(attachmentPaths)
          if (storageResult.error) throw storageResult.error
          removedAttachments = storageResult.data?.length || 0
        }
      }
    }

    return res.json({
      connected: true,
      imported: result.count,
      skippedUnrelated: result.skippedUnrelated,
      processingErrors: result.errors,
      audit: {
        recentImported: recentResult.data?.length || 0,
        unrelated: unrelated.length,
        removedUnrelated,
        removedAttachments,
      },
    })
  } catch (error) {
    return res.status(500).json({ connected: false, error: error.message })
  }
}

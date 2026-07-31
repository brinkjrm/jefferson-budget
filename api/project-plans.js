import {
  PLAN_BUCKET,
  finalizePlanUpload,
  hasProjectPlanAccess,
  preparePlanUpload,
  privatePlanPath,
  projectPlanShareToken,
  projectServiceClient,
} from '../server/projectPlans.js'

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  if (!process.env.PROJECT_ACCESS_CODE) return res.status(503).json({ error: 'Private plan access is not configured' })
  if (!hasProjectPlanAccess(req)) return res.status(401).json({ error: 'Incorrect project access code' })

  try {
    const client = projectServiceClient()
    if (req.method === 'GET') {
      if (req.query.id) {
        const record = await client.from('plans').select('id,file_url').eq('id', req.query.id).single()
        if (record.error) throw record.error
        const signed = await client.storage.from(PLAN_BUCKET).createSignedUrl(privatePlanPath(record.data.file_url), 15 * 60)
        if (signed.error) throw signed.error
        return res.json({ url: signed.data.signedUrl, expiresIn: 900 })
      }
      const list = await client.from('plans').select('id,name,file_size,created_at').order('created_at', { ascending: false })
      if (list.error) throw list.error
      const appUrl = (process.env.PUBLIC_APP_URL || 'https://jefferson-budget.vercel.app').replace(/\/$/, '')
      return res.json({
        plans: list.data || [],
        share_url: `${appUrl}/shared-plans/${projectPlanShareToken()}`,
      })
    }

    if (req.method === 'POST') {
      if (req.body?.action === 'prepareUpload') {
        const filename = String(req.body.filename || '')
        if (!filename.toLowerCase().endsWith('.pdf')) return res.status(400).json({ error: 'Only PDF files are accepted' })
        return res.json(await preparePlanUpload(client, { filename, prefix: 'uploads' }))
      }
      if (req.body?.action === 'finalizeUpload') {
        const plan = await finalizePlanUpload(client, req.body)
        return res.json({ plan: publicPlan(plan) })
      }
      return res.status(400).json({ error: 'Unknown plan action' })
    }

    if (req.method === 'PATCH') {
      const name = String(req.body?.name || '').trim()
      if (!req.body?.id || !name) return res.status(400).json({ error: 'Plan id and name are required' })
      const updated = await client.from('plans').update({ name }).eq('id', req.body.id).select('id,name,file_size,created_at').single()
      if (updated.error) throw updated.error
      return res.json({ plan: updated.data })
    }

    if (req.method === 'DELETE') {
      const record = await client.from('plans').select('id,file_url').eq('id', req.body?.id).single()
      if (record.error) throw record.error
      const removedFile = await client.storage.from(PLAN_BUCKET).remove([privatePlanPath(record.data.file_url)])
      if (removedFile.error) throw removedFile.error
      const removedRecord = await client.from('plans').delete().eq('id', record.data.id)
      if (removedRecord.error) throw removedRecord.error
      return res.json({ deleted: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}

function publicPlan(plan) {
  return { id: plan.id, name: plan.name, file_size: plan.file_size, created_at: plan.created_at }
}

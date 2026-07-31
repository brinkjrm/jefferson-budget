import { finalizePlanUpload, preparePlanUpload, projectServiceClient } from '../server/projectPlans.js'

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not configured' })
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const client = projectServiceClient()
    if (req.body?.action === 'prepareUpload') {
      return res.json(await preparePlanUpload(client, {
        filename: req.body.filename,
        prefix: 'permit-package',
      }))
    }
    if (req.body?.action === 'finalizeUpload') {
      const plan = await finalizePlanUpload(client, req.body)
      return res.json({ id: plan.id, name: plan.name })
    }
    return res.status(400).json({ error: 'Unknown import action' })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}

import {
  PLAN_BUCKET,
  hasProjectPlanShareAccess,
  privatePlanPath,
  projectServiceClient,
} from '../server/projectPlans.js'

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!hasProjectPlanShareAccess(req.query.token)) return res.status(404).json({ error: 'Shared plan link is invalid' })

  try {
    const client = projectServiceClient()
    const list = await client.from('plans')
      .select('id,name,file_url,file_size,created_at')
      .order('name', { ascending: true })
    if (list.error) throw list.error

    const plans = await Promise.all((list.data || []).map(async plan => {
      const signed = await client.storage.from(PLAN_BUCKET).createSignedUrl(privatePlanPath(plan.file_url), 60 * 60)
      if (signed.error) throw signed.error
      return {
        id: plan.id,
        name: plan.name,
        file_size: plan.file_size,
        created_at: plan.created_at,
        url: signed.data.signedUrl,
      }
    }))

    res.setHeader('Cache-Control', 'private, no-store')
    return res.json({ plans, expiresIn: 3600 })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}

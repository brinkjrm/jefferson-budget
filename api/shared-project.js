import {
  PLAN_BUCKET,
  hasProjectShareAccess,
  privatePlanPath,
  projectServiceClient,
} from '../server/projectPlans.js'
import { publicScheduleTask, publicSelection } from '../server/sharedProject.js'

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!hasProjectShareAccess(req.query.token)) return res.status(404).json({ error: 'Shared project link is invalid' })

  try {
    const client = projectServiceClient()
    const [projectResult, scheduleResult, selectionsResult, plansResult] = await Promise.all([
      client.from('projects').select('name,address').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      client.from('schedule_tasks').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
      client.from('selections').select('*').order('sort_order', { ascending: true }),
      client.from('plans').select('id,name,file_url,file_size,created_at').order('name', { ascending: true }),
    ])

    for (const result of [scheduleResult, selectionsResult, plansResult]) {
      if (result.error) throw result.error
    }

    const plans = await Promise.all((plansResult.data || []).map(async plan => {
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
    return res.json({
      project: projectResult.error ? { name: '3120 Jefferson Street', address: '' } : projectResult.data,
      schedule: (scheduleResult.data || []).map(publicScheduleTask),
      selections: (selectionsResult.data || []).map(publicSelection),
      plans,
      permissions: {
        schedule: 'read',
        selections: 'read',
        plans: 'read',
      },
      expiresIn: 3600,
    })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}

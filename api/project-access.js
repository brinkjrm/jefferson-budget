import { hasProjectAccess } from '../server/projectPlans.js'

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!process.env.PROJECT_ACCESS_CODE) return res.status(503).json({ error: 'Private workspace access is not configured' })
  if (!hasProjectAccess(req)) return res.status(401).json({ error: 'Incorrect project access code' })
  res.setHeader('Cache-Control', 'private, no-store')
  return res.json({ authorized: true })
}


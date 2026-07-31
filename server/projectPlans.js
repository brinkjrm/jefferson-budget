import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

export const PLAN_BUCKET = 'plan-pdfs'

export function projectServiceClient() {
  const url = process.env.SUPABASE_URL || 'https://qxffadumpshyaseayndy.supabase.co'
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

export function hasProjectPlanAccess(req) {
  const expected = process.env.PROJECT_ACCESS_CODE || ''
  const provided = String(req.headers['x-project-access-code'] || '')
  if (!expected || !provided) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer)
}

export function privatePlanPath(value = '') {
  return String(value).replace(/^private:/, '').replace(/^\/+/, '')
}

export function safePlanPath(filename, prefix = 'uploads') {
  const clean = String(filename || 'plan.pdf')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'plan.pdf'
  return `${prefix}/${Date.now()}-${clean}`
}

export async function verifyPrivatePlanBucket(client) {
  const result = await client.storage.getBucket(PLAN_BUCKET)
  if (result.error) throw result.error
  if (result.data.public) throw new Error('The plan-pdfs bucket must remain private')
  return result.data
}

export async function preparePlanUpload(client, { filename, prefix }) {
  await verifyPrivatePlanBucket(client)
  const path = safePlanPath(filename, prefix)
  const result = await client.storage.from(PLAN_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (result.error) throw result.error
  return { path, token: result.data.token, signedUrl: result.data.signedUrl }
}

export async function finalizePlanUpload(client, { path, name, size }) {
  const storagePath = privatePlanPath(path)
  if (!storagePath || !storagePath.toLowerCase().endsWith('.pdf')) throw new Error('A PDF storage path is required')
  const values = {
    name: String(name || 'Plan').trim(),
    file_url: `private:${storagePath}`,
    file_size: Number(size || 0),
  }
  const existing = await client.from('plans').select('*').eq('file_url', values.file_url).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    const updated = await client.from('plans').update(values).eq('id', existing.data.id).select().single()
    if (updated.error) throw updated.error
    return updated.data
  }
  const inserted = await client.from('plans').insert(values).select().single()
  if (inserted.error) throw inserted.error
  return inserted.data
}

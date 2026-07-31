import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const secret = process.env.IMPORT_SECRET
const appUrl = (process.env.PUBLIC_APP_URL || 'https://jefferson-budget.vercel.app').replace(/\/$/, '')
if (!secret) throw new Error('IMPORT_SECRET is required')
const storage = createClient(
  'https://qxffadumpshyaseayndy.supabase.co',
  'sb_publishable_jOL4vqNZCBd8vw0U7CYOqQ_-unZJWfi',
  { auth: { persistSession: false } },
)

const scriptDir = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(scriptDir, '../../sources')
const displayNames = {
  'ArchPlns_3120 Jefferson St_02-16-2026.pdf': 'Architectural Plans — 02/16/2026',
  'StrucPlans_3120 Jefferson St_02-16-2026.pdf': 'Structural Plans — 02/16/2026',
  'StrucCalcs_3120 Jefferson St_02-16-2026.pdf': 'Structural Calculations — 02/16/2026',
  'Mech_3120 Jefferson St_02-16-2026.pdf': 'Mechanical Plans — 02/16/2026',
  '3120 Jefferson St_ISP_Sealed.pdf': 'Site Improvement Plan — Sealed',
  'BONSALL Sub Plat.pdf': 'Bonsall Subdivision Plat',
  'FARBldgCov_3120Jefferson St_02-13-26.pdf': 'FAR / Building Coverage — 02/13/2026',
  '2020cityofboulderenergycode2ndptg.pdf': '2020 City of Boulder Energy Code',
  'HERS_3120 Jefferson St.pdf': 'HERS Report',
  'SoilsRpt_3120JeffersonSt_10-22-2025 -.pdf': 'Soils Report — 10/22/2025',
}

const filenames = (await readdir(sourceDir)).filter(name => name.toLowerCase().endsWith('.pdf')).sort()
await api({ action: 'secureBucket' })
for (const filename of filenames) {
  const localPath = resolve(sourceDir, filename)
  const fileStat = await stat(localPath)
  const prepared = await api({ action: 'prepareUpload', filename })
  const file = await readFile(localPath)
  const uploaded = await storage.storage.from('plan-pdfs').uploadToSignedUrl(
    prepared.path,
    prepared.token,
    file,
    { contentType: 'application/pdf' },
  )
  if (uploaded.error) throw new Error(`Upload failed for ${filename}: ${uploaded.error.message}`)
  const finalized = await api({
    action: 'finalizeUpload',
    path: prepared.path,
    name: displayNames[filename] || filename.replace(/\.pdf$/i, ''),
    size: fileStat.size,
  })
  console.log(`Imported ${finalized.name}`)
}

async function api(body) {
  const response = await fetch(`${appUrl}/api/import-project-plan`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Import API returned ${response.status}`)
  return data
}

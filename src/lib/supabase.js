import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qxffadumpshyaseayndy.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_jOL4vqNZCBd8vw0U7CYOqQ_-unZJWfi'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function uploadInvoice(file, drawId, itemIndex) {
  const ext = file.name.split('.').pop()
  const path = `draw-${drawId}/item-${itemIndex}-${Date.now()}.${ext}`
  const { data, error } = await supabase.storage
    .from('invoices')
    .upload(path, file, { upsert: true })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('invoices').getPublicUrl(path)
  return { path, publicUrl }
}

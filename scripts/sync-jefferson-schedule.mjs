import { createClient } from '@supabase/supabase-js'
import { buildJeffersonSchedule } from '../src/data/jeffersonSchedule.js'
import { replaceScheduleWithBlueprint } from '../src/lib/scheduleRepository.js'

const url = process.env.JEFFERSON_SUPABASE_URL || 'https://qxffadumpshyaseayndy.supabase.co'
const key = process.env.JEFFERSON_SUPABASE_ANON_KEY

if (!key) {
  console.error('Set JEFFERSON_SUPABASE_ANON_KEY before syncing the schedule.')
  process.exit(1)
}

const supabase = createClient(url, key)
const { data: existingRows, error } = await supabase.from('schedule_tasks').select('*')
if (error) throw error

const schedule = buildJeffersonSchedule()
const rows = await replaceScheduleWithBlueprint(supabase, schedule, existingRows || [])
const taskCount = rows.filter(row => row.parent_id).length
const phaseCount = rows.filter(row => !row.parent_id).length

console.log(`Synced ${phaseCount} phases and ${taskCount} tasks (${schedule.projectStart} through ${schedule.projectEnd}).`)

export async function replaceScheduleWithBlueprint(supabase, schedule, existingRows = []) {
  const insertedIds = []
  const rollback = async () => {
    const children = insertedIds.filter(id => id.parentId).map(id => id.id)
    const phases = insertedIds.filter(id => !id.parentId).map(id => id.id)
    if (children.length) await supabase.from('schedule_tasks').delete().in('id', children)
    if (phases.length) await supabase.from('schedule_tasks').delete().in('id', phases)
  }

  try {
    const phasePayload = schedule.phases.map(phase => ({
      name: phase.name,
      start_date: phase.start_date,
      end_date: phase.end_date,
      status: phase.status,
      sort_order: phase.sort_order,
      color: phase.color,
      depends_on: [],
      dependency_settings: {},
    }))
    const { data: insertedPhases, error: phaseError } = await supabase
      .from('schedule_tasks').insert(phasePayload).select()
    if (phaseError) throw phaseError
    insertedPhases.forEach(row => insertedIds.push({ id: row.id, parentId: null }))

    const phaseIdByName = new Map(insertedPhases.map(row => [row.name, row.id]))
    const taskPayload = schedule.tasks.map(item => ({
      name: item.name,
      parent_id: phaseIdByName.get(item.phaseName),
      start_date: item.start_date,
      end_date: item.end_date,
      status: item.status,
      sort_order: item.sort_order,
      depends_on: [],
      dependency_settings: {},
    }))
    const { data: insertedTasks, error: taskError } = await supabase
      .from('schedule_tasks').insert(taskPayload).select()
    if (taskError) throw taskError
    insertedTasks.forEach(row => insertedIds.push({ id: row.id, parentId: row.parent_id }))

    const idByName = new Map(insertedTasks.map(row => [row.name, row.id]))
    const sourceByName = new Map(schedule.tasks.map(item => [item.name, item]))
    const dependencyPayload = insertedTasks.map(row => {
      const source = sourceByName.get(row.name)
      const dependsOn = source.dependsOn.map(key => {
        const predecessor = schedule.tasks.find(item => item.key === key)
        const predecessorId = predecessor && idByName.get(predecessor.name)
        if (!predecessorId) throw new Error(`Could not resolve dependency ${key} for ${row.name}`)
        return predecessorId
      })
      return {
        ...row,
        depends_on: dependsOn,
        dependency_settings: Object.fromEntries(dependsOn.map(id => [id, { type: 'FS', lag: 0 }])),
        updated_at: new Date().toISOString(),
      }
    })
    const { data: updatedTasks, error: dependencyError } = await supabase
      .from('schedule_tasks').upsert(dependencyPayload).select()
    if (dependencyError) throw dependencyError

    const metadataPayload = updatedTasks.map(row => {
      const source = sourceByName.get(row.name)
      return {
        id: row.id,
        task_type: source.type || 'work',
        trade: source.trade || null,
        plan_references: source.references || null,
      }
    })
    const { data: enrichedTasks, error: metadataError } = await supabase
      .from('schedule_tasks').upsert(metadataPayload).select()
    const finalTasks = metadataError && isMissingMetadataColumns(metadataError) ? updatedTasks : enrichedTasks
    if (metadataError && !isMissingMetadataColumns(metadataError)) throw metadataError

    const oldChildren = existingRows.filter(row => row.parent_id).map(row => row.id)
    const oldPhases = existingRows.filter(row => !row.parent_id).map(row => row.id)
    if (oldChildren.length) {
      const { error } = await supabase.from('schedule_tasks').delete().in('id', oldChildren)
      if (error) throw error
    }
    if (oldPhases.length) {
      const { error } = await supabase.from('schedule_tasks').delete().in('id', oldPhases)
      if (error) throw error
    }

    return [...insertedPhases, ...finalTasks]
  } catch (error) {
    await rollback()
    throw error
  }
}

function isMissingMetadataColumns(error) {
  return error?.code === 'PGRST204' || /task_type|trade|plan_references|schema cache/i.test(error?.message || '')
}

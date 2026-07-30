export const COLLECTION_SPECS = {
  projects: { table: 'projects', optional: true, order: [['created_at', false]] },
  buildings: { table: 'project_buildings', optional: true, order: [['sort_order', true]] },
  areas: { table: 'project_areas', optional: true, order: [['sort_order', true]] },
  projectEvents: { table: 'project_events', optional: true, order: [['occurred_at', false]], limit: 100 },
  projectLinks: { table: 'project_links', optional: true, order: [['created_at', false]] },
  lineItems: { table: 'line_items', order: [['sort_order', true], ['created_at', true]] },
  prepaidItems: { table: 'prepaid_items', order: [['date_paid', false], ['created_at', false]] },
  drawSheets: { table: 'draw_sheets', order: [['draw_number', false]] },
  drawItems: { table: 'draw_items', order: [['sort_order', true]] },
  scheduleTasks: { table: 'schedule_tasks', order: [['sort_order', true], ['created_at', true]] },
  bids: { table: 'bids', select: '*, contractors(*)', order: [['created_at', false]] },
  contractors: { table: 'contractors', order: [['name', true]] },
  selections: { table: 'selections', order: [['sort_order', true]] },
  plans: { table: 'plans', order: [['created_at', false]] },
  settings: { table: 'settings', order: [['key', true]] },
}

export function createProjectRepository(client) {
  return {
    async loadCollection(key) {
      const spec = COLLECTION_SPECS[key]
      if (!spec) throw new Error(`Unknown project collection: ${key}`)
      let query = client.from(spec.table).select(spec.select || '*')
      for (const [column, ascending] of spec.order || []) {
        query = query.order(column, { ascending })
      }
      if (spec.limit) query = query.limit(spec.limit)
      const { data, error } = await query
      if (error) {
        if (spec.optional && isMissingRelation(error)) return { data: [], available: false, error: null }
        throw error
      }
      return { data: data || [], available: true, error: null }
    },

    async loadCollections(keys = Object.keys(COLLECTION_SPECS)) {
      const entries = await Promise.all(keys.map(async key => {
        try {
          return [key, await this.loadCollection(key)]
        } catch (error) {
          return [key, { data: [], available: false, error }]
        }
      }))
      return Object.fromEntries(entries)
    },

    tableFor(key) {
      const spec = COLLECTION_SPECS[key]
      if (!spec) throw new Error(`Unknown project collection: ${key}`)
      return spec.table
    },

    async create(key, values) {
      const { data, error } = await client.from(this.tableFor(key)).insert(values).select().single()
      if (error) throw error
      return data
    },

    async update(key, id, patch) {
      const { data, error } = await client.from(this.tableFor(key)).update(patch).eq('id', id).select().single()
      if (error) throw error
      return data
    },

    async remove(key, id) {
      const { error } = await client.from(this.tableFor(key)).delete().eq('id', id)
      if (error) throw error
    },
  }
}

export function isMissingRelation(error) {
  return error?.code === '42P01' || /relation .* does not exist|schema cache/i.test(error?.message || '')
}

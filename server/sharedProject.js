const SCHEDULE_FIELDS = [
  'id', 'name', 'parent_id', 'start_date', 'end_date', 'status', 'sort_order',
  'color', 'depends_on', 'dependency_settings', 'task_type', 'trade', 'plan_references',
  'needs_contractor_discussion',
]

const SELECTION_FIELDS = [
  'id', 'category', 'section', 'room', 'item_description', 'qty', 'product_link',
  'brand_model', 'status', 'notes', 'sort_order',
]

function pick(row, fields) {
  return Object.fromEntries(fields.map(field => [field, row?.[field] ?? null]))
}

export function publicScheduleTask(row) {
  return {
    ...pick(row, SCHEDULE_FIELDS),
    depends_on: Array.isArray(row?.depends_on) ? row.depends_on : [],
    dependency_settings: row?.dependency_settings && typeof row.dependency_settings === 'object'
      ? row.dependency_settings
      : {},
  }
}

export function publicSelection(row) {
  return pick(row, SELECTION_FIELDS)
}

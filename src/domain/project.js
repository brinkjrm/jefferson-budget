const DEFAULT_PROJECT = {
  id: 'jefferson',
  name: 'Jefferson Remodel',
  address: '3120 Jefferson St, Boulder CO 80304',
  owner: 'Josh Meyer',
  builder: 'Marc David Homes',
}

const money = value => Number(value || 0)

export function settingsFromRows(rows = []) {
  return rows.reduce((settings, row) => {
    settings[row.key] = row.value
    return settings
  }, {})
}

export function createProjectModel(collections = {}, options = {}) {
  const settings = {
    bank_name: 'FirstBank',
    borrower: DEFAULT_PROJECT.owner,
    property_address: DEFAULT_PROJECT.address,
    builder: DEFAULT_PROJECT.builder,
    loan_amount: '',
    loan_number: '',
    ...settingsFromRows(collections.settings || []),
  }
  const projects = collections.projects || []
  const storedProject = projects[0]
  const project = {
    ...DEFAULT_PROJECT,
    ...(storedProject || {}),
    name: storedProject?.name || settings.project_name || DEFAULT_PROJECT.name,
    address: storedProject?.address || settings.property_address || DEFAULT_PROJECT.address,
    owner: storedProject?.owner || settings.borrower || DEFAULT_PROJECT.owner,
    builder: storedProject?.builder || settings.builder || DEFAULT_PROJECT.builder,
  }

  const scheduleRows = collections.scheduleTasks || []
  const phases = scheduleRows.filter(row => !row.parent_id)
  const tasks = scheduleRows.filter(row => row.parent_id).map(row => {
    const metadata = options.taskMetadataFor?.(row.name) || {}
    return {
      ...row,
      trade: row.trade || metadata.trade || '',
      task_type: row.task_type || metadata.type || 'work',
      references: row.plan_references || metadata.references || '',
    }
  })

  return {
    project,
    settings,
    buildings: collections.buildings || [],
    areas: collections.areas || [],
    financials: {
      budgetItems: collections.lineItems || [],
      prepaidItems: collections.prepaidItems || [],
      drawSheets: collections.drawSheets || [],
      drawItems: collections.drawItems || [],
    },
    schedule: { rows: [...phases, ...tasks], phases, tasks },
    procurement: {
      bids: collections.bids || [],
      contractors: collections.contractors || [],
      selections: collections.selections || [],
    },
    documents: { plans: collections.plans || [] },
    events: collections.projectEvents || [],
    links: collections.projectLinks || [],
  }
}

export function calculateProjectMetrics(model, today = new Date()) {
  const budgetItems = model.financials.budgetItems
  const prepaidItems = model.financials.prepaidItems
  const draws = model.financials.drawSheets
  const tasks = model.schedule.tasks
  const bids = model.procurement.bids
  const selections = model.procurement.selections

  const estimated = budgetItems.reduce((sum, item) => sum + money(item.estimated_cost), 0)
  const committed = budgetItems
    .filter(item => item.status === 'locked')
    .reduce((sum, item) => sum + money(item.actual_cost ?? item.estimated_cost), 0)
  const forecast = budgetItems.reduce(
    (sum, item) => sum + money(item.actual_cost ?? item.estimated_cost),
    0,
  )
  const prepaid = prepaidItems.reduce((sum, item) => sum + money(item.amount), 0)
  const drawsTotal = draws.reduce((sum, draw) => sum + money(draw.this_draw_amount), 0)
  const contingency = budgetItems.find(item => item.code === 'C000' || /contingency/i.test(item.name || ''))

  const completeTasks = tasks.filter(task => task.status === 'complete')
  const blockedTasks = tasks.filter(task => task.status === 'blocked')
  const inProgressTasks = tasks.filter(task => task.status === 'in_progress')
  const inspectionTasks = tasks.filter(task => task.task_type === 'inspection')
  const passedInspections = inspectionTasks.filter(task => task.status === 'complete')
  const pendingBids = bids.filter(bid => bid.status === 'pending')
  const tbdSelections = selections.filter(item => item.status === 'TBD')
  const todayString = toLocalDateString(today)
  const overdueTasks = tasks.filter(task =>
    task.status !== 'complete' && task.end_date && task.end_date < todayString,
  )

  const readyInspections = inspectionTasks.filter(task => {
    if (task.status === 'complete') return false
    const predecessors = task.depends_on || []
    return predecessors.length > 0 && predecessors.every(id =>
      tasks.some(candidate => candidate.id === id && candidate.status === 'complete'),
    )
  })

  const scheduleProgress = tasks.length ? completeTasks.length / tasks.length : 0
  const budgetHealth = forecast <= estimated || estimated === 0 ? 1 : Math.max(0, estimated / forecast)
  const scheduleHealth = blockedTasks.length === 0 ? 1 : Math.max(0, 1 - blockedTasks.length / Math.max(tasks.length, 1))
  const decisionHealth = selections.length ? 1 - (tbdSelections.length / selections.length) * 0.35 : 1
  const healthScore = Math.round((budgetHealth * 0.35 + scheduleHealth * 0.4 + decisionHealth * 0.25) * 100)

  return {
    financials: {
      estimated,
      committed,
      forecast,
      prepaid,
      drawsTotal,
      contingency: money(contingency?.estimated_cost),
      committedPercent: estimated ? Math.round((committed / estimated) * 100) : 0,
      variance: forecast - estimated,
    },
    schedule: {
      total: tasks.length,
      complete: completeTasks.length,
      progressPercent: Math.round(scheduleProgress * 100),
      blocked: blockedTasks,
      inProgress: inProgressTasks,
      overdue: overdueTasks,
      inspections: inspectionTasks,
      passedInspections,
      readyInspections,
      start: minValue(tasks.map(task => task.start_date)),
      finish: maxValue(tasks.map(task => task.end_date)),
    },
    procurement: {
      pendingBids,
      tbdSelections,
      selectedCount: selections.filter(item => item.status === 'SELECTED').length,
    },
    healthScore: Math.max(0, Math.min(100, healthScore)),
  }
}

export function buildActionItems(model, metrics) {
  const actions = []

  metrics.schedule.blocked.forEach(task => actions.push({
    id: `blocked-${task.id}`,
    type: 'risk',
    priority: 1,
    title: `Resolve blocked task: ${task.name}`,
    detail: task.notes || 'Downstream schedule work may be delayed.',
    tab: 'Schedule',
  }))

  metrics.schedule.readyInspections.forEach(task => actions.push({
    id: `inspection-${task.id}`,
    type: 'inspection',
    priority: 2,
    title: `Schedule ${task.name}`,
    detail: 'All predecessor work is complete and the inspection gate is ready.',
    tab: 'Schedule',
  }))

  if (metrics.procurement.pendingBids.length) actions.push({
    id: 'pending-bids',
    type: 'bid',
    priority: 3,
    title: `Review ${metrics.procurement.pendingBids.length} pending bid${metrics.procurement.pendingBids.length === 1 ? '' : 's'}`,
    detail: 'Accepting a bid connects it to the project budget and schedule.',
    tab: 'Bids',
  })

  if (metrics.procurement.tbdSelections.length) actions.push({
    id: 'tbd-selections',
    type: 'decision',
    priority: 4,
    title: `${metrics.procurement.tbdSelections.length} selections still TBD`,
    detail: 'Review unresolved product decisions before they affect procurement.',
    tab: 'Selections',
  })

  if (metrics.financials.variance > 0) actions.push({
    id: 'budget-variance',
    type: 'budget',
    priority: 2,
    title: 'Current forecast exceeds the working budget',
    detail: `Forecast variance is ${formatCurrency(metrics.financials.variance)}.`,
    tab: 'Budget',
  })

  return actions.sort((a, b) => a.priority - b.priority)
}

export function formatCurrency(value) {
  return Number(value || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function minValue(values) {
  const populated = values.filter(Boolean)
  return populated.length ? populated.sort()[0] : null
}

function maxValue(values) {
  const populated = values.filter(Boolean)
  return populated.length ? populated.sort().at(-1) : null
}

function toLocalDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
